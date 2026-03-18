# Todo Module

## 模块描述
该模块基于MongoDB存储待办事项与其清单条目，包含AI考量、决策来源与执行计划字段，并提供REST接口供前端与工具使用。
文件路径: `src/modules/todo`

## 功能描述及关键词

### todo.controller.ts
Todo控制器。
- **关键词**: todo, tasks, todo-items, checklist, ai-plan, crud, mongo, controller
- **函数**:
  - `create`: 创建待办/create todo
  - `list`: 列表查询/list todos
  - `get`: 获取待办/get todo
  - `update`: 更新待办/update todo
  - `remove`: 删除待办/delete todo
  - `createItem`: 创建清单/create todo item
  - `listItems`: 清单列表/list todo items

### todo.service.ts
Todo服务。
- **关键词**: service
- **函数**:
  - `create`: 创建待办/create
  - `update`: 更新待办/update
  - `listByScope`: 范围查询/list by scope
  - `createItem`: 创建清单/create item
  - `buildTenantFilter`: 租户过滤/build tenant filter

### todo.module.ts
Todo模块定义。
- **关键词**: module

### todo.entity.ts
Todo实体。
- **关键词**: entity

### todo-item.entity.ts
清单实体。
- **关键词**: todo-item, entity
