/**
 * @description Tools Function-Call 聚合模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword tools, function-call, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Function-Call-Tools',
  purpose: '聚合并导出可供Agent调用的工具集合',
  description:
    '该模块负责聚合各Function-Call子模块与工具服务，统一对外导出工具提供者，并对不再使用的工具进行统一过滤，便于在Agent运行时以依赖注入方式加载。',
  keywords: [
    'tools',
    'function-call',
    'aggregation',
    'langchain',
    'agent',
    'graph-workflow',
    'batch-publish',
    'mcp-batch-task',
    'gallery-tags',
    'gallery-search',
    'tool-filtering',
  ],
  dependencies: ['@nestjs/common', 'function-call modules'],
  lastUpdated: '2026-02-05',
  files: {
    '服务/Service': 'src/modules/function-call/tools/services/tools.service.ts',
    '模块/Module': 'src/modules/function-call/tools/tools.module.ts',
  },
};
