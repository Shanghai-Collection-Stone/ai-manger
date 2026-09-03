# Batch-Task Module

## 模块描述
该模块基于MongoDB存储批量发布任务，支持并行入队、重试退避、回调更新状态，并与Todo模块联动：任务总览映射为待办，单条发布映射为清单条目。
文件路径: `src/modules/batch-task`

## 功能描述及关键词

### batch-task.service.ts
批量任务服务。
- **关键词**: batch-task, parallel, pool, retry, backoff, callback, mcp, todo-linkage, publishing, mongo, service
- ensureIndexes() — 建索引；队列认领走 graphJob_claim_queued 部分索引（仅收录 queued） | keywords: batch-task, mongo, index, partial-index
- claimNextGraphJob(kind) — 原子认领队列任务，投影裁掉 posts[] 只回传 worker 必需字段 | keywords: claim-graph-job, atomic-claim, projection

### batch-task.controller.ts
批量任务控制器。
- **关键词**: controller

### batch-task.entity.ts
批量任务实体。
- **关键词**: entity
- BatchTaskGraphJobClaim — 队列认领的精简投影类型 | keywords: graph-job-claim, projection-shape

### batch-task.module.ts
批量任务模块定义。
- **关键词**: module
