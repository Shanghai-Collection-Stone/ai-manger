# SaaS 数据源接入接口文档

## 接口地址

- 接口地址: `https://ai-manger.superboxlink.com/`
- api key: `599244720e3c4f3c9346d91b406f9bb497eeb8bea9b34c2caca2864f905b1983`
- 订单表ID: `69a940530bb6fa16ce15e5bf`
- 订单退单信息表ID: `69a940890bb6fa16ce15e5c0`
- 订单使用信息表ID: `69a940e30bb6fa16ce15e5c1`

## 基础信息

- 模块基础路径: `/sass`
- ID 说明:
  - `:id`、`tenantId`、`schemaId` 均为 MongoDB ObjectId 字符串（24位十六进制）
- 鉴权说明:
  - `/sass/schema*` 与 `/sass/data/*` 需要 API Key 鉴权
  - Header: `x-api-key: <API_KEY>`

## 一、Schema 管理（sass_schema）

### POST `/sass/schema`

- 描述: 创建表结构定义
- 请求体:

```json
{
  "table": "orders",
  "tableDesc": "订单表",
  "tableField": {
    "orderNo": "订单号",
    "amount": "订单金额"
  },
  "dedupeField": "orderNo"
}
```

- 请求字段说明:
  - `table`: string，表标识，仅允许字母/数字/下划线，建议全局唯一
  - `tableDesc`: string，表中文描述
  - `tableField`: object，字段定义，key 为字段名，value 为字段描述
  - `dedupeField`: string，可选，去重字段名，必须出现在 `tableField` 中
- 返回: `{ schema }`
- 返回字段说明:
  - `schema._id`: string，schema 主键
  - `schema.table`: string，表标识
  - `schema.tableDesc`: string，表描述
  - `schema.tableField`: object，字段定义
  - `schema.dedupeField`: string，可选，去重字段
  - `schema.createdAt`: string，创建时间（ISO）
  - `schema.updatedAt`: string，更新时间（ISO）

### GET `/sass/schema`

- 描述: 获取 Schema 列表
- 返回: `{ schemas }`
- 返回字段说明:
  - `schemas`: array，schema 数组，元素结构同 `POST /sass/schema` 的 `schema`

### GET `/sass/schema/:id`

- 描述: 获取单个 Schema
- 路径字段说明:
  - `id`: string，schema 主键（ObjectId）
- 返回: `{ schema }`
- 返回字段说明:
  - `schema`: object | null，schema 详情，不存在时为 `null`

### PATCH `/sass/schema/:id`

- 描述: 更新 Schema
- 请求体（可选字段）:

```json
{
  "table": "orders_new",
  "tableDesc": "新订单表",
  "tableField": {
    "orderNo": "订单号",
    "amount": "金额"
  },
  "dedupeField": "orderNo"
}
```

- 路径字段说明:
  - `id`: string，schema 主键（ObjectId）
- 请求字段说明:
  - `table`: string，可选，更新表标识
  - `tableDesc`: string，可选，更新表描述
  - `tableField`: object，可选，整体替换字段定义
  - `dedupeField`: string，可选，更新去重字段
- 返回: `{ schema }`
- 返回字段说明:
  - `schema`: object | null，更新后的 schema，不存在时为 `null`

### DELETE `/sass/schema/:id`

- 描述: 删除 Schema
- 路径字段说明:
  - `id`: string，schema 主键（ObjectId）
- 返回: `{ ok: boolean }`
- 返回字段说明:
  - `ok`: boolean，是否删除成功

## 二、数据 CRUD（/sass/data/\* 需要鉴权）

### POST `/sass/data/insert`

- 描述: 新增数据
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "data": [
    {
      "orderNo": "SO-001",
      "amount": 128.5
    },
    {
      "orderNo": "SO-002",
      "amount": 168.5
    }
  ]
}
```

- 返回:

```json
{
  "totalCount": 2,
  "insertedCount": 2,
  "skippedDuplicateCount": 0,
  "insertedIds": ["xxxx", "yyyy"],
  "skippedDuplicateValues": []
}
```

- 规则:
  - `data` 支持对象或对象数组
  - 数据键必须与 schema 字段键完全匹配，缺少字段键会直接报错
  - `dedupeField` 已配置时，该字段值必须非空
- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `data`: object | object[]，待插入记录，字段必须与 schema 定义一致
- 返回字段说明:
  - `totalCount`: number，请求总记录数
  - `insertedCount`: number，实际插入条数
  - `skippedDuplicateCount`: number，去重跳过条数
  - `insertedIds`: string[]，新插入记录的 `_id` 列表
  - `skippedDuplicateValues`: unknown[]，被跳过的去重字段值

### POST `/sass/data/patch`

- 描述: 批量补丁数据（有重复则更新，无重复则新增）
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "data": [
    {
      "orderNo": "SO-001",
      "amount": 199.9
    },
    {
      "orderNo": "SO-003",
      "amount": 168.5
    }
  ]
}
```

- 返回:

```json
{
  "totalCount": 2,
  "effectiveCount": 2,
  "insertedCount": 1,
  "updatedCount": 1,
  "upsertedIds": ["xxxx"],
  "updatedValues": ["SO-001"]
}
```

- 规则:
  - 必须配置 `dedupeField`，否则会报错
  - `dedupeField` 命中已有记录时执行更新，未命中时执行新增
  - 同一批次 `data` 中若 dedupe 值重复，以最后一条为准
- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `data`: object | object[]，补丁记录，字段必须与 schema 定义一致
- 返回字段说明:
  - `totalCount`: number，请求总记录数
  - `effectiveCount`: number，批次内按 dedupe 去重后的有效记录数
  - `insertedCount`: number，本次新增条数
  - `updatedCount`: number，本次更新条数
  - `upsertedIds`: string[]，本次新增记录的 `_id` 列表
  - `updatedValues`: unknown[]，本次命中更新的 dedupe 字段值

### POST `/sass/data/list`

- 描述: 查询列表
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "filter": {},
  "where": {
    "and": [
      { "field": "amount", "op": "gte", "value": 100 },
      { "field": "orderNo", "op": "starts_with", "value": "SO-" }
    ]
  },
  "projection": {},
  "sort": { "_id": -1 },
  "limit": 20,
  "skip": 0
}
```

- 返回: `{ rows: [] }`
- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `filter`: object，可选，Mongo 简单过滤条件
  - `where`: object，可选，DSL 过滤条件（支持 `and/or/not` 与比较操作）
  - `projection`: object，可选，字段投影
  - `sort`: object，可选，排序规则，`1` 升序，`-1` 降序
  - `limit`: number，可选，返回条数上限，最大 500
  - `skip`: number，可选，偏移条数
- 返回字段说明:
  - `rows`: object[]，查询结果列表

### POST `/sass/data/find-one`

- 描述: 查询单条
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "filter": { "orderNo": "SO-001" },
  "where": {
    "field": "amount",
    "op": "between",
    "min": 100,
    "max": 300
  },
  "projection": {},
  "sort": { "_id": -1 }
}
```

- 返回: `{ row: {} | null }`
- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `filter`: object，可选，Mongo 简单过滤条件
  - `where`: object，可选，DSL 过滤条件
  - `projection`: object，可选，字段投影
  - `sort`: object，可选，排序规则
- 返回字段说明:
  - `row`: object | null，命中的单条记录，未命中为 `null`

### POST `/sass/data/update-one`

- 描述: 更新单条
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "filter": { "orderNo": "SO-001" },
  "update": { "amount": 188.8 },
  "upsert": false
}
```

- 返回:

```json
{
  "matchedCount": 1,
  "modifiedCount": 1,
  "upsertedId": null
}
```

- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `filter`: object，必填，更新过滤条件
  - `where`: object，可选，DSL 过滤条件
  - `update`: object，必填，更新字段集合
  - `upsert`: boolean，可选，未命中时是否新增，默认 `false`
- 返回字段说明:
  - `matchedCount`: number，匹配记录数
  - `modifiedCount`: number，实际更新记录数
  - `upsertedId`: string | null，触发 upsert 时的新记录 `_id`

### POST `/sass/data/delete-one`

- 描述: 删除单条
- Header: `x-api-key: <API_KEY>`
- 请求体:

```json
{
  "schemaId": "65f1b8e8b4a8d5f4f53b0b21",
  "filter": { "orderNo": "SO-001" }
}
```

- 返回:

```json
{
  "deletedCount": 1
}
```

- 请求字段说明:
  - `schemaId`: string，schema 主键（ObjectId）
  - `filter`: object，必填，删除过滤条件
  - `where`: object，可选，DSL 过滤条件
- 返回字段说明:
  - `deletedCount`: number，删除条数（0 或 1）

## 三、错误码（约定）

- `MISSING_API_KEY`: 缺失 API Key
- `API_KEY_EXPIRED`: API Key 已过期
- `INVALID_TENANT_CONTEXT`: API Key 缺少有效租户上下文
- `API_KEY_NOT_FOUND_OR_REVOKED`: key 无效或已撤销
- `INVALID_SCHEMA_ID`: schemaId 不是合法ObjectId
- `INVALID_TENANT_ID`: tenantId 不是合法ObjectId
- `INVALID_API_KEY_ID`: apiKey id 不是合法ObjectId
- `SCHEMA_NOT_FOUND`: schemaId 不存在
- `SCHEMA_TABLE_ALREADY_EXISTS`: schema表名已存在
- `FILTER_REQUIRED`: 缺少过滤条件
- `UPDATE_REQUIRED`: 缺少更新内容
- `FIELD_KEY_REQUIRED:<field>`: 缺少schema字段键
- `FIELD_NOT_IN_SCHEMA:<field>`: 存在未定义字段
- `DEDUPE_FIELD_REQUIRED`: 去重字段定义为空
- `DEDUPE_FIELD_NOT_IN_SCHEMA`: 去重字段不在schema字段中
- `DEDUPE_FIELD_EMPTY:<field>`: 去重字段值为空
