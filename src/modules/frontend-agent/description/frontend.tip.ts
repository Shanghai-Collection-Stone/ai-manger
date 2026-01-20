import { createHash } from 'crypto';

/**
 * @title 模块描述 Frontend Agent Tip
 * @description 前端页生成模块：关键词、文件映射与函数哈希。
 * @keywords-cn 前端, 页面生成, 图表, 表格, Markdown
 * @keywords-en frontend, page generation, chart, table, markdown
 */
export const moduleTip = {
  keywordsCn: ['前端', '页面', '图表', '表格', 'Markdown', 'Agent', '服务'],
  keywordsEn: [
    'frontend',
    'page',
    'chart',
    'table',
    'markdown',
    'agent',
    'service',
  ],
  files: {
    '服务/Service': 'src/modules/frontend-agent/services/frontend.service.ts',
    '类型/Types': 'src/modules/frontend-agent/types/frontend.types.ts',
  },
  functionMap: {
    '生成页面/generate page': {
      name: 'generatePage',
      hash: sha(
        'src/modules/frontend-agent/services/frontend.service.ts#generatePage',
      ),
    },
    '获取句柄/get handle': {
      name: 'getHandle',
      hash: sha(
        'src/modules/frontend-agent/services/frontend.service.ts#getHandle',
      ),
    },
  },
  description:
    '前端页Agent模块：生成结构化的图表、表格与富Markdown页面，满足可视化需求。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
