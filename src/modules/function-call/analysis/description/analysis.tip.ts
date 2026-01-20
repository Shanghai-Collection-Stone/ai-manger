import { createHash } from 'crypto';

/**
 * @title 模块描述 Analysis Module Tip
 * @description 模块关键词、文件映射与函数哈希描述。
 * @keywords-cn 分析模块, 关键词对照, 函数哈希
 * @keywords-en analysis module, keywords mapping, function hash
 */
export const moduleTip = {
  keywordsCn: ['数据分析', 'Schema搜索', 'Mongo查询', 'Agent调用'],
  keywordsEn: ['data analysis', 'schema search', 'mongo query', 'agent call'],
  files: {
    '服务/Service':
      'src/modules/function-call/analysis/services/analysis.service.ts',
  },
  fileMap: {
    服务: 'src/modules/function-call/analysis/services/analysis.service.ts',
    service: 'src/modules/function-call/analysis/services/analysis.service.ts',
  },
  functionMap: {
    '获取句柄/getHandle': {
      name: 'getHandle',
      hash: sha(
        'src/modules/function-call/analysis/services/analysis.service.ts#getHandle',
      ),
    },
  },
  description:
    'Analysis模块：负责理解用户意图，通过Schema搜索与Mongo查询分析数据。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
