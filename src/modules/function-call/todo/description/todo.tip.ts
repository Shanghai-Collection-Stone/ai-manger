/**
 * @description Todo Function-Call 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword todo, function-call, tip
 * @since 2026-01-27
 */
export const moduleTip = {
  moduleName: 'Todo-Function-Call',
  purpose: '为AI提供待办事项的增删改查工具',
  description:
    '该模块封装待办CRUD为LangChain工具，支持按用户过滤、序号ID操作，以及AI考量/决策/计划字段写入与更新。',
  keywords: ['todo', 'tools', 'crud', 'ai-plan', 'user-filter'],
  dependencies: ['@nestjs/common', 'langchain', 'zod', 'todo module'],
  lastUpdated: '2026-01-27',
  files: {
    '服务/Service': 'src/modules/function-call/todo/services/todo.service.ts',
    '模块/Module': 'src/modules/function-call/todo/todo.module.ts',
  },
};
