/**
 * @description Batch-Task 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword batch-task, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Batch-Task',
  purpose: '批量任务并行入队与待办池联动追踪',
  description:
    '该模块基于MongoDB存储批量发布任务，支持并行入队、重试退避、回调更新状态，并与Todo模块联动：任务总览映射为待办，单条发布映射为清单条目。',
  keywords: [
    'batch-task',
    'parallel',
    'pool',
    'retry',
    'backoff',
    'callback',
    'mcp',
    'todo-linkage',
    'publishing',
    'mongo',
  ],
  dependencies: [
    '@nestjs/common',
    'mongodb',
    'data-source module',
    'todo module',
    'mcp adapters',
  ],
  lastUpdated: '2026-02-05',
  files: {
    '控制器/Controller':
      'src/modules/batch-task/controller/batch-task.controller.ts',
    '服务/Service': 'src/modules/batch-task/services/batch-task.service.ts',
    '实体/Entity': 'src/modules/batch-task/entities/batch-task.entity.ts',
    '模块/Module': 'src/modules/batch-task/batch-task.module.ts',
  },
};
