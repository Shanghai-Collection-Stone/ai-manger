/**
 * @description Schema Function-Call 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword schema, function-call, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Schema-Function-Call',
  purpose: '为AI提供数据源Schema与查询能力的函数调用入口',
  description:
    '该模块将数据源的Schema检索与数据库查询能力封装为可被Agent调用的工具服务，依赖Data-Source模块对外提供统一数据访问层。',
  keywords: [
    'schema',
    'function-call',
    'tools',
    'data-source',
    'mongo',
    'query',
  ],
  dependencies: ['@nestjs/common', 'langchain', 'zod', 'data-source module'],
  lastUpdated: '2026-02-04',
  files: {
    '服务/Service':
      'src/modules/function-call/schema/services/schema.service.ts',
    '模块/Module': 'src/modules/function-call/schema/schema.module.ts',
  },
};
