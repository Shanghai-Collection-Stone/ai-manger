/**
 * @description Embedding 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword embedding, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Embedding',
  purpose: '提供文本向量化与余弦相似度计算能力',
  description:
    '该模块封装Google Generative AI的文本Embedding能力，提供单文本与批量向量化，并提供余弦相似度计算供向量检索回退策略使用。',
  keywords: [
    'embedding',
    'vector',
    'gemini-embedding-001',
    'google-genai',
    'cosine',
    'similarity',
    'langchain',
    'global',
  ],
  dependencies: ['@nestjs/common', '@langchain/google-genai'],
  lastUpdated: '2026-02-04',
  files: {
    '模块/Module': 'src/modules/shared/embedding/embedding.module.ts',
    '服务/Service': 'src/modules/shared/embedding/embedding.service.ts',
  },
};
