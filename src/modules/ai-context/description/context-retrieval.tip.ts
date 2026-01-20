import { createHash } from 'crypto';

/**
 * @title 检索模块描述 Context Retrieval Tip
 * @description 关键词检索与滑动窗口相关文件和函数映射。
 * @keywords-cn 检索, 关键词, 滑动窗口
 * @keywords-en retrieval, keywords, sliding window
 */
export const moduleTip = {
  files: {
    '检索/Service': 'src/modules/ai-context/services/retrieval.service.ts',
    '关键词/Keyword': 'src/modules/ai-context/services/keyword.service.ts',
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
    '关键词提取/extract': {
      name: 'extractKeywords',
      hash: sha(
        'src/modules/ai-context/services/keyword.service.ts#extractKeywords',
      ),
    },
  },
  description:
    '上下文检索模块描述：提供关键词检索、滑动窗口上下文构造与索引重建能力。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
