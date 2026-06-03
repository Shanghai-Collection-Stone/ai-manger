/**
 * @title Supervisor Intent Service
 * @description 意图识别 + 专家直派。**不再使用 LangGraph StateGraph**。
 *   两步走:
 *   ① recognizeIntent —— 先走代码层 tag 承接/显式跨领域关键词切换/弱短句承上规则,仍不确定时再用轻量 LLM
 *      读取 JSON 化的 fullDialog/recentDialog,在提示词强约束下只输出一个路由词
 *      (image/article/data/frontend/publisher/task/chat),代码 parseRouteToken
 *      硬解析,解析不到再走关键词/延续兜底。
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
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
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
  const wantsArticle =
    /文章|正文|选题|文案|种草|小红书内容|写文|图文|全套|也写文|一并出文|生成\s*\d+\s*篇|写\s*\d+\s*篇|来\s*\d+\s*篇|生成[一二两三四五六七八九十几]篇|写[一二两三四五六七八九十几]篇|来[一二两三四五六七八九十几]篇/.test(
      s,
    );
  const wantsImage =
    /图组|图片组|image-group|拼图|封面|配图|海报|生成图|做图|出图|标签|tag\s*选|选标签/i.test(
      s,
    );
  if (wantsArticle) return 'article';
  if (wantsImage) return 'image';
  if (
    /图组|拼图|封面|配图|海报|生成图|做图|出图|图片组|标签|tag\s*选|选标签/i.test(
      s,
    )
  )
    return 'image';
  if (/文章|正文|选题|文案|种草|小红书内容|写[一几]?篇/.test(s))
    return 'article';
  if (/图表|可视化|dashboard|看板页|html页/.test(s)) return 'frontend';
  if (
    /数据|统计|分析|趋势|业绩|营业额|营收|收入|销售额|流水|订单|客流|需求进入|工作流|粉丝|点赞|收藏|评论|互动|爆文|竞品|账号数据|数据追踪|采集|报表|决策|方案|策略|建议/.test(
      s,
    )
  )
    return 'data';
  if (
    /批量发布|定时发|发布任务|内容分发|批量任务|发文|发布|账号池|adspower|小红书发布/.test(
      s,
    )
  )
    return 'publisher';
  if (
    /待办|todo|工单|排期|任务编排|任务清单|任务列表|创建任务|新建任务|安排任务/i.test(
      s,
    )
  )
    return 'task';
  return null;
}

/**
 * @description 判断用户消息是否是"延续上一轮任务"的口吻(再来一组/继续等)。
 * @keyword-cn 意图承接, 专家延续
 * @keyword-en continuation-intent, intent-routing
 */
function isContinuationText(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (/^(好的?|嗯+|行|可以|可以了|没问题|确认|收到|明白|ok)$/i.test(s)) {
    return true;
  }
  if (isTagWorkflowText(s)) return true;
  return /再来|再生成|再做|再一?组|又一|多来|继续|接着|那再|那就|就按|就看|就用|也看|也要|一并|一起|都看|下一?组|换一?组|选定标签|我选|开始生成|开始吧|开始|生成吧|开干|执行|派单|正式派单|确认|就这样|就好了|按这个|按.*(?:来|算|筛|看)|照这个|走起|搞起|上周|本周|这周|上月|本月|昨天|今天|明天|时间范围|口径|条件|补上|加上/.test(
    s,
  );
}

/**
 * @description 判断用户是否明确结束当前业务链路或切回普通对话。
 * @keyword-cn 退出业务, 闲聊切换, 意图识别
 * @keyword-en action-exit, chat-switch, intent-routing
 */
function isActionExitText(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return (
    /^(不用了|算了|取消|结束|停止|暂停|先这样|先到这|不做了|不用看了|先不做了)$/i.test(
      s,
    ) ||
    /换个话题|聊点别的|先聊|退出当前|结束当前|不用继续|不要继续|停止执行|取消任务/.test(
      s,
    )
  );
}

/**
 * @description 识别业务链路里的追问、核对、补字段、补口径等短句承接。
 * @keyword-cn 业务追问, 专家承接, 意图识别
 * @keyword-en business-follow-up, action-continuation, intent-routing
 */
function isBusinessFollowUpText(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return /确定|确认|核对|再查|再看|看看|看下|有没有|是否|是不是|没有提到|没提到|表中|表里|字段|备注|原因|口径|来源|明细|详情|刚才|刚刚|上面|前面|这个|那个|这些|那条|里面|还有吗|呢|吗|为什么|怎么回事|补充|换成|改成|按这个|就这个/.test(
    s,
  );
}

/**
 * @description 判断当前用户输入是否应优先延续上一轮已激活专家,用于避免短确认、
 *   时间范围补充、指标口径补充被意图 LLM 误归类为 chat。
 * @keyword-cn 意图识别, 专家延续, 上下文路由
 * @keyword-en action-continuation, intent-routing
 */
function shouldContinueCurrentAction(
  text: string,
  currentActionSession?: ExpertName | null,
): currentActionSession is ExpertName {
  return (
    Boolean(currentActionSession) &&
    !isActionExitText(text) &&
    (isContinuationText(text) || isBusinessFollowUpText(text))
  );
}

/**
 * @description 判断本轮是否在询问 AI 指挥官身份、能力或用法。此类元问题必须走 chat,
 *   不应受上一轮 actionSession 或 LLM 解释文本中的专家词影响。
 * @keyword-cn 指挥官元问题, 能力询问, 意图识别
 * @keyword-en commander-meta-question, capability-query, intent-routing
 */
function isCommanderMetaQuestion(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return (
    /你是谁|你是(谁|什么)|你叫什么|介绍(一下)?你自己/.test(s) ||
    /你(能|可以|会|擅长).{0,8}(干嘛|干什么|做什么|做些?啥|帮我做什么)/.test(
      s,
    ) ||
    /(能干嘛|能做什么|可以做什么|会做什么|有什么功能|功能介绍|能力介绍|能力说明|怎么用|如何使用|使用说明)/.test(
      s,
    )
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
 * @description 截断单条对话文本,避免弱上下文模型被过长历史稀释。
 * @keyword-cn 意图识别, 上下文压缩
 * @keyword-en intent-context, truncate-text
 */
function truncateIntentText(text: string, maxLength = 900): string {
  const s = String(text ?? '').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength)}...`;
}

/**
 * @description 把完整消息整理成 user/assistant 对话,用于以单条 JSON
 *   user message 喂给意图识别模型。
 * @keyword-cn 意图识别, 结构化上下文
 * @keyword-en intent-context, full-json-history
 */
function buildDialogTurns(history: BaseMessage[]): Array<{
  assistant?: string;
  user?: string;
}> {
  const turns: Array<{ assistant?: string; user?: string }> = [];
  let current: { assistant?: string; user?: string } | null = null;

  for (const msg of history) {
    const type = (msg as { _getType?: () => string })._getType?.();
    if (type !== 'human' && type !== 'ai') continue;
    const text = truncateIntentText(
      extractMessageText((msg as { content?: unknown }).content),
    );
    if (!text) continue;

    if (type === 'human') {
      current = { user: text };
      turns.push(current);
      continue;
    }

    if (!current || current.assistant) {
      current = { assistant: text };
      turns.push(current);
      continue;
    }
    current.assistant = text;
  }

  return turns;
}

/**
 * @description 判断是否处于小红书图组/图文的标签选择链路。
 * @keyword-cn 标签选择, 意图承接, 小红书
 * @keyword-en tag-workflow, intent-continuation
 */
function isTagWorkflowText(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return /我选定标签|选定标签|已选标签|标签[:：]|tag[:：]|#[^\s#]+|(?:有哪些|有什么|可用|看看|看下|列出|查看|选择|选一下|挑一下|我想选).*?(?:tag|标签)|(?:tag|标签).*?(?:有哪些|有什么|可用|看看|看下|列出|查看|选择|选一下|挑一下|我想选)/i.test(
    s,
  );
}

/**
 * @description 从完整结构化对话中截取最近 10 组,作为意图识别的近端摘要。
 * @keyword-cn 意图识别, 最近上下文
 * @keyword-en intent-context, recent-json-history
 */
function buildRecentDialogTurns(history: BaseMessage[]): Array<{
  assistant?: string;
  user?: string;
}> {
  return buildDialogTurns(history).slice(-10);
}

/**
 * @description 构建意图识别专用 JSON 上下文消息。模型只看系统路由规则和这一条
 *   JSON,不再靠普通多轮消息隐式理解历史。
 * @keyword-cn 意图识别, 结构化上下文
 * @keyword-en intent-context, json-history
 */
function buildIntentContextMessage(
  history: BaseMessage[],
  currentActionSession?: ExpertName | null,
): HumanMessage {
  const fullDialog = buildDialogTurns(history);
  const recentDialog = buildRecentDialogTurns(history);
  const latestUserMessage = recentDialog
    .slice()
    .reverse()
    .find((turn) => turn.user)?.user;
  return new HumanMessage(
    JSON.stringify(
      {
        instruction:
          '请基于 currentActionSession、latestUserMessage、fullDialog 和 recentDialog 判断本轮用户意图。fullDialog 是完整清洗历史,recentDialog 只是最近片段。只输出 image/article/data/frontend/publisher/task/chat 之一。',
        currentActionSession: currentActionSession ?? null,
        latestUserMessage: latestUserMessage ?? '',
        fullDialog,
        recentDialog,
      },
      null,
      2,
    ),
  );
}

/**
 * @description 从意图识别 LLM 的纯文本回复里硬解析路由 token。
 *   提示词约束它只输出 image/article/data/frontend/publisher/task/chat 之一,
 *   本函数容错: 先 trim+lowercase 整体比对;若不是精确单词,只在全文唯一出现
 *   一个 route 词时采信。若解释文本里同时出现 actionSession=image 与 chat,
 *   返回 null 交给确定性兜底,避免被第一个专家词误导。
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
  const matches = Array.from(
    s.matchAll(/\b(image|article|data|frontend|publisher|task|chat)\b/g),
  ).map((m) => m[1] as RouteTarget);
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0] : null;
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
  /** @description 清洗后的对话历史,会被整理成 fullDialog + recentDialog JSON 上下文 */
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
   * @description 第一步: 意图识别。先用代码层处理元问题、显式退出、tag 承接、显式跨领域关键词切换和弱短句承上。
   *   仍不确定时再用轻量 LLM 读 JSON 化 fullDialog/recentDialog,在提示词强约束下只输出一个路由词。
   *   **不是 tool 调用,不是 graph 节点** —— 就是一次普通的 invoke。
   *   解析不到 → 关键词规则 / 延续上轮专家
   *   兜底 → 都没有则 'chat'。永远返回一个有效 RouteTarget,绝不抛错。
   * @keyword-en recognize intent via standalone llm call
   */
  async recognizeIntent(opts: RecognizeIntentOptions): Promise<RouteTarget> {
    const { systemPrompt, history, llm, currentActionSession } = opts;
    const userText = this.lastHumanText(history);
    if (isCommanderMetaQuestion(userText)) {
      this.logger.log(`[intent] → chat (指挥官元问题)`);
      return 'chat';
    }
    if (isActionExitText(userText)) {
      this.logger.log(`[intent] → chat (用户结束/切换当前业务链路)`);
      return 'chat';
    }

    const isTagSelectionContinuation =
      Boolean(currentActionSession) && isTagWorkflowText(userText);
    if (isTagSelectionContinuation) {
      this.logger.log(`[intent] -> ${currentActionSession} (tag continuation)`);
      return currentActionSession!;
    }
    const keywordFallback = inferExpertByKeyword(userText);
    if (keywordFallback && keywordFallback !== currentActionSession) {
      this.logger.log(
        `[intent] -> ${keywordFallback} (explicit keyword switch, current=${currentActionSession ?? 'none'})`,
      );
      return keywordFallback;
    }
    const shouldContinue = shouldContinueCurrentAction(
      userText,
      currentActionSession,
    );
    if (shouldContinue || isTagSelectionContinuation) {
      this.logger.log(
        `[intent] → ${currentActionSession} (actionSession 确定性承上)`,
      );
      return currentActionSession!;
    }
    if (keywordFallback) {
      this.logger.log(`[intent] → ${keywordFallback} (关键词确定性路由)`);
      return keywordFallback;
    }

    let respText = '';
    try {
      const resp = await (
        llm as unknown as {
          invoke: (msgs: BaseMessage[]) => Promise<{ content?: unknown }>;
        }
      ).invoke([
        new SystemMessage(systemPrompt),
        buildIntentContextMessage(history, currentActionSession),
      ]);
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
      let route: RouteTarget = parsed;
      if (isTagSelectionContinuation) {
        route = currentActionSession!;
      } else if (parsed === 'chat' && keywordFallback) {
        route = keywordFallback;
      } else if (parsed === 'chat' && shouldContinue) {
        route = currentActionSession!;
      }
      this.logger.log(`[intent] → ${route} (LLM 路由)`);
      return route;
    }

    // 决策 2: 没解析出 token → 关键词规则 / 延续上轮专家兜底。
    let fallback = isTagSelectionContinuation
      ? currentActionSession!
      : keywordFallback;
    if (!fallback && shouldContinue) {
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
    const {
      route,
      experts,
      chatExpertPrompt,
      expertLLM,
      chatLLM,
      checkpointer,
    } = opts;
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
   *   default 与 xhs-specialist 走自动路由;其他显式专家 sessionType 保留原
   *   deepagents 路径不动。
   * @keyword-en should use intent routing for session type
   */
  shouldUseSupervisor(sessionType: string): boolean {
    return sessionType === 'default' || sessionType === 'xhs-specialist';
  }
}
