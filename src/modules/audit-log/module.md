# Audit Log Module

## 模块描述
审计日志模块(v2)，提供后台可审计变更事件的写入与分页查询。被工作区(workspace)、网盘(netdisk)、通知(notice)模块复用做自动埋点：增删改操作后直写 `audit_logs` 集合(无事件总线)。查询接口按租户隔离，鉴权走后台 JWT + CASL(`read AuditLog`)。
文件路径: `src/modules/audit-log`
路由前缀: `api/v2/audit-logs`
事件命名: `<module>.<verb>`，如 `workspace.create` / `netdisk.fileUpload` / `notice.publish`，动作常量定义在各来源模块内(见 workspace / netdisk / notice module.md)。

## 功能描述及关键词

### services/audit-log.service.ts
审计日志服务，事件写入与分页查询。
- **关键词**: audit, log, record, query, tenant-isolation, mongo
- **函数**:
  - `ensureIndexes`: 初始化审计索引/ensure audit log indexes | keywords: ensure-audit-log-indexes
  - `record`: 写入一条审计事件(失败不抛出)/record audit event | keywords: record-audit-event
  - `list`: 分页查询审计事件(租户隔离，时间倒序)/list audit events | keywords: list-audit-events

### controller/audit-log.controller.ts
审计日志控制器，提供 `GET /api/v2/audit-logs` 分页查询，鉴权 `read AuditLog`。
- **关键词**: controller, audit, query, casl, jwt, v2
- **函数**:
  - `list`: 审计事件分页查询端点/list audit logs endpoint | keywords: list-audit-logs-endpoint
  - `requireUser`: 读取当前登录后台用户/read current admin user | keywords: read-current-admin-user

### controller/audit-log.dto.ts
审计查询请求体 DTO(query 参数校验)。
- **关键词**: dto, class-validator, query, pagination

### entities/audit-log.entity.ts
审计日志实体与写入入参定义。
- **关键词**: entity, audit-log, target-type
- **类型导出**: `AuditLogEntity`, `AuditRecordInput`, `AuditTargetType`

### audit-log.module.ts
审计日志模块定义，导出 `AuditLogService` 供其他模块埋点。
- **关键词**: module, nest, export-service
