/**
 * @title Supervisor Intent Service
 * @description 意图识别 + 专家直派。**不再使用 LangGraph StateGraph**。
 *   两步走:
 *   ① recognizeIntent —— 一次独立的轻量 LLM 调用,读取**全部对话历史**,在提示词
 *      强约束下只输出一个路由词(image/article/data/frontend/publisher/chat),
 *      代码 parseRouteToken 硬解析,解析不到再走关键词/延续兜底。
 *   ② buildExpertAgent —— 按路由词在代码层选定单个专家,构建 createReactAgent
 *      实例(业务专家带真实工具 / chat 带空工具),交给 agent.service.stream
 *      当 preBuiltAgent 正常流式消费,原有处理逻辑完全不变。
 *   放弃 StateGraph 的原因: supervisor 作为图节点时,minimax 等模型会被多代理
 *   执行上下文带偏(模仿历史里的工具调用、不老实输出路由词),且 Command(goto)
 *   跨子图不稳定。拆成"独立意图调用 + 代码选专家"后,路由层和执行层彻底解耦。
 * @keywords-cn 意图识别, 路由, 专家直派, supervisor
 * @keywords-en intent recognition, routing, expert dispatch, supervisor
 */
import { Injectable, Logger } from '@nestjs/common';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredTool } from '@langchain/core/tools';

/**
 * @description 6 个业务专家名。
 *   image: 图组Canvas + 图库搜图 + 封面 + 拼图
 *   article: 文章正文生成 + 选题编排
 *   data: 数据查询/统计/趋势分析 + 决策卡/方案建议
 *   frontend: 图表/HTML 可视化生成
 *   publisher: 批量发布/内容分发/机器人发布执行
 *   task: 任务编排(待办/工单的创建、编排、管理)
 * @keyword-en business expert names
 */
export type ExpertName =
  | 'image'
  | 'article'
  | 'data'
  | 'frontend'
  | 'publisher'
  | 'task';

/**
 * @description 意图识别的路由目标。5 个业务专家 + 'chat'(指挥官闲聊/通用对话)。
 * @keyword-en intent route target including chat fallback
 */
export type RouteTarget = ExpertName | 'chat';

/**
 * @description 关键词规则推断用户意图对应的专家。供意图识别 LLM 没吐出可识别路由
 *   token 时做兜底。返回 null 表示无明确意图。
 * @keyword-en infer expert by keyword fallback
 */
function inferExpertByKeyword(text: string): ExpertName | null {
  const s = String(text ?? '');
  if (/图组|拼图|封面|配图|海报|生成图|做图|出图|图片组|标签|tag\s*选|选标签/i.test(s))
    return 'image';
  if (/文章|正文|选题|文案|种草|小红书内容|写[一几]?篇/.test(s)) return 'article';
  if (/数据|统计|分析|趋势|业绩|订单|客流|报表|决策|方案|策略|建议/.test(s))
    return 'data';
  if (/图表|可视化|dashboard|看板页|html页/.test(s)) return 'frontend';
  if (/批量发布|定时发|发布任务|内容分发|批量任务/.test(s)) return 'publisher';
  if (/待办|todo|工单|排期|任务编排|任务清单|任务列表|创建任务|新建任务|安排任务/i.test(s))
    return 'task';
  return null;
}

/**
 * @description 判断用户消息是否是"延续上一轮任务"的口吻(再来一组/继续等)。
 * @keyword-en detect continuation intent
 */
function isContinuationText(text: string): boolean {
  return /再来|再生成|再做|再一?组|又一|多来|继续|接着|那再|下一?组|换一?组|选定标签|我选/.test(
    String(text ?? ''),
  );
}

/**
 * @description 从 BaseMessage 的 content(string 或多模态数组)提取纯文本。
 * @keyword-en extract plain text from message content
 */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && 'text' in b
          ? String((b as { text?: unknown }).text ?? '')
          : '',
      )
      .join(' ');
  }
  return '';
}

/**
 * @description 从意图识别 LLM 的纯文本回复里硬解析路由 token。
 *   提示词约束它只输出 image/article/data/frontend/publisher/chat 之一,
 *   本函数容错: 先 trim+lowercase 整体比对,再正则取首个以单词边界命中的 route 词。
 *   不用 tool calling —— minimax 等模型对"长 prompt + bindTools"极不稳定。
 *   返回 null 表示没解析出有效路由。
 * @keyword-en parse route token from intent llm plain text reply
 */
function parseRouteToken(text: string): RouteTarget | null {
  const all: RouteTarget[] = [
    'image',
    'article',
    'data',
    'frontend',
    'publisher',
    'task',
    'chat',
  ];
  const s = String(text ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const exact = all.find((r) => r === s);
  if (exact) return exact;
  const m = /\b(image|article|data|frontend|publisher|task|chat)\b/.exec(s);
  return (m?.[1] as RouteTarget | undefined) ?? null;
}

/**
 * @description 专家配置:供外部(chat.service)按 sessionType/scope 构造。
 *   每个专家由 systemPrompt + tools 描述,buildExpertAgent 内部把它包装成
 *   createReactAgent 实例。
 */
export interface ExpertSpec {
  /** @description 专家唯一标识 */
  name: ExpertName;
  /** @description 专家描述(诊断/日志用) */
  description: string;
  /** @description 该专家的系统提示词 */
  systemPrompt: string;
  /** @description 该专家可调用的工具 */
  tools: StructuredTool[];
}

/** @description createReactAgent 的 llm 入参类型 */
type AgentLLM = Parameters<typeof createReactAgent>[0]['llm'];
/** @description createReactAgent 的 checkpointer 入参类型 */
type AgentCheckpointer = Parameters<typeof createReactAgent>[0]['checkpointer'];

/**
 * @description recognizeIntent 入参。
 */
export interface RecognizeIntentOptions {
  /** @description 意图识别系统提示词(强约束只输出一个路由词) */
  systemPrompt: string;
  /** @description 全部对话历史(意图识别必须看完整历史才能精准判定延续性) */
  history: BaseMessage[];
  /** @description 意图识别用的轻量 LLM(temperature=0) */
  llm: AgentLLM;
  /** @description 上一轮激活专家(actionSession),用于延续判定兜底 */
  currentActionSession?: ExpertName | null;
}

/**
 * @description buildExpertAgent 入参。
 */
export interface BuildExpertAgentOptions {
  /** @description 意图识别得出的路由目标 */
  route: RouteTarget;
  /** @description 5 个业务专家配置(用于按 route 取对应专家的 prompt+tools) */
  experts: ExpertSpec[];
  /** @description chat 路由用的指挥官闲聊/通用对话系统提示词 */
  chatExpertPrompt: string;
  /** @description 业务专家节点使用的 LLM */
  expertLLM: AgentLLM;
  /** @description chat 节点使用的 LLM */
  chatLLM: AgentLLM;
  /** @description LangGraph checkpointer(MongoDBSaver),按 thread_id 持久化 state */
  checkpointer?: AgentCheckpointer;
}

@Injectable()
export class SupervisorGraphService {
  private readonly logger = new Logger(SupervisorGraphService.name);

  /**
   * @description 第一步: 意图识别。一次独立的轻量 LLM 调用,读全部历史,在提示词
   *   强约束下只输出一个路由词,代码 parseRouteToken 硬解析。**不是 tool 调用,不是
   *   graph 节点** —— 就是一次普通的 invoke。解析不到 → 关键词规则 / 延续上轮专家
   *   兜底 → 都没有则 'chat'。永远返回一个有效 RouteTarget,绝不抛错。
   * @keyword-en recognize intent via standalone llm call
   */
  async recognizeIntent(opts: RecognizeIntentOptions): Promise<RouteTarget> {
    const { systemPrompt, history, llm, currentActionSession } = opts;
    let respText = '';
    try {
      const resp = await (
        llm as unknown as {
          invoke: (msgs: BaseMessage[]) => Promise<{ content?: unknown }>;
        }
      ).invoke([new SystemMessage(systemPrompt), ...history]);
      respText = extractMessageText(resp.content);
    } catch (e) {
      this.logger.warn(`[intent] llm invoke 失败: ${String(e)}`);
    }
    this.logger.log(
      `[intent] msgIn=${history.length} resp="${respText.trim().slice(0, 120)}"`,
    );

    // 决策 1: 从纯文本回复硬解析路由 token(含 'chat')。
    const parsed = parseRouteToken(respText);
    if (parsed) {
      this.logger.log(`[intent] → ${parsed} (LLM 路由)`);
      return parsed;
    }

    // 决策 2: 没解析出 token → 关键词规则 / 延续上轮专家兜底。
    const userText = this.lastHumanText(history);
    let fallback = inferExpertByKeyword(userText);
    if (!fallback && currentActionSession && isContinuationText(userText)) {
      fallback = currentActionSession;
    }
    const route: RouteTarget = fallback ?? 'chat';
    this.logger.log(
      `[intent] → ${route} (兜底: ${fallback ? '关键词/延续' : 'chat'} userText="${userText.slice(0, 40)}")`,
    );
    return route;
  }

  /**
   * @description 第二步: 专家直派。按意图识别得出的 route,在代码层选定单个专家,
   *   构建 createReactAgent 实例返回。业务专家带真实工具,chat 带空工具。
   *   返回值交给 agent.service.stream 当 preBuiltAgent 正常流式消费 ——
   *   不经过任何 graph,原有 stream 处理逻辑完全不变。
   * @keyword-en build single expert agent by route
   */
  buildExpertAgent(opts: BuildExpertAgentOptions) {
    const { route, experts, chatExpertPrompt, expertLLM, chatLLM, checkpointer } =
      opts;
    if (route === 'chat') {
      return createReactAgent({
        llm: chatLLM,
        tools: [],
        prompt: chatExpertPrompt,
        checkpointer,
      });
    }
    const spec = experts.find((e) => e.name === route);
    if (!spec) {
      // 路由词没对应专家配置(理论上不会) → 降级 chat,避免整链空转。
      this.logger.warn(`[intent] route=${route} 无对应专家配置,降级 chat`);
      return createReactAgent({
        llm: chatLLM,
        tools: [],
        prompt: chatExpertPrompt,
        checkpointer,
      });
    }
    this.logger.log(
      `[intent] buildExpertAgent → ${route} (tools=${spec.tools.length})`,
    );
    return createReactAgent({
      llm: expertLLM,
      tools: spec.tools,
      prompt: spec.systemPrompt,
      checkpointer,
    });
  }

  /**
   * @description 取历史里最后一条用户消息的纯文本,供关键词兜底。
   * @keyword-en extract last human message text
   */
  private lastHumanText(history: BaseMessage[]): string {
    const lastHuman = [...history]
      .reverse()
      .find(
        (m) =>
          (m as { _getType?: () => string })._getType?.() === 'human' ||
          (m as { type?: string }).type === 'human',
      );
    return lastHuman
      ? extractMessageText((lastHuman as { content?: unknown }).content)
      : '';
  }

  /**
   * @description 给定 sessionType 是否应该走意图识别 + 专家直派路径。
   *   目前只 default 走;其他 sessionType(xhs-image-expert 等显式专家模式)
   *   保留原 deepagents 路径不动。
   * @keyword-en should use intent routing for session type
   */
  shouldUseSupervisor(sessionType: string): boolean {
    return sessionType === 'default';
  }
}
