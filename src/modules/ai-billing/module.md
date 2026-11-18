# 模块名称 (Module Name)

AI 计费模块（ai-billing）

## 概述 (Overview)

统一提供服务级固定 Credit 扣费与模型物理调用 Token 用量记录，并维护租户待分配额度 / 成员租户额度 / 个人额度三层 Credit 钱包（跨钱包按顺序扣、按分摊原路退）。服务编码、名称和默认点数由代码目录固定，后台配置表只覆盖消耗点数；服务工作流一次原子扣费后抑制底层 Provider 重复扣费。未接入服务目录的旧调用继续兼容 Provider Token/Credit 计费。

文件路径: `src/modules/ai-billing`
Mongo 集合: `ai_service_credit_configs`、`ai_service_usage_records`、`ai_credit_transactions`、`ai_usage_records`、`ai_credit_wallets`、`sass_tenants`、`admin_users`（只读，解析计费成员）

## 文件清单 (File List)

- `ai-billing.module.ts` — NestJS 模块入口，导出计费服务与钱包服务。
- `entities/ai-usage-record.entity.ts` — 计费上下文、Provider 计费快照与用量流水实体（含免费调用标记 `free`）。
- `entities/ai-service-credit.entity.ts` — 固定服务目录、点数配置、管理视图与服务扣费流水实体（流水含 `refunded` 状态与退款时间、原因）。
- `entities/ai-credit-transaction.entity.ts` — 追加式 Credit 余额流水类型与变动前后余额实体，含所在钱包 `wallet` 与成员 / 账号 ID。
- `entities/ai-credit-wallet.entity.ts` — 钱包种类、租户额度模式、成员 / 个人钱包文档、付款钱包与扣费分摊类型。
- `services/ai-billing.service.ts` — 服务固定扣费与失败退款、Provider 重复扣费抑制、Token 计量、余额原子更新与充值/消费/退款流水。
- `services/ai-billing.service.spec.ts` — 服务退款的幂等、余额加回、流水追加与失败还原单测。
- `services/ai-credit-wallet.service.ts` — 三层钱包：付款顺序解析、跨钱包原子扣减 / 尾款扣光、原路退款、划拨、新成员赠送、旧余额迁移、个人充值与余额 / 流水查询。
- `services/ai-credit-wallet.service.spec.ts` — 付款顺序、跨钱包扣费与补偿、原路退款、新成员赠送单测。

## 函数清单 (Function List)

### ai-billing.module.ts

- `AiBillingModule` — 组合并导出统一 AI 计费服务与三层 Credit 钱包服务 | keywords: AI计费模块, Credit扣费, ai-billing-module, credit-charge

### entities/ai-credit-wallet.entity.ts

- `AiCreditWalletKind` — 钱包种类 tenant / member / account | keywords: 钱包种类, 三层额度, wallet-kind, three-tier-credit
- `AiTenantCreditMode` — 租户额度模式 shared / allocated | keywords: 租户额度模式, 统一分配, tenant-credit-mode, unified-allocation
- `AiCreditWalletEntity` — `ai_credit_wallets` 成员 / 个人钱包文档 | keywords: 成员钱包, 个人钱包, member-wallet, personal-wallet
- `AiCreditPayer` — 一次扣费可动用的付款钱包 | keywords: 付款钱包, 扣费顺序, credit-payer, charge-order
- `AiCreditAllocation` — 扣费落在某钱包上的单位数 | keywords: 扣费分摊, 原路退回, charge-allocation, refund-to-source

### entities/ai-service-credit.entity.ts

- `AI_CREDIT_SERVICE_CATALOG` — 固定收费服务的英文编码、名称与默认点数目录 | keywords: 服务目录, 固定编码, service-catalog, fixed-code

### services/ai-billing.service.spec.ts

- `createFakeDb()` — 构造按集合名返回 jest mock 的假 Db | keywords: 假数据库, 集合模拟, fake-db, collection-mock
- `chargedRecord(overrides?)` — 生成已扣 1 Credit 的服务流水样本 | keywords: 服务流水样本, 退款前文档, service-record-fixture, pre-refund-document
- `buildService(db)` — 用假 Db 组装计费服务与钱包服务 | keywords: 组装计费服务, 钱包依赖, build-billing-service, wallet-dependency

### services/ai-credit-wallet.service.spec.ts

- `createWalletDb()` — 构造钱包服务用到的集合假 Db | keywords: 钱包假数据库, 集合模拟, wallet-fake-db, collection-mock
- `tenantDoc(mode,overrides?)` — 生成有限额度租户样本 | keywords: 租户样本, 额度模式, tenant-fixture, credit-mode
- `memberPayers()` — 生成成员租户额度 → 个人额度的付款顺序 | keywords: 成员付款顺序, 个人额度, member-payer-order, personal-credit

### services/ai-credit-wallet.service.ts

- `WALLET_UNIT_SCALE` — 钱包整数最小计费单位，与 CREDIT_UNIT_SCALE 一致 | keywords: 钱包计费精度, 最小计费单位, wallet-unit-scale, billing-unit-scale
- `AiCreditWalletService` — 三层 Credit 钱包服务 | keywords: Credit钱包, 跨钱包扣费, credit-wallet-service, multi-wallet-debit
- `AiCreditWalletService(db)` — 初始化钱包集合并异步建索引 | keywords: 钱包服务初始化, 钱包索引, wallet-service-init, wallet-index
- `ensureIndexes()` — 建钱包唯一键、租户成员钱包与按成员 / 账号查流水的索引 | keywords: 钱包索引, 钱包流水索引, wallet-index, wallet-ledger-index
- `walletKey(kind,ownerId)` — 拼成员或个人钱包唯一键 | keywords: 钱包唯一键, 钱包定位, wallet-key, wallet-locate
- `creditMode(tenant)` — 读取租户额度模式，缺省为历史共用 | keywords: 租户额度模式, 历史共用, tenant-credit-mode, legacy-shared
- `isUnlimited(tenant)` — 判断租户是否无限额度 | keywords: 无限额度, 租户额度, unlimited-credit, tenant-credit
- `resolvePayers(tenant,userId?)` — 分配模式 [成员租户额度, 个人额度]，共用模式 [租户余额, 个人额度]，查不到成员只扣租户余额 | keywords: 付款顺序, 先租户后个人, resolve-payers, tenant-first-then-personal
- `findTenantMember(tenantId,userId?)` — 读取调用方在该租户的成员身份 | keywords: 计费成员, 租户成员查找, billing-member, tenant-member-lookup
- `debit(input)` — 依次跨钱包扣减，partial 取光尾款，否则不足撤销并抛 CREDIT_EXHAUSTED，每个落账钱包写一笔流水 | keywords: 跨钱包扣费, 额度耗尽, multi-wallet-debit, credit-exhausted
- `revert(result)` — 删已写流水并把单位加回原钱包 | keywords: 撤销扣费, 单机补偿, revert-debit, standalone-compensation
- `refund(input)` — 按扣费分摊从后往前原路退回并写退款流水，加余额失败带已退单位数抛出 | keywords: 原路退款, 预占退款, refund-to-source, reservation-refund
- `transfer(input)` — 两个钱包之间先扣后加的划拨，写出入两笔流水，流水失败整体撤销 | keywords: 钱包划拨, 额度分配, wallet-transfer, credit-allocation
- `grantNewMember(tenant,member)` — 分配模式租户的新成员从待分配额度领赠送，同一成员只处理一次 | keywords: 新成员赠送, 注册发放, new-member-grant, registration-grant
- `migrateTenantToMembers(input)` — 原子切分配模式并清零租户余额，每个启用成员各发一份原余额全额 | keywords: 旧余额迁移, 每人全额, legacy-credit-migration, full-copy-per-member
- `enableAllocation(tenant)` — 不迁移直接切分配模式，原余额留作待分配额度 | keywords: 切换分配模式, 保留待分配额度, enable-allocation-mode, keep-pool-balance
- `changeAccountWallet(input)` — 后台给个人钱包充值或调账，不许透支，外部单号幂等 | keywords: 个人充值, 个人调账, personal-recharge, personal-adjustment
- `getWalletUnits(kind,ownerId)` — 读取单个成员或个人钱包余额 | keywords: 钱包余额, 单钱包查询, wallet-balance, single-wallet-query
- `getWalletUnitsMap(kind,ownerIds)` — 批量读取钱包余额 | keywords: 批量钱包余额, 成员额度列表, batch-wallet-balance, member-credit-list
- `listTransactions(filter,input)` — 倒序分页读取钱包流水 | keywords: 钱包流水查询, 倒序分页, wallet-ledger-query, reverse-pagination
- `ensureTenantUnits(tenantId)` — 懒初始化历史租户余额单位（由计费服务迁入） | keywords: 历史租户兼容, 余额单位初始化, legacy-tenant-compat, balance-unit-init
- `take(payer,units,exact,session?)` — 单钱包原子扣减，exact 够才扣满，否则扣到 0 | keywords: 单钱包扣减, 原子扣减余额, single-wallet-take, atomic-balance-debit
- `give(payer,units,session?)` — 单钱包入账，成员 / 个人钱包不存在时自动创建，无限租户返回 null | keywords: 单钱包入账, 自动建钱包, single-wallet-give, auto-create-wallet
- `giveBack(allocations)` — 把扣费分摊原样加回不写流水 | keywords: 加回余额, 补偿撤销, give-back-balance, compensation-undo
- `buildLedger(payer,deltaUnits,afterUnits,meta)` — 生成带所在钱包的追加式流水 | keywords: 生成钱包流水, 变动前后余额, build-wallet-ledger, balance-before-after
- `insertLedger(transaction,session?)` — 写入流水，有会话随会话提交 | keywords: 写入流水, 事务会话, insert-ledger, transaction-session
- `walletError(code)` — 构造稳定错误码钱包异常 | keywords: 钱包异常, 错误码, wallet-error, error-code

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
- `AiBillingService(db,wallet)` — 初始化计费集合和索引并注入钱包服务 | keywords: 计费服务初始化, 用量索引, billing-service-init, usage-index
- `ensureIndexes()` — 创建调用幂等与查询索引 | keywords: 用量索引, 调用幂等, usage-index, call-idempotency
- `getServiceCreditCost(serviceCode)` — 读取固定服务当前生效点数 | keywords: 读取服务价格, 固定目录, resolve-service-price, fixed-catalog
- `chargeService(input)` — 按服务固定点数沿付款顺序跨钱包扣费并记录流水与分摊 | keywords: 服务固定扣费, 服务流水, fixed-service-charge, service-ledger
- `commitServiceCharge(payers,definition,record,session?)` — 跨钱包扣服务点数、写流水与服务用量（含 allocations），单机写失败撤销扣费 | keywords: 提交服务扣费, 单机补偿, commit-service-charge, standalone-compensation
- `isMongoTransactionUnsupported(error)` — 识别单机 Mongo 的事务拒绝错误 | keywords: 单机事务识别, 兼容降级, transaction-support-detect, compatibility-fallback
- `refundService(input)` — 业务生成失败时按 operationId 幂等、按扣费分摊原路退回服务扣费并追加 refund 余额流水 | keywords: 服务退款, 失败退点, 幂等退款, service-refund, failure-refund, idempotent-refund
- `runWithServiceBilling(operation)` — 在服务调用链中抑制 Provider 重复扣费 | keywords: 抑制重复扣费, 服务调用链, suppress-provider-charge, service-call-chain
- `createCallback(context,provider)` — 创建模型计费回调 | keywords: 创建计费回调, 子代理计量, create-billing-callback, subagent-metering
- `beginTextCall(input)` — 登记并预扣文本调用 | keywords: 文本调用开始, 流式预扣, text-call-start, streaming-precharge
- `consumeTextChunk(callId,token)` — 消费流式文本并追加预扣，免费提供商与无限额度租户直接返回 | keywords: 消费流式文本, 余额耗尽, consume-stream-text, balance-exhausted
- `completeTextCall(callId,output)` — 完成真实 Token 结算 | keywords: 文本调用完成, Token结算, text-call-complete, token-settlement
- `failTextCall(callId,error)` — 结算失败文本调用 | keywords: 文本调用失败, 额度耗尽状态, text-call-failure, credit-exhausted-status
- `beginImageCall(input)` — 生图调用前执行固定 Token 预扣 | keywords: 生图预扣, 固定Token计费, image-precharge, fixed-token-billing
- `completeImageCall(callId,usage?)` — 完成生图用量流水 | keywords: 生图完成, 生图用量, image-complete, image-usage
- `failImageCall(callId,error)` — 记录失败生图费用 | keywords: 生图失败计费, 生图错误流水, image-failure-charge, image-error-ledger
- `listUsage(input)` — 按租户与时间分页查询用量 | keywords: 用量流水查询, 租户过滤, usage-ledger-query, tenant-filter
- `createCallState(input)` — 建立调用状态并对付费提供商首次原子预扣；provider 缺 tokensPerCredit 视为免费服务，不校验额度只记流水 | keywords: 创建调用状态, 首次原子预扣, create-call-state, initial-atomic-reserve
- `reserveMore(state,tokens)` — 为活跃调用沿付款顺序追加预扣，完整块不足时取走各钱包尾款 | keywords: 追加预扣, 活跃调用, additional-reserve, active-call
- `mergeAllocations(current,next)` — 合并两次扣费分摊，保持钱包首次出现顺序 | keywords: 合并扣费分摊, 钱包顺序, merge-allocations, wallet-order
- `finishCall(callId,status,usage?,errorCode?)` — 结算调用，补扣走付款顺序，多余预占按分摊原路退回 | keywords: 完成调用结算, Credit退款, finish-call-settlement, credit-refund
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
| 免费提供商 | free-provider         |
| 失败退点   | failure-refund        |
| 幂等退款   | idempotent-refund     |
| 三层额度   | three-tier-credit     |
| 跨钱包扣费 | multi-wallet-debit    |
| 付款顺序   | resolve-payers        |
| 先租户后个人 | tenant-first-then-personal |
| 原路退款   | refund-to-source      |
| 钱包划拨   | wallet-transfer       |
| 新成员赠送 | new-member-grant      |
| 旧余额迁移 | legacy-credit-migration |
| 个人充值   | personal-recharge     |
| 租户额度模式 | tenant-credit-mode  |

## 类型导出 (Type Exports)

- `AiBillingContext` / `AiProviderBillingSnapshot` / `AiUsageRecordEntity`（`entities/ai-usage-record.entity.ts`）。
- `AiCreditServiceCode` / `AiCreditServiceDefinition` / `AiServiceCreditConfigEntity` / `AiCreditServiceView` / `AiServiceUsageRecordEntity` / `AI_CREDIT_SERVICE_CATALOG`（`entities/ai-service-credit.entity.ts`）。
- `AiCreditTransactionType` / `AiCreditTransactionEntity`（`entities/ai-credit-transaction.entity.ts`）。
- `AiCreditWalletKind` / `AiTenantCreditMode` / `AiCreditWalletEntity` / `AiCreditPayer` / `AiCreditAllocation`（`entities/ai-credit-wallet.entity.ts`）。
- `AiCreditWalletService` / `AiCreditLedgerMeta` / `AiCreditDebitResult`（`services/ai-credit-wallet.service.ts`）。
- `AiBillingCallbackHandler` / `AiBillingService` / `CREDIT_UNIT_SCALE` / `STREAM_TOKEN_BLOCK`（`services/ai-billing.service.ts`）。

## 模块功能描述 (Module Feature Description)

`text-generation`（生文服务）与 `video-generation`（生视频服务）固定登记在 `AI_CREDIT_SERVICE_CATALOG`，默认均为 1 Credit；后台只允许按既有编码覆盖点数。有限租户在服务启动前完成一次原子扣费并写入 `ai_service_usage_records` 和统一 `ai_credit_transactions` 流水；Provider 预扣、尾款与退款也追加余额流水。流水保存有符号变动值、变动前后余额、原因、操作方、外部单号与服务信息，禁止修改或删除。服务工作流通过异步上下文关闭内部 LLM、生图 Provider 的重复扣费；尚未接入服务目录的旧调用仍使用原 Provider Token 预扣与结算链路。

**失败退点**: `refundService` 按 `operationId` 退回服务扣费。先把服务流水从 `succeeded` 原子翻成 `refunded` 抢占退款权，并发或重复调用只有一方能抢到；再给租户加回余额并追加一条 `refund` 余额流水（`referenceId` 为 operationId）。余额加回失败时把流水还原成 `succeeded` 以便重退；余额已加回但余额流水写失败时不还原，只记错误日志供对账，避免重复退款。没扣成功（`credit_exhausted`）或已退过的流水不会命中。当前只有小红书单篇文章生成接入。

**三层 Credit 钱包**: 租户待分配额度存在 `sass_tenants.credit/creditUnits`；成员在某租户分到的额度（`member:<成员ID>`）与手机号账号的个人额度（`account:<账号ID>`，跨租户通用）存在 `ai_credit_wallets`。`resolvePayers` 按租户模式决定扣费顺序：分配模式（`creditMode: allocated`，新租户默认）先扣成员本租户额度、不够再扣个人额度；共用模式（缺省 / `shared`，旧租户迁移前）先扣租户余额、再扣个人额度；查不到调用成员（系统任务、无 userId）只扣租户余额。无限额度租户（-1）不扣任何钱包。不同租户的成员额度互不相通，切换租户后只能用目标租户分到的额度加个人额度。服务扣费、Provider 预扣 / 追加 / 补扣都通过 `debit` 跨钱包扣减（流式追加用 partial 取光尾款），每个落账钱包各写一笔带 `wallet` 的流水；`AiServiceUsageRecordEntity.allocations` 与调用内存态记录扣费分摊，退款与预占退款都按分摊从后往前原路退（先退个人额度）。历史服务流水没有 allocations 时退回租户钱包。分配、新成员赠送、旧余额迁移和个人充值由 tenant-credit 模块调用本服务完成。

**免费提供商**: 后台 `ai_providers` 未填 `tokensPerCredit` 即表示该模型不计费。此时无论租户额度是否有限，都不做额度校验、不预扣、不在流式中拦截，只落一条 `free: true` 的用量流水。付费提供商（已填 `tokensPerCredit`）仍按原链路预扣与结算，其中非流式文本调用无法边收 token 边预扣，仍要求配置 `fixedTokensPerCall`，否则抛 `TEXT_FIXED_TOKEN_NOT_CONFIGURED`；改走流式即可按厂商真实 usage 结算。
