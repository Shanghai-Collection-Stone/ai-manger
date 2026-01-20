import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams, BaseMessage } from 'langchain';
import * as z from 'zod';
import { AgentService } from '../../../ai-agent/services/agent.service.js';
import { ContextService } from '../../../context/services/context.service.js';
import { ConversationEntity } from '../../../context/entities/conversation.entity.js';

/**
 * @title 会话标题函数服务 Title Function Call Service
 * @description 基于首轮问答生成简洁会话标题，并持久化到会话。
 * @keywords-cn 会话标题, 函数调用, 首轮问答
 * @keywords-en session title, function-call, first turn
 */
@Injectable()
export class TitleFunctionCallService {
  constructor(
    private readonly agent: AgentService,
    private readonly ctx: ContextService,
  ) {}

  /**
   * @title 获取函数句柄 Get Handle
   * @description 返回用于生成并持久化标题的函数句柄。
   * @keywords-cn 句柄, 标题生成
   * @keywords-en handle, title generation
   */
  getHandle(): CreateAgentParams['tools'] {
    const titleGenerate = tool(
      async ({ sessionId, question, answer, language }) => {
        const sys = [
          '你是一个会话标题生成器。根据第一轮问答内容生成简短而准确的会话标题。',
          '要求：不超过24个字符；避免冗长；避免标点结尾；突出主题。',
          'language=en 时使用英文，否则使用中文。',
        ].join('\n');

        const prompt = `Q: ${question}\nA: ${answer ?? ''}\nlanguage: ${language ?? 'zh'}`;
        const messages: BaseMessage[] = this.agent.toMessages([
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ]);

        const ai = await this.agent.runWithMessages({
          config: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            temperature: 0.3,
          },
          messages,
        });
        const content = (ai as unknown as { content: unknown }).content;
        const raw =
          typeof content === 'string' ? content : JSON.stringify(content);
        const title = raw.trim().slice(0, 24);
        await this.ctx.setTitle(sessionId, title);
        return JSON.stringify({ sessionId, title });
      },
      {
        name: 'title_generate',
        description:
          'Generate a concise session title from first Q/A and persist it to the conversation.',
        schema: z.object({
          sessionId: z.string().describe('Context sessionId to persist title'),
          question: z.string().describe('First user question'),
          answer: z.string().optional().describe('First assistant answer'),
          language: z
            .enum(['zh', 'en'])
            .optional()
            .describe('Preferred language'),
        }),
      },
    );

    return [titleGenerate];
  }

  /**
   * @title 首轮自动生成 Ensure First-Turn Title
   * @description 若会话无标题，基于前两条消息生成并持久化标题。
   * @keywords-cn 首轮生成, 自动标题
   * @keywords-en first turn, auto title
   */
  async ensureFirstTurnTitle(sessionId: string): Promise<string | undefined> {
    const meta: ConversationEntity | null =
      await this.ctx.getConversation(sessionId);
    if (meta?.title && meta.title.trim().length > 0) return meta.title;

    const msgs = await this.ctx.getMessages(sessionId, 2);
    if (msgs.length === 0) return undefined;
    const q = msgs[0]?.content ?? '';
    const a = msgs[1]?.content ?? '';

    const sys = [
      '你是一个会话标题生成器。根据第一轮问答内容生成简短而准确的会话标题。',
      '要求：不超过24个字符；避免冗长；避免标点结尾；突出主题。',
      '默认使用中文。',
    ].join('\n');

    const messages: BaseMessage[] = this.agent.toMessages([
      { role: 'system', content: sys },
      { role: 'user', content: `Q: ${q}\nA: ${a}` },
    ]);
    const ai = await this.agent.runWithMessages({
      config: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.3,
      },
      messages,
    });
    const content = (ai as unknown as { content: unknown }).content;
    const raw = typeof content === 'string' ? content : JSON.stringify(content);
    const title = raw.trim().slice(0, 24);
    await this.ctx.setTitle(sessionId, title);
    return title;
  }
}
