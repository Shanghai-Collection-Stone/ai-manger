# Todo-Function-Call Module

## 模块描述
该模块封装待办CRUD为LangChain工具，支持按用户过滤、序号ID操作，以及AI考量/决策/计划字段写入与更新。
文件路径: `src/modules/function-call/todo`

## 功能描述及关键词

### todo.service.ts
Todo工具服务。
- **关键词**: todo, tools, crud, ai-plan, user-filter, service
- **函数**:
	- `getHandle`: 注册待办工具句柄（create/update/delete/get/list/item_create）/register todo tool handles
	- `resolveTenantId`: 解析租户范围并做作用域校验/resolve tenant scope
	- `resolveUserId`: 优先使用会话scope中的userId，若与入参不一致则记录覆盖日志/resolve user scope with context override
	- `normalizeToolTodoTypeInput`: 归一化工具入参type（兼容xhs_publish等历史值，支持long_task）/normalize todo type aliases
	- `buildTodoDescription`: 描述缺失时基于上下文信息自动补全任务描述/build todo description fallback from context
	- `injectLongTaskCronPrompt`: long_task类型时自动在aiPlan中注入Cron job追踪提示词/inject cron job prompt for long_task
	- `injectXhsTrackerDataCollectPrompt`: assignee=robot:xhs_tracker时注入数据回写规范（xhs-stats专项接口）/inject xhs tracker data write-back spec
	- `shouldAutoAssignXhsRobot`: 判断是否自动派单小红书机器人/auto assign xhs robot
	- `triggerRobotAssignedDeferred`: 异步触发机器人执行且不影响工具主流程/deferred robot trigger

### todo.module.ts
Todo工具模块定义。
- **关键词**: module
