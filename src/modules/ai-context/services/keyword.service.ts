import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentService } from '../../ai-agent/services/agent.service';
import { AdminService } from '../../admin/services/admin.service';

/**
 * @title 关键词服务 Keyword Service
 * @description 提取消息中的关键词，支持中英文基本规则与AI分析。
 * @keywords-cn 关键词, 提取, AI分析
 * @keywords-en keywords, extract, AI analysis
 */
@Injectable()
export class KeywordService {
  private readonly stopwords = new Set<string>([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'have',
    'has',
    'are',
    'was',
    'were',
    'is',
    'of',
    'to',
    'in',
    'on',
    'at',
    'by',
    'it',
    'be',
    'a',
    'an',
    'or',
    'as',
    'but',
    'not',
    'can',
    'could',
    'should',
    'would',
    'will',
    'do',
    'does',
    'did',
  ]);

  constructor(
    private readonly agent: AgentService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @title 提取关键词 Extract Keywords
   * @description 从文本中提取中英文关键词，优先使用AI分析，失败则回退到规则提取。
   * @keywords-cn 关键词, 提取, 停用词, AI
   * @keywords-en keywords, extract, stopwords, AI
   * @param text 原始文本内容
   * @returns 去重后的关键词数组
   */
  async extractKeywords(text: string, tenantId?: string): Promise<string[]> {
    let aiConfig:
      | {
          provider: string;
          model: string;
          apiKey?: string;
          baseUrl?: string;
        }
      | undefined;
    try {
      if (!text || text.trim().length === 0) return [];
      const normalizedText = this.normalizeKeywordInput(text);
      if (normalizedText.length === 0) return [];
      aiConfig = await this.resolveKeywordAiConfig();

      const llm = await this.agent.buildLLM({
        provider: aiConfig.provider,
        model: aiConfig.model,
        temperature: 0.1,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        tenantId,
      });
      const aiResult = await llm.invoke([
        new SystemMessage(
          'You are an advanced keyword extraction and expansion tool. Your goal is to identify the core subject and intent of the user input, and then generate a list of keywords that includes:\n1. The core entities/concepts explicitly mentioned.\n2. Synonyms or closely related terms.\n3. Broader categories or specific attributes (e.g., if input is "Apple", include "Red", "Fruit", "Rosaceae", "Technology", "iPhone" depending on context).\n\nIMPORTANT: ALL KEYWORDS MUST BE IN ENGLISH ONLY, regardless of the input language.\n\nReturn ONLY the keywords separated by commas. No explanation.',
        ),
        new HumanMessage(normalizedText),
      ]);

      const aiText = this.toPlainText(
        (aiResult as unknown as { content: unknown }).content,
      );

      const keywords = aiText
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      if (keywords.length > 0) {
        return Array.from(new Set(keywords));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/invalid chat setting|2013/i.test(msg)) {
        console.warn(
          'AI keyword extraction skipped due to model chat setting',
          {
            provider: aiConfig?.provider,
            model: aiConfig?.model,
          },
        );
      } else if (/999|1000|overload|api_error|unknown error/i.test(msg)) {
        // Anthropic / provider transient errors (overloaded, unknown error 999, etc.)
        console.warn(
          'AI keyword extraction skipped due to transient API error, falling back to regex',
          {
            provider: aiConfig?.provider,
            model: aiConfig?.model,
            error: msg.slice(0, 200),
          },
        );
      } else {
        console.error('AI keyword extraction failed, falling back to regex', e);
      }
    }

    // Fallback to regex
    const set = new Set<string>();
    const normalizedText = this.normalizeKeywordInput(text);
    const lower = normalizedText.toLowerCase();

    const english = lower.match(/[a-z][a-z0-9-]{1,}/g) ?? [];
    for (const w of english) {
      if (w.length >= 2 && !this.stopwords.has(w)) set.add(w);
    }

    const chineseSeq = normalizedText.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
    for (const seq of chineseSeq) {
      if (seq.length >= 2) set.add(seq);
    }

    return Array.from(set);
  }

  /**
   * @description 解析关键词模型配置
   * @keyword-en resolve keyword model config
   */
  private async resolveKeywordAiConfig(): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultAiProviderRuntime();
    if (runtime) {
      return {
        provider: runtime.providerCode,
        model: runtime.model || 'deepseek-ai/deepseek-v3.1-terminus',
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
      };
    }
    return {
      provider: 'nvidia',
      model: 'deepseek-ai/deepseek-v3.1-terminus',
    };
  }

  /**
   * @description 清洗关键词输入，移除伪参数标签与多余空白，防止模型误触发工具调用语义。
   * @keyword-en normalize keyword input
   */
  private normalizeKeywordInput(text: string): string {
    return String(text ?? '')
      .replace(/<parameter[^>]*>.*?<\/parameter>/gis, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @description 将模型 content 统一转为纯文本。
   * @keyword-en normalize model content text
   */
  private toPlainText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'text' in item) {
            const text = (item as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .join('\n');
    }
    return JSON.stringify(content ?? '');
  }
}
