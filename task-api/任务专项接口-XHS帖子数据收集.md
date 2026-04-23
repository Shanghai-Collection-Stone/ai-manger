# 任务专项接口 - XHS 帖子数据收集

## 概述

此接口专供 `claw skill` 使用，通过 `taskToken` 进行鉴权，无需管理员登录态。

**基础路径**: `http://127.0.0.1:3011`

**鉴权方式**: 请求头 `Authorization: Bearer <taskToken>`

不要使用 Curl 等方式调用 Api喔,因为会导致标题乱码,写出临时代码来执行,然后执行完毕在删除掉就好了。

---

## 核心鉴权规则

| 规则 | 说明 |
|------|------|
| 每个接口必须携带 `Authorization: Bearer <taskToken>` | 无此 header 返回 401 |
| `taskToken` 与路径中的 `todoId` 必须完全匹配 | 不匹配返回 401 `TASK_TOKEN_MISMATCH` |
| taskToken 一经创建绑定任务不可更换 | 通过任务创建接口（非 task-api）获取 |
| 跨任务操作被拒绝 | 每个 token 只能操作绑定的 todoId |

---

## 通用错误码

| 错误信息 | HTTP 状态码 | 描述 |
|---------|-------------|------|
| `TASK_TOKEN_REQUIRED` | 401 | 未提供 Authorization header 或 Bearer token |
| `INVALID_TASK_TOKEN` | 401 | taskToken 无效或已过期 |
| `TASK_TOKEN_MISMATCH` | 401 | taskToken 与路径 todoId 不匹配 |
| `STAT_NOT_BELONG_TO_TASK` | 401 | XHS 帖子数据不属于当前任务 |

---

## XHS 帖子数据收集接口

用于小红书数据追踪子代理将帖子数据存入任务下的数据表，支持批量 upsert。

### 列表 - 获取当前任务下所有帖子数据

```
GET /task-api/:todoId/xhs-stats
Authorization: Bearer <taskToken>
```

**响应**:
```json
{
  "stats": [
    {
      "id": 1,
      "todoId": 10,
      "tag": "美食",
      "postTitle": "最好吃的火锅攻略",
      "postHash": "a1b2c3d4e5f6a7b8",
      "postUrl": "https://xiaohongshu.com/...",
      "authorUrl": "https://xiaohongshu.com/user/...",
      "likeCount": 1200,
      "commentCount": 80,
      "collectCount": 450,
      "topComments": [
        { "content": "太好吃了！", "likeCount": 120, "replyCount": 5 }
      ],
      "dataAt": "2026-04-13T00:00:00.000Z",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### 单条 - 根据 statId 获取

```
GET /task-api/:todoId/xhs-stats/:statId
Authorization: Bearer <taskToken>
```

---

### 新增 - 创建一条帖子数据

```
POST /task-api/:todoId/xhs-stats
Authorization: Bearer <taskToken>
Content-Type: application/json

{
  "postTitle": "最好吃的火锅攻略",
  "tag": "美食",
  "postUrl": "https://xiaohongshu.com/...",
  "authorUrl": "https://xiaohongshu.com/user/...",
  "likeCount": 1200,
  "commentCount": 80,
  "collectCount": 450,
  "topComments": [
    { "content": "评论内容", "likeCount": 50, "replyCount": 3 }
  ],
  "dataAt": "2026-04-13T00:00:00.000Z"
}
```

**字段说明**:

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `postTitle` | string | ✅ | 帖子标题（与 postUrl 共同生成唯一 hash） |
| `tag` | string | ❌ | 自定义分类标签 |
| `postUrl` | string | ❌ | 帖子链接 |
| `authorUrl` | string | ❌ | 作者主页链接 |
| `likeCount` | number | ❌ | 点赞数，默认 0 |
| `commentCount` | number | ❌ | 评论数，默认 0 |
| `collectCount` | number | ❌ | 收藏数，默认 0 |
| `topComments` | array | ❌ | Top评论列表（每条含 content/likeCount/replyCount） |
| `dataAt` | string (ISO) | ❌ | 数据采集时间，默认当前时间 |

> `postHash` 由服务端自动计算（MD5(title|url).slice(0,16)），无需前端传入

---

### 批量插入 - 无论是否重复，每次都新增一条记录

```
POST /task-api/:todoId/xhs-stats/bulk
Authorization: Bearer <taskToken>
Content-Type: application/json

{
  "items": [
    { "postTitle": "帖子A", "likeCount": 100, ... },
    { "postTitle": "帖子B", "postUrl": "https://...", "likeCount": 200, ... }
  ]
}
```

**响应**:
```json
{ "ok": true, "upserted": 2 }
```

---

### 更新 - 修改帖子数据

```
PATCH /task-api/:todoId/xhs-stats/:statId
Authorization: Bearer <taskToken>
Content-Type: application/json

{
  "likeCount": 1500,
  "collectCount": 600
}
```

所有字段（同新增字段）均可选填，只更新传入的字段。

---

### 删除 - 删除帖子数据

```
DELETE /task-api/:todoId/xhs-stats/:statId
Authorization: Bearer <taskToken>
```

**响应**: `{ "ok": true }`

---

## 关联文件

- Controller: [todo-task.controller.ts](../src/modules/todo/controller/todo-task.controller.ts)
- Service: [xhs-post-stat.service.ts](../src/modules/todo/services/xhs-post-stat.service.ts)
- Entity: [xhs-post-stat.entity.ts](../src/modules/todo/entities/xhs-post-stat.entity.ts)
