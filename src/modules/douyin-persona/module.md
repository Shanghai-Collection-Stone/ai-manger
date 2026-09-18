# 模块名称 (Module Name)

抖音预设人物（douyin-persona）

## 概述 (Overview)

提供租户内共享的抖音短视频「预设人物」：人设文字（外貌、性格语气）、叙事视角（探店 / 测评 / 讲解 / 种草 / 用户口碑）、音色设置，以及 AI 生成的三视图形象参考图。人物由后台管理端维护一次，租户内所有工作台用户都能在脚本上选用。
人物是画面一致性的第一道保险：分镜出图时把形象参考图作为底图候选（[douyin-workbench 模块](../douyin-workbench/module.md) 的线性连贯出图再叠加上一镜画面），成片配音时把音色写进 PixMax 提示词【声音】段。
这套链路没有独立 TTS 音色库，人声由生视频模型按提示词生成，因此音色是结构化描述而不是音色 ID。人物形象图入租户图库并打「抖音人物形象」标签，不使用占位图或模拟数据。

## 文件清单 (File List)

- `douyin-persona.module.ts` — NestJS 模块入口与依赖装配（生图所需的 `GalleryModule`、按节点取模型的 `WorkflowModelModule`）。
- `controller/douyin-persona.controller.ts` — 预设人物鉴权 REST 接口（列表、选项、增删改、AI 人设草稿、三视图生成）。
- `controller/douyin-persona.dto.ts` — 人设、音色与 AI 草稿需求的输入校验。
- `entities/douyin-persona.entity.ts` — 人物实体、叙事视角登记表、音色结构与三视图构图规格。
- `services/douyin-persona-repository.service.ts` — MongoDB 人物持久化，按租户共享、按租户隔离。
- `services/douyin-persona-prompt.ts` — 人设转提示词片段：脚本视角段、出图外貌段、配音音色段与底图地址。
- `services/douyin-persona-generation.service.ts` — AI 人设草稿与三视图形象图串行生成。

## 函数清单 (Function List)

- `DOUYIN_PERSONA_PERSPECTIVES` — 叙事视角键名登记表，前后端取值唯一来源 | keywords: 人物叙事视角, 探店视角, persona-perspective, store-visit-perspective
- `DOUYIN_PERSONA_PERSPECTIVE_LABELS` — 各视角的中文名与写进提示词的口吻说明 | keywords: 视角说明文案, 视角提示词, perspective-labels, perspective-prompt
- `DouyinPersonaVoice` — 音色结构：性别、年龄感、语速与自由音色特质 | keywords: 人物音色设置, 提示词音色, persona-voice-setting, prompt-level-timbre
- `DouyinPersonaImage` — 一张形象参考图：三视图位次、图库 ID 与地址 | keywords: 人物形象参考图, 三视图, persona-reference-image, three-view-sheet
- `DouyinPersonaEntity` — 预设人物持久化实体，租户内共享 | keywords: 预设人物实体, 租户共享人设, douyin-persona-entity, tenant-shared-persona
- `DouyinPersonaView` — 去掉数据库 ID 的前端人物视图 | keywords: 预设人物视图, 隐藏数据库ID, douyin-persona-view, hide-database-id
- `DOUYIN_PERSONA_VIEW_SPECS` — 正面全身 / 四分之三侧身 / 面部特写三张的构图要求与尺寸 | keywords: 三视图构图, 形象生成规格, three-view-composition, reference-sheet-spec
- `normalizePersonaVoice(input?)` — 规整音色，非法值回退中性成年正常语速 | keywords: 规整人物音色, 默认音色, normalize-persona-voice, default-voice
- `normalizePersonaPerspective(input?)` — 规整叙事视角，未登记回退种草介绍 | keywords: 规整叙事视角, 默认视角, normalize-persona-perspective, default-perspective
- `DouyinPersonaRepositoryService()` — 管理预设人物持久化 | keywords: 预设人物仓储, 租户共享, douyin-persona-repository, tenant-shared
- `ensureIndexes()` — 创建人物业务 ID 唯一索引与租户列表索引 | keywords: 预设人物索引, 租户列表查询, douyin-persona-indexes, tenant-list-query
- `list(scope,options?)` — 列出本租户人物，默认只返回启用中 | keywords: 查询预设人物, 启用中人物, list-douyin-personas, active-personas
- `get(id,scope)` — 按业务 ID 读取本租户人物 | keywords: 读取预设人物, 租户校验, get-douyin-persona, tenant-check
- `create(input,scope)` — 新建人物，形象图留空待生成 | keywords: 新建预设人物, 人设入库, create-douyin-persona, persist-persona
- `update(id,input,scope)` — 更新人设或归档状态，只写传入字段 | keywords: 更新预设人物, 归档人物, update-douyin-persona, archive-persona
- `replaceImages(id,images,scope)` — 三视图生成完成后整组替换形象图 | keywords: 回填人物形象图, 三视图入库, save-persona-images, persist-reference-sheet
- `remove(id,scope)` — 删除人物，已选用它的脚本按引用降级处理 | keywords: 删除预设人物, 引用降级, delete-douyin-persona, dangling-reference
- `nextId()` — 生成人物业务自增 ID | keywords: 预设人物自增ID, 计数器, next-douyin-persona-id, counter
- `tenantFilter(tenantId?)` — 构造租户或母平台数据边界 | keywords: 人物租户边界, 母平台数据边界, persona-tenant-filter, platform-data-boundary
- `trimLine(value,max)` — 压掉换行的单行文本裁剪 | keywords: 单行文本裁剪, 去空白, trim-single-line, collapse-whitespace
- `trimText(value,max)` — 保留换行的多行文本裁剪 | keywords: 多行文本裁剪, 保留换行, trim-multiline, keep-newline
- `toView(row)` — 移除数据库 ID | keywords: 预设人物视图, 隐藏数据库ID, douyin-persona-view, hide-database-id
- `DOUYIN_PERSONA_VOICE_LABELS` — 音色三个维度写进提示词的中文措辞 | keywords: 音色维度文案, 音色描述, voice-dimension-labels, timbre-wording
- `describePersonaVoice(voice)` — 音色拼成一句中文，UI 徽标与提示词共用 | keywords: 音色短文案, 音色一句话, voice-label, timbre-one-liner
- `buildPersonaVoiceSection(persona?)` — 生视频提示词【声音】段的音色补充句 | keywords: 音色提示片段, 配音音色约束, voice-prompt-fragment, voiceover-timbre-rule
- `buildPersonaScriptBrief(persona?)` — 脚本与分镜共用的人设段（身份、视角、语气、第一人称约束） | keywords: 人设脚本段, 视角约束, persona-script-brief, perspective-constraint
- `buildPersonaImageBrief(persona?)` — 分镜出图叠加的人物外貌段 | keywords: 人物外貌提示, 跨镜一致, persona-appearance-prompt, cross-shot-consistency
- `personaBaseImageUrls(persona?)` — 取形象参考图地址作为生图底图候选 | keywords: 人物底图候选, 形象图地址, persona-base-images, reference-image-urls
- `DOUYIN_PERSONA_IMAGE_TAG` — 人物形象图的图库业务标签 | keywords: 人物形象图标签, 业务标签, persona-image-tag, business-tag
- `readString(value)` — 只接受字符串的安全取值，避免 LLM 返回对象被转成 `[object Object]` | keywords: 安全读取字符串, LLM返回取值, safe-read-string, llm-value-access
- `DouyinPersonaGenerationService()` — 人物的 AI 人设草稿与三视图生成 | keywords: 人物AI生成, 三视图生成, persona-ai-generation, reference-sheet-generation
- `draftPersona(brief,scope)` — 按一句话需求让 LLM 写出人设草稿（不入库）；解析不出 JSON 抛 `DOUYIN_PERSONA_DRAFT_NOT_JSON`、缺人物名或外貌不足 20 字抛 `DOUYIN_PERSONA_DRAFT_INCOMPLETE`，两者都带中文说明并把原始回复写进警告日志 | keywords: AI生成人设, 人设草稿, ai-draft-persona, persona-draft
- `generateReferenceSheet(id,scope)` — 串行生成三视图，后两张以前一张为底图保证同一张脸 | keywords: 生成人物三视图, 形象一致, generate-reference-sheet, identity-consistency
- `buildViewPrompt(name,appearance,composition,hasBaseImage)` — 一张形象图的文生图提示词 | keywords: 构造形象图提示, 纯色背景无文字, build-persona-image-prompt, plain-background-no-text
- `readJsonObject(result)` — 从 Agent 响应里解析 JSON，摘掉 `<think>` 推理段与代码块围栏，连原始回复一起返回供排错 | keywords: 解析Agent JSON, 去代码块围栏, 保留原始回复, parse-agent-json, strip-code-fence, keep-raw-reply
- `DouyinPersonaController()` — 预设人物鉴权 HTTP 接口 | keywords: 预设人物接口, 人设管理接口, douyin-persona-controller, persona-management-api
- `list(req,includeArchived?)` — `GET /api/douyin-persona` 查询本租户人物 | keywords: 查询预设人物接口, 人物列表, list-douyin-personas-api, persona-list
- `options()` — `GET /api/douyin-persona/options` 返回视角与三视图登记表 | keywords: 人物选项接口, 视角登记表, persona-options-api, perspective-registry
- `create(req,body)` — `POST /api/douyin-persona` 新建人物 | keywords: 新建预设人物接口, 人设入库, create-douyin-persona-api, persist-persona
- `draft(req,body)` — `POST /api/douyin-persona/draft` AI 人设草稿 | keywords: AI生成人设接口, 人设草稿, draft-douyin-persona-api, persona-draft
- `update(req,id,body)` — `PATCH /api/douyin-persona/:id` 更新人设或归档 | keywords: 更新预设人物接口, 归档人物, update-douyin-persona-api, archive-persona
- `generateReferenceSheet(req,id)` — `POST /api/douyin-persona/:id/reference-sheet` 生成三视图 | keywords: 生成人物三视图接口, 形象一致, generate-reference-sheet-api, identity-consistency
- `remove(req,id)` — `DELETE /api/douyin-persona/:id` 删除人物 | keywords: 删除预设人物接口, 移除人设, delete-douyin-persona-api, remove-persona
- `readId(value)` — 解析并校验路由中的正整数人物 ID | keywords: 解析人物ID, 路由校验, parse-persona-id, route-validation
- `requireUser(req)` — 读取登录用户，未登录拒绝 | keywords: 读取登录用户, 拒绝匿名, require-admin-user, reject-anonymous
- `scopeOf(user)` — 构造租户用户作用域 | keywords: 构造人物作用域, 租户边界, build-persona-scope, tenant-boundary
- `DouyinPersonaVoiceDto()` — 校验音色三维度与音色特质 | keywords: 人物音色参数, 音色校验, persona-voice-dto, voice-validation
- `CreateDouyinPersonaDto()` — 校验新建人物，人物名与外貌必填 | keywords: 新建预设人物参数, 外貌必填, create-persona-dto, appearance-required
- `UpdateDouyinPersonaDto()` — 校验更新人物，字段全可选，含归档状态 | keywords: 更新预设人物参数, 归档状态, update-persona-dto, archive-status
- `DraftDouyinPersonaDto()` — 校验 AI 人设草稿的一句话需求 | keywords: 人设草稿参数, 一句话需求, persona-draft-dto, one-line-brief
- `DouyinPersonaModule()` — 装配预设人物能力并导出仓储 | keywords: 预设人物模块, 人设能力装配, douyin-persona-module, persona-capability-wiring

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 预设人物 | douyin-persona |
| 租户共享人设 | tenant-shared-persona |
| 人物叙事视角 | persona-perspective |
| 探店视角 | store-visit-perspective |
| 人物音色设置 | persona-voice-setting |
| 提示词音色 | prompt-level-timbre |
| 配音音色约束 | voiceover-timbre-rule |
| 人物形象参考图 | persona-reference-image |
| 三视图 | three-view-sheet |
| 三视图生成 | reference-sheet-generation |
| 形象一致 | identity-consistency |
| 跨镜一致 | cross-shot-consistency |
| 人物底图候选 | persona-base-images |
| AI生成人设 | ai-draft-persona |
| 人设草稿 | persona-draft |
| 人设脚本段 | persona-script-brief |
| 视角约束 | perspective-constraint |
| 人物外貌提示 | persona-appearance-prompt |
| 归档人物 | archive-persona |
| 引用降级 | dangling-reference |
| 人物租户边界 | persona-tenant-filter |
| 人物形象图标签 | persona-image-tag |
| 安全读取字符串 | safe-read-string |
| 保留原始回复 | keep-raw-reply |

## 类型导出 (Type Exports)

- `DouyinPersonaPerspective` — 叙事视角键名联合类型。
- `DouyinPersonaVoice` — 音色设置结构。
- `DouyinPersonaImage` — 一张形象参考图。
- `DouyinPersonaEntity` — 人物持久化实体。
- `DouyinPersonaView` — 去掉 `_id` 的前端人物视图。

## 模块功能描述 (Module Functionality)

后台管理端（`ai-manger/web` 的「抖音人物」Tab）维护租户的预设人物：填人设或用一句话需求让 AI 写草稿，确认后保存，再点一次生成三视图形象图。三视图串行出图——正面全身出完后，侧身与特写都把已生成的图当底图，三张必然是同一张脸；任意一张失败即整体失败，不会留下半套形象图。

工作台（`xhs-manger` 抖音视频制作）在脚本上选用人物后：

- **写脚本**：`buildPersonaScriptBrief` 把身份、叙事视角（探店 / 测评 / 讲解 / 种草 / 用户口碑）与语气写进脚本生成提示词，口播稿全程用这个人物的第一人称。
- **拆分镜**：同一份人设段进入分镜提示词，每段画面与 `image_prompt` 都要带上这个人物。
- **逐镜出图**：`buildPersonaImageBrief` 叠加外貌段，`personaBaseImageUrls` 提供形象图作为底图候选，与上一镜画面、脚本参考图一起构成 `baseImageCandidates`。
- **生成成片**：`buildPersonaVoiceSection` 把音色写进 PixMax 提示词【声音】段，固定全片只有这一个人的声音。

权限主体为 `DouyinPersona`：租户管理员 `manage`（后台维护人设），操作员 `read`（工作台只能选用，不能改人设）。人物按租户共享而不按创建人隔离，`tenantFilter` 保证母平台只看到平台级人物。
