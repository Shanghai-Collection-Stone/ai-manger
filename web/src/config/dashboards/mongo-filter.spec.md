# Mongo JSON Filter 规范（通用查询接口）

## 目标
- 用一套 JSON 描述查询条件，统一支持：
  - 查数据列表（list）
  - 查数量（count）
  - 关联查询（join / `$lookup`）
- 强制租户隔离：
  - 母平台：`tenantId` 为空/不存在（平台账号）时不注入租户过滤，可查看全部数据
  - 普通租户：服务端自动追加 `tenantId = <当前租户>` 到主集合与 join 集合

## API
### POST `/mongo/query`
- Header（二选一）：
  - `Authorization: Bearer <ADMIN_JWT>`（平台/租户后台用户）
  - `x-api-key: <SASS_API_KEY>`（仅租户）
- 请求体结构：`MongoQueryRequest`

## MongoQueryRequest
```json
{
  "collection": "todo_items",
  "mode": "list",
  "filter": { "status": "open" },
  "where": { "field": "score", "op": "gte", "value": 80 },
  "projection": { "_id": 0, "title": 1, "status": 1 },
  "sort": { "updatedAt": -1 },
  "skip": 0,
  "limit": 50,
  "tenantField": "tenantId",
  "joins": []
}
```

### 字段说明
- `collection`: string，集合名，仅允许 `[a-zA-Z0-9_]+`
- `mode`: `"list" | "count"`
- `filter`: object，可选，“简单等值过滤”，禁止包含 `$xxx` 操作符键
- `where`: object，可选，DSL 过滤（支持 `and/or/not` 与比较操作）
- `projection`: object，可选，字段投影（0/1）
- `sort`: object，可选，排序规则（1/-1）
- `skip`: number，可选，偏移
- `limit`: number，可选，返回条数上限（最大 500）
- `tenantField`: string，可选，租户字段名（默认 `tenantId`）
- `joins`: array，可选，关联查询定义

## where DSL（MongoWhereNode）
### 条件节点（MongoWhereCondition）
```json
{ "field": "amount", "op": "between", "min": 100, "max": 300 }
```

支持操作符 `op`：
- `eq` / `ne`
- `gt` / `gte`
- `lt` / `lte`
- `in` / `nin`（使用 `values` 数组）
- `between`（使用 `min/max`）
- `exists`（使用 `value: true|false`）
- `regex`（使用 `value` 字符串，`options` 默认 `i`）
- `contains` / `starts_with` / `ends_with`（字符串匹配，大小写不敏感）

字段约束：
- `field` 支持点路径（如 `user.profile.name`）
- 禁止包含 `$`、禁止 `..`

### 组合节点（MongoWhereGroup）
```json
{ "and": [ { "field": "a", "op": "gte", "value": 1 }, { "field": "b", "op": "lte", "value": 10 } ] }
```
```json
{ "or": [ { "field": "status", "op": "eq", "value": "open" }, { "field": "status", "op": "eq", "value": "doing" } ] }
```
```json
{ "not": { "field": "deletedAt", "op": "exists", "value": true } }
```

## joins（关联查询）
### MongoQueryJoin
```json
{
  "from": "users",
  "as": "user",
  "localField": "userId",
  "foreignField": "id",
  "localFieldIsArray": false,
  "unwind": true,
  "where": { "field": "enabled", "op": "eq", "value": true },
  "projection": { "_id": 0, "id": 1, "displayName": 1 },
  "sort": { "updatedAt": -1 },
  "limit": 1,
  "tenantField": "tenantId"
}
```

### 说明
- `from`: join 集合名
- `as`: join 结果字段名
- `localField/foreignField`: 关联键
- `localFieldIsArray`: `true` 时使用 `$in` 语义（适用于本地字段是数组）
- `unwind`:
  - `true` 等价于 `{ "preserveNullAndEmptyArrays": true }`
  - 或显式对象：`{ "preserveNullAndEmptyArrays": false }`
- join 内部也支持 `filter/where/projection/sort/limit`
- `limit` 最大 200

## 示例
### 1) count（只查数量）
```json
{
  "collection": "decision_cards",
  "mode": "count",
  "where": {
    "and": [
      { "field": "status", "op": "eq", "value": "open" },
      { "field": "updatedAt", "op": "gte", "value": "2026-01-01T00:00:00.000Z" }
    ]
  }
}
```

### 2) list + join（查列表并关联用户信息）
```json
{
  "collection": "todo_items",
  "mode": "list",
  "where": { "field": "status", "op": "in", "values": ["open", "doing"] },
  "joins": [
    {
      "from": "admin_users",
      "as": "owner",
      "localField": "userId",
      "foreignField": "username",
      "unwind": true,
      "projection": { "_id": 0, "username": 1, "displayName": 1 }
    }
  ],
  "sort": { "updatedAt": -1 },
  "limit": 50
}
```

