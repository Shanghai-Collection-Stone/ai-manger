/**
 * @description Todo 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword todo, module, tip
 * @since 2026-01-27
 */
export const moduleTip = {
  moduleName: 'Todo',
  purpose: '提供待办事项的CRUD与序号ID管理',
  description:
    '该模块基于MongoDB存储待办事项，包含AI考量、决策来源与执行计划字段，并提供REST接口供前端与工具使用。',
  keywords: ['todo', 'tasks', 'ai-plan', 'decision', 'crud', 'mongo'],
  dependencies: ['@nestjs/common', 'mongodb', 'data-source module'],
  lastUpdated: '2026-01-27',
  files: {
    '控制器/Controller': 'src/modules/todo/controller/todo.controller.ts',
    '服务/Service': 'src/modules/todo/services/todo.service.ts',
    '模块/Module': 'src/modules/todo/todo.module.ts',
    '实体/Entity': 'src/modules/todo/entities/todo.entity.ts',
  },
};
