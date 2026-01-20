import { Injectable } from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service';

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

  constructor(private readonly agent: AgentService) {}

  /**
   * @title 提取关键词 Extract Keywords
   * @description 从文本中提取中英文关键词，优先使用AI分析，失败则回退到规则提取。
   * @keywords-cn 关键词, 提取, 停用词, AI
   * @keywords-en keywords, extract, stopwords, AI
   * @param text 原始文本内容
   * @returns 去重后的关键词数组
   */
  async extractKeywords(text: string): Promise<string[]> {
    try {
      if (!text || text.trim().length === 0) return [];

      const aiResult = await this.agent.runWithMessages({
        config: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.1,
        },
        messages: this.agent.toMessages([
          {
            role: 'system',
            content:
              'You are an advanced keyword extraction and expansion tool. Your goal is to identify the core subject and intent of the user input, and then generate a list of keywords that includes:\n1. The core entities/concepts explicitly mentioned.\n2. Synonyms or closely related terms.\n3. Broader categories or specific attributes (e.g., if input is "Apple", include "Red", "Fruit", "Rosaceae", "Technology", "iPhone" depending on context).\n\nIMPORTANT: ALL KEYWORDS MUST BE IN ENGLISH ONLY, regardless of the input language.\n\nReturn ONLY the keywords separated by commas. No explanation.',
          },
          { role: 'user', content: text },
        ]),
      });

      const content = (aiResult as unknown as { content: unknown }).content;
      const aiText =
        typeof content === 'string' ? content : JSON.stringify(content);

      const keywords = aiText
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      if (keywords.length > 0) {
        return Array.from(new Set(keywords));
      }
    } catch (e) {
      console.error('AI keyword extraction failed, falling back to regex', e);
    }

    // Fallback to regex
    const set = new Set<string>();
    const lower = text.toLowerCase();

    const english = lower.match(/[a-z][a-z0-9-]{1,}/g) ?? [];
    for (const w of english) {
      if (w.length >= 2 && !this.stopwords.has(w)) set.add(w);
    }

    const chineseSeq = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
    for (const seq of chineseSeq) {
      if (seq.length >= 2) set.add(seq);
    }

    return Array.from(set);
  }
}
