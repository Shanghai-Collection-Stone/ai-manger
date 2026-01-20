import { createHash } from 'crypto';

/**
 * @title 模块描述 Ai-Context Module Tip
 * @description 关键词检索与滑动窗口相关的关键词、文件映射与函数哈希描述。
 * @keywords-cn 检索, 关键词, 滑动窗口, 控制器, 服务, 类型
 * @keywords-en retrieval, keywords, sliding window, controller, service, types
 */
export const moduleTip = {
  keywordsCn: ['检索', '关键词', '滑动窗口', '控制器', '服务', '类型'],
  keywordsEn: [
    'retrieval',
    'keywords',
    'sliding window',
    'controller',
    'service',
    'types',
  ],
  files: {
    '检索服务/Service': 'src/modules/ai-context/services/retrieval.service.ts',
    '关键词服务/Keyword': 'src/modules/ai-context/services/keyword.service.ts',
    '检索控制器/Controller':
      'src/modules/ai-context/controller/retrieval.controller.ts',
    '检索类型/Types': 'src/modules/ai-context/types/retrieval.types.ts',
  },
  functionMap: {
    '重建索引/reindex': {
      name: 'reindexSession',
      hash: sha(
        'src/modules/ai-context/services/retrieval.service.ts#reindexSession',
      ),
    },
    '关键词检索/search': {
      name: 'search',
      hash: sha('src/modules/ai-context/services/retrieval.service.ts#search'),
    },
    '滑动上下文/sliding': {
      name: 'getSlidingContext',
      hash: sha(
        'src/modules/ai-context/services/retrieval.service.ts#getSlidingContext',
      ),
    },
    '关键词提取/extractKeywords': {
      name: 'extractKeywords',
      hash: sha(
        'src/modules/ai-context/services/keyword.service.ts#extractKeywords',
      ),
    },
  },
  description:
    'AI上下文检索模块：提供关键词提取、命中检索与滑动窗口上下文构造能力。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
