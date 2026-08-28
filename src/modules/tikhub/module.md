# 模块名称 (Module Name)

TikHub 平台接入模块（tikhub）

## 概述 (Overview)

TikHub（`https://api.tikhub.io`，国内直连域名 `https://api.tikhub.dev`）是第三方多平台社交数据开放接口，鉴权方式为 `Authorization: Bearer <API Key>`，按接口调用计费。本模块把它接进平台，作为小红书数据采集在 SuperClaw 之外的第二条通道：**平台直接调接口拿数**，不需要节点、不需要工作区、不需要浏览器登录态、也不产生 Todo。

模块只保存两样东西：API Key 与 API 域名，按「租户 + 后台用户」一行。API Key 落库前经 AES-256-GCM 加密（密钥取 `TIKHUB_ENCRYPTION_KEY`，回落 `BROWSER_AUTH_ENCRYPTION_KEY`）；两个环境变量都没配时降级为明文保存并打一次告警——否则本地环境根本存不进 Key。接口层只返回 `****尾4位` 掩码，任何日志都不打明文。读取生效 Key 时按「本作用域 → 同租户任意配置 → 环境变量 `TIKHUB_API_KEY`」回落，因为调度器用的是选题归属用户，而 Key 通常填在管理员名下。域名只接受白名单内的两个值，避免 Key 被写去任意地址。

采集侧当前只做小红书，且**只按 NoteId 取数**，与 SuperClaw 路径的抓取对象口径一致。每篇笔记两次调用：`app_v2/get_image_note_detail` 取互动数据（图文/视频通用，只需 note_id），`app_v2/get_note_comments` 按点赞排序取热门评论快照。相邻调用间隔 300ms 规避上游限频。单篇失败不中断整批，失败原因逐条带回，由调用方（`xhs-topic-data` 的抓取运行）判定这次是 `done` 还是 `failed`。评论拿不到只降级为空评论，不让整篇笔记的互动指标作废。

上游 JSON 的字段名在 App/Web/蒲公英几套接口之间并不一致（`liked_count` / `like_count` / `likeNum`、`collected_count` / `favNum` …），且官方 OpenAPI 只声明了通用 `ResponseModel`，没有逐字段 schema。所以归一化不写死路径，而是**深度遍历响应、按字段特征认节点**：命中最多计数字段组的那个对象即互动数据所在。计数值支持 `1234`、`"1,234"`、`"1.2万"`、`"10+"` 几种形态。**取不到的指标一律留 undefined 而不是填 0**，看板据此显示「待采集」，这样「真的是 0」和「还没采到」不会混成一个显示。

本模块不出控制器：配置入口挂在小红书数据看板的采集设置里（`GET/PUT /api/xhs-topic-data/crawl-settings` 与 `POST /api/xhs-topic-data/crawl-settings/test-tikhub`），保持配置页「一个页面一组接口」。

## 文件清单 (File List)

- `tikhub.module.ts` — NestJS 模块入口，装配配置、加解密、HTTP 客户端与小红书采集服务。
- `entities/tikhub.entity.ts` — 配置作用域、密钥信封、配置文档与视图、自检结果、归一化笔记数据类型定义。
- `services/tikhub-crypto.service.ts` — API Key 的 AES-256-GCM 加解密与无密钥时的明文降级。
- `services/tikhub-config.service.ts` — API Key 与 API 域名的读写、掩码视图、生效值解析与域名白名单。
- `services/tikhub-client.service.ts` — TikHub HTTP 调用、统一判错与账户连通性自检。
- `services/tikhub-xhs.service.ts` — 按 NoteId 批量采集小红书笔记并把上游字段归一化成看板指标。

## 函数清单 (Function List)

- `TikhubModule()` — 注册 TikHub 模块依赖与对外导出服务 | keywords: tikhub-module, platform-integration
- `TikhubCryptoService.encrypt(value)` — 把 API Key 明文封装成落库信封，无密钥时降级明文信封 | keywords: 加密密钥, 生成信封, encrypt-api-key, build-envelope
- `TikhubCryptoService.decrypt(envelope?)` — 从信封还原 API Key，解不开时返回空串而不抛异常 | keywords: 解密密钥, 容错解包, decrypt-api-key, tolerant-unwrap
- `TikhubCryptoService.resolveKey()` — 解析 32 字节密钥，优先 TIKHUB_ENCRYPTION_KEY 回落浏览器认证密钥 | keywords: 解析加密密钥, 环境变量, resolve-encryption-key, environment-key
- `TikhubConfigService.ensureIndexes()` — 建立配置集合索引，一个作用域只保留一行 | keywords: 配置索引, 作用域唯一, config-indexes, unique-scope
- `TikhubConfigService.getView(scope)` — 读取配置页视图，只回掩码后的 Key 尾号 | keywords: 读取配置视图, 密钥掩码, read-config-view, masked-api-key
- `TikhubConfigService.save(scope,input)` — 保存 API Key 与域名，空串清空、不传保持不变 | keywords: 保存配置, 密钥更新, save-config, update-api-key
- `TikhubConfigService.resolveApiKey(scope)` — 解析采集实际使用的 Key，按作用域到环境变量逐级回落 | keywords: 解析生效密钥, 租户回落, resolve-effective-key, tenant-fallback
- `TikhubConfigService.resolveBaseUrl(scope)` — 解析采集使用的 API 域名 | keywords: 解析API域名, 国内直连, resolve-base-url, mainland-endpoint
- `TikhubConfigService.findScoped(scope)` — 精确作用域优先、同租户配置兜底地取配置文档 | keywords: 作用域查询, 同租户回落, scoped-lookup, tenant-wide-fallback
- `TikhubConfigService.scopeFilter(scope)` — 构造强制作用域过滤并把空 tenantId 收口成 null | keywords: 作用域过滤, 空值归一, scope-filter, null-normalization
- `TikhubConfigService.normalizeBaseUrl(value?)` — 把域名收敛到白名单，非法值回落默认域名 | keywords: 域名白名单, 防止外发, base-url-allowlist, exfiltration-guard
- `TikhubConfigService.mask(apiKey)` — 把 API Key 掩码成只剩尾 4 位 | keywords: 密钥掩码, 尾号展示, mask-api-key, tail-digits
- `TikhubClientService.probe(options)` — 用账户信息接口自检 API Key 是否可用 | keywords: 连通性自检, 密钥校验, connectivity-probe, api-key-validation
- `TikhubClientService.fetchNoteDetail(noteId,options)` — 拉取小红书笔记详情（图文/视频通用） | keywords: 笔记详情, 互动数据, note-detail, interaction-data
- `TikhubClientService.fetchNoteComments(noteId,options)` — 按点赞排序拉取笔记评论首屏 | keywords: 笔记评论, 热门排序, note-comments, hot-sort
- `TikhubClientService.request(path,query,options)` — 发起 GET 调用并统一判错，日志不带 API Key | keywords: 发起请求, 统一判错, send-request, unified-error
- `TikhubClientService.readBalance(payload)` — 从账户信息响应里尽量读出余额 | keywords: 读取余额, 字段容错, read-balance, tolerant-field
- `TikhubClientService.readErrorMessage(error)` — 把 fetch/超时异常压成一行可读文本 | keywords: 错误可读化, 失败原因, readable-error, failure-reason
- `TikhubXhsService.isReady(scope)` — 当前作用域是否已具备直采条件（有可用 API Key） | keywords: 采集可用性, 密钥就绪, collector-availability, api-key-ready
- `TikhubXhsService.probe(scope)` — 用生效 Key 与域名做一次连通性自检 | keywords: 连通性自检, 配置校验, connectivity-probe, config-validation
- `TikhubXhsService.collectNotes(notes,scope)` — 逐篇采集互动数据，单篇失败不中断整批并逐条带回原因 | keywords: 批量采集笔记, 单篇失败不中断, collect-notes, per-note-failure-tolerance
- `TikhubXhsService.normalizeNoteDetail(payload,noteId,fallbackTitle?)` — 把笔记详情响应归一化成看板指标结构 | keywords: 归一化笔记详情, 指标提取, normalize-note-detail, metric-extraction
- `TikhubXhsService.normalizeComments(payload)` — 把评论响应归一化成前 5 条热门评论快照 | keywords: 归一化评论, 评论快照, normalize-comments, comment-snapshot
- `TikhubXhsService.findInteractionNode(payload)` — 按计数字段特征深度定位互动数据所在对象 | keywords: 定位互动节点, 深度遍历, locate-interaction-node, deep-traverse
- `TikhubXhsService.findNoteNode(payload)` — 定位承载标题与标签的笔记对象 | keywords: 定位笔记节点, 标题来源, locate-note-node, title-source
- `TikhubXhsService.readAuthorUrl(payload)` — 从响应里解析博主主页链接 | keywords: 博主主页, 作者链接, author-profile, author-url
- `TikhubXhsService.readFirstTag(noteNode)` — 取笔记第一个话题标签作为看板 tag | keywords: 笔记标签, 话题提取, note-tag, topic-extract
- `TikhubXhsService.findCommentArray(payload)` — 按元素特征找出评论数组 | keywords: 定位评论数组, 结构探测, locate-comment-array, structure-probe
- `TikhubXhsService.walk(payload)` — 广度遍历响应里的全部对象节点 | keywords: 遍历对象节点, 广度优先, walk-object-nodes, breadth-first
- `TikhubXhsService.pickCount(node,keys)` — 在候选字段名里取第一个可解析的计数值 | keywords: 取计数字段, 候选字段, pick-count-field, candidate-keys
- `TikhubXhsService.parseCount(value)` — 解析 `1234`/`"1,234"`/`"1.2万"`/`"10+"` 几种计数形态 | keywords: 解析计数, 万亿单位, parse-count, chinese-unit
- `TikhubXhsService.readString(node,keys)` — 在候选字段名里取第一个非空字符串 | keywords: 取字符串字段, 候选字段, pick-string-field, candidate-keys
- `TikhubXhsService.delay(ms)` — 相邻两次上游调用之间的固定间隔 | keywords: 调用间隔, 限频规避, call-delay, rate-limit-guard

## 关键词索引 (Keyword Index)

| 中文             | English                     |
| ---------------- | --------------------------- |
| TikHub模块       | tikhub-module               |
| 平台接入         | platform-integration        |
| TikHub配置服务   | tikhub-config-service       |
| 密钥读写         | api-key-crud                |
| 配置作用域       | config-scope                |
| 密钥信封         | secret-envelope             |
| 加密存储         | encrypted-storage           |
| 明文降级         | plaintext-fallback          |
| 密钥掩码         | masked-api-key              |
| 解析生效密钥     | resolve-effective-key       |
| 租户回落         | tenant-fallback             |
| 域名白名单       | base-url-allowlist          |
| 防止外发         | exfiltration-guard          |
| 国内直连         | mainland-endpoint           |
| TikHub客户端     | tikhub-client               |
| 接口调用         | http-call                   |
| 统一判错         | unified-error               |
| 连通性自检       | connectivity-probe          |
| 密钥校验         | api-key-validation          |
| 笔记详情         | note-detail                 |
| 笔记评论         | note-comments               |
| TikHub小红书采集 | tikhub-xhs-collect          |
| 字段归一化       | field-normalization         |
| 批量采集笔记     | collect-notes               |
| 单篇失败不中断   | per-note-failure-tolerance  |
| 定位互动节点     | locate-interaction-node     |
| 深度遍历         | deep-traverse               |
| 解析计数         | parse-count                 |
| 万亿单位         | chinese-unit                |
| 采集可用性       | collector-availability      |
| 限频规避         | rate-limit-guard            |

## 类型导出 (Type Exports)

- `TikhubConfigScope` — 配置作用域（租户 + 后台用户），与小红书抓取频率设置同一维度
- `TikhubSecretEnvelope` — API Key 落库信封，`aes-256-gcm` 密文或 `plain` 明文两种形态
- `TikhubConfigEntity` — 配置文档，集合 `tikhub_configs`，`tenantId + userId` 唯一
- `TikhubConfigView` — 配置页视图，含 `hasApiKey` / `apiKeyMasked` / `apiKeySource` / `baseUrl`
- `TikhubProbeResult` — 连通性自检结果，含 `ok` / `message` / `balance`
- `TikhubXhsNoteStat` — 归一化后的单篇笔记互动数据；`viewCount` / `shareCount` 取不到时省略
- `TikhubXhsCollectResult` — 一批笔记的采集结果，成功项与逐条失败原因分开
- `TIKHUB_DEFAULT_BASE_URL` — 默认 API 域名（`https://api.tikhub.io`） | keywords: 默认域名, 接口地址, default-base-url, api-endpoint
- `TIKHUB_ALLOWED_BASE_URLS` — 允许写入的 API 域名白名单 | keywords: 域名白名单, 防止外发, base-url-allowlist, exfiltration-guard

## 模块功能描述 (Module Description)

本模块不注册任何 HTTP 路由与事件/Hook，因此没有入口鉴权声明；对外只导出 `TikhubConfigService` 与 `TikhubXhsService` 两个服务，消费方是 `xhs-topic-data`：

- 配置页读写走 `GET/PUT /api/xhs-topic-data/crawl-settings`（权限 `read/update XhsTopic`），请求体字段 `channel` / `tikhubApiKey` / `tikhubBaseUrl`；`tikhubApiKey` 传空串表示清空，不传表示保持不变，所以配置页不必回填明文。
- 连通性自检走 `POST /api/xhs-topic-data/crawl-settings/test-tikhub`（权限 `update XhsTopic`）。
- 采集调度切到 `channel=tikhub` 后，`XhsTopicCrawlService.createCrawlTask` 直接调 `collectNotes`，不再创建 Todo、不再下发 SuperClaw 节点。

新增集合：`tikhub_configs`（`tenantId + userId` 唯一索引）。

环境变量：

| 变量                        | 必需 | 说明                                                          |
| --------------------------- | ---- | ------------------------------------------------------------- |
| `TIKHUB_API_KEY`            | 否   | 未在配置页填写时的兜底 Key                                    |
| `TIKHUB_BASE_URL`           | 否   | 未在配置页选择时的默认域名，只接受白名单内取值                |
| `TIKHUB_ENCRYPTION_KEY`     | 否   | API Key 落库加密密钥；缺失时回落 `BROWSER_AUTH_ENCRYPTION_KEY` |

**生产环境必须配置 `TIKHUB_ENCRYPTION_KEY` 或 `BROWSER_AUTH_ENCRYPTION_KEY`**，建议 32 字节随机值的 Base64 或 64 位十六进制表示；两者都缺失时 API Key 以明文存进 Mongo。

计费提示（来自 TikHub 官方文档）：传入错误或不存在的 note_id 时接口仍返回 200 并照常扣费，所以采集前不做重试放大——`collectNotes` 对单篇失败只记录原因，不自动重试。
