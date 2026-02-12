/**
 * @description Checkpoint 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword checkpoint, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Checkpoint',
  purpose: 'LangGraph Checkpoint 的Mongo持久化适配',
  description:
    '该模块封装 LangGraph MongoDBSaver，用于将Agent运行过程中的checkpoint持久化到MongoDB，支持读取、写入与线程删除等基础能力。',
  keywords: ['checkpoint', 'langgraph', 'mongodb', 'saver', 'persistence'],
  dependencies: [
    '@nestjs/common',
    '@nestjs/config',
    '@langchain/langgraph-checkpoint',
    '@langchain/langgraph-checkpoint-mongodb',
    'mongodb',
  ],
  lastUpdated: '2026-02-04',
  files: {
    '服务/Service': 'src/modules/checkpoint/services/checkpoint.service.ts',
  },
};
