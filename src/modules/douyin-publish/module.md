# 模块名称 (Module Name)

抖音视频发布库（douyin-publish）

## 概述 (Overview)

独立管理抖音待发布视频作品。管理端把视频库成片保存为不可变媒体快照，按租户与用户隔离维护多个发布库；抖音小程序通过二维码 Bearer token 扫码进入，按 FIFO 原子领取作品，并回写抖音原生发布器结果。原有 `douyin-workbench` 直连发布能力不受影响。

## 文件清单 (File List)

- `douyin-publish.module.ts` — Nest 模块声明，装配数据源、后台鉴权、抖音工作台视频校验、控制器与服务。
- `entities/douyin-publish.entity.ts` — 发布库、发布作品、统计、接口视图与十分钟租约常量定义。
- `services/douyin-publish-library.service.ts` — 发布库 CRUD、批量统计、二维码 token、长期 Schema 缓存与扫码 token 查询。
- `services/douyin-miniapp-schema.service.ts` — 抖音小程序 client_token 缓存与「生成 SchemaV2」调用，产出抖音扫一扫可直接打开发布页的 `sslocal://miniapp?ticket=…`。
- `services/douyin-publish-work.service.ts` — 视频快照入库、作品列表、选题位置、换库、FIFO 租约与发布结果回写。
- `services/douyin-publish-work.service.spec.ts` — 原生ID必需、加密ID保留、链接补全、待补状态防重发与抓取衔接回归测试。
- CONFIGURATION.md — 服务端配置、平台权限、桌面接口配套与部署步骤。
- `controller/douyin-publish.controller.ts` — `/api/douyin-publish` 管理端接口。
- `controller/douyin-publish-task.controller.ts` — `/api/publish-tasks` 抖音小程序扫码 token 接口。
- `controller/douyin-publish.dto.ts` — 管理端与小程序请求体校验 DTO。
- `guards/douyin-publish-token.guard.ts` — 小程序入口的同址权限声明装饰器、Bearer 扫码 token Guard 与发布库请求上下文。
- `../../../.env` — 本机抖音小程序 AppID 与发布页配置；环境文件被 Git 忽略，AppSecret 仅从服务端环境读取。

- `services/douyin-publish-webhook.service.ts` — 平台任务创建、跨进程复用和通知关联。
- `guards/douyin-publish-webhook.guard.ts` — 原始请求体验签及同址权限装饰器。
- `controller/douyin-publish-webhook.controller.ts` — 平台地址校验与任务回调 HTTP 入口。
- `services/douyin-publish-webhook.service.spec.ts` — 平台签名、任务关联、持久化重试与乱序回归测试。

## 函数清单 (Function List)

- `DOUYIN_PUBLISH_LEASE_MS` — 固定十分钟发布任务租约 | keywords: 发布租约, 十分钟租约, publish-lease, ten-minute-lease
- `CreateDouyinPublishLibraryDto()` — 校验发布库名称 | keywords: 发布库名称参数, publish-library-name-dto
- `UpdateDouyinPublishLibraryDto()` — 校验发布库改名参数 | keywords: 发布库改名参数, update-publish-library-dto
- `CreateDouyinPublishWorkDto()` — 校验作品入库参数 | keywords: 作品入库参数, create-publish-work-dto
- `UpdateDouyinPublishWorkDto()` — 校验作品可编辑字段与换库目标 | keywords: 作品更新参数, 换库参数, update-publish-work-dto, move-library-dto
- `DouyinPublishResultDto()` — 校验小程序发布结果回写参数 | keywords: 发布结果参数, publish-result-dto
- `DouyinPublishModule()` — 装配抖音视频发布库管理端与扫码发布能力 | keywords: 抖音发布模块, 扫码发布, douyin-publish-module, qr-publishing
- `DouyinPublishLibraryService()` — 管理发布库、二维码 token 与统计 | keywords: 发布库服务, 二维码令牌, publish-library-service, qr-token
- `ensureIndexes()` — 建立发布库作用域索引与二维码 partial unique 索引 | keywords: 发布库索引, 二维码唯一索引, publish-library-indexes, qr-token-unique-index
- `scopeFilter(scope)` — 构造租户用户双重过滤 | keywords: 发布作用域过滤, 用户隔离, publish-scope-filter, user-isolation
- `create(name,scope)` — 新建当前作用域发布库 | keywords: 新建发布库, create-publish-library
- `list(scope)` — 一次聚合全部发布库及统计 | keywords: 发布库列表, 批量统计, list-publish-libraries, batch-library-stats
- `get(id,scope)` — 读取当前作用域发布库 | keywords: 读取发布库, 所有权校验, get-publish-library, ownership-check
- `require(id,scope)` — 要求当前作用域发布库存在 | keywords: 要求发布库, 发布库不存在, require-publish-library, publish-library-not-found
- `update(id,name,scope)` — 更新发布库名称 | keywords: 更新发布库, update-publish-library
- `remove(id,scope)` — 删除空发布库 | keywords: 删除发布库, 非空库保护, delete-publish-library, non-empty-library-guard
- `getQr(id,scope)` — 懒生成 token 并构造二维码内容：配置小程序 AppID 时为长期 Schema，否则沿用链接模板或原始 JSON | keywords: 生成发布二维码, 懒生成令牌, build-publish-qr, lazy-qr-token
- `resolveQrSchema(library,query)` — 复用或生成一次发布库长期 Schema 并写回发布库，同库并发只生成一次 | keywords: 发布库Schema, 生成一次复用, publish-library-schema, generate-once-reuse
- `DouyinMiniappSchemaError(code,detail?,errNo?)` — 抖音开放平台调用失败，带业务错误码与抖音原始错误 | keywords: 抖音开放平台错误, 生成Schema失败, douyin-open-api-error, generate-schema-failure
- `DouyinMiniappSchemaService(config)` — 抖音小程序 Schema 生成服务，client_token 按进程缓存并在令牌失效时刷新重试一次 | keywords: 抖音小程序Schema, 扫码唤起小程序, douyin-miniapp-schema, qr-open-miniapp
- `readSettings()` — 读取小程序 AppID、AppSecret、网关与发布页路径 | keywords: 小程序配置, 配置读取, miniapp-config, config-read
- `isConfigured()` — 是否已配置小程序 AppID 与 AppSecret | keywords: 小程序配置, 是否启用Schema, miniapp-config, schema-enabled
- `buildSchemaKey(query)` — 当前 Schema 的身份键（AppID + 发布页 + 启动参数） | keywords: Schema身份键, 失效判断, schema-identity-key, cache-invalidation
- `generatePermanentSchema(query)` — 生成长期有效 Schema，启动参数原样作为页面 options | keywords: 生成长期Schema, 扫码唤起小程序, generate-permanent-schema, qr-open-miniapp
- `postSchema(settings,token,body)` — 调用生成 SchemaV2 并整理错误码与 Schema | keywords: 生成Schema请求, 抖音开放平台, generate-schema-request, douyin-open-api
- `getClientToken(settings,forceRefresh)` — 取缓存或单路在途换新 client_token | keywords: 获取client_token, 令牌缓存, get-client-token, token-cache
- `fetchClientToken(settings)` — 以 client_credential 换取 client_token 并写入缓存 | keywords: 获取client_token, 非用户授权, get-client-token, client-credential
- `postJson(url,body,headers?)` — 带超时的 JSON POST，网络错误与非 JSON 响应统一抛出 | keywords: 抖音接口请求, 超时控制, douyin-open-api-request, timeout-control
- `findByToken(token)` — 通过全局唯一 token 查询发布库 | keywords: 二维码鉴权查询, find-library-by-token
- `getStats(libraryId)` — 聚合单库发布统计 | keywords: 发布库统计聚合, aggregate-library-stats
- `emptyStats()` — 返回全零统计 | keywords: 空发布统计, empty-publish-stats
- `normalizeName(name)` — 归一并校验发布库名称 | keywords: 发布库名称归一化, normalize-library-name
- `toView(entity,stats)` — 转换发布库接口视图 | keywords: 发布库视图转换, publish-library-view-mapping
- `DouyinPublishWorkService()` — 管理发布作品与发布队列 | keywords: 发布作品服务, 发布队列, publish-work-service, publish-queue
- `ensureIndexes()` — 建立作品队列、选题位置和发布时间索引 | keywords: 发布作品索引, 领取队列索引, publish-work-indexes, lease-queue-index
- `create(libraryId,input,scope)` — 从视频库复制快照并创建作品 | keywords: 作品入库, 视频快照, create-publish-work, video-snapshot
- `createFromLink(libraryId,input,scope)` — 按抖音链接直接建已发布作品，同库同作品 ID 重复 409 | keywords: 按链接建作品, 手动链接作品, create-work-from-link, manual-link-work
- `findWork(id,scope)` — 读取当前作用域作品实体，不存在返回 null | keywords: 读取发布作品, 数据监控校验, find-publish-work, data-monitor-check
- `list(libraryId,params,scope)` — 分页列出作品并返回库统计 | keywords: 作品列表, 发布状态筛选, list-publish-works, publish-status-filter
- `locations(topicIds,scope)` — 查询选题入库位置 | keywords: 选题入库位置, topic-work-locations
- `update(id,input,scope)` — 更新作品或换库并保护有效租约 | keywords: 更新发布作品, 租约修改保护, update-publish-work, leased-mutation-guard
- `remove(id,scope)` — 删除作品并保护有效租约 | keywords: 删除发布作品, 租约删除保护, delete-publish-work, leased-delete-guard
- `leaseNext(libraryId)` — 原子 FIFO 领取下一条作品 | keywords: FIFO领取, 原子租约, fifo-lease-next, atomic-lease
- `getForLibrary(id,libraryId)` — 按扫码库读取指定作品 | keywords: 小程序读取作品, miniapp-get-work
- `updatePublishResult(id,libraryId,input)` — 回写发布结果并释放租约 | keywords: 发布结果回写, 释放租约, update-publish-result, release-lease
- resolvePublishedIdentity(work, input) — 保留原生ID并校验分享链接对应的数字抓取ID，拒绝缺ID成功与身份冲突 | keywords: publish-identity, crawl-handoff, 发布标识, 抓取衔接
- publishFixture() — 构造真实服务和内存作品验证发布回写 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- findWork() — 测试中读取当前作品 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- updateWork(filter, patch) — 测试中按数据库条件应用更新以验证并发保护 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- getCollection() — 测试中提供内存集合 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- publishIdentityTests() — 注册发布身份与抓取衔接回归 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- rejectsMissingId() — 验证缺ID不能正常上报已完成发布 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- numericIdIsCrawlable() — 验证数字原生ID供后续抓取读取 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- completesEncryptedId() — 验证加密ID原样保存并可补齐抓取链接 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- recoversMissingIdWithLink() — 验证漏返ID时退出领取队列并用链接恢复 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- protectsPublishedIdentity() — 验证已发布作品标识不可被冲突回调覆盖 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- rejectsInvalidLink() — 验证无效链接不能补全发布身份 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- rejectsConcurrentIdentityOverwrite() — 验证并发回调不能覆盖已落库的不同视频ID | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- bindsDesktopLinkToPublishedWork() — 验证桌面绑定链接能补齐发布库抓取身份且保留原始ID | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- writeMonitor(_query, patch) — 测试中模拟监控行upsert | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- getMonitorCollection() — 测试中提供监控集合 | keywords: publish-result-test, crawl-handoff, 发布回写测试, 抓取衔接
- `scopeFilter(scope)` — 构造作品租户用户过滤 | keywords: 作品作用域过滤, 用户隔离, work-scope-filter, user-isolation
- `requireWork(id,scope)` — 要求当前作用域作品存在 | keywords: 要求发布作品, require-publish-work
- `normalizeTags(tags?)` — 去井号、空白并去重标签 | keywords: 标签归一化, normalize-publish-tags
- `requireTitle(title)` — 归一并校验作品标题 | keywords: 标题归一化, normalize-publish-title
- `isLeased(work)` — 判断作品是否有有效租约 | keywords: 有效租约判断, active-lease-check
- `throwLeased()` — 抛出作品租约冲突 | keywords: 租约冲突错误, leased-work-conflict
- `throwDuplicate(work)` — 抛出重复选题冲突并携带位置 | keywords: 重复选题错误, duplicate-topic-conflict
- `escapeRegex(value)` — 转义关键词搜索正则 | keywords: 搜索词转义, escape-search-regex
- `toView(work)` — 转换管理端作品视图，返回租约状态和数字抓取目标crawlTarget | keywords: 作品视图转换, 实时租约状态, publish-work-view-mapping, computed-lease-state
- `DouyinPublishController()` — 提供发布库管理端接口 | keywords: 发布库管理接口, 管理端鉴权, publish-admin-controller, admin-authorization
- `listLibraries(req)` — 列出发布库及统计 | keywords: 发布库列表接口, list-publish-libraries-endpoint
- `createLibrary(body,req)` — 新建发布库 | keywords: 新建发布库接口, create-publish-library-endpoint
- `updateLibrary(id,body,req)` — 更新发布库名称 | keywords: 更新发布库接口, update-publish-library-endpoint
- `deleteLibrary(id,req)` — 删除空发布库 | keywords: 删除发布库接口, delete-publish-library-endpoint
- `getLibraryQr(id,req)` — 获取二维码入口内容 | keywords: 发布二维码接口, publish-qr-endpoint
- `listWorks(id,status,keyword,page,pageSize,req)` — 分页列出作品 | keywords: 发布作品列表接口, list-publish-works-endpoint
- `createWork(id,body,req)` — 创建视频快照作品 | keywords: 作品入库接口, create-publish-work-endpoint
- `getLocations(topicIds,req)` — 查询选题位置 | keywords: 选题位置接口, topic-locations-endpoint
- `updateWork(id,body,req)` — 更新作品或换库 | keywords: 更新发布作品接口, 换库接口, update-publish-work-endpoint, move-library-endpoint
- `deleteWork(id,req)` — 删除无有效租约作品 | keywords: 删除发布作品接口, delete-publish-work-endpoint
- `requireUser(req)` — 读取后台鉴权用户 | keywords: 读取发布用户, read-publish-user
- `scopeOf(user)` — 构造租户用户作用域 | keywords: 构造发布作用域, build-publish-scope
- `positiveInteger(value,fallback,min,max)` — 解析分页正整数 | keywords: 分页参数解析, parse-pagination-integer
- `DOUYIN_PUBLISH_ACCESS_METADATA` — 标记小程序入口的动作与权限主体 | keywords: 扫码入口权限, 权限主体声明, qr-entry-permission, permission-subject-declaration
- `DouyinPublishTokenGuard()` — 校验扫码令牌并写入发布库请求上下文 | keywords: 扫码令牌鉴权, 同址权限声明, qr-token-guard, colocated-permission-declaration
- `canActivate(context)` — 校验 DouyinWorkbench 权限主体与扫码令牌 | keywords: 校验扫码入口, 权限主体校验, validate-qr-entry, permission-subject-check
- `RequireDouyinPublishTokenAccess(action,subject)` — 在路由注册处挂载权限声明与扫码 Guard | keywords: 扫码权限装饰器, 同址权限声明, qr-access-decorator, colocated-permission-declaration
- `DouyinPublishTaskController()` — 提供小程序扫码发布接口 | keywords: 小程序发布接口, 扫码令牌鉴权, publish-task-controller, qr-token-auth
- `leaseNext(req)` — 领取下一条未发布作品并准备平台任务，准备失败释放本次租约 | keywords: 小程序领取接口, FIFO领取, lease-next-endpoint, fifo-lease
- `getWork(id,req)` — 读取扫码库内作品及平台状态，为未发布作品准备任务 | keywords: 小程序作品详情接口, publish-task-detail-endpoint
- `publishResult(id,body,req)` — 回写发布结果并释放租约，返回平台状态与抓取目标 | keywords: 小程序发布回写接口, 释放租约, publish-result-endpoint, release-lease
- `toTaskView(work,req)` — 转换小程序任务字段并补全媒体地址 | keywords: 小程序任务视图, 绝对媒体地址, publish-task-view, absolute-media-url
- `toAbsoluteUrl(value,req)` — 按转发协议与 host 补全相对地址 | keywords: 媒体地址补全, 代理协议识别, absolute-media-url, forwarded-protocol

- `DouyinPublishWebhookService()` — services/douyin-publish-webhook.service.ts：创建发布任务并将签名验证后的平台通知交给关联作品 | keywords: 拍抖音任务, 发布回调, douyin-video-task, publish-webhook
- `DouyinPublishWebhookService.constructor(db, config, platform, works)` — services/douyin-publish-webhook.service.ts：注入平台调用、作品服务与持久化任务关联 | keywords: 拍抖音任务, 发布回调, douyin-video-task, publish-webhook
- `onModuleInit()` — services/douyin-publish-webhook.service.ts：在启动完成前建立平台任务唯一索引，支持多进程去重 | keywords: 任务关联, 唯一索引, task-mapping, unique-index
- `prepareTask(work)` — services/douyin-publish-webhook.service.ts：为未发布作品复用或创建任务；启用后配置和权限错误会阻止无回调发布 | keywords: 拍抖音任务, 任务关联, douyin-video-task, task-mapping
- `activeTask(slot)` — services/douyin-publish-webhook.service.ts：查找仍有至少五分钟有效期的任务 | keywords: 任务关联, 任务复用, task-mapping, task-reuse
- `receive(body, messageId)` — services/douyin-publish-webhook.service.ts：处理平台原生事件名，关联任务后记录作品ID和审核公开状态；未知事件只确认接收 | keywords: 发布回调, 作品标识, publish-webhook, video-identity
- `parseContent(value)` — services/douyin-publish-webhook.service.ts：兼容平台 content 对象及 JSON 字符串格式 | keywords: 发布回调, 消息解析, publish-webhook, message-parse
- `DouyinPublishWebhookGuard()` — guards/douyin-publish-webhook.guard.ts：校验平台原始请求体签名与 AppID；challenge 只允许无副作用的地址验证 | keywords: 回调验签, 同址权限声明, webhook-signature, colocated-permission-declaration
- `DouyinPublishWebhookGuard.constructor(config, reflector)` — guards/douyin-publish-webhook.guard.ts：注入签名秘钥及入口权限声明读取器 | keywords: 回调验签, 同址权限声明, webhook-signature, colocated-permission-declaration
- `canActivate(context)` — guards/douyin-publish-webhook.guard.ts：只接受配置应用的签名消息；不将 JSON 再序列化作为验签输入 | keywords: 回调验签, 原始请求体, webhook-signature, raw-body
- `RequireDouyinPublishWebhookAccess(action, subject)` — guards/douyin-publish-webhook.guard.ts：在平台回调路由同址声明真实权限根主体及平台签名鉴权 | keywords: 回调验签, 同址权限声明, webhook-signature, colocated-permission-declaration
- `DouyinPublishWebhookController()` — controller/douyin-publish-webhook.controller.ts：接收抖音平台地址验证及拍抖音任务通知 | keywords: 发布回调, 平台通知, publish-webhook, platform-notification
- `DouyinPublishWebhookController.constructor(webhook)` — controller/douyin-publish-webhook.controller.ts：注入已签名通知的业务处理服务 | keywords: 发布回调, 平台通知, publish-webhook, platform-notification
- `receive(body, req, res)` — controller/douyin-publish-webhook.controller.ts：返回平台要求的文本 JSON challenge；业务事件落库成功后才确认接收 | keywords: 发布回调, 平台通知, publish-webhook, platform-notification
- `webhookFixture()` — services/douyin-publish-webhook.service.spec.ts：构造真实服务、内存持久层与可控平台 API，验证签名到作品更新全链路 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `matches(filter, value)` — services/douyin-publish-webhook.service.spec.ts：按 Mongo 精确值及 in 条件匹配，返回快照以验证实际并发比较更新 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `matchesCandidate(candidate)` — services/douyin-publish-webhook.service.spec.ts：比较精确候选值 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `findTestWork(filter)` — services/douyin-publish-webhook.service.spec.ts：读取作品快照 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `writeTestWork(filter, patch)` — services/douyin-publish-webhook.service.spec.ts：原子应用作品更新 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `findSlot(filter)` — services/douyin-publish-webhook.service.spec.ts：按作品或平台任务查询关联 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `matchesTask(task)` — services/douyin-publish-webhook.service.spec.ts：匹配历史平台任务 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `claimSlot(filter, patch)` — services/douyin-publish-webhook.service.spec.ts：模拟跨进程任务创建租约 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `writeSlot(filter, patch)` — services/douyin-publish-webhook.service.spec.ts：应用任务保存和租约释放 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `getWebhookCollection(name)` — services/douyin-publish-webhook.service.spec.ts：返回请求的测试集合 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `getWebhookSetting(key)` — services/douyin-publish-webhook.service.spec.ts：读取测试配置 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `notification(status, timestamp, videoId)` — services/douyin-publish-webhook.service.spec.ts：构造平台原生通知，content 按官方字符串格式传输 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `webhookTests()` — services/douyin-publish-webhook.service.spec.ts：验证安全入口、持久化任务关联及乱序回调 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `preparesMappedTasks()` — services/douyin-publish-webhook.service.spec.ts：任务按作品持久复用，关闭功能不影响原生发布，启用错误明确阻止发布 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `preventsConcurrentTaskCreation()` — services/douyin-publish-webhook.service.spec.ts：两次并发准备只有一个平台任务被创建 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `successfulTaskClaim(outcome)` — services/douyin-publish-webhook.service.spec.ts：统计成功的任务领取 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `handlesWebhookBeforeNativeResult()` — services/douyin-publish-webhook.service.spec.ts：平台通知先到也能接收后来的原生加密ID，不覆盖数字抓取目标 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `handlesDuplicateAndOutOfOrderEvents()` — services/douyin-publish-webhook.service.spec.ts：重复和旧通知不会降级状态，失败状态不重新进入发布队列 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `retriesFailedPersistence()` — services/douyin-publish-webhook.service.spec.ts：写入失败不提前标记已消费，平台重试可完成同一条通知 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `retainsOpaqueWebhookIdentity()` — services/douyin-publish-webhook.service.spec.ts：不将不透明平台ID假装成可抓取的数字作品ID | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `verifiesHttpSignatures()` — services/douyin-publish-webhook.service.spec.ts：使用真实 HTTP body parser 和路由验证原始字节签名及地址校验响应 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `createsOfficialLongTermTask()` — services/douyin-publish-webhook.service.spec.ts：平台创建请求使用长期任务类型和公开会客厅路径 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature
- `createPublishVideoTask()` — 创建携带公开会客厅挂载路径的长期视频任务 | keywords: 拍抖音任务, 发布回调, douyin-video-task, publish-webhook
- `applyPublishWebhook(id, event)` — 原子回写平台作品ID及状态并防止乱序覆盖 | keywords: 发布回调, 抓取衔接, publish-webhook, crawl-handoff
- `webhookMessage(status)` — 转换任务公开审核状态为工作台提示 | keywords: 发布回调, 审核状态, publish-webhook, audit-status
- `DouyinPublishTaskController.constructor(works, webhook)` — 注入作品与平台任务服务 | keywords: 小程序发布接口, 扫码令牌鉴权, publish-task-controller, qr-token-auth

- `releaseUnstartedLease(work)` — 平台任务准备失败时按租约条件释放作品，避免重试跳过当前视频 | keywords: 任务准备, 释放租约, task-prepare, release-lease

- `releasesLeaseAfterTaskFailure()` — 验证任务准备失败后立即释放新领取租约并允许重试 | keywords: 发布回调测试, 回调验签, publish-webhook-test, webhook-signature

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 抖音发布模块 | douyin-publish-module |
| 发布库 | publish-library |
| 发布作品 | publish-work |
| 视频快照 | video-snapshot |
| 发布队列 | publish-queue |
| 二维码令牌 | qr-token |
| 扫码令牌鉴权 | qr-token-auth |
| 扫码入口权限 | qr-entry-permission |
| 同址权限声明 | colocated-permission-declaration |
| 租户用户隔离 | user-isolation |
| 批量统计 | batch-library-stats |
| FIFO领取 | fifo-lease-next |
| 原子租约 | atomic-lease |
| 十分钟租约 | ten-minute-lease |
| 释放租约 | release-lease |
| 选题入库位置 | topic-work-locations |
| 绝对媒体地址 | absolute-media-url |
| 发布结果回写 | update-publish-result |
| 发布标识 | publish-identity |
| 抓取衔接 | crawl-handoff |
| 发布回写测试 | publish-result-test |
| 按链接建作品 | create-work-from-link |
| 手动链接作品 | manual-link-work |
| 抖音小程序Schema | douyin-miniapp-schema |
| 扫码唤起小程序 | qr-open-miniapp |
| 生成长期Schema | generate-permanent-schema |
| 发布库Schema | publish-library-schema |
| 生成一次复用 | generate-once-reuse |
| Schema身份键 | schema-identity-key |
| 获取client_token | get-client-token |
| 令牌缓存 | token-cache |
| 非用户授权 | client-credential |
| 抖音开放平台错误 | douyin-open-api-error |
| 生成Schema失败 | generate-schema-failure |
| 发布回调 | publish-webhook |
| 拍抖音任务 | douyin-video-task |
| 任务关联 | task-mapping |
| 回调验签 | webhook-signature |
| 原始请求体 | raw-body |
| 平台通知 | platform-notification |
| 发布回调测试 | publish-webhook-test |
| 任务复用 | task-reuse |
| 消息解析 | message-parse |
| 作品标识 | video-identity |
| 审核状态 | audit-status |
| 任务准备 | task-prepare |
| 唯一索引 | unique-index |

## 类型导出 (Type Exports)

- `DouyinPublishScope` — 租户与用户双重作用域 | keywords: 发布作用域, publish-scope
- `DouyinPublishLibraryEntity` — 发布库 Mongo 实体；`qrSchema` / `qrSchemaKey` 缓存长期 Schema 及生成它时的 AppID + 发布页 + 启动参数 | keywords: 发布库实体, publish-library-entity
- `DouyinPublishStatus` — `unpublished` / `published` 状态 | keywords: 作品发布状态, work-publish-status
- `DouyinPublishedSnapshot` — 实际发布文案快照 | keywords: 发布文案快照, published-copy-snapshot
- `DouyinPublishWorkSource` — 作品来源 `video` / `manual-link` | keywords: 作品来源, 手动链接作品, work-source, manual-link-work
- `DouyinPublishWorkEntity` — 带媒体快照和租约的作品实体 | keywords: 发布作品实体, 视频快照, publish-work-entity, video-snapshot
- `DouyinPublishLibraryStats` — 库统计 | keywords: 发布库统计, publish-library-stats
- `DouyinPublishLibraryView` — 管理端库视图 | keywords: 发布库视图, publish-library-view
- `DouyinPublishWorkView` — 管理端作品视图 | keywords: 发布作品视图, publish-work-view
- `DouyinPublishAccessDeclaration` — 小程序入口动作与 `DouyinWorkbench` 权限主体声明 | keywords: 扫码入口权限, 权限主体声明, qr-entry-permission, permission-subject-declaration
- `DouyinPublishTaskRequest` — 已写入发布库上下文的小程序请求 | keywords: 扫码请求上下文, 发布库上下文, qr-request-context, publish-library-context

## 模块功能描述 (Module Description)

管理端路由前缀为 `/api/douyin-publish`，数据边界与 `douyin-workbench` 一致：过滤条件始终包含 `userId`；有租户时精确匹配 `tenantId`，平台态只匹配 `tenantId` 不存在、`null` 或空字符串的数据。视频校验直接复用已导出的 `DouyinWorkbenchRepositoryService.requireVideo`，按当前租户读取 `videos` 记录；作品保存 `url`、`coverUrl`、`durationMs` 快照，分别对外映射为 `videoUrl`、`coverUrl`，并把 `durationMs` 换算为整秒 `duration`。

**入口鉴权**：

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET | `/api/douyin-publish/libraries` | `AdminAuthGuard` + `AdminPoliciesGuard`，`read DouyinWorkbench` |
| POST | `/api/douyin-publish/libraries` | 同上，`create DouyinWorkbench` |
| POST | `/api/douyin-publish/webhook` | 同址 `update DouyinWorkbench`，平台签名 Guard 与 AppID 校验；challenge 仅回显 |
| PATCH | `/api/douyin-publish/libraries/:id` | 同上，`update DouyinWorkbench` |
| DELETE | `/api/douyin-publish/libraries/:id` | 同上，`delete DouyinWorkbench` |
| GET | `/api/douyin-publish/libraries/:id/qr` | 同上，`read DouyinWorkbench` |
| GET | `/api/douyin-publish/libraries/:id/works` | 同上，`read DouyinWorkbench` |
| POST | `/api/douyin-publish/libraries/:id/works` | 同上，`create DouyinWorkbench` |
| GET | `/api/douyin-publish/works/locations` | 同上，`read DouyinWorkbench` |
| PATCH | `/api/douyin-publish/works/:id` | 同上，`update DouyinWorkbench` |
| DELETE | `/api/douyin-publish/works/:id` | 同上，`delete DouyinWorkbench` |
| POST | `/api/publish-tasks/lease-next` | `RequireDouyinPublishTokenAccess(update, DouyinWorkbench)` 同址声明；`Authorization: Bearer <qrToken>` 扫码 token 鉴权，可选 `X-Tenant-Id` 一致性校验 |
| GET | `/api/publish-tasks/:id` | `RequireDouyinPublishTokenAccess(read, DouyinWorkbench)` 同址声明；扫码 token 鉴权同上 |
| POST | `/api/publish-tasks/:id/publish-result` | `RequireDouyinPublishTokenAccess(update, DouyinWorkbench)` 同址声明；扫码 token 鉴权同上 |

集合 `douyin_publish_libraries` 使用 `{tenantId, userId, createdAt}` 索引；`qrToken` 使用只索引字符串的 partial unique 索引。集合 `douyin_publish_works` 使用 `{libraryId, status, createdAt}`、`{tenantId, topicId}`、`{libraryId, status, publishedAt}` 索引，并用 `{tenantId, userId, topicId}` partial unique 索引保证同一作用域选题并发入库仍唯一。库和作品以 Mongo ObjectId 存储，对外 `id`、`libraryId` 均为十六进制字符串。

`GET /libraries` 通过一次 `$lookup` 聚合全部库统计，不产生 N+1。`stats` 包含 `unpublished`、`published`、当前有效 `leased` 数与 `lastPublishedAt`。作品列表未发布按 `createdAt` 升序，已发布按 `publishedAt` 降序；`leased` 每次输出时按 `lockExpireAt > now` 现算。

作品新增 `source`（`video` / `manual-link`，旧数据缺省按 `video` 输出）与 `douyinUrl`。`manual-link` 作品由 `douyin-data` 的「新增链接」经 `createFromLink` 创建：直接是已发布状态，`douyinVideoId` 为解析出的作品 ID，没有视频地址、封面与时长，因为不是未发布状态所以永远不会被小程序领取；同一发布库里同一 `douyinVideoId` 重复时返回 409 `DOUYIN_PUBLISH_WORK_EXISTS`。`findWork` 供数据监控在抓取前确认作品仍存在。

领取使用 `findOneAndUpdate`，条件为 `status: unpublished` 且租约不存在、为空或已过期，按 `createdAt` 升序原子写入十分钟租约。成功和失败均清除租约。正常 published 回写必须有原生 douyinVideoId 或可解析的 douyinUrl；原生加密ID原样保存，数字ID对应链接保存到 douyinUrl，供 douyin-data 使用。已发布回写可补齐作品链接，保留首次发布时间与文案快照，通过数据库条件防止冲突ID或链接覆盖，晚到的失败不降级已发布状态。响应为 `{ ok, douyinVideoId, crawlTarget }`。

平台发布成功却漏返ID时，小程序上报 identity-pending，后端按实际已发布状态从领取队列移出，lastError 明确标记待补作品ID，防止租约过期后重复发布；补充链接后清除待补提示并提供数字抓取目标。此时 crawlTarget 为 null，不能开启抓取。douyinUrl 支持15-21位数字ID、抖音作品长链接和分享口令中的短链，仅跟随抖音域名；错误为 DOUYIN_PUBLISH_VIDEO_ID_REQUIRED、DOUYIN_PUBLISH_VIDEO_LINK_INVALID 或 DOUYIN_PUBLISH_VIDEO_ID_CONFLICT。有效租约期间管理端换库、编辑或删除仍返回409。

**扫码直接打开小程序（长期 Schema）**：配置了 `DOUYIN_MINIAPP_APP_ID` 与 `DOUYIN_MINIAPP_APP_SECRET` 时，`getQr` 的 `qrContent` 改为抖音「生成 SchemaV2」产出的长期链接 `sslocal://miniapp?ticket=…`（`qrContentType: douyin-schema`），抖音 App 扫一扫即可打开小程序发布页。Schema 的启动参数是扁平的 `{token, tenantId}`（不是 `path` JSON），小程序 `readPublishEntryPayload` 在没有 `path` 时直接从 options 读这两个键。每个发布库只生成一次，存在 `qrSchema`，`qrSchemaKey` 记下 AppID + 发布页 + 启动参数，任一项变化才重新生成；长期 Schema 全平台上限 10 万条，所以不能每次打开二维码都生成。client_token 来自 `POST /oauth/client_token/`（`grant_type=client_credential`），按进程缓存、提前 5 分钟刷新；多进程互相刷新导致令牌失效（`err_no=28001003`）时刷新后重试一次。生成失败返回 502 `DOUYIN_PUBLISH_QR_SCHEMA_FAILED` 并记日志（含抖音 `err_no` / `log_id`），不悄悄退回打不开的原始 JSON。可选配置：`DOUYIN_OPEN_API_BASE`（默认 `https://open.douyin.com`，沙盒用 `https://open-sandbox.douyin.com`）、`DOUYIN_MINIAPP_PUBLISH_PAGE`（默认 `pages/publish/index`）。小程序需开通 `ma.share.schema` 权限。

本机 `.env` 的 `DOUYIN_MINIAPP_APP_ID` 已配置为 `ttd8d9ae6446a0257001`，与合并后的 `shunye-ip/super-myself/src/manifest.json` 一致；`DOUYIN_MINIAPP_PUBLISH_PAGE` 为独立发布页 `pages/publish/index`，小程序默认首页保留会客厅内容。仍需在服务端单独提供 `DOUYIN_MINIAPP_APP_SECRET`，不能仅凭 AppID 生成 Schema。部署环境也需提供同名配置，本机 `.env` 不随 Git 分发。

二维码 token 懒生成，使用 32 字节随机数的 base64url 字符串。`path` 是 `{"token":"...","tenantId":"..."}` JSON；未配置 `DOUYIN_PUBLISH_QR_LINK_TEMPLATE` 时 `qrContent` 等于 `path`。配置模板时必须包含 `{path}`，服务会替换为 `encodeURIComponent(path)`；模板应指向抖音小程序页面 `pages/publish/index`，入口参数名为 `path`，可使用抖音小程序 schema 或抖音开放平台生成的带参链接。

领取与详情返回 `{ id, title, description, tags, videoUrl, coverUrl, duration, status, douyinVideoId, crawlTarget }`。小程序重开指定作品时依据 status 恢复已发布锁定状态；crawlTarget 为空时可补作品链接，不能再次发布。相对媒体路径按请求协议与host补全。无可领取作品返回404；无效token返回401；租户不匹配返回403。

错误码：`DOUYIN_PUBLISH_LIBRARY_NOT_FOUND`（404）、`DOUYIN_PUBLISH_WORK_NOT_FOUND`（404）、`DOUYIN_PUBLISH_WORK_NOT_AVAILABLE`（404）、`DOUYIN_PUBLISH_LIBRARY_NOT_EMPTY`（409）、`DOUYIN_PUBLISH_WORK_EXISTS`（409，响应额外携带 `workId`、`libraryId`）、`DOUYIN_PUBLISH_WORK_LEASED`（409）、`DOUYIN_PUBLISH_QR_TOKEN_FAILED`（409）、`DOUYIN_VIDEO_ASSET_NOT_FOUND`（404）、`DOUYIN_PUBLISH_TOKEN_REQUIRED`（401）、`DOUYIN_PUBLISH_TOKEN_INVALID`（401）、`DOUYIN_PUBLISH_TENANT_MISMATCH`（403）、`DOUYIN_PUBLISH_LIBRARY_NAME_INVALID`（400）、`DOUYIN_PUBLISH_TITLE_INVALID`（400）、`DOUYIN_PUBLISH_TAGS_INVALID`（400）、`DOUYIN_PUBLISH_STATUS_INVALID`（400）、`DOUYIN_PUBLISH_PAGINATION_INVALID`（400）。DTO 字段不合法时沿用 Nest `ValidationPipe` 的 400 默认错误结构。

平台 Webhook 入口为 POST /api/douyin-publish/webhook，同址声明 update DouyinWorkbench，由平台原始请求体 SHA1 签名鉴权；challenge 仅回显，无业务写入。平台保留事件名 verify_webhook、douyin_video_task_message 和 Nest 生命周期 onModuleInit 不属于自定义事件总线命名。平台任务按作品保存历史关联，taskIds 在作品领取/详情时送入新版小程序发布器；平台通知在客户端未返回页面时仍可回写原作品，保留原生ID并供既有抓取目标读取。配置与能力前置条件见 CONFIGURATION.md。
