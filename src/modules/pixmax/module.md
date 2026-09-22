# 模块名称 (Module Name)

PixMax 生成平台客户端（pixmax）

## 概述 (Overview)

PixMax（https://app.pixmax.cn）OpenAPI 的服务端客户端与参数组装工具。连接信息（域名、Key）不读环境变量，由调用方从后台「Ai提供商设置」里 `providerCode=pixmax` 的记录传入，通常经 [workflow-model](../workflow-model/module.md) 的节点设置取得。接口与模型说明见仓库根目录 `vendor-api/pixmax/`。

## 文件清单 (File List)

- `pixmax.module.ts` — NestJS 模块入口，导出 `PixmaxClientService`。
- `entities/pixmax.entity.ts` — 连接信息、模型规格、资产、任务与上传缓存类型。
- `entities/pixmax-model-catalog.ts` — 由 `vendor-api/pixmax/models.json` 生成的生图 / 生视频模型规格目录。
- `services/pixmax-client.service.ts` — OpenAPI 调用：项目复用、资产上传（带缓存）与合规审核、任务提交与查询、结果地址与下载。
- `services/pixmax-video-params.ts` — 按模型规格组装生视频参数（生成方式、时长、清晰度、竖屏比例、默认值）与状态映射。
- `services/pixmax-video-params.spec.ts` — 参数组装单测。
- `services/pixmax-error.ts` — PixMax / 上游模型错误翻译成中文说明（版权、敏感内容、积分、限流、Key、网络等），并保留原始信息。
- `services/pixmax-error.spec.ts` — 错误翻译单测。

## 函数清单 (Function List)

- `PixmaxModule()` — 装配 PixMax 客户端 | keywords: PixMax模块, 第三方生成平台, pixmax-module, third-party-generation
- `PixmaxRuntime` — 调用所需的域名与 Key | keywords: PixMax连接信息, 提供商凭证, pixmax-runtime, provider-credential
- `PixmaxParamSpec` — 模型参数规格（可选值或滑块范围） | keywords: PixMax参数规格, 可选值范围, pixmax-param-spec, option-range
- `PixmaxModelSpec` — 模型规格（参数、生成模式要求、输入上限） | keywords: PixMax模型规格, 输入上限, pixmax-model-spec, input-limit
- `PixmaxAsset` — 资产对象 | keywords: PixMax资产, 结果地址, pixmax-asset, result-url
- `PixmaxTaskStatus` — 任务状态原值 | keywords: PixMax任务状态, 状态枚举, pixmax-task-status, status-enum
- `PixmaxTask` — 任务对象 | keywords: PixMax任务, 任务详情, pixmax-task, task-detail
- `PixmaxSubmitInput` — 提交任务请求体 | keywords: 提交任务参数, 输入资产, submit-task-input, input-assets
- `PixmaxAssetCacheEntity` — 已上传素材缓存（`pixmax_asset_cache`） | keywords: 资产上传缓存, 避免重复上传, asset-upload-cache, dedupe-upload
- `PIXMAX_MODEL_CATALOG` — 生图 / 生视频模型规格目录 | keywords: PixMax模型规格, 参数目录, pixmax-model-spec, param-catalog
- `PIXMAX_DEFAULT_BASE_URL` — 默认域名 | keywords: PixMax域名, 默认地址, pixmax-base-url, default-endpoint
- `PIXMAX_COMPLIANCE_WAIT_MS` — 合规审核最长等待 90 秒 | keywords: 合规审核等待, 审核轮询, compliance-wait, compliance-polling
- `PixmaxClientService()` — OpenAPI 客户端 | keywords: PixMax客户端, OpenAPI调用, pixmax-client, openapi-call
- `PixmaxClientService.ensureIndexes()` — 资产缓存唯一索引 | keywords: 资产缓存索引, 唯一约束, asset-cache-index, unique-constraint
- `PixmaxClientService.ensureProject(runtime,name)` — 按名称复用或创建项目并按账号缓存 | keywords: 复用PixMax项目, 按名称建项目, ensure-pixmax-project, project-by-name
- `PixmaxClientService.uploadAssetCached(runtime,input)` — 同一账号同一素材只上传一次，可选等待合规审核 | keywords: 上传PixMax资产, 上传去重, upload-pixmax-asset, dedupe-upload
- `PixmaxClientService.waitCompliance(runtime,assetUuid)` — 发起合规审核并轮询到通过 | keywords: 资产合规审核, 等待审核通过, asset-compliance-check, wait-compliance
- `PixmaxClientService.submitTask(runtime,input)` — 提交生成任务 | keywords: 提交PixMax任务, 生成任务, submit-pixmax-task, generation-task
- `PixmaxClientService.getTask(runtime,taskUuid)` — 查询任务详情 | keywords: 查询PixMax任务, 任务轮询, get-pixmax-task, task-polling
- `PixmaxClientService.resolveAssetUrl(runtime,asset,field?)` — 拼资产完整地址 | keywords: 资产完整地址, 地址拼接, asset-full-url, url-join
- `PixmaxClientService.download(url)` — 下载结果文件 | keywords: 下载PixMax结果, 结果文件, download-pixmax-result, result-file
- `PixmaxClientService.request(runtime,path,body)` — 统一鉴权与响应信封解析 | keywords: PixMax请求, 响应信封, pixmax-request, response-envelope
- `PixmaxClientService.baseUrlOf(runtime)` — 取域名并默认回退 | keywords: 读取PixMax域名, 默认回退, read-pixmax-base-url, default-fallback
- `PixmaxClientService.accountKey(runtime)` — 域名 + Key 摘要区分账号 | keywords: 账号摘要, 缓存隔离, account-digest, cache-isolation
- `PixmaxVideoMode` — `shot` 分镜 / `full` 整片 | keywords: 视频生成模式, 分镜与整片, video-generation-mode, shot-and-full
- `PixmaxVideoParamsResult` — 组装结果与取舍 | keywords: 生视频参数结果, 参数取舍, video-params-result, param-decisions
- `findPixmaxModel(code,name?)` — 按编码或名称查规格 | keywords: 查找PixMax模型, 编码或名称, find-pixmax-model, code-or-name
- `requiresPixmaxCompliance(code)` — 火山系模型需要合规审核 | keywords: 需要合规审核, 火山系模型, requires-compliance, volc-models
- `pickPixmaxDuration(spec,target)` — 取不小于目标的最短一档或最长一档 | keywords: 选择生成时长, 时长夹取, pick-duration, clamp-duration
- `listPixmaxDurationChoices(modelCode)` — 列出模型可生成的时长（枚举取可选值、滑块按步长展开、未知模型 5～15 秒、非生视频模型为空） | keywords: 模型可用时长, 时长选项, model-duration-choices, duration-options
- `readResolutionWeight(option)` — 清晰度档位的排序权重（`720P` 按像素、`2K` 按千、`SUPER_` 同档加半级） | keywords: 清晰度权重, 档位排序, resolution-weight, resolution-order
- `listPixmaxResolutionChoices(modelCode)` — 列出模型可选清晰度（按档位升序；模型没有该参数或目录里没这个模型时为空） | keywords: 模型可选清晰度, 清晰度选项, model-resolution-choices, resolution-options
- `pickPixmaxResolution(spec,target)` — 目标档位对不上时按权重就近取（平级取低档），没指定时用模型默认值 | keywords: 选择清晰度, 清晰度就近取档, pick-resolution, nearest-resolution
- `readReferImageLimit(requirement,spec)` — 从模式要求读参考图上限 | keywords: 解析参考图上限, 模式输入要求, parse-image-limit, mode-requirement
- `pickPixmaxReferMode(spec,mode,availableImages)` — 分镜优先图生视频；整片依次多图参考 → 图片参考 → 首尾帧 → 首帧 → 文生视频 | keywords: 选择生成方式, 参考图模式, pick-refer-mode, reference-mode
- `toParamValue(spec,value)` — 默认值转接口类型 | keywords: 参数类型转换, 默认值, convert-param-value, default-value
- `buildPixmaxVideoParams(input)` — 组装生视频 params，`targetResolution` 就近写入模型的 `resolution` 参数，`audioEnabled` 写入模型的 `includeAudio` 参数（有该参数时） | keywords: 组装生视频参数, 竖屏比例, build-video-params, portrait-ratio
- `PixmaxErrorRule` — 一条错误翻译规则（匹配式 + 中文说明，`{subject}` 替换为出问题的对象） | keywords: PixMax错误规则, 友好错误, pixmax-error-rule, friendly-error
- `PIXMAX_ERROR_RULES` — 错误到中文说明的对照，越具体越靠前（含真人素材被拒、版权审核、敏感内容等） | keywords: PixMax错误对照, 版权审核, pixmax-error-rules, copyright-review
- `extractPixmaxErrorCode(raw)` — 取出原始报错里的上游错误码 | keywords: 提取上游错误码, 错误解析, extract-upstream-error-code, error-parse
- `describePixmaxError(raw,subject?)` — 原始报错翻译成中文说明，中文原文直接用，未知错误给通用说明并附错误码 | keywords: 翻译PixMax错误, 友好错误提示, describe-pixmax-error, friendly-error-message
- `PixmaxFriendlyError` — 已翻译的异常，`message` 给用户、`detail` 留原文 | keywords: 友好PixMax异常, 原始错误保留, friendly-pixmax-error, raw-error-detail
- `toPixmaxFriendlyError(error,subject?)` — 任意异常包装成友好异常 | keywords: 包装友好错误, 保留原始信息, wrap-friendly-error, keep-raw-detail
- `mapPixmaxTaskStatus(status)` — 映射为排队 / 生成中 / 已完成 / 失败 | keywords: PixMax状态映射, 调用状态, map-pixmax-status, operation-status

## 关键词索引 (Keyword Index)

| 中文           | English                |
| -------------- | ---------------------- |
| PixMax客户端   | pixmax-client          |
| PixMax模型规格 | pixmax-model-spec      |
| 上传PixMax资产 | upload-pixmax-asset    |
| 资产合规审核   | asset-compliance-check |
| 提交PixMax任务 | submit-pixmax-task     |
| 组装生视频参数 | build-video-params     |
| 选择生成方式   | pick-refer-mode        |
| 选择生成时长   | pick-duration          |
| 选择清晰度     | pick-resolution        |
| 模型可选清晰度 | model-resolution-choices |
| 视频生成模式   | video-generation-mode  |

## 类型导出 (Type Exports)

- `PixmaxRuntime` / `PixmaxParamSpec` / `PixmaxModelSpec` / `PixmaxAsset` / `PixmaxTaskStatus` / `PixmaxTask` / `PixmaxSubmitInput` / `PixmaxAssetCacheEntity`。
- `PixmaxVideoMode` / `PixmaxVideoParamsResult`。

## 模块功能描述 (Module Feature Description)

**调用约定**：所有请求 `POST {baseUrl}{path}`，带 `Authorization: Bearer <Key>`，按 `success / errCode / errMessage / data` 解析，失败抛 `PIXMAX_API_FAILED:<errCode>:<errMessage>`，网络错误抛 `PIXMAX_NETWORK_ERROR`，缺 Key 抛 `PIXMAX_API_KEY_NOT_CONFIGURED`。任务必须落在项目里，`ensureProject` 按名称复用已有项目，没有就新建，并按「域名 + Key 摘要」缓存。上传素材按 `sourceKey`（如 `gallery:<图库ID>`）记入 `pixmax_asset_cache`，同一账号不重复上传；火山系模型（Seedance / Doubao）引用素材前调用合规审核并每 3 秒轮询，最多等 90 秒，防重锁和限流报错时继续等。结果地址按 `fullUrl → ossDomain + webUrl → PixMax 域名 + webUrl` 拼接。

**生视频参数组装**：`buildPixmaxVideoParams` 按目录里的模型规格组装 `params`：`model` 与 `nodeType=GENERATE_VIDEO` 必带；生成方式在分镜模式下依次尝试 图生视频（有图）→ 图片参考 → 参考素材 → 文生视频，整片模式依次尝试 参考素材（多图）→ 图片参考 → 首尾帧（至少 2 张图，取第一镜与最后一镜的画面）→ 首图图生视频 → 文生视频，尽量让分镜画面参与生成；参考图数量按模式要求原文（如「图片必须为 1～9 个」）与模型输入上限截断，只要求视频的模式不会拿图片凑数。时长取不小于目标的最短一档，超过上限取最长一档并标记 `durationClamped`；清晰度按调用方传入的 `targetResolution` 在模型档位里就近取（对不上标记 `resolutionClamped`，没传时用模型默认档，目录里没有的模型不写 `resolution` 免得塞它不收的字段）；宽高比优先 `9:16`，模式要求 `adaptive` 时改用 `adaptive`；数量固定 1；其余参数用模型默认值。目录里没有的模型（例如接口返回的编码与文档不一致）按通用参数兜底，时长夹在 5～15 秒；超分等非生成模型直接拒绝。PixMax 调整模型后，用 `vendor-api/pixmax/models.json` 重新生成 `pixmax-model-catalog.ts`。

**错误友好化**：`describePixmaxError` 按 `PIXMAX_ERROR_RULES` 把原始报错翻译成中文说明，例如合规审核返回 `InputImageSensitiveContentDetected.PolicyViolation`（版权限制）时说明「{对象}可能涉及版权内容（如知名 IP、动漫或影视形象、品牌标识等），没有通过平台审核，请换成原创或没有版权风险的图片后重试」；其他覆盖敏感图片 / 文字 / 输出、图片尺寸格式、审核超时、积分不足、限流、Key 无效或未配置、网络、模型不支持、成片转存失败、图库图片读不到。调用方用 `toPixmaxFriendlyError` 得到「中文说明 + 原始信息」，前者给用户，后者留作排查。
