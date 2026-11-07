# 模块名称 (Module Name)

租户 MCP 服务（tenant-mcp）

## 概述 (Overview)

为每个租户开放多个 MCP 链接，每个链接可创建多把独立密钥，按工具名称分配权限。使用官方 MCP SDK 的无状态 Streamable HTTP，复用图库、文章库和小红书采集服务。后台入口为“后台管理 → MCP 接入”。已有 function-call/mcp 是连接外部 MCP 的客户端，本模块是向外提供业务工具的服务端。

## 文件清单 (File List)

- `tenant-mcp.module.ts` — NestJS 业务模块装配。
- `tenant-mcp.tools.ts` — 45 项工具定义（16 项图库与文章 + 29 项抖音工作台）、工具分组与 MCP 提示标记（`TENANT_MCP_TOOL_META`）、严格参数 schema、文章文件结构和 base64 校验。
- `entities/tenant-mcp.entity.ts` — 链接、密钥和认证作用域类型。
- `controller/tenant-mcp.dto.ts` — 后台链接和密钥请求校验。
- `controller/tenant-mcp-admin.controller.ts` — 后台管理 HTTP 入口与 CASL 权限声明。
- `controller/tenant-mcp-auth.guard.ts` — MCP 专用密钥认证与权限声明检查。
- `controller/tenant-mcp.controller.ts` — MCP HTTP 入口与无状态方法响应。
- `services/tenant-mcp.service.ts` — 链接/密钥管理、可恢复凭证保存、认证与租户隔离。
- `services/tenant-mcp-tools.service.ts` — 图库、文章库、文章和抓取能力适配；`douyin_` 开头的工具转交抖音工具分发服务。
- `services/tenant-mcp-douyin-tools.service.ts` — 抖音工作台 29 项工具的入参解析与分发（调用 `DouyinWorkbenchAgentService`），返回里站内地址补成完整地址。
- `services/tenant-mcp-image.ts` — MCP base64 图片严格解码、格式校验、纠正方向与缩放后重新编码为 JPEG 落盘（图片上传与门店照片上传共用）。
- `services/tenant-mcp-douyin-tools.service.spec.ts` — 抖音工具分组与严格 schema、调用身份固定为密钥、地址补全、导演控制工具分发与动作校验、门店照片登记失败删文件测试。
- `services/tenant-mcp-protocol.service.ts` — MCP 工具发现、调用、初始化使用说明、参数描述、标准协议错误与 HTTP 传输。
- `services/tenant-mcp.service.spec.ts` — 密钥生命周期和管理作用域测试。
- `services/tenant-mcp-tools.service.spec.ts` — 业务权限、租户隔离、上传和采集返回测试。
- `services/tenant-mcp-protocol.service.spec.ts` — 官方客户端连接、全部 45 项工具说明、参数结构与提示标记（含抖音工具）、空权限列表、方法拼写、Accept 请求头、调用及 HTTP 鉴权集成测试。

## 函数清单 (Function List)

- `TenantMcpModule()` — 装配 MCP 控制器及依赖服务 | keywords: tenant-mcp-module, mcp-server
- `TENANT_MCP_TOOLS` — 定义工具名称、说明及严格输入 schema（图库与文章 16 项、抖音工作台 29 项） | keywords: mcp-tools, tool-permission
- `TENANT_MCP_TOOL_META` — 每个工具的分组（后台按组勾选权限）与 MCP 提示标记：只读、会改动或删除数据、会访问外部平台。按工具名全覆盖，漏写编译不过 | keywords: 工具分组, 工具提示标记, tool-group, tool-annotations
- `MCP_IMAGE_MAX_BYTES` — MCP 上传图片的大小上限（10 MiB） | keywords: MCP图片上限, 上传大小, mcp-image-limit, upload-size
- `saveMcpImageFile(base64)` — 把 MCP 传来的 base64 图片严格解码、校验格式（JPEG / PNG / WebP）、纠正方向并限制在 2400 像素内，重新编码成 JPEG 写进上传目录；返回登记图库需要的文件信息，登记失败时调用方负责删掉文件 | keywords: MCP图片落盘, 图片重编码, save-mcp-image, image-reencode
- `MCP_ARTICLE_CONTENT_SCHEMA` — 校验上传文章文件内容 | keywords: article-upload, input-validation
- `decodeMcpBase64(value,maxBytes)` — 严格解码 base64 并限制文件大小 | keywords: base64-validation, upload-limit
- `TenantMcpService()` — 管理租户 MCP 链接和密钥 | keywords: tenant-mcp, key-management
- `TenantMcpService.constructor(db,config)` — 初始化链接和密钥集合 | keywords: tenant-mcp, key-management
- `TenantMcpService.onModuleInit()` — 创建租户时间线和密钥哈希唯一索引 | keywords: mcp-indexes, tenant-isolation
- `TenantMcpService.scope(user,requested?)` — 限定管理员可操作的真实租户 | keywords: mcp-scope, tenant-isolation
- `TenantMcpService.objectId(value)` — 校验外部对象标识 | keywords: mcp-id, input-validation
- `TenantMcpService.requireEndpoint(tenantId,endpointId)` — 查询当前租户的链接或返回不存在 | keywords: mcp-endpoint, tenant-isolation
- `TenantMcpService.endpointView(endpoint)` — 返回链接名称、状态与连接地址 | keywords: mcp-endpoint-view, secret-redaction
- `TenantMcpService.secretEncryptionKey()` — 按配置优先级解析可恢复密钥保存所用的加密密钥 | keywords: mcp-secret-key, encryption-config
- `TenantMcpService.sealSecret(secret,scope)` — 保存可恢复凭证并在加密配置存在时绑定租户链接和密钥身份 | keywords: mcp-secret-storage, recoverable-secret
- `TenantMcpService.revealSecret(key)` — 恢复完整密钥并校验其与认证哈希一致 | keywords: mcp-secret-recovery, hash-verification
- `TenantMcpService.keyView(key)` — 向有权限的管理端返回完整密钥及权限且隐藏哈希和存储信封 | keywords: mcp-key-view, secret-redaction
- `TenantMcpService.list(tenantId)` — 返回租户链接、密钥及工具目录 | keywords: mcp-list, key-management
- `TenantMcpService.createEndpoint(tenantId,user,input)` — 创建租户的独立链接 | keywords: mcp-create-endpoint, key-management
- `TenantMcpService.updateEndpoint(tenantId,endpointId,input)` — 修改链接名称或启用状态 | keywords: mcp-update-endpoint, key-management
- `TenantMcpService.deleteEndpoint(tenantId,endpointId)` — 删除链接并级联撤销密钥 | keywords: mcp-delete-endpoint, key-revocation
- `TenantMcpService.validatePermissions(permissions)` — 校验工具权限并去重 | keywords: mcp-permissions, input-validation
- `TenantMcpService.expiry(value?)` — 校验未来过期时间或永久有效 | keywords: mcp-expiry, input-validation
- `TenantMcpService.createKey(tenantId,endpointId,user,input)` — 生成随机密钥并保存认证哈希及可恢复凭证 | keywords: mcp-create-key, recoverable-secret
- `TenantMcpService.rotateKey(tenantId,endpointId,keyId)` — 显式重新生成密钥并保留权限有效期和启用状态 | keywords: mcp-rotate-key, recoverable-secret
- `TenantMcpService.updateKey(tenantId,endpointId,keyId,input)` — 修改权限、有效期、名称或启用状态 | keywords: mcp-update-key, tool-permission
- `TenantMcpService.deleteKey(tenantId,endpointId,keyId)` — 立即撤销密钥 | keywords: mcp-delete-key, key-revocation
- `TenantMcpService.authenticate(endpointId,authorization?)` — 验证链接、密钥、有效期、租户与创建者身份 | keywords: mcp-auth, tenant-isolation
- `TenantMcpToolsService()` — 适配现有业务能力为 MCP 工具 | keywords: mcp-tool-execution, tenant-isolation
- `TenantMcpToolsService.constructor(db,libraries,articles,gallery,crawl,topics,config,douyin)` — 注入业务与存储服务及抖音工具分发服务 | keywords: mcp-tool-execution, tenant-isolation
- `TenantMcpToolsService.requireLibrary(principal,id)` — 强制验证文章库租户归属 | keywords: mcp-library-check, tenant-isolation
- `TenantMcpToolsService.requireArticle(principal,id)` — 验证文章及其所属文章库归属 | keywords: mcp-article-check, tenant-isolation
- `TenantMcpToolsService.libraryView(library)` — 隐藏文章库扫码 token 与内部字段 | keywords: mcp-library-view, secret-redaction
- `TenantMcpToolsService.absoluteUrl(value)` — 使用 APP_URL 补齐图片地址 | keywords: mcp-image-url, absolute-url
- `TenantMcpToolsService.articleView(article)` — 返回文章内容并隐藏租约和内部元数据 | keywords: mcp-article-view, secret-redaction
- `TenantMcpToolsService.imageView(image)` — 返回图片公开字段及可访问地址 | keywords: mcp-image-view, secret-redaction
- `TenantMcpToolsService.uploadImage(principal,input)` — 用 `saveMcpImageFile` 验证并重新编码图片后写入租户图库，登记失败删文件 | keywords: mcp-image-upload, upload-validation
- `TenantMcpToolsService.createArticle(principal,libraryId,input)` — 把文章写入租户文章库的未发布队列 | keywords: mcp-article-create, article-intake
- `TenantMcpToolsService.crawlTarget(principal,articleId)` — 验证已发布文章、笔记标识与选题归属 | keywords: mcp-crawl-target, tenant-isolation
- `TenantMcpToolsService.prepareCrawlTarget(principal,articleId)` — 为已发布且无选题绑定的文章补建监控并清理并发冗余选题 | keywords: mcp-crawl-binding, published-article
- `TenantMcpToolsService.recentData(principal,input)` — 查询文章近期数据或指定抓取运行结果 | keywords: mcp-recent-data, crawl-result
- `TenantMcpToolsService.execute(principal,name,raw)` — 校验工具权限与参数后分发业务调用，`douyin_` 开头的工具转交 `TenantMcpDouyinToolsService` | keywords: mcp-tool-execution, tool-permission
- `TenantMcpDouyinToolsService()` — 抖音工作台 MCP 工具的分发：每个工具用自己的严格 schema 解析入参，身份只取密钥（租户 + 密钥创建人），交给 `DouyinWorkbenchAgentService` 完成一步并落库；返回里站内相对地址补成可访问的完整地址 | keywords: 抖音MCP工具, 工具分发, douyin-mcp-tools, tool-dispatch
- `TenantMcpDouyinToolsService.constructor(agent,config)` — 注入抖音工作台编排服务与配置（补完整地址用） | keywords: 抖音MCP工具依赖, 编排服务, douyin-mcp-dependencies, agent-service
- `TenantMcpDouyinToolsService.absolute(value)` — 把返回里 `url` 字段的站内相对地址补成带 APP_URL 的完整地址，其余原样 | keywords: 补完整地址, 站内地址, absolute-urls, site-relative-url
- `TenantMcpDouyinToolsService.execute(principal,name,raw)` — 解析入参并执行一个抖音工具；不接受入参里的租户或用户，调用身份固定为密钥的租户与创建人 | keywords: 执行抖音工具, 调用身份, execute-douyin-tool, caller-identity
- `TenantMcpDouyinToolsService.run(principal,name,raw)` — 按工具名分发到编排服务的对应一步 | keywords: 抖音工具分支, 编排一步, douyin-tool-switch, agent-step
- `CreateMcpEndpointDto()` — 校验链接创建请求 | keywords: mcp-endpoint-dto, input-validation
- `UpdateMcpEndpointDto()` — 校验链接更新请求 | keywords: mcp-endpoint-dto, input-validation
- `CreateMcpKeyDto()` — 校验密钥创建请求 | keywords: mcp-key-dto, input-validation
- `UpdateMcpKeyDto()` — 校验密钥更新请求 | keywords: mcp-key-dto, input-validation
- `TenantMcpAdminController()` — 提供后台链接和密钥管理入口 | keywords: mcp-admin, key-management
- `TenantMcpAdminController.constructor(service)` — 注入管理服务 | keywords: mcp-admin, key-management
- `TenantMcpAdminController.user(req)` — 获取当前管理员身份 | keywords: mcp-admin-scope, tenant-isolation
- `TenantMcpAdminController.list(req,tenantId?)` — 列出本租户 MCP 配置 | keywords: mcp-list, key-management
- `TenantMcpAdminController.createEndpoint(req,body,tenantId?)` — 创建链接入口 | keywords: mcp-create-endpoint, key-management
- `TenantMcpAdminController.updateEndpoint(req,endpointId,body,tenantId?)` — 更新链接入口 | keywords: mcp-update-endpoint, key-management
- `TenantMcpAdminController.deleteEndpoint(req,endpointId,tenantId?)` — 删除链接入口 | keywords: mcp-delete-endpoint, key-revocation
- `TenantMcpAdminController.createKey(req,endpointId,body,tenantId?)` — 创建可重复查看及复制的完整密钥 | keywords: mcp-create-key, recoverable-secret
- `TenantMcpAdminController.rotateKey(req,endpointId,keyId,tenantId?)` — 以更新权限重新生成当前租户密钥 | keywords: mcp-rotate-key, recoverable-secret
- `TenantMcpAdminController.updateKey(req,endpointId,keyId,body,tenantId?)` — 修改密钥权限及状态 | keywords: mcp-update-key, tool-permission
- `TenantMcpAdminController.deleteKey(req,endpointId,keyId,tenantId?)` — 撤销密钥入口 | keywords: mcp-delete-key, key-revocation
- `TenantMcpAuthGuard()` — 提供独立于管理员会话的 MCP 密钥认证 | keywords: mcp-auth-guard, tool-permission
- `TenantMcpAuthGuard.constructor(service,reflector)` — 注入认证服务与权限反射器 | keywords: mcp-auth-guard, tool-permission
- `TenantMcpAuthGuard.canActivate(context)` — 检查同址权限声明并注入密钥作用域 | keywords: mcp-auth, tenant-isolation
- `TenantMcpController()` — 提供 MCP Streamable HTTP 路由 | keywords: mcp-controller, streamable-http
- `TenantMcpController.constructor(protocol)` — 注入 MCP 协议服务 | keywords: mcp-controller, streamable-http
- `TenantMcpController.handle(req,res)` — 处理 MCP POST 请求 | keywords: mcp-http-handler, streamable-http
- `TenantMcpController.get(res)` — 对无状态 GET 返回方法不支持 | keywords: mcp-http-method, stateless-transport
- `TenantMcpController.delete(res)` — 对无状态 DELETE 返回方法不支持 | keywords: mcp-http-method, stateless-transport
- `TenantMcpProtocolService()` — 处理 MCP 工具发现与调用协议 | keywords: mcp-protocol, streamable-http
- `TenantMcpProtocolService.constructor(service,tools)` — 注入认证与业务工具服务 | keywords: mcp-protocol, streamable-http
- `TenantMcpProtocolService.createServer(principal,authorization)` — 按密钥权限创建工具目录及调用处理器 | keywords: mcp-server, tool-permission
- `TenantMcpProtocolService.handle(req,res)` — 创建无状态传输并在请求结束后释放资源 | keywords: mcp-http-handler, streamable-http
- `fixture(settings?)` — 构造密钥生命周期和可恢复凭证配置的测试依赖 | keywords: mcp-test-fixture, key-management
- `toolsFixture()` — 构造租户业务工具测试依赖 | keywords: mcp-tools-fixture, tenant-isolation

## 关键词索引 (Keyword Index)

| 中文         | English             |
| ------------ | ------------------- |
| 租户MCP      | tenant-mcp          |
| 模块装配     | tenant-mcp-module   |
| 服务端       | mcp-server          |
| 工具目录     | mcp-tools           |
| 工具权限     | tool-permission     |
| 密钥管理     | key-management      |
| 可恢复密钥   | recoverable-secret  |
| 密钥保存     | mcp-secret-storage  |
| 密钥恢复     | mcp-secret-recovery |
| 重新生成密钥 | mcp-rotate-key      |
| 加密配置     | encryption-config   |
| 哈希一致性   | hash-verification   |
| 撤销密钥     | key-revocation      |
| 租户隔离     | tenant-isolation    |
| 身份认证     | mcp-auth            |
| 密钥有效期   | mcp-expiry          |
| 图片上传     | mcp-image-upload    |
| 文章入库     | article-intake      |
| 文章上传     | article-upload      |
| 近期抓取     | mcp-recent-data     |
| 抓取结果     | crawl-result        |
| 补建监控绑定 | mcp-crawl-binding   |
| 已发布文章   | published-article   |
| 敏感字段脱敏 | secret-redaction    |
| 输入校验     | input-validation    |
| 无状态传输   | stateless-transport |
| 流式HTTP     | streamable-http     |
| 协议集成测试 | mcp-protocol        |

| 工具分组 | tool-group |
| 工具提示标记 | tool-annotations |
| 抖音工具名 | douyin-tool-name |
| 工具分发 | tool-dispatch |
| MCP图片上限 | mcp-image-limit |
| 上传大小 | upload-size |
| MCP图片落盘 | save-mcp-image |
| 图片重编码 | image-reencode |
| 抖音MCP工具 | douyin-mcp-tools |
| 抖音MCP工具依赖 | douyin-mcp-dependencies |
| 编排服务 | agent-service |
| 补完整地址 | absolute-urls |
| 站内地址 | site-relative-url |
| 执行抖音工具 | execute-douyin-tool |
| 调用身份 | caller-identity |
| 抖音工具分支 | douyin-tool-switch |
| 编排一步 | agent-step |

## 类型导出 (Type Exports)

- `TenantMcpEndpoint` — 租户 MCP 链接。
- `TenantMcpKey` — 含哈希的内部密钥实体，不直接对外返回。
- `TenantMcpSecretEnvelope` — 可恢复凭证信封，支持 AES-256-GCM 或未配置加密时的明文形式。
- `TenantMcpPrincipal` — 由密钥认证得到的租户及工具权限。
- `TenantMcpToolName` — 固定工具名称联合类型。
- `TenantMcpDouyinToolName` — 抖音工作台工具名（`douyin_` 开头），由 `TenantMcpDouyinToolsService` 分发 | keywords: 抖音工具名, 工具分发, douyin-tool-name, tool-dispatch
- `TenantMcpRequest` — 注入 MCP 作用域的 HTTP 请求。

## 模块功能描述 (Module Description)

管理入口 `/admin/tenant-mcp` 使用管理员 Bearer 登录态和 CASL `TenantMcp` 主体；租户管理员管理本租户，平台管理员通过 `tenantId` 查询参数选择目标租户，操作员不可管理。链接创建、修改、删除及密钥创建、修改、撤销分别声明 create/update/delete 权限。界面位于 `web/src/ui/Admin/TenantMcpPanel.jsx`。

MCP 入口 `POST /api/mcp/:endpointId` 使用独立的 `Authorization: Bearer tmcp_…`。GET/DELETE 在认证后返回 405。本模块不注册事件总线或 Hook。控制器同址声明 `read TenantMcp`，专用认证守卫检查此声明，工具调用再检查工具名称权限。每次工具发现和调用都重新读取密钥，停用链接、撤销密钥、修改权限、过期、删除租户或停用创建者后禁止后续请求。已开始的业务操作不回滚。密钥用 32 字节安全随机数生成，保存 SHA-256 认证哈希、短前缀及可恢复的 secretEnvelope；具有对应租户管理权限的登录用户可通过管理列表随时查看完整 secret、复制密钥和完整接入提示词。管理列表、创建、更新与轮换响应均标记 Cache-Control: no-store；MCP 工具调用和认证结果不返回此密钥。

可恢复凭证优先使用 TENANT_MCP_ENCRYPTION_KEY，其次 BROWSER_AUTH_ENCRYPTION_KEY、ADMIN_JWT_SECRET；支持 64 位十六进制、32 字节 Base64 或字符串 SHA-256 派生。配置存在时使用 AES-256-GCM，每条记录独立 IV，AAD 绑定 tenantId/endpointId/keyId，恢复时再次验证认证哈希。与既有凭证模块一致，无上述配置时使用明文信封以保证本地可用。密钥配置变更后，原加密信封可能无法还原，页面可显式重新生成。历史仅保存哈希的密钥不尝试倒推或自动作废：成功 Bearer 认证时利用已经匹配哈希的输入补存可恢复凭证，更新过滤同时带原哈希，避免并发轮换后写回旧密钥；也可 POST /admin/tenant-mcp/endpoints/:endpointId/keys/:keyId/rotate 显式轮换（update TenantMcp），旧密钥随后失效，权限、有效期和启用状态保留。

新增集合 `tenant_mcp_endpoints`、`tenant_mcp_keys`，启动时建立索引。`APP_URL` 用于生成完整连接地址与图片地址；部署时配置为外部可访问的应用根地址。

工具目录与密钥权限逐字一致：

| 工具                                              | 能力                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| gallery_search                                    | 租户图库语义搜索或标签筛选，query 与 tags 分开使用                      |
| image_upload                                      | base64 JPEG/PNG/WebP 上传，最多 10 MiB、4000 万像素，重新编码为 JPEG    |
| library_list / library_get                        | 文章库分页查询及详情统计                                                |
| library_create / library_update                   | 文章库新增和修改                                                        |
| article_publish                                   | 标题、正文、标签、图片存入指定文章库，状态为 unpublished                |
| article_upload                                    | UTF-8 JSON 文件 base64 入库，最多 1 MiB，字段 title/text/tags/imageUrls |
| article_get / article_update                      | 单篇文章查询和修改                                                      |
| article_list                                      | 按 all/published/unpublished 分页查询文章                               |
| article_list_published / article_list_unpublished | 分别获取已发布和未发布文章                                              |
| library_publish_qr                                | 单独授权后获取扫码发布内容与小红书链接                                  |
| article_recent_data                               | 获取最近 1–90 天的数据，默认 7 天，可带 taskId 轮询指定批次             |
| article_crawl                                     | 使用当前采集渠道立即采集并返回数据或运行状态                            |
| douyin_workspace / douyin_topic_get                | 抖音工作台概览；单条脚本完整状态、成片地址、出片前还差什么与下一步建议  |
| douyin_topic_create / _update / _delete           | 新建母选题（探店自动带一条脚本）、改标题正文、台词与念法或分镜文案、删除 |
| douyin_video_options / _personas / _knowledge_list | 节点是否配好、预设出镜人物、引用知识                                    |
| douyin_store_* （门店点位）                       | 门店列表与新建、照片上传进场景图库、AI 归类保存（每次 ≤16 张）、整体保存 |
| douyin_store_visit_*（探店）                      | 选门店、AI 写脚本、生成台词、音色库、定出镜人物音色、AI 配场景、启动 AI 导演一段一段出片、单段重做、暂停 / 继续 / 重做（`douyin_store_visit_pipeline`） |
| douyin_storyboard_* / douyin_generation_jobs（分镜）| 生成候选脚本、查任务、确认候选、重新生成分镜、单镜配图、逐镜或整片出片 |
| douyin_video_merge                                | 打开全部出片后自动拼接，由桌面端完成                                    |

“发布文章”表示存入文章库待扫码发布，不直接发布到外部平台。普通列表和详情不返回扫码 token、文章租约 token、密钥哈希、图库向量或服务器文件路径；二维码能力必须单独授权。

抓取要求文章已发布且存在有效 `meta.NoteId`。没有 `meta.xhsTopicId` 的文章（例如 MCP 入库后经扫码发布的文章），首次 `article_crawl` 自动创建同租户独立监控选题并绑定文章，CAS 避免并发重复绑定，缺少采集计划时补建；已有选题强制验证租户归属。复用原有调度服务，采集批次可能包含该子选题全部已发布笔记，返回数据按目标文章 NoteId 过滤。TikHub 同步返回终态与本次数据；SuperClaw 返回 `completed=false`、`taskId` 及 `pollTool=article_recent_data`，客户端以 articleId/taskId 查询完成状态及数据。任务 ID 必须匹配同租户同选题，失败任务保留 error 和部分成功数据。`article_recent_data` 仅查询已绑定的文章，不自动创建监控记录。

验证命令：`npx jest --runInBand --testPathPatterns=tenant-mcp`、`npx tsc --noEmit --incremental false`、`npm run build -- --outDir ../.codex-mcp-web-build`（前端目录）。

工具发现使用 JSON-RPC 方法 `tools/list`（tools 为复数），调用方法是 `tools/call`，并非名为 tool/list 的业务工具，也不是 GET 路径。请求 POST 到链接自身 `/api/mcp/:endpointId`，携带 `Authorization: Bearer tmcp_…`、`Content-Type: application/json`、`Accept: application/json, text/event-stream`；初始化后携带协商的 `MCP-Protocol-Version`。当前 SDK 支持的最高协议版本为 `2025-11-25`，不承诺覆盖之后的协议版本。每个工具返回 name/title/description/inputSchema/annotations，description 提供用途，inputSchema 定义参数；初始化 instructions 同时说明发现、权限和异步采集用法，无须额外调用说明工具。未知或当前密钥不可见工具返回 JSON-RPC -32602，不泄露工具存在性；业务执行或参数校验失败返回工具结果 isError=true。

排障区分：`result.tools=[]` 表示认证成功但该密钥没有可用工具权限；新建密钥默认不授权。401 检查密钥、启用状态、到期时间和链接是否匹配；403 检查 Origin；404 检查地址与部署版本；406 检查 Accept；JSON-RPC -32601 检查方法是否误拼为 tool/list。GET 返回 405 是无状态 Streamable HTTP 的正常行为，旧式 SSE 客户端不能据此认定工具目录为空。云端 Agent 应使用外部可访问的部署地址，不能使用开发机的 localhost；`APP_URL` 必须配置为对客户端可达的应用根地址。修改权限后如客户端缓存了工具列表，应刷新连接重新发现工具。

抖音工作台工具（`douyin_*`）：作用域固定为密钥的租户与创建人（`principal.userId` 与抖音工作台的 `String(user._id)` 同口径），由 `TenantMcpDouyinToolsService` 解析后交给抖音模块的 `DouyinWorkbenchAgentService`，每一步做完即落库、规则与桌面端一致。出片、AI 写作、归类、配图等工具在说明里写明会产生费用；出片与拼接是异步的，用 `douyin_topic_get` 轮询。同点位尾帧续段、统一音色与拼接成片仍要密钥创建人的账号在桌面端打开「视频制作」页（该页每 20 秒静默刷新并在窗口回到前台时立刻刷新，能接手 MCP 发起的任务）；所以建密钥的租户管理员要和使用桌面端的是同一账号。发布到抖音、抓取数据这类对外动作暂不开放。工具分组与只读 / 破坏性 / 访问外部平台的提示标记统一写在 `TENANT_MCP_TOOL_META`，后台「MCP 接入」按组勾选权限。
