/**
 * @description Graph 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword graph, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Graph',
  purpose: '编排文章与批量发布的工作流聚合入口',
  description:
    '该模块提供“编排文章 -> 写入Canvas -> 图库向量配图”的生成流程，并提供“从Canvas生成批量任务 -> 并行入队 -> 触发MCP运行”的发布流程，作为后端工作流编排的统一入口。',
  keywords: [
    'graph',
    'workflow',
    'orchestration',
    'langgraph',
    'articles',
    'canvas',
    'gallery',
    'batch-task',
    'publishing',
    'mcp',
    'task-it',
    'todo-summary',
  ],
  dependencies: [
    '@nestjs/common',
    '@langchain/langgraph',
    'ai-agent module',
    'format module',
    'canvas module',
    'gallery module',
    'batch-task module',
    'mcp-function-call module',
  ],
  lastUpdated: '2026-02-05',
  files: {
    '控制器/Controller': 'src/modules/graph/controller/graph.controller.ts',
    '文章编排/ArticleGraph':
      'src/modules/graph/services/article-graph.service.ts',
    '批量发布/BatchTaskGraph':
      'src/modules/graph/services/batch-task-graph.service.ts',
    '模块/Module': 'src/modules/graph/graph.module.ts',
  },
};
