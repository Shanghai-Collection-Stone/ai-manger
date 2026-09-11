# 模块名称 (Module Name)

AI 计费模块（ai-billing）

## 概述 (Overview)

统一提供服务级固定 Credit 扣费与模型物理调用 Token 用量记录。服务编码、名称和默认点数由代码目录固定，后台配置表只覆盖消耗点数；服务工作流一次原子扣费后抑制底层 Provider 重复扣费。未接入服务目录的旧调用继续兼容 Provider Token/Credit 计费。

文件路径: `src/modules/ai-billing`
Mongo 集合: `ai_service_credit_configs`、`ai_service_usage_records`、`ai_credit_transactions`、`ai_usage_records`、`sass_tenants`

## 文件清单 (File List)

- `ai-billing.module.ts` — NestJS 模块入口。
- `entities/ai-usage-record.entity.ts` — 计费上下文、Provider 计费快照与用量流水实体。
- `entities/ai-service-credit.entity.ts` — 固定服务目录、点数配置、管理视图与服务扣费流水实体。
- `entities/ai-credit-transaction.entity.ts` — 追加式 Credit 余额流水类型与变动前后余额实体。
- `services/ai-billing.service.ts` — 服务固定扣费、Provider 重复扣费抑制、Token 计量、余额原子更新与充值/消费/退款流水。

## 函数清单 (Function List)

### ai-billing.module.ts

- `AiBillingModule` — 组合并导出统一 AI 计费服务 | keywords: AI计费模块, Credit扣费, ai-billing-module, credit-charge

### entities/ai-service-credit.entity.ts

- `AI_CREDIT_SERVICE_CATALOG` — 固定收费服务的英文编码、名称与默认点数目录 | keywords: 服务目录, 固定编码, service-catalog, fixed-code

### services/ai-billing.service.ts

- `CREDIT_UNIT_SCALE` — 定义一个 Credit 的整数计费精度 | keywords: 最小计费单位, Credit精度, billing-unit-scale, credit-precision
- `STREAM_TOKEN_BLOCK` — 定义流式输出追加预占的 Token 块 | keywords: 流式预占, Token分块, stream-reservation, token-block
- `AiBillingCallbackHandler` — 将每次物理 LLM 调用接入计量与扣费 | keywords: 模型计费回调, 流式扣费, model-billing-callback, streaming-charge
- `AiBillingCallbackHandler(billing,context,provider)` — 创建失败关闭的 LangChain 计费回调 | keywords: 计费回调初始化, 失败关闭, billing-callback-init, fail-closed
- `handleChatModelStart(llm,messages,runId,parentRunId?)` — 调用前预扣输入与首个输出块 | keywords: 调用前预扣, 输入Token, pre-call-reserve, input-token
- `handleLLMNewToken(token,idx,runId)` — 流式输出时持续扣费并在额度耗尽时中断 | keywords: 流式Token扣费, 额度中断, streaming-token-charge, credit-interrupt
- `handleLLMEnd(output,runId)` — 按真实用量结算并退款 | keywords: 真实用量结算, 预占退款, actual-usage-settlement, reservation-refund
- `handleLLMError(error,runId)` — 记录失败调用用量 | keywords: 失败调用结算, 错误流水, failed-call-settlement, error-ledger
- `AiBillingService` — 提供 AI 用量流水与原子 Credit 扣费 | keywords: AI计费服务, 原子扣费, ai-billing-service, atomic-charge
- `AiBillingService(db)` — 初始化计费集合和索引 | keywords: 计费服务初始化, 用量索引, billing-service-init, usage-index
- `ensureIndexes()` — 创建调用幂等与查询索引 | keywords: 用量索引, 调用幂等, usage-index, call-idempotency
- `getServiceCreditCost(serviceCode)` — 读取固定服务当前生效点数 | keywords: 读取服务价格, 固定目录, resolve-service-price, fixed-catalog
- `chargeService(input)` — 按服务固定点数原子扣费并记录流水 | keywords: 服务固定扣费, 服务流水, fixed-service-charge, service-ledger
- `commitServiceCharge(tenantId,definition,record,session?)` — 同步提交服务余额、流水和用量并兼容单机补偿 | keywords: 提交服务扣费, 单机补偿, commit-service-charge, standalone-compensation
- `isMongoTransactionUnsupported(error)` — 识别单机 Mongo 的事务拒绝错误 | keywords: 单机事务识别, 兼容降级, transaction-support-detect, compatibility-fallback
- `runWithServiceBilling(operation)` — 在服务调用链中抑制 Provider 重复扣费 | keywords: 抑制重复扣费, 服务调用链, suppress-provider-charge, service-call-chain
- `createCallback(context,provider)` — 创建模型计费回调 | keywords: 创建计费回调, 子代理计量, create-billing-callback, subagent-metering
- `beginTextCall(input)` — 登记并预扣文本调用 | keywords: 文本调用开始, 流式预扣, text-call-start, streaming-precharge
- `consumeTextChunk(callId,token)` — 消费流式文本并追加预扣 | keywords: 消费流式文本, 余额耗尽, consume-stream-text, balance-exhausted
- `completeTextCall(callId,output)` — 完成真实 Token 结算 | keywords: 文本调用完成, Token结算, text-call-complete, token-settlement
- `failTextCall(callId,error)` — 结算失败文本调用 | keywords: 文本调用失败, 额度耗尽状态, text-call-failure, credit-exhausted-status
- `beginImageCall(input)` — 生图调用前执行固定 Token 预扣 | keywords: 生图预扣, 固定Token计费, image-precharge, fixed-token-billing
- `completeImageCall(callId,usage?)` — 完成生图用量流水 | keywords: 生图完成, 生图用量, image-complete, image-usage
- `failImageCall(callId,error)` — 记录失败生图费用 | keywords: 生图失败计费, 生图错误流水, image-failure-charge, image-error-ledger
- `listUsage(input)` — 按租户与时间分页查询用量 | keywords: 用量流水查询, 租户过滤, usage-ledger-query, tenant-filter
- `createCallState(input)` — 建立调用状态并首次原子预扣 | keywords: 创建调用状态, 首次原子预扣, create-call-state, initial-atomic-reserve
- `reserveMore(state,tokens)` — 为活跃调用追加预扣，完整块不足时取走可用尾款 | keywords: 追加预扣, 活跃调用, additional-reserve, active-call
- `drainTenantUnits(tenantId,meta?)` — 原子耗尽不足一个预扣块的最后余额并记录消费流水 | keywords: 耗尽最后余额, Credit归零, drain-final-balance, zero-credit
- `reserveTenantUnits(tenantId,units,meta?)` — 原子扣减租户余额并记录 Provider 消费流水 | keywords: 原子扣减余额, 额度耗尽, atomic-balance-debit, credit-exhausted
- `ensureCreditUnits(tenantId)` — 懒初始化历史租户余额单位 | keywords: 历史租户兼容, 余额单位初始化, legacy-tenant-compat, balance-unit-init
- `finishCall(callId,status,usage?,errorCode?)` — 结算调用并退回多余预占 | keywords: 完成调用结算, Credit退款, finish-call-settlement, credit-refund
- `extractUsage(output)` — 提取多厂商 Token 用量 | keywords: Token用量解析, 多厂商兼容, token-usage-parser, multi-provider-compat
- `normalizeUsageCandidate(value)` — 归一用量字段别名 | keywords: Token字段归一, 用量元数据, token-field-normalize, usage-metadata
- `firstNumber(record,keys)` — 读取首个合法数字字段 | keywords: 数字字段读取, Token别名, numeric-field-read, token-alias
- `estimateTokens(value)` — 用 UTF-8 字节数保守估算 Token | keywords: Token保守估算, UTF8字节, conservative-token-estimate, utf8-byte
- `tokensToUnits(tokens,tokensPerCredit)` — Token 转整数 Credit 单位 | keywords: Token转Credit, 向上取整, token-to-credit, ceiling-rounding
- `positiveInteger(value)` — 校验正整数计费配置 | keywords: 正整数配置, 计费参数校验, positive-integer-config, billing-validation
- `normalizeCreditCost(value,fallback)` — 归一服务点数与六位小数精度 | keywords: 服务点数归一, 小数精度, normalize-service-credit, decimal-precision
- `resolveTenant(context)` — 解析租户或显式平台作用域 | keywords: 租户计费作用域, 平台调用声明, tenant-billing-scope, platform-call-declaration
- `billingError(code)` — 构造稳定计费异常 | keywords: 计费异常, 错误码, billing-error, error-code
- `errorCode(error)` — 提取稳定错误码 | keywords: 错误码提取, 异常归一, error-code-extract, exception-normalize

## 关键词索引 (Keyword Index)

| 中文       | English               |
| ---------- | --------------------- |
| AI用量流水 | ai-usage-ledger       |
| 原子扣费   | atomic-charge         |
| 流式扣费   | streaming-charge      |
| 固定Token  | fixed-token           |
| 额度耗尽   | credit-exhausted      |
| 预占退款   | reservation-refund    |
| 调用幂等   | call-idempotency      |
| 多厂商兼容 | multi-provider-compat |
| 服务目录   | service-catalog       |
| 服务固定扣费 | fixed-service-charge |
| 后台改价   | admin-pricing         |
| Credit流水 | credit-transaction    |
| 余额审计   | balance-audit         |

## 类型导出 (Type Exports)

- `AiBillingContext` / `AiProviderBillingSnapshot` / `AiUsageRecordEntity`（`entities/ai-usage-record.entity.ts`）。
- `AiCreditServiceCode` / `AiCreditServiceDefinition` / `AiServiceCreditConfigEntity` / `AiCreditServiceView` / `AiServiceUsageRecordEntity` / `AI_CREDIT_SERVICE_CATALOG`（`entities/ai-service-credit.entity.ts`）。
- `AiCreditTransactionType` / `AiCreditTransactionEntity`（`entities/ai-credit-transaction.entity.ts`）。
- `AiBillingCallbackHandler` / `AiBillingService` / `CREDIT_UNIT_SCALE` / `STREAM_TOKEN_BLOCK`（`services/ai-billing.service.ts`）。

## 模块功能描述 (Module Feature Description)

`text-generation`（生文服务）与 `video-generation`（生视频服务）固定登记在 `AI_CREDIT_SERVICE_CATALOG`，默认均为 1 Credit；后台只允许按既有编码覆盖点数。有限租户在服务启动前完成一次原子扣费并写入 `ai_service_usage_records` 和统一 `ai_credit_transactions` 流水；Provider 预扣、尾款与退款也追加余额流水。流水保存有符号变动值、变动前后余额、原因、操作方、外部单号与服务信息，禁止修改或删除。服务工作流通过异步上下文关闭内部 LLM、生图 Provider 的重复扣费；尚未接入服务目录的旧调用仍使用原 Provider Token 预扣与结算链路。
