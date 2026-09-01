# 模块名称 (Module Name)

热点采集榜模块（hot-topic）

## 概述 (Overview)

给内容运营提供一张「当下的热点榜」：由后台可配置的**采集规则**从公开榜单接口 HTTP 直采，落库后由 AI 逐条归类打标，最后可以按用户母选题反查「当前榜单里哪几条适合写」。

采集通道是**平台进程内直接 fetch 公开 JSON 接口**，不需要节点、不需要工作区、不需要登录态、不计费，也不产生 Todo。一条采集规则 = 一个榜单地址 + 一组点号取值路径（榜单数组路径 + 标题/链接/热度/摘要字段路径）+ 保留条数 + 启用开关。上游随时可能改版式，所以取值路径全部是可编辑字段，失效时改路径即可恢复，不需要发版。规则表本身就是一个「让服务端去访问任意 URL」的入口，因此 `HotTopicFetcherService.validateEndpoint` 只放行 http/https 公网地址，挡掉 localhost、回环、IPv4 私网、IPv6 链路本地与 `.internal`/`.local` 后缀。

**「是否可用」不是手工维护的状态位**，而是最近一次自检或正式采集的真实结果，写在规则的 `health` 快照上（状态、时间、解析条数、失败原因、示例标题）。所以管理页看到的可用状态与实际采集行为永远一致：点「自检」会真跑一次抓取解析但不落库，正式采集结束也同样回写 `health`；改了地址或取值路径后 `health` 被重置成 `unknown`，避免旧配置的「可用」结论继续挂着误导人。

内置 8 条预置规则，社会热点与娱乐热点各 4 条（微博热搜 / 百度热搜·实时 / 今日头条热榜 / 澎湃新闻热榜；百度热搜·电影 / 百度热搜·电视剧 / 哔哩哔哩热搜 / 抖音热榜），全部取值路径都实测通过。初始化按 `builtinKey` 幂等：已存在的一条都不覆盖，用户改过的内置规则不会被打回默认值；删掉的内置规则可以再点一次初始化补回。

**每次采集默认先清除上一轮**（`clearPrevious` 缺省 true）。热榜是「当下快照」，条目还带名次，留着上一轮会让「当前榜单」失真，也会把过气热点混进推荐候选。只跑部分规则时只清这部分规则的历史，不会顺手抹掉没参与本次采集的榜单。停用的规则即使被显式勾选也会被跳过并给出「已停用」回执，这样启用开关是唯一的真实闸门。单条规则抓取失败只体现在它自己的回执和 `health` 上，不会让整次采集失败。

归类标签由 Agent 完成：条目按 25 条一批送进模型，标签**只经 `hot_topic_set_tags` 工具逐条写入运行内存**，模型最终文本不参与解析；写入的 `hot_topic_id` 必须命中本批清单。推荐词表只是「建议」不是枚举——热榜每天都会冒出词表覆盖不到的新话题，锁死词表会把它们全塞进「其他」；词表的作用是让高频话题收敛到同一批词上，避免同义标签把标签列表撑成几百条。模型不可用或漏写时按规则的 `defaultTags` 兜底，`tagSource` 记录标签来自 `ai` / `rule` / `none`，所以榜单上不会出现一批完全没有标签的条目，也分得清哪些是真的 AI 归类结果。

`POST /recommend` 按母选题反查适配热点，走**两阶段**：先只把归类标签清单（标签名 + 条目数）交给模型做**标签粗筛**，再用选中的标签过滤候选、把该范围内的热点标题全量交给模型逐条判定契合度。分两步是因为一步做不好：热榜动辄几百条，一次性全塞进去要么超上下文、要么被截断成「前 80 条」，而截断是按名次而不是按相关性做的，母选题真正对口的热点很可能正好落在被截掉的那一段里；先按标签把范围收到对口领域，两次的输入就都在模型读得完的量级上。粗筛只收窄范围、不做最终判断：选不出标签、标签总数本来就不超过 8 个、或按标签筛完候选少于 12 条，都会回落到全量候选池，宁可让模型多看一些也不能把范围筛没；调用方显式传 `tags` 时那是硬约束，直接跳过第一阶段。两个阶段同样是纯工具交付：粗筛只接受标签清单内的标签，判定写入的 `hot_topic_id` 必须命中候选池，因此模型无法凭空造标签或热点；接口返回结构化 JSON（热点 ID、标题、来源、标签、0-100 契合度、匹配理由、切入角度），并带上 `matchedTags` / `tagFiltered` 说明候选是被哪几个标签圈出来的、还是走了全量兜底。任一阶段 Agent 异常都不抛 500：粗筛失败就回落全量，判定失败就返回 `recommendations: []`。

## 文件清单 (File List)

- `hot-topic.module.ts` — NestJS 模块入口，装配后台鉴权、榜单直采、规则仓储、AI 归类与热点推荐服务。
- `controller/hot-topic.controller.ts` — 热点采集榜 HTTP 接口与权限声明。
- `controller/hot-topic.dto.ts` — 采集规则、采集触发、榜单查询、清库与推荐入参校验。
- `entities/hot-topic.entity.ts` — 分类枚举、采集规则、可用性快照、榜单条目、采集结果、标签汇总与推荐结果类型。
- `entities/hot-topic-presets.ts` — 平台内置的社会/娱乐热点预置采集规则及其实测取值路径。
- `services/hot-topic-fetcher.service.ts` — 榜单 HTTP 直采、内网地址拦截、点号路径解析与条目归一化。
- `services/hot-topic-rule.service.ts` — 采集规则 CRUD、预置规则幂等初始化、可用性自检与健康快照回写。
- `services/hot-topic-item.service.ts` — 榜单条目批量入库、清库、分页查询、标签回写与标签线性汇总。
- `services/hot-topic-tagging.service.ts` — AI 归类 Agent、归类工具与规则兜底标签。
- `services/hot-topic-collect.service.ts` — 采集编排：解析待跑规则、按需清库、逐规则直采、入库、归类与可用性回写。
- `services/hot-topic-recommend.service.ts` — 按母选题推荐热点的 Agent、推荐写入工具与结构化结果组装。

## 函数清单 (Function List)

- `HotTopicRuleFieldsDto({ title, url?, heat?, summary? })` — 校验榜单条目字段的取值路径，标题路径必填 | keywords: 字段路径参数, 解析路径校验, field-path-dto, parse-path-validation
- `CreateHotTopicRuleDto({ name, category, platform?, endpoint, headers?, listPath?, fields, urlTemplate?, defaultTags?, limit?, enabled? })` — 校验新建采集规则请求 | keywords: 新建规则参数, 榜单地址校验, create-rule-dto, endpoint-validation
- `UpdateHotTopicRuleDto({ ...全部可选 })` — 校验更新采集规则请求，只更新传入的部分 | keywords: 更新规则参数, 增量更新, update-rule-dto, partial-update
- `CollectHotTopicDto({ ruleIds?, clearPrevious?, autoTag? })` — 校验触发采集请求，`clearPrevious` 不传按默认清除历史 | keywords: 采集参数, 默认清除历史, collect-dto, clear-previous-default
- `HotTopicItemQueryDto({ category?, ruleId?, tag?, keyword?, page?, pageSize? })` — 校验榜单条目分页查询参数 | keywords: 榜单查询参数, 分页过滤, item-query-dto, paged-filter
- `RecommendHotTopicDto({ parentTopic, parentTopicBrief?, ruleIds?, category?, tags?, limit? })` — 校验按母选题推荐热点的请求 | keywords: 推荐参数, 母选题必填, recommend-dto, parent-topic-required
- `ClearHotTopicItemDto({ ruleIds? })` — 校验清空榜单条目请求 | keywords: 清空榜单参数, 按规则清除, clear-items-dto, clear-by-rule
- `HotTopicModule()` — 装配热点采集榜的控制器、直采、仓储、归类与推荐服务 | keywords: 热点采集模块, 榜单管理, hot-topic-module, board-management
- `HotTopicController.meta()` — 返回分类枚举与 AI 归类推荐词表 | keywords: 分类元数据, 推荐词表, category-metadata, suggested-tags
- `HotTopicController.listRules(req)` — 列出全部采集规则，每条带最近一次自检或采集的可用性状态 | keywords: 采集规则列表, 是否可用, list-collect-rules, availability-status
- `HotTopicController.createRule(req, dto)` — 新建一条采集规则 | keywords: 新建采集规则, 榜单地址, create-collect-rule, board-endpoint
- `HotTopicController.updateRule(req, id, dto)` — 更新采集规则；改地址或解析路径后可用性重置为未知 | keywords: 更新采集规则, 重置可用性, update-collect-rule, reset-health
- `HotTopicController.deleteRule(req, id)` — 删除采集规则，内置规则可通过初始化补回 | keywords: 删除采集规则, 预置可补回, delete-collect-rule, preset-restorable
- `HotTopicController.seedRules(req)` — 幂等初始化内置社会/娱乐热点预置规则 | keywords: 初始化预置规则, 幂等补齐, seed-builtin-rules, idempotent-fill
- `HotTopicController.checkRule(req, id)` — 对规则做真实采集自检并回写可用性，只跑不落库 | keywords: 规则自检接口, 可用性探测, rule-check-endpoint, availability-probe
- `HotTopicController.collect(req, dto)` — 触发一次采集，默认先清除历史再采并自动 AI 归类 | keywords: 触发热点采集, 默认清除历史, trigger-collect, clear-previous-default
- `HotTopicController.retag(req)` — 对尚未 AI 归类的条目补跑一次归类 | keywords: 补跑归类接口, 未归类条目, retag-endpoint, untagged-items
- `HotTopicController.listItems(req, query)` — 分页返回当前热点采集榜并附带概况统计 | keywords: 榜单列表接口, 分页过滤, board-list-endpoint, paged-filter
- `HotTopicController.clearItems(req, dto)` — 清空当前榜单条目，可只清指定规则 | keywords: 清空榜单接口, 按规则清除, clear-items-endpoint, clear-by-rule
- `HotTopicController.listTags(req)` — 线性返回全部 AI 归类标签及条目数、分类与示例标题 | keywords: 采集标签接口, 线性查看标签, collected-tags-endpoint, linear-tag-view
- `HotTopicController.recommend(req, dto)` — 按母选题推荐热点，返回工具写入的结构化 JSON | keywords: 热点推荐接口, 母选题匹配, 结构化返回, recommend-endpoint, parent-topic-match, structured-response
- `HotTopicController.requireScope(req)` — 取出当前后台用户并组装数据作用域 | keywords: 当前后台用户, 数据作用域, require-admin-user, data-scope
- `HotTopicController.toHttpError(error)` — 把服务层业务错误码翻成带可读中文原因的 400 | keywords: 错误码翻译, 可读原因, error-code-mapping, readable-reason
- `HotTopicFetcherService.fetchRule(rule)` — 抓取并解析一条采集规则，失败收敛成 `{ ok:false, message }` 不抛异常 | keywords: 抓取榜单, 单规则容错, fetch-board, per-rule-tolerance
- `HotTopicFetcherService.validateEndpoint(endpoint)` — 只放行 http/https 公网地址，挡掉本机与内网网段 | keywords: 地址校验, 内网地址拦截, endpoint-validation, ssrf-guard
- `HotTopicFetcherService.isInternalHost(hostname)` — 判断主机名是否落在本机/内网网段 | keywords: 内网主机判定, 私网网段, internal-host-check, private-range
- `HotTopicFetcherService.requestJson(rule)` — 发起榜单 GET 并按文本解析 JSON，不看 Content-Type | keywords: 发起榜单请求, 文本解析JSON, request-board-json, parse-text-json
- `HotTopicFetcherService.resolveList(payload, listPath)` — 按点号路径取榜单数组，路径为空时自动探测 | keywords: 定位榜单数组, 自动探测, locate-board-array, auto-detect
- `HotTopicFetcherService.findFirstObjectArray(node, depth)` — 深度优先找第一个元素为对象的数组作为兜底探测 | keywords: 探测对象数组, 深度限制, detect-object-array, depth-limit
- `HotTopicFetcherService.readPath(source, path)` — 点号路径取值，纯数字段按数组下标处理 | keywords: 点号路径取值, 数组下标, dot-path-read, array-index
- `HotTopicFetcherService.normalizeItem(raw, fields, urlTemplate?)` — 按取值路径归一化条目，标题取不到即丢弃 | keywords: 归一化条目, 标题必填, normalize-item, title-required
- `HotTopicFetcherService.readText(raw, path?, maxLength)` — 按路径读短文本，数字转字符串，对象数组视为取不到 | keywords: 读取文本字段, 截断, read-text-field, truncate
- `HotTopicFetcherService.buildTemplateUrl(template?, title, raw)` — 填充地址模板占位符，`{title}` 用标题、其余按点号路径取值 | keywords: 拼接检索地址, 字段占位符, build-search-url, field-placeholder
- `HotTopicFetcherService.readErrorMessage(error)` — 把 fetch/超时/解析异常压成一行可读文本 | keywords: 错误可读化, 失败原因, readable-error, failure-reason
- `HotTopicRuleService.ensureIndexes()` — 建立规则业务 ID 唯一索引与作用域、启用、内置幂等索引 | keywords: 规则索引, 幂等约束, rule-indexes, idempotent-constraint
- `HotTopicRuleService.list(scope)` — 列出作用域内全部采集规则 | keywords: 列出采集规则, 管理页列表, list-collect-rules, admin-table
- `HotTopicRuleService.get(scope, id)` — 读取单条规则，越权按不存在处理 | keywords: 读取单条规则, 越权防护, get-rule, ownership-guard
- `HotTopicRuleService.resolveRunnableRules(scope, ruleIds?)` — 解析本次要跑的规则，停用规则一律不跑 | keywords: 解析待采集规则, 启用闸门, resolve-runnable-rules, enabled-gate
- `HotTopicRuleService.create(scope, input)` — 新建采集规则，地址先过内网拦截校验 | keywords: 新建采集规则, 地址校验, create-collect-rule, endpoint-validation
- `HotTopicRuleService.update(scope, id, input)` — 增量更新规则，解析配置变更后重置可用性 | keywords: 更新采集规则, 重置可用性, update-collect-rule, reset-health
- `HotTopicRuleService.remove(scope, id)` — 删除采集规则 | keywords: 删除采集规则, 预置可补回, delete-collect-rule, preset-restorable
- `HotTopicRuleService.seedPresets(scope)` — 按 `builtinKey` 幂等补齐内置预置规则，不覆盖已有 | keywords: 初始化预置规则, 幂等补齐, seed-builtin-rules, idempotent-fill
- `HotTopicRuleService.checkRule(scope, id)` — 真实抓取解析一次并回写可用性，只跑不落库 | keywords: 规则自检, 可用性探测, rule-self-check, availability-probe
- `HotTopicRuleService.saveHealth(ruleId, health)` — 回写可用性快照，自检与正式采集共用 | keywords: 回写可用性, 健康快照, save-health, health-snapshot
- `HotTopicRuleService.nextId()` — 生成规则业务自增 ID | keywords: 规则自增ID, 计数器, rule-auto-id, counter
- `HotTopicRuleService.scopeFilter(scope)` — 构造强制作用域过滤，空租户收口成三态匹配 | keywords: 作用域过滤, 空租户归一, scope-filter, null-tenant-normalization
- `HotTopicRuleService.normalizeCategory(value?)` — 分类收敛到合法枚举，非法值落 other | keywords: 归一分类, 枚举回落, normalize-category, enum-fallback
- `HotTopicRuleService.normalizeFields(fields?)` — 归一化字段取值路径，标题路径缺省 `title` | keywords: 归一字段路径, 默认标题路径, normalize-field-paths, default-title-path
- `HotTopicRuleService.normalizeHeaders(headers?)` — 归一化附加请求头，最多 10 条 | keywords: 归一请求头, 数量上限, normalize-headers, header-cap
- `HotTopicRuleService.normalizeTags(tags?)` — 归一化兜底标签，去空去重最多 5 个 | keywords: 归一兜底标签, 去重, normalize-default-tags, dedupe
- `HotTopicRuleService.normalizeLimit(value?)` — 保留条数收敛到 1-200，非法值回落 50 | keywords: 归一条数上限, 回落默认, normalize-limit, default-fallback
- `HotTopicItemService.ensureIndexes()` — 建立条目唯一索引与作用域、批次、规则、分类、标签索引 | keywords: 条目索引, 批次索引, item-indexes, batch-index
- `HotTopicItemService.insertMany(items)` — 批量写入采集条目并逐条分配业务自增 ID | keywords: 批量入库热点, 分配ID, bulk-insert-items, assign-id
- `HotTopicItemService.clear(scope, ruleIds?)` — 清空作用域内历史条目，可只清指定规则 | keywords: 清除历史热点, 采集前清库, clear-previous-items, pre-collect-purge
- `HotTopicItemService.list(scope, query)` — 分页查询榜单条目，支持分类/规则/标签/关键词过滤 | keywords: 分页查询榜单, 标签过滤, paged-item-list, tag-filter
- `HotTopicItemService.listCandidates(scope, query)` — 取推荐用候选热点，按名次升序截断 | keywords: 推荐候选热点, 候选截断, recommend-candidates, candidate-cap
- `HotTopicItemService.listTagNames(scope, limit?)` — 列出全部归类标签及条目数，不带示例标题的轻量清单，供推荐第一阶段标签粗筛 | keywords: 标签清单, 标签粗筛, tag-list, tag-prefilter
- `HotTopicItemService.applyTags(updates)` — 按 ID 批量回写归类结果，一次 bulkWrite | keywords: 回写归类标签, 批量更新, save-classified-tags, bulk-update
- `HotTopicItemService.listTagSummary(scope)` — 线性汇总全部归类标签及条目数、分类与示例标题 | keywords: 标签汇总, 线性查看标签, tag-summary, linear-tag-view
- `HotTopicItemService.summarize(scope)` — 统计榜单总条数、已归类条数与最近采集时间 | keywords: 榜单概况, 归类进度, board-summary, tagging-progress
- `HotTopicItemService.buildQueryFilter(scope, query)` — 组装条目查询过滤，作用域强制生效 | keywords: 组装查询条件, 作用域强制, build-query-filter, enforced-scope
- `HotTopicItemService.scopeFilter(scope)` — 构造强制作用域过滤，空租户收口成三态匹配 | keywords: 作用域过滤, 空租户归一, scope-filter, null-tenant-normalization
- `HotTopicItemService.reserveIds(count)` — 一次性预留连续条目 ID 段 | keywords: 预留自增ID, 连续段, reserve-auto-ids, id-block
- `HotTopicTaggingService.tagItems(items, fallbackTagsByRuleId, tenantId?)` — 分批 AI 归类并回写标签，模型漏写时按规则兜底 | keywords: 批量归类热点, 分批跑Agent, tag-hot-topics, chunked-agent-run
- `HotTopicTaggingService.runTaggingAgent(chunk, tenantId?)` — 跑一次归类 Agent，只保留工具写入的内存结果 | keywords: 执行归类Agent, 忽略最终文本, run-tagging-agent, ignore-final-text
- `HotTopicTaggingService.createTagTool(assigned, allowedIds)` — 归类工具，非本批 ID 与空标签一律拒绝 | keywords: 归类工具, 内存写入, tagging-tool, memory-write
- `HotTopicTaggingService.buildSystemPrompt(chunk)` — 构造归类提示词：热点清单、推荐词表与工具交付协议 | keywords: 构造归类提示词, 工具交付约束, build-tagging-prompt, tool-delivery-contract
- `HotTopicCollectService.collect(scope, input)` — 执行一次热点采集，默认先清后采并自动归类 | keywords: 执行热点采集, 采集批次, run-hot-topic-collect, collect-batch
- `HotTopicCollectService.collectOneRule(scope, rule, batchId)` — 采集单条规则并把真实结果回写可用性快照 | keywords: 单规则采集, 采集回写可用性, collect-one-rule, collect-health-writeback
- `HotTopicCollectService.retagPending(scope)` — 对尚未 AI 归类的条目补跑一次归类 | keywords: 补跑归类, 未归类条目, retag-pending, untagged-items
- `HotTopicRecommendService.recommend(scope, input)` — 两阶段推荐：标签粗筛 → 按标签取候选(不足回落全量) → 判定 Agent → 结构化结果 | keywords: 执行热点推荐, 两阶段推荐, 结构化返回, run-hot-topic-recommend, two-stage-recommend, structured-response
- `HotTopicRecommendService.selectRelevantTags(scope, parentTopic, brief?)` — 第一阶段标签粗筛，只收窄范围不做最终判断，选不出返回空数组 | keywords: 标签粗筛, 收窄候选范围, tag-prefilter, narrow-candidates
- `HotTopicRecommendService.createTagPickTool(picked, allowed)` — 标签粗筛工具，只接受清单内标签且拒绝重复超额 | keywords: 标签筛选工具, 清单约束, tag-pick-tool, list-constraint
- `HotTopicRecommendService.buildTagPrompt(parentTopic, brief?, tagRows)` — 构造粗筛提示词：母选题与带条目数的标签清单 | keywords: 构造粗筛提示词, 工具交付约束, build-tag-prompt, tool-delivery-contract
- `HotTopicRecommendService.runRecommendAgent(parentTopic, brief?, candidates, wanted, tenantId?)` — 跑一次推荐 Agent，异常时返回空结果不抛 500 | keywords: 执行推荐Agent, 忽略最终文本, run-recommend-agent, ignore-final-text
- `HotTopicRecommendService.createRecommendTool(picked, allowedIds, wanted)` — 推荐写入工具，只接受候选池内 ID 且拒绝重复超额 | keywords: 推荐写入工具, 候选池约束, recommendation-tool, candidate-pool-constraint
- `HotTopicRecommendService.buildSystemPrompt(parentTopic, brief?, candidates, wanted)` — 构造推荐提示词：母选题、候选清单与工具交付协议 | keywords: 构造推荐提示词, 工具交付约束, build-recommend-prompt, tool-delivery-contract

## 关键词索引 (Keyword Index)

| 中文关键词       | English keyword                | 定位                                                                  |
| ---------------- | ------------------------------ | --------------------------------------------------------------------- |
| 热点采集模块     | hot-topic-module               | 模块入口、控制器与业务服务                                            |
| 采集规则         | collect-rule                   | `hot_topic_rules` 集合：榜单地址 + 取值路径 + 启用开关                |
| 榜单直采         | board-http-fetch               | 平台进程内直接 fetch 公开榜单 JSON，不走节点也不计费                  |
| 内网地址拦截     | ssrf-guard                     | 规则地址只放行 http/https 公网地址，挡掉本机与私网网段                |
| 点号路径取值     | dot-path-read                  | `data.cards.0.content` 形态的嵌套取值，数字段按数组下标               |
| 自动探测         | auto-detect                    | 榜单数组路径留空时深度优先找第一个对象数组                            |
| 字段占位符       | field-placeholder              | 地址模板 `{title}` / `{contId}`，榜单不给直链时拼地址                 |
| 规则自检         | rule-self-check                | 真跑一次抓取解析但不落库，结果写进可用性快照                          |
| 是否可用         | availability-status            | 管理页那一列，读的是最近一次自检或采集的真实结果                      |
| 健康快照         | health-snapshot                | 规则上的 `health`：状态、时间、条数、失败原因、示例标题               |
| 重置可用性       | reset-health                   | 改地址或取值路径后 `health` 归 `unknown`，必须重新自检                |
| 预置规则         | builtin-presets                | 内置社会/娱乐各 4 条，按 `builtinKey` 幂等初始化                      |
| 幂等补齐         | idempotent-fill                | 已存在的一条都不覆盖，用户改过的内置规则不会被打回默认值              |
| 启用闸门         | enabled-gate                   | 停用规则即使被显式勾选也跳过，启用开关是唯一真实闸门                  |
| 默认清除历史     | clear-previous-default         | `clearPrevious` 缺省 true，热榜是当下快照不留旧批次                   |
| 采集批次         | collect-batch                  | 同一次采集共用的 `batchId`                                            |
| 单规则容错       | per-rule-tolerance             | 单条规则失效只体现在自己的回执与可用性上，不拖垮整次采集              |
| 热点归类         | hot-topic-classification       | 由 Agent 给条目打中文归类标签                                         |
| 归类工具         | tagging-tool                   | `hot_topic_set_tags`，标签只经工具写入运行内存                        |
| 推荐标签词表     | suggested-tag-vocabulary       | 建议词表而非硬性枚举，作用是让高频话题收敛不炸标签列表                |
| 标签来源         | tag-source                     | `ai` / `rule` / `none`，分得清哪些是真的 AI 归类结果                  |
| 线性查看标签     | linear-tag-view                | `GET /tags` 的标签汇总，后台弹窗逐条查看的数据源                      |
| 热点推荐         | hot-topic-recommend            | 按母选题反查当前榜单里适合的热点                                      |
| 母选题匹配       | parent-topic-match             | 推荐的唯一判据，带 0-100 契合度、匹配理由与切入角度                   |
| 候选池约束       | candidate-pool-constraint      | 工具只接受候选池内的 `hot_topic_id`，模型无法凭空造热点               |
| 两阶段推荐       | two-stage-recommend            | 先按标签粗筛圈定领域，再在该范围内看全部热点标题做判定                |
| 标签粗筛         | tag-prefilter                  | 第一阶段：只把标签清单给模型选相关领域，只收窄范围不做最终判断        |
| 收窄候选范围     | narrow-candidates              | 粗筛选不出标签或筛完不足 12 条时回落全量池，不把范围筛没              |
| 结构化返回       | structured-response            | 推荐结果全由工具写入，接口返回 JSON，不解析模型自然语言               |
| 工具交付约束     | tool-delivery-contract         | 归类与推荐共用的提示词协议：只走工具，最终文本不被读取                |
| 作用域过滤       | scope-filter                   | 租户 + 用户隔离，空租户收口成三态匹配                                 |

## 类型导出 (Type Exports)

- `HotTopicCategory` — 内容分类：`social` / `entertainment` / `tech` / `finance` / `lifestyle` / `other`。
- `HOT_TOPIC_CATEGORIES` — 分类枚举常量，DTO 校验与前端下拉共用同一份口径。
- `HOT_TOPIC_CATEGORY_LABELS` — 分类中文展示名映射。
- `HotTopicRuleHealthStatus` — 可用性状态：`unknown` / `ok` / `failed`。
- `HotTopicRuleHealth` — 可用性快照：状态、检查时间、解析条数、原因、示例标题。
- `HotTopicRuleFieldPaths` — 条目字段的点号取值路径（标题必填，链接/热度/摘要可选）。
- `HotTopicRuleEntity` — `hot_topic_rules` 中持久化的一条采集规则。
- `HotTopicItemEntity` — `hot_topic_items` 中持久化的一条已采集热点。
- `HotTopicCollectRuleOutcome` — 单条规则在一次采集中的执行回执。
- `HotTopicCollectResult` — 一次采集的整体结果：批次号、清除条数、入库条数、归类条数与逐规则回执。
- `HotTopicTagSummary` — 标签线性汇总项：标签、条目数、出现分类、最近时间与示例标题。
- `HotTopicRecommendation` — 单条推荐热点：热点 ID、标题、来源、标签、契合度、理由与切入角度。
- `HotTopicRecommendResult` — 推荐接口返回体：母选题、候选条数、粗筛命中的 `matchedTags`、是否真的按标签收窄过的 `tagFiltered`、推荐列表与生成时间。
- `HotTopicScope` — 数据作用域：租户 + 后台用户。
- `HotTopicRulePreset` — 内置预置规则的定义形状。
- `HOT_TOPIC_RULE_PRESETS` — 内置的 8 条社会/娱乐热点预置采集规则。
- `HOT_TOPIC_SUGGESTED_TAGS` — AI 归类的推荐标签词表。
- `HotTopicRuleWriteInput` — 规则新建/更新的服务层入参。
- `HotTopicItemQuery` — 榜单条目查询条件。
- `HotTopicCollectInput` — 一次采集的服务层入参。
- `HotTopicRecommendInput` — 推荐的服务层入参。
- `HotTopicFetchable` — 抓取所需的规则最小字段集合，自检与正式采集共用。
- `HotTopicFetchResult` / `ParsedHotTopic` — 一次抓取解析的结果与解析出的原始条目。

## 模块功能描述 (Module Description)

全部接口挂在 `/api/hot-topic` 下，统一走 `AdminAuthGuard + AdminPoliciesGuard`，每个入口同址声明 `@RequirePermission(action, 'HotTopic')`。动作按副作用切分：浏览榜单、看标签、看规则和调推荐都是 `read`，新建规则与触发采集是 `create`，改规则、自检和补跑归类是 `update`，删规则与清库是 `delete`。因此 `operator` 角色（只授 `read HotTopic`）能看榜单、能调推荐，但改不了采集规则；`tenant_admin` 授 `manage HotTopic` 拿到全部动作。`super_admin` 走 `manage all` 覆盖。

规则与条目分两张表：`hot_topic_rules` 是长期配置，`hot_topic_items` 是可以随时被清掉重采的当下快照。两张表都按「租户 + 后台用户」作用域隔离，空 `tenantId` 收口成 `$exists:false / null / ''` 三态匹配，与图库口径一致，母平台账号能读到历史缺失字段的数据。

`POST /rules/seed` 只补不覆盖，所以它既是首次开箱的初始化按钮，也是「误删了内置规则想补回来」的入口，随便点多少次都不会产生重复规则。

`POST /rules/:id/check` 与 `POST /collect` 都会写规则的 `health`，区别只是前者不落库。所以管理页不需要用户额外点自检——正常跑一轮采集，「是否可用」那一列就跟着刷新了；单独点自检是给「改完取值路径想立刻验证」用的。

`POST /collect` 的顺序是「解析待跑规则 → 按需清库 → 逐条规则直采入库 → 统一 AI 归类」。归类放在全部规则采完之后统一做，而不是每条规则采完就跑一次，这样同一批热点在同一次模型调用的上下文里归类，标签口径更一致，模型调用次数也更少。条目先以 `tags: []` / `tagSource: 'none'` 落库再回写标签，所以即使归类整体失败，榜单本身照样可见可用。

`GET /tags` 是「查看采集标签」弹窗的数据源：`$unwind` 标签后按命中条数倒序线性铺开，每个标签带出现过的分类、最近时间和最多 5 条示例标题，人工一眼就能判断 AI 归类有没有跑偏；点某个标签会把下方榜单过滤到该标签。

`POST /recommend` 是**纯后端结构化接口**，不依赖任何前端形态：入参母选题（可选补充说明、来源规则、分类、标签、条数），返回 `{ parentTopic, candidateCount, matchedTags, tagFiltered, recommendations[], generatedAt }`。候选上限按是否走了标签粗筛分两档：粗筛命中取 150 条（范围已经收窄过，多带一些才能让模型看到该领域下的全部标题），全量兜底取 80 条，都按名次升序。推荐条数上限 10。契合度打分要求拉开差距，且提示词明确「真正贴合的不足就少推，不要凑数」，所以 `recommendations` 可能短于请求条数甚至为空——这是设计内的正常返回，不是失败。`tagFiltered=false` 说明这次没能按标签收窄（榜单标签太少、粗筛没选出、或筛完条目不够），模型是在全量榜单里判定的。

后台入口在 [Admin 管理页](../../../web/src/ui/Admin/module.md) 的「热点采集榜」Tab，由 `HotTopicPanel.jsx` 承载。
