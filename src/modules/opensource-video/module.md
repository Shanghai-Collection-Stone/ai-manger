# 模块名称 (Module Name)

自建 MiniMax-H3 视频服务客户端（opensource-video）

## 概述 (Overview)

`opensource-video` 项目部署在 GPU 服务器上的视频接口（ComfyUI + MiniMax-H3，传提示词 / 首尾帧 → 拿 mp4）的服务端客户端与参数工具。连接信息不读环境变量，由调用方从后台「Ai提供商设置」里 `providerCode=opensource-video` 的记录传入（Base URL 填 GPU 平台给 6006 端口的映射地址，Key 填服务器 `.env` 的 `VIDEO_API_KEY`），通常经 [workflow-model](../workflow-model/module.md) 的节点设置取得。当前调用方是 [douyin-workbench](../douyin-workbench/module.md) 的分镜视频、整片视频（首尾帧图生视频）与探店画面视频、探店人物对口型（参考生视频）四个节点。

文件路径: `src/modules/opensource-video`
服务端接口: `POST /v1/videos`、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`、`GET /v1/system/health`（全部 `Authorization: Bearer <VIDEO_API_KEY>`）

已知限制：服务端单卡串行（5 秒视频约 1 分钟，15 秒约 3～4 分钟，参考生视频首次要加载 ref2va 模型），多段会排队；单条最长 15 秒；参考生视频只收图片与音频（最多 9 张 / 3 段），不收视频参考；首尾帧与参考素材不能同时传；不支持取消任务；换实例后映射地址会变，要回后台改 Base URL。

## 文件清单 (File List)

- `opensource-video.module.ts` — NestJS 模块入口，导出 `OpensourceVideoClientService`。
- `entities/opensource-video.entity.ts` — 提供商代码、连接信息、模型目录、清晰度档位、时长范围与接口请求 / 任务类型。
- `services/opensource-video-client.service.ts` — HTTP 调用：提交任务、查询任务、带 Key 流式下载成片。
- `services/opensource-video-params.ts` — 提供商识别、模型编码换档位、时长与清晰度收敛、状态映射、错误翻译。
- `services/opensource-video-params.spec.ts` — 参数工具单测。

## 函数清单 (Function List)

- `OpensourceVideoModule()` — 装配自建视频客户端 | keywords: 自建视频模块, 自建生成服务, opensource-video-module, self-hosted-generation
- `OPENSOURCE_VIDEO_PROVIDER_CODE` — 后台提供商代码 `opensource-video` | keywords: 自建视频提供商代码, 提供商识别, opensource-video-provider-code, provider-code
- `OpensourceVideoRuntime` — 调用所需的 Base URL 与 Key | keywords: 自建视频连接信息, 提供商凭证, opensource-video-runtime, provider-credential
- `OpensourceVideoMode` — 服务端生成档位 fast / turbo / quality | keywords: 自建视频生成档位, 采样步数, opensource-video-mode, sampling-steps
- `OPENSOURCE_VIDEO_MODELS` — 节点可选模型 `minimax-h3-turbo` / `minimax-h3-fast` / `minimax-h3-quality` 与档位对照 | keywords: 自建视频模型目录, 节点可选模型, opensource-video-models, node-model-options
- `OPENSOURCE_VIDEO_RESOLUTIONS` — 清晰度档位 544P（0.5MP）/ 672P（0.8MP）与 megapixels 对照 | keywords: 自建视频清晰度档位, 像素量对照, opensource-video-resolutions, megapixels-mapping
- `OPENSOURCE_VIDEO_DURATION_RANGE` — 单条 1～15 秒 | keywords: 自建视频时长范围, 最长时长, opensource-video-duration-range, max-duration
- `OPENSOURCE_VIDEO_PROMPT_MAX` — 提示词上限 8000 字 | keywords: 自建视频提示词上限, 提示词截断, opensource-video-prompt-max, prompt-truncate
- `OPENSOURCE_VIDEO_REFERENCE_LIMITS` — 参考生视频最多 9 张参考图、3 段参考音频 | keywords: 参考素材上限, 参考生视频, opensource-video-reference-limits, reference-to-video
- `OpensourceVideoCreateInput` — `POST /v1/videos` 请求体（首尾帧或参考图 / 参考音频二选一） | keywords: 自建视频提交参数, 首尾帧, opensource-video-create-input, first-last-frame
- `OpensourceVideoJobStatus` — 任务状态原值 | keywords: 自建视频任务状态, 状态枚举, opensource-video-job-status, status-enum
- `OpensourceVideoJob` — 任务视图 | keywords: 自建视频任务, 任务详情, opensource-video-job, job-detail
- `OpensourceVideoClientService()` — HTTP 客户端 | keywords: 自建视频客户端, 视频接口调用, opensource-video-client, video-api-call
- `OpensourceVideoClientService.createVideo(runtime,input)` — 提交生成任务 | keywords: 提交自建视频任务, 生成视频, submit-opensource-video-job, create-video
- `OpensourceVideoClientService.getVideo(runtime,jobId)` — 查询任务 | keywords: 查询自建视频任务, 任务状态, get-opensource-video-job, job-status
- `OpensourceVideoClientService.downloadVideo(runtime,jobId,target)` — 带 Key 下载成片并流式写文件 | keywords: 下载自建视频成片, 流式写文件, download-opensource-video, stream-to-file
- `OpensourceVideoClientService.request(runtime,path,init)` — 带 Bearer 请求，校验配置并保留错误体 | keywords: 自建视频HTTP请求, 错误体保留, opensource-video-http, preserve-error-body
- `isOpensourceVideoProvider(providerCode?)` — 判断提供商代码是否自建视频服务 | keywords: 自建视频识别, 提供商代码, is-opensource-video-provider, provider-code
- `resolveOpensourceVideoMode(model?)` — 模型编码换生成档位，不认识返回 null | keywords: 解析生成档位, 模型编码, resolve-opensource-video-mode, model-code
- `listOpensourceVideoDurationChoices()` — 可选秒数 1～15 | keywords: 自建视频可选时长, 时长范围, opensource-video-duration-choices, duration-range
- `clampOpensourceVideoDuration(seconds)` — 四舍五入并夹到 1～15 秒 | keywords: 自建视频时长收敛, 视频时长, clamp-opensource-video-duration, video-duration
- `listOpensourceVideoResolutionChoices()` — 可选清晰度档位 | keywords: 自建视频可选清晰度, 清晰度档位, opensource-video-resolution-choices, resolution-tiers
- `clampOpensourceVideoResolution(resolution?)` — 清晰度就近收敛到 544P / 672P，没设定用 544P | keywords: 自建视频清晰度收敛, 就近取档, clamp-opensource-video-resolution, nearest-tier
- `toOpensourceVoiceHint(description?)` — 中文音色描述按关键词转英文提示（年龄、声线、性别、方言口音、风格、语速），认不出为空；直连模型会念出提示词里台词以外的中文 | keywords: 音色英文提示, 中文音色转换, voice-hint-english, chinese-voice-convert
- `mapOpensourceVideoStatus(status?)` — 服务端状态映射成工作台状态 | keywords: 自建视频状态映射, 工作台状态, map-opensource-video-status, workbench-status
- `OPENSOURCE_VIDEO_ERROR_RULES` — 错误说明对照 | keywords: 自建视频错误对照, 通道错误, opensource-video-error-rules, channel-error
- `describeOpensourceVideoFailure(raw)` — 原始报错翻译成中文，规则外附原文 | keywords: 翻译自建视频报错, 友好错误提示, describe-opensource-video-error, friendly-error-message

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 自建视频模块 | opensource-video-module |
| 自建视频提供商代码 | opensource-video-provider-code |
| 自建视频连接信息 | opensource-video-runtime |
| 自建视频生成档位 | opensource-video-mode |
| 自建视频模型目录 | opensource-video-models |
| 自建视频清晰度档位 | opensource-video-resolutions |
| 自建视频客户端 | opensource-video-client |
| 提交自建视频任务 | submit-opensource-video-job |
| 查询自建视频任务 | get-opensource-video-job |
| 下载自建视频成片 | download-opensource-video |
| 自建视频识别 | is-opensource-video-provider |
| 解析生成档位 | resolve-opensource-video-mode |
| 自建视频时长收敛 | clamp-opensource-video-duration |
| 自建视频清晰度收敛 | clamp-opensource-video-resolution |
| 自建视频状态映射 | map-opensource-video-status |
| 翻译自建视频报错 | describe-opensource-video-error |
| 音色英文提示 | voice-hint-english |
| 参考素材上限 | opensource-video-reference-limits |

## 类型导出 (Type Exports)

- `OpensourceVideoRuntime` / `OpensourceVideoMode` / `OpensourceVideoCreateInput` / `OpensourceVideoJobStatus` / `OpensourceVideoJob`（`entities/opensource-video.entity.ts`）。

## 模块功能描述 (Module Feature Description)

**调用约定**：`request` 先校验 Base URL 与 Key（缺失抛 `OPENSOURCE_VIDEO_BASE_URL_NOT_CONFIGURED` / `OPENSOURCE_VIDEO_API_KEY_NOT_CONFIGURED`），再带 `Authorization: Bearer <Key>` 请求；网络错误抛 `OPENSOURCE_VIDEO_NETWORK_ERROR:<原因>`，非 2xx 抛 `OPENSOURCE_VIDEO_HTTP_<状态码>:<响应体>`。提交超时 2 分钟、查询 1 分钟、下载 10 分钟（流式写盘，不整段读进内存）。服务端状态码含义：401 / 403 Key 无效，404 任务不存在，409 成片未就绪，422 参数或图片不合格，502 ComfyUI 不可用。

**模型与档位**：模型编码只是档位的名字，服务端只有一个 MiniMax-H3 工作流：`minimax-h3-turbo` 为 8 步加速 LoRA（默认），`minimax-h3-fast` 为 4 步（音频有持续杂音，只适合预览），`minimax-h3-quality` 为 20 步无加速。后台「工作流节点模型」里这三个只能选不能手填。

**清晰度**：服务端按百万像素算宽高（对齐 32），竖屏下 544P = 0.5MP（544x960，加速 LoRA 训练分辨率，最快），672P = 0.8MP（672x1216）。其他平台的档位写法（`720p`、`1080P`、`2K`）按短边像素就近取，认不出时用 544P。

**错误翻译**：`describeOpensourceVideoFailure` 先按 `OPENSOURCE_VIDEO_ERROR_RULES` 给固定说明（图片类规则排在网络规则前，因为图片下载失败的原文里也会带 `fetch failed`）；规则外的多为服务端生成失败原文（如「任务已不在 ComfyUI 队列中 (ComfyUI 可能重启过)」「UNETLoader: ...」），原样附在「自建视频服务生成失败：」后面。

**参考生视频**：请求带 `reference_images` / `reference_audios`（data URL 数组）时服务端换 ref2va 模型，参考按顺序对应 `<Picture i>` / `<Audio j>`。服务是直连模型、没有提示词改写，ref2va 对措辞非常敏感：调用方要按 H3 官方模板格式写（英文骨架 + 引号里的中文台词，参考标签就地写），而且**除引号里的台词外不能有中文**——标题、指令段、场景说明、音色描述里的中文都会被模型念出来，开头人声错乱（语音识别实测念出「集合石探店」「西部决斗场」「自然口语」）。音色用 `toOpensourceVoiceHint` 转成英文；带参考音频时写明「<Audio 1> 只是音色样本，不要说出它的词」。探店见 douyin-workbench 的 `buildStoreVisitH3Prompt`，分镜 / 整片见 `buildOpensourceShotPrompt` / `buildOpensourceFullPrompt`。

**后台测试连接**：`admin` 模块的「测试」按钮对这个提供商调 `GET /v1/system/health`（带 Key，返回 ComfyUI 与显卡状态，不占 GPU）。
