# SuperClaw gRPC 接入协议

本文是 SuperClaw 节点接入平台的规范性协议文档。当前稳定协议为 `superclaw.v1`。

协议的线格式以同目录的 `super-claw.proto` 为准，字段含义、调用时序、鉴权、错误处理和兼容性规则以本文为准。两者不一致时视为实现缺陷，不允许客户端自行猜测。

## 1. 协议范围

V1 只处理 SuperClaw 节点控制面连接：

- 使用平台签发的节点 Token 鉴权。
- 注册或刷新一个节点实例的信息。
- 通过心跳维持在线状态并上报节点观测值。
- 从平台接收工作区槽位总量和已分配数量。

V1 不包含工作区文件读写、文件迁移、租户改绑、任务投递或数据面传输。租户默认节点变化和工作区迁移属于平台管理面；客户端不得把 `Register` 或 `Heartbeat` 理解为迁移指令。

## 2. 服务标识

| 项目           | 值                                             |
| -------------- | ---------------------------------------------- |
| Proto syntax   | `proto3`                                       |
| Package        | `superclaw.v1`                                 |
| Service        | `SuperClawGateway`                             |
| 完整服务名     | `superclaw.v1.SuperClawGateway`                |
| RPC 类型       | Unary RPC                                      |
| 默认监听地址   | `0.0.0.0:50051`                                |
| 服务端地址配置 | `SUPER_CLAW_GRPC_URL`                          |
| 启用配置       | `SUPER_CLAW_GRPC_ENABLED`，设为 `false` 时关闭 |

默认配置未在 gRPC 进程内启用 TLS。生产环境必须通过受信网络、服务网格或 TLS 代理保护连接，禁止把明文端口直接暴露到公网。

## 3. 鉴权

每次 RPC 都必须携带平台为该 SuperClaw 节点签发的 Token。支持以下任一 metadata：

| Metadata key         | 值格式           | 推荐程度 |
| -------------------- | ---------------- | -------- |
| `authorization`      | `Bearer <token>` | 推荐     |
| `x-super-claw-token` | `<token>`        | 兼容     |

规则：

- metadata key 按 gRPC 规范使用小写 ASCII。
- 同时提供两种 metadata 时，服务端优先使用合法格式的 `authorization`。
- Token 与一个平台 SuperClaw 节点一一对应，身份以 Token 为准，客户端不提交 `super_claw_id`。
- Token 轮换后旧 Token 立即失效，客户端必须安全替换并重新注册。
- Token 是长期机密，不得写入日志、指标标签、错误信息或仓库。

## 4. 连接生命周期

1. 平台管理员创建 SuperClaw 节点，取得仅展示一次的 Token。
2. 节点启动后调用 `Register`。
3. 注册成功后，节点按响应中的 `heartbeat_interval_seconds` 调用 `Heartbeat`。
4. 心跳连续中断超过 3 个建议间隔时，平台管理面将节点判定为离线。V1 当前建议间隔为 30 秒，因此当前离线判定窗口为约 90 秒。
5. 网络恢复、进程重启、Token 更新或实例信息发生变化后，节点应再次调用 `Register`，随后恢复心跳。

`Register` 和 `Heartbeat` 都允许安全重试。重试不会新增平台节点；同一个 Token 始终定位到同一个 SuperClaw。并发请求采用服务端最后成功写入的信息。

建议客户端为 `Register` 设置 5 秒 deadline，为 `Heartbeat` 设置 3 秒 deadline，并使用带随机抖动的指数退避。客户端不得以低于服务端返回间隔的频率持续发送心跳。

## 5. RPC：Register

方法全名：`superclaw.v1.SuperClawGateway/Register`

用途：验证节点身份、登记当前运行实例，并将节点连接状态刷新为在线。

### RegisterRequest

| 字段          | tag | 类型     | 必填 | 约束与语义                                                                                                    |
| ------------- | --: | -------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `instance_id` |   1 | `string` | 是   | 当前进程或部署实例的稳定标识；去除首尾空白后不可为空。建议使用 UUID 或编排平台实例 ID。进程重建可以生成新值。 |
| `endpoint`    |   2 | `string` | 否   | 节点对外服务地址，仅用于登记和诊断；空字符串按未提供处理。V1 平台不会主动拨号该地址。                         |
| `version`     |   3 | `string` | 否   | SuperClaw 程序版本，建议使用 SemVer 或不可变构建版本；空字符串按未提供处理。                                  |

### RegisterResponse

| 字段                         | tag | 类型     | 语义                                                                          |
| ---------------------------- | --: | -------- | ----------------------------------------------------------------------------- |
| `super_claw_id`              |   1 | `string` | 平台节点 ID，仅用于日志关联和诊断，不作为后续鉴权凭据。                       |
| `registered`                 |   2 | `bool`   | `true` 表示本次注册已被接受。RPC 返回 OK 时当前恒为 `true`。                  |
| `capacity`                   |   3 | `int32`  | 平台配置的工作区槽位总数。每个实际绑定到此节点的工作区占用一个槽位。          |
| `allocated_capacity`         |   4 | `int32`  | 平台根据工作区绑定关系计算的已占用槽位，是调度与限额判断的权威值。            |
| `heartbeat_interval_seconds` |   5 | `int32`  | 服务端建议心跳间隔，客户端必须以响应值为准。                                  |
| `server_time`                |   6 | `string` | 服务端 UTC 时间，RFC 3339/ISO 8601 格式。仅用于诊断，不用于替代本地单调时钟。 |

示例请求：

```json
{
  "instanceId": "sc-prod-a-01",
  "endpoint": "https://superclaw-a.internal.example",
  "version": "1.4.2"
}
```

示例响应：

```json
{
  "superClawId": "66cabc1234567890abcdef12",
  "registered": true,
  "capacity": 100,
  "allocatedCapacity": 37,
  "heartbeatIntervalSeconds": 30,
  "serverTime": "2026-08-24T08:30:00.000Z"
}
```

## 6. RPC：Heartbeat

方法全名：`superclaw.v1.SuperClawGateway/Heartbeat`

用途：续期节点在线状态，并可更新实例标识和节点侧容量观测值。

节点必须先成功调用 `Register`。服务端当前会接受持有有效 Token 的心跳，但客户端不得依赖“用心跳代替注册”的实现细节。

### HeartbeatRequest

| 字段            | tag | 类型     | 必填 | 约束与语义                                                                                         |
| --------------- | --: | -------- | ---- | -------------------------------------------------------------------------------------------------- |
| `instance_id`   |   1 | `string` | 建议 | 应与最近一次注册一致。非空时服务端更新登记值；空字符串时保留原值。                                 |
| `used_capacity` |   2 | `int32`  | 是   | 节点自身观测到的已使用工作区槽位数，必须为非负整数。该值只用于监控和差异诊断，不参与平台限额计算。 |

由于 V1 使用 proto3 普通标量，省略 `used_capacity` 在线格式上等价于传入 `0`。客户端必须显式填写真实观测值。

### HeartbeatResponse

| 字段                 | tag | 类型     | 语义                                                   |
| -------------------- | --: | -------- | ------------------------------------------------------ |
| `accepted`           |   1 | `bool`   | `true` 表示心跳已接受。RPC 返回 OK 时当前恒为 `true`。 |
| `capacity`           |   2 | `int32`  | 平台配置的工作区槽位总数。                             |
| `allocated_capacity` |   3 | `int32`  | 平台计算的已占用工作区槽位数。                         |
| `server_time`        |   4 | `string` | 服务端 UTC 时间，RFC 3339/ISO 8601 格式。              |

`used_capacity` 与响应中的 `allocated_capacity` 不一致时，客户端只能记录告警，不得自行创建、删除或迁移工作区。平台值是控制面权威值，差异需要通过管理面处理。

示例请求：

```json
{
  "instanceId": "sc-prod-a-01",
  "usedCapacity": 37
}
```

示例响应：

```json
{
  "accepted": true,
  "capacity": 100,
  "allocatedCapacity": 37,
  "serverTime": "2026-08-24T08:30:30.000Z"
}
```

## 7. 错误处理

客户端必须先判断 gRPC status；非 `OK` 时不得使用响应消息中的默认值。

| gRPC status         | 稳定错误标识               | 场景                                 | 客户端处理                             |
| ------------------- | -------------------------- | ------------------------------------ | -------------------------------------- |
| `UNAUTHENTICATED`   | `INVALID_SUPER_CLAW_TOKEN` | Token 缺失、格式错误、已轮换或不存在 | 停止重试，刷新凭据后重新注册。         |
| `INVALID_ARGUMENT`  | `INSTANCE_ID_REQUIRED`     | 注册请求缺少有效 `instance_id`       | 修正配置后重试。                       |
| `UNAVAILABLE`       | 无固定业务标识             | 服务未启动、网络中断或服务暂时不可达 | 按退避策略重试。                       |
| `DEADLINE_EXCEEDED` | 无固定业务标识             | 请求超过客户端 deadline              | 按退避策略重试。                       |
| `INTERNAL`          | 无固定业务标识             | 未预期服务端错误                     | 记录 request context，退避重试并告警。 |

稳定错误标识位于 gRPC error message。客户端可以用于诊断和分类，但不得解析自然语言错误文本。

## 8. 兼容性规则

`superclaw.v1` 的演进必须遵守以下规则：

- 已发布字段 tag 永不改变、永不复用；删除字段时必须在 `.proto` 中使用 `reserved` 保留字段号和名称。
- V1 只能新增可选请求字段、响应字段或新 RPC；不得改变已有字段类型、单位、必填性或语义。
- 客户端必须忽略未知响应字段；服务端必须接受缺失的新可选请求字段。
- 不得把字段改为含义不同但类型相同的新用途。
- 需要破坏性变更时新建 `superclaw.v2` package，并保留 V1 迁移窗口。
- 所有容量字段单位均为“工作区槽位数”，不是字节数、任务数或并发数。
- 当前所有计数字段使用 `int32` 且必须非负。需要超过 `2,147,483,647` 时只能在新版本中升级类型。

## 9. 发布与变更流程

任何协议变更必须在同一个变更中完成：

1. 修改 `super-claw.proto`。
2. 修改本文档对应字段、时序或错误说明。
3. 更新服务端类型和实现。
4. 增加或更新兼容性测试。
5. 在本文版本记录中说明兼容性影响。

未经上述同步，不得把新字段或新行为用于生产客户端。

## 10. 本地联调

服务启用后，可以使用 `grpcurl` 调用。默认监听未配置 TLS，因此本地示例使用 `-plaintext`：

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"instanceId":"sc-local-01","endpoint":"http://127.0.0.1:7000","version":"dev"}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/Register
```

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"instanceId":"sc-local-01","usedCapacity":0}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/Heartbeat
```

## 11. 版本记录

| 协议版本       | 文档版本 | 日期       | 变更                                                          |
| -------------- | -------- | ---------- | ------------------------------------------------------------- |
| `superclaw.v1` | `1.0.0`  | 2026-08-24 | 固化 Token 鉴权、注册、心跳、容量语义、错误分类和兼容性规则。 |
