# PixMax OpenAPI 对接文档

> 来源：飞书知识库《Pixmax工具平台OpenAPI 接口文档》（https://pixmax-ai.feishu.cn/wiki/PdQBwWB6FiXdULk2QqNcohwsn4g，需登录），另参考《Pixmax 新手教程》。整理日期：2026-09-17。
> 官方文档会更新，接口字段以线上返回为准。模型清单见 [models.md](models.md)，结构化数据见 [models.json](models.json)。

## 1. 平台是什么

PixMax（https://www.pixmax.cn ，应用地址 https://app.pixmax.cn ）是一个面向 AI 内容创作的**无限画布工作流平台**，同时是一个**多模型中转站**：一个 API Key 可以调用文本、图片、视频、音频、3D 五类共 55 个模型（Seedance、Kling、Wan、MiniMax、Vidu、Hailuo、PixVerse、悠船、Doubao Seedream 等），统一按 PixMax 积分计费。

对接时需要记住它的组织方式：

- **项目（project）**：画布的容器，提交任务必须指定项目。建议按业务用途建项目，不要把所有测试堆在一个项目里。
- **节点（node）**：画布上的一个生成单元。OpenAPI 每提交一次任务，就在项目画布里产生一个节点，响应里的 `nodeUuid` 就是它。
- **资产（asset）**：上传的素材和生成结果，统一用 `assetsUuid` / `assetUuid` 引用。任务输入的图片、视频、音频必须先上传成资产。
- **任务（task）**：一次模型调用，异步执行，只能**轮询**任务详情，文档里没有回调或 webhook。

## 2. 基础约定

| 项 | 值 |
|---|---|
| 域名 | `https://app.pixmax.cn` |
| 接口前缀 | `/openapi` |
| 鉴权 | 请求头 `Authorization: Bearer <API_KEY>`，Key 归属某个 PixMax 用户，所有数据按该用户隔离 |
| 普通接口 | `Content-Type: application/json`，除两个 GET 外都是 POST（无参数时也可以传 `{}`） |
| 上传接口 | `multipart/form-data`，字段名 `file` |
| 时间 | 多数时间字段是秒级 Unix 时间戳字符串（如 `"1782821239"`）；任务的 `createTime` / `updateTime` 是 `2026-06-30T21:00:00` 格式；模型配置的 `updateTime` 是毫秒数字 |

### 统一响应结构

```json
{
  "success": true,
  "errCode": null,
  "errMessage": null,
  "data": {},
  "requestId": "f43d54b5-ba70-4569-83bc-427c1837b119",
  "releaseVersion": "2026-06-30 10:50:42"
}
```

- 以 `success` 判断成功；失败时读 `errCode` / `errMessage`。
- 分页接口有两种形状：项目列表把分页放在 `data` 里（`data.data`、`data.totalCount`…）；积分消耗记录把分页放在顶层（`data` 是数组，`totalCount`、`totalPages` 与 `data` 同级）。
- 文档只列出了一个错误码：限流 `OpenApi.RateLimit.Exceeded`（HTTP 429）。其他失败要靠 `errCode` 原样透传。

## 3. 接口一览

| # | 方法 | 路径 | 用途 |
|---|---|---|---|
| 1 | POST | `/openapi/model/available` | 当前 Key 可用的模型列表 |
| 2 | POST | `/openapi/project/createOrUpdate` | 新建或修改项目 |
| 3 | POST | `/openapi/project/list` | 项目列表 |
| 4 | POST | `/openapi/assets/upload` | 上传文件成为资产 |
| 5 | POST | `/openapi/assetLibrary/compliance/check` | 发起资产合规审核 |
| 6 | POST | `/openapi/task/submit` | 提交生成任务 |
| 7 | POST | `/openapi/task/detail` | 查询任务详情（轮询） |
| 8 | POST | `/openapi/task/credit/consumptions` | 任务积分消耗记录 |
| 9 | GET | `/openapi/credit/balance` | 积分余额 |
| 10 | GET | `/openapi/credit/pricing-configs` | 全部模型的积分定价配置 |
| 11 | POST | `/openapi/model/config/check` | 模型配置版本（MD5），用来判断是否需要刷新模型缓存 |

官方建议的调用顺序：取可用模型 → 创建项目拿 `projectUuid` → 上传资产（可选）→ 资产合规审核（可选）→ 提交任务 → 轮询任务详情 → 查询积分消耗（可选）。

## 4. 接口详解

### 4.1 获取可用模型 `POST /openapi/model/available`

请求体为空（可传 `{}`）。

```json
{
  "success": true,
  "data": [
    { "modelCode": "PIXDANCE_2", "modelName": "Seedance 2.0", "nodeType": "GENERATE_VIDEO" }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `data[].modelCode` | string | 模型编码，提交任务时 `params.model` 传这个值 |
| `data[].modelName` | string | 展示名 |
| `data[].nodeType` | string | 模型所属节点类型，见 [§5](#5-节点类型--资源类型) |

### 4.2 新增或修改项目 `POST /openapi/project/createOrUpdate`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `uuid` | string | 否 | 不传为新增；传入则更新该项目 |
| `name` | string | 是 | 项目名，最长 64 字符 |
| `description` | string | 否 | 项目描述 |

返回 `data` 为项目 UUID 字符串。

### 4.3 项目列表 `POST /openapi/project/list`

请求：`name`（名称筛选，可选）、`pageIndex`（从 1 开始）、`pageSize`。

| 返回字段 | 类型 | 说明 |
|---|---|---|
| `data.data[]` | array | 项目列表 |
| `data.totalCount` / `data.pageSize` / `data.pageIndex` | number | 分页信息 |
| `data.projectSets` | array | 项目集列表，仅在查询未加入项目集的项目且为第一页时返回 |
| `data.data[].uuid` / `name` / `description` | string | 项目基本信息 |
| `data.data[].projectType` | string | `PERSONAL`、`TEAM` |
| `data.data[].projectSetUuid` / `projectSetName` | string/null | 所属项目集 |
| `data.data[].subUserUuid` / `subUserAccount` / `subUserName` | string/null | 创建项目的子账号，主账号创建时为空 |
| `data.data[].creatorName` | string | 创建人展示名 |
| `data.data[].cover` | object/null | 封面，结构同资产对象 |
| `data.data[].status` | string | `ENABLED`、`DISABLED` |
| `data.data[].createTime` / `updateTime` | string | 时间 |

### 4.4 资产上传 `POST /openapi/assets/upload`

`multipart/form-data`，字段 `file`。提交任务时要引用的图片、视频、音频都必须先上传，把返回的 `data.assetsUuid` 放进 `inputAssetUuids`。

```bash
curl -X POST "https://app.pixmax.cn/openapi/assets/upload" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@/path/to/image.png"
```

**资产对象**（上传返回的 `data`，也是任务 `inputAssets[]` / `resultAssets[]` 和项目封面的结构）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `assetsUuid` / `assetUuid` | string | 资产 UUID，两个字段值相同 |
| `fileType` | string | 文件类型，示例值 `IMG`、`VIDEO` |
| `type` | string/null | 资产类型 |
| `webUrl` / `previewWebUrl` / `thumbnailWebUrl` | string | 原文件、预览图、缩略图的**相对路径** |
| `relativePath` / `previewPath` / `thumbnailPath` | string | 同上（上传返回里有） |
| `ossSynced` / `ossDomain` | boolean / string | 是否已同步 OSS 及其域名；**完整地址 = `ossDomain` + `webUrl`** |
| `fullUrl` | string/null | 完整 URL，示例里为 null，不能依赖 |
| `metaData` | object | `fileType`、`fileSize`（字节）、`fileExtension`、`width`、`height`；视频还有 `duration`（秒）、`frameRate`、`totalFrames` |
| `width` / `height` | number/null | 宽高（px），刚上传时可能为 null，以 `metaData` 为准 |
| `panorama` | boolean/null | 生成该图时是否开启全景 |
| `createTime` | string | 秒级时间戳 |
| `complianceStatus` | string/null | 合规检测状态：`PENDING`、`PROCESSING`、`ACTIVE`、`FAILED` |
| `complianceErrorMsg` / `complianceUpdateTime` | object/null | 合规检测错误与更新时间 |
| `assetId` / `assetName` / `assetType` / `assetSize` | — | 数据库 ID、文件名、资产类型、大小，示例里均为 null |
| `extValues` | object | 扩展字段 |

> 刚上传时 `ossSynced=false`、`ossDomain=""`，这时拿不到可直接访问的完整地址。结果资产（任务完成后）示例里都已同步 OSS。

### 4.5 资产合规审核 `POST /openapi/assetLibrary/compliance/check`

请求：`{ "assetUuid": "<上传返回的 assetUuid 或 assetsUuid>" }`。

| 返回字段 | 类型 | 说明 |
|---|---|---|
| `data.id` | number | 资产库组内项 ID |
| `data.assetUuid` | string | 资产 UUID |
| `data.syncStatus` | string | 兼容字段：`PENDING` 已写入组内待提交 / `PROCESSING` 已提交火山等待审核 / `ACTIVE` 同步成功且审核通过 / `FAILED` 同步或审核失败 |
| `data.auditStatus` | string | 审核状态：`Processing` / `Active` / `Failed`（注意大小写与其他状态不同） |
| `data.syncErrorMsg` | object/null | 兼容字段，同步错误 |
| `data.volcAssetId` | string/null | 火山资产 ID |
| `data.complianceStatus` / `complianceErrorMsg` | — | 同资产对象 |

- 同一用户对同一资产 **20 秒内**重复提交会被防重锁拦截。
- 限流：用户级 **QPS 2、QPM 100**，超限返回 HTTP 429，`errCode=OpenApi.RateLimit.Exceeded`，`errMessage=OpenAPI rate limit exceeded`。
- 文档把它列为可选步骤。审核走的是火山引擎，推测 Seedance 等火山系模型引用素材时需要审核通过，文档没有明说哪些模型强制要求，需要实测确认。

### 4.6 提交任务 `POST /openapi/task/submit`

```json
{
  "projectUuid": "xxx",
  "inputAssetUuids": ["xxx"],
  "inputTexts": ["文本1", "文本2"],
  "params": {
    "prompt": "一只小猫在奔跑",
    "resolution": "480P",
    "aspectRatio": "16:9",
    "duration": "4",
    "referModel": "imageToVideo",
    "includeAudio": "true",
    "count": "1",
    "model": "PIXDANCE_2",
    "nodeType": "GENERATE_VIDEO"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectUuid` | string | 是 | 项目 UUID，任务会作为节点落在该项目画布上 |
| `inputAssetUuids` | string[] | 否 | 输入资产（图片 / 视频 / 音频 / 分镜 / 3D），数量与格式受模型输入限制约束 |
| `inputTexts` | string[] | 否 | 输入文本节点，数量受模型「文本节点数量」约束 |
| `params` | object | 是 | 模型参数，**必须包含 `model`（模型编码）和 `nodeType`**，其余按 [models.md](models.md) |

返回 `data` 是任务对象（结构同 §4.7），初始 `status` 为 `QUEUE`，记下 `taskUuid` 用于轮询。

各类型的 `params` 示例：

```jsonc
// 文本
{ "prompt": "请帮我生成一段产品介绍文案。", "model": "DeepSeek V4 Flash", "nodeType": "GENERATE_TEXT" }
// 图片
{ "prompt": "生成一只小猫", "aspectRatio": "1:1", "model": "DOUBAO_SEEDREAM_5_PRO", "nodeType": "GENERATE_IMAGE" }
// 视频
{ "prompt": "一只小猫在奔跑", "resolution": "720P", "duration": "5", "referModel": "textToVideo",
  "includeAudio": false, "bitrateMode": "standard", "count": 1, "model": "PIXDANCE_2", "nodeType": "GENERATE_VIDEO" }
// 音频
{ "prompt": "一段优美的歌曲", "duration": 30, "model": "ElevenLabs Music", "nodeType": "GENERATE_AUDIO" }
// 3D
{ "referModel": "textTo3D", "prompt": "一款风格化的木质宝箱，带有金属装饰细节", "generateType": "Normal",
  "enablePBR": false, "faceCount": "300000", "polygonType": "triangle", "count": 1,
  "model": "Hunyuan 3D Pro 3.0", "nodeType": "GENERATE_3D" }
```

**视频的 `referModel`（生成模式）决定需要哪些输入**，以 Seedance 2.5 为例（各模型支持的模式不同，见 [models.md](models.md)）：

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需素材 |
| `referToVideo` | 参考素材生成 | 图片 + 视频 + 音频合计 1～50 个 |
| `imageToVideo` | 图生视频 | 图片恰好 1 个，`aspectRatio` 置为 `adaptive` |
| `firstAndLastFrame` | 首尾帧 | 图片恰好 2 个，`aspectRatio` 置为 `adaptive` |
| `videoEdit` | 视频编辑 | 视频恰好 1 个，`duration` 置为 `-1`，`aspectRatio` 置为 `adaptive` |
| `videoExtend` | 视频延长 | 视频恰好 1 个，`aspectRatio` 置为 `adaptive` |

其他模型还出现了 `lastFrameToVideo`（尾帧生成）、`imageRefer`（图片参考）。

### 4.7 查询任务详情 `POST /openapi/task/detail`

请求：`{ "taskUuid": "xxx" }`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskUuid` | string | 任务 UUID |
| `nodeUuid` | string | 画布节点 UUID |
| `createTime` / `updateTime` | string | 创建 / 更新时间；任务结束后 `updateTime` 即结束时间 |
| `status` | string | `QUEUE`、`RUNNING`、`COMPLETE`、`FAILED`、`ABORTED`、`RESOURCE_INSUFFICIENT` |
| `progress` | number | 进度百分比 |
| `userConcurrencyWaiting` | boolean/null | 是否因用户并发限制在等待调度 |
| `modelCode` / `modelName` | string | 模型 |
| `inputTexts` / `inputAssets` | array | 输入文本与输入资产 |
| `resultText` | string/null | 文本任务的结果 |
| `resultAssets` | array | 结果资产（资产对象）；视频地址 = `ossDomain` + `webUrl`，时长等在 `metaData` |
| `providerErrorMsg` | string/null | 模型供应商原始错误 |
| `replaceProviderErrorMsg` | string/null | PixMax 替换后的错误文案（更适合展示给用户） |
| `count` / `completedCount` / `failedCount` | number | 请求数量、已完成数量、失败数量（`count` > 1 时一个任务产出多个结果） |

任务状态归类：

| 状态 | 含义 | 归类 |
|---|---|---|
| `QUEUE` | 排队 | 进行中 |
| `RUNNING` | 生成中 | 进行中 |
| `COMPLETE` | 完成 | 成功（仍要看 `failedCount`，多结果时可能部分失败） |
| `FAILED` | 失败 | 失败 |
| `ABORTED` | 已中止 | 失败 |
| `RESOURCE_INSUFFICIENT` | 资源不足（积分不够） | 失败，提示充值 |

> 注意：积分消耗记录里的状态值是 `COMPLETED`，任务详情里是 `COMPLETE`，两处拼写不同。

### 4.8 任务积分消耗记录 `POST /openapi/task/credit/consumptions`

| 请求字段 | 类型 | 说明 |
|---|---|---|
| `status` | string | 按任务状态筛选，如 `COMPLETED` |
| `projectUuid` | string | 按项目筛选 |
| `startCreateTime` / `endCreateTime` | string | 秒级时间戳 |
| `pageIndex` / `pageSize` | number | 分页，页码从 1 开始 |

返回（分页在顶层）：`totalCount`、`pageSize`、`pageIndex`、`totalPages`、`empty`、`notEmpty`，以及 `data[]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `consumptionUuid` | string | 消耗记录 UUID |
| `taskUuid` / `projectUuid` / `projectName` | string | 关联任务与项目 |
| `userAccount` | string | 账号（脱敏） |
| `modelCode` / `modelName` | string | 模型 |
| `status` | string | 任务状态 |
| `estimatedCost` / `actualCost` | number | 预估 / 实际积分 |
| `owedAmount` | number | 欠费积分 |
| `totalCost` | number | 总积分 |
| `consumeDescription` | string/null | 消耗说明 |
| `createTime` | string | 秒级时间戳 |

### 4.9 积分余额 `GET /openapi/credit/balance`

返回 `data.totalBalance`（当前积分余额）。

### 4.10 积分定价配置 `GET /openapi/credit/pricing-configs`

返回全部模型的定价规则数组：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 规则 ID |
| `modelName` / `modelCode` / `nodeType` | string | 模型（示例里 `modelCode` 填的是展示名 `Seedance 2.0`，匹配时要兼顾名称） |
| `billingType` | string | 计费类型，示例 `TASK_PARAMS`（按任务参数组合计价） |
| `basePrice` | number | 基础价格 |
| `pricingConfig.selectedParams` | string[] | 参与组合计价的参数名，按顺序用 `||` 拼成组合键 |
| `pricingConfig.combinationPrices` | object | 无输入视频时的组合单价 |
| `pricingConfig.combinationPricesWithVideo` | object | 有输入视频时的组合单价 |
| `pricingConfig.isPerSecond` | boolean | 是否按秒计价（单价 × `duration`） |
| `pricingConfig.isInputVideo` | boolean | 是否区分输入视频 |
| `pricingConfig.imageExtraPrice` / `videoExtraPrice` / `audioExtraPrice` | number | 每额外一个图片 / 视频 / 音频输入的加价 |
| `discountType` / `discountRate` / `returnDiscountedPrice` | — | 折扣类型（如 `NONE`、`ACTIVITY`）、折扣系数、是否返回折后价 |
| `activityDiscountId` / `activityStartTime` / `activityEndTime` | — | 活动信息 |
| `currentTime` / `enabled` / `createTime` / `updateTime` | — | 系统时间、是否启用、时间戳 |

Seedance 2.0 的示例配置：`selectedParams = ["resolution", "includeAudio"]`，按秒计价。

| 组合键 | 无视频输入 | 有视频输入 |
|---|---|---|
| `480P||true` / `480P||false` | 4 / 3 | 5 / 4 |
| `720P||true` / `720P||false` | 8 / 6 | 10 / 8 |
| `1080P||true` / `1080P||false` | 16 / 12 | 20 / 15 |
| `4K||true` / `4K||false` | 32 / 24 | 40 / 30 |

`videoExtraPrice = 2`，其余加价为 0。

**计价公式**（以参数 `resolution=720P, includeAudio=true, duration=5, count=1` 为例）：

```text
组合键   = selectedParams 依次取值，用 "||" 连接 → "720P||true"
单价     = 组合价 × duration（isPerSecond 时）
无视频：  8 × 5 = 40；总价 = 40 × count + 输入加价(0) = 40
有视频：  10 × 5 = 50；总价 = 50 × count + videoExtraPrice(2) = 52
折扣价   = max(1, round(总价 × discountRate))   // discountType=ACTIVITY、rate=0.8、returnDiscountedPrice=true 时：max(1, round(40×0.8)) = 32
```

文档没有说明「额外输入加价」是按每个输入累加还是只加一次（示例只有 1 个视频），需要实测或以消耗记录的 `actualCost` 校准。

### 4.11 检查模型配置 `POST /openapi/model/config/check`

返回 `data.md5`（模型配置 MD5）与 `data.updateTime`（毫秒）。MD5 变化说明模型或参数配置更新了，这时再重新拉取可用模型和定价。

## 5. 节点类型 / 资源类型

`nodeType` 既是模型类型，也是画布上的资源类型：

| 值 | 含义 |
|---|---|
| `BASE_TEXT` / `GENERATE_TEXT` | 原始文本 / 生成文本 |
| `BASE_IMAGE` / `GENERATE_IMAGE` | 原始图片 / 生成图片 |
| `BASE_VIDEO` / `GENERATE_VIDEO` | 原始视频 / 生成视频 |
| `BASE_AUDIO` / `GENERATE_AUDIO` | 原始音频 / 生成音频 |
| `GENERATE_STORYBOARD` | 分镜 |
| `GENERATE_3D` | 生成 3D |

提交任务时 `params.nodeType` 只会用到 `GENERATE_*`。

模型输入限制的读法（详见 [models.md](models.md)）：

- 「文本节点数量」「文本总长度」约束 `inputTexts`。
- 「图片 / 视频 / 音频数量」及「合计数量」约束 `inputAssetUuids`。
- 「附加属性」是文件约束，例如 `{"type":"IMAGE","singleMaxSize":31457280,"totalMaxSize":67108864,"formats":["JPEG","PNG",...],"aspectRatio":{"mode":"range","min":"2:5","max":"5:2"},"resolution":{"min":{"width":300,"height":300},"max":{"width":6000,"height":6000}}}` 表示单文件 ≤30MB、合计 ≤64MB、宽高比 2:5～5:2、分辨率 300×300～6000×6000。视频 / 音频还有 `minDuration`、`maxDuration`、`totalDuration`（秒）、`maxFrameRate`，视频有像素总数 `area`。
- 参数的「前端类型」是画布控件：`text` 文本、`select` / `radio` 枚举、`switch` 开关、`range` / `stops` 滑块。数值和布尔在官方示例里有时是字符串（`"duration": "5"`、`"includeAudio": "true"`），有时是原生类型，两种写法都出现过。

## 6. 模型概况

共 55 个模型（整理时的文档快照）：

| 类型 | 数量 | 代表模型 |
|---|---|---|
| 文本 `GENERATE_TEXT` | 9 | Gen 3.1 Pro、Doubao Seed 2.1 Pro/Turbo、DeepSeek V4 Pro/Flash、MiniMax M3、GLM 5.2 |
| 图片 `GENERATE_IMAGE` | 17 | PixImage 2.5、Doubao Seedream 5.0 Pro/Lite、PixNano、悠船 V8/Niji、Qwen Image Edit、MiniMax Image、Image Upscale |
| 视频 `GENERATE_VIDEO` | 24 | Seedance 2.5/2.0/Fast/Mini/1.5、Wan 3.0/2.6、MiniMax H3、Vidu Q3/Q2、Kling V3/O1/2.6、PixVerse、Hailuo、HappyHorse、Video Upscale |
| 音频 `GENERATE_AUDIO` | 3 | MiniMax Speech 2.8 HD/Turbo、MiniMax Music 2.6 |
| 3D `GENERATE_3D` | 2 | Hunyuan 3D Pro 3.0/3.1 |

视频模型常见参数：`prompt`、`resolution`、`aspectRatio`（含 `9:16`，部分支持 `adaptive`）、`duration`、`referModel`、`includeAudio`、`count`，少数有 `bitrateMode`、`promptExtend`、`multiShot`、`frameRate`、`extendDuration`。Seedance 系列 `prompt` 的默认值是「保持无字幕，避免生成任何文字或字幕，不要生成 logo，不要生成水印。」。

## 7. 文档里的不一致与注意事项

1. **模型编码不统一**：接口示例用 `PIXDANCE_2`，模型清单里 Seedance 2.0 的编码是 `SEEDANCE_2_0`；文本 / 音频 / 3D 示例的 `model` 填的是展示名（`DeepSeek V4 Flash`、`ElevenLabs Music`、`Hunyuan 3D Pro 3.0`）；定价接口示例的 `modelCode` 也是展示名。**对接时一律以 `/openapi/model/available` 实时返回的 `modelCode` 为准**，定价匹配时同时比对编码和名称。`ElevenLabs Music` 不在模型清单里。
2. **状态值拼写**：任务 `COMPLETE`，积分消耗 `COMPLETED`；合规 `auditStatus` 是首字母大写（`Active`），其他状态全大写。
3. **结果地址是相对路径**，要自己拼 `ossDomain + webUrl`。要长期保存时应下载后转存到我们自己的存储，不要只存 PixMax 地址。
4. **没有回调**，只能轮询任务详情；`userConcurrencyWaiting=true` 表示被 PixMax 用户级并发限制卡住，属于正常排队。
5. **限流**只在合规审核接口写明（QPS 2 / QPM 100），其他接口没写，轮询要控制频率并处理 429。
6. **`count` 多结果**：一个任务可以产出 1/2/4 个结果，`resultAssets` 是数组，需要按 `completedCount` / `failedCount` 判断部分失败。
7. 任务详情的返回示例在文档里前半段缺失（从 `modelCode` 开始），字段以返回字段表为准。
8. **没有视频合并 / 拼接接口**。OpenAPI 只能「一次任务出一段视频」，文档里和多段相关的只有：
   - `videoExtend` 视频延长（Seedance 2.5、PixVerse V6，输入恰好 1 个视频，PixVerse 用 `extendDuration` 指定延长 5/8/10/15 秒）——在一段视频后续写，不是把多段拼起来；
   - `multiShot` 多镜头（Wan 2.6）——一次生成里包含多个镜头，时长仍受单次上限约束；
   - `referToVideo` 可以传多段视频，但它们只是参考素材，不会被拼进结果；
   - `firstAndLastFrame` 首尾帧——可用上一镜的末帧做下一镜首帧，让分镜衔接更自然。
   单次时长上限多在 15 秒左右（Seedance 2.5 为 30 秒），15–60 秒的整条短视频必须**逐镜生成后由我们自己合并**（ffmpeg 拼接、配音 / 字幕 / 转场），合成结果再入视频库。

## 8. 对接要点（给后台适配器基座的输入）

> 最终方案：不单独做适配器层，PixMax 作为「Ai提供商设置」里的一种提供商（`providerCode=pixmax`，按类别分别添加生图 / 生视频记录），由后台「工作流节点模型」为每个节点指定提供商与模型，见 `src/modules/workflow-model`。下表是 PixMax 能力与后台现有概念的对应，接入调用时参考。

PixMax 的能力与通用概念的对应：

| 通用能力 | PixMax 实现 | 说明 |
|---|---|---|
| 凭证 | `Authorization: Bearer <API_KEY>` | 按租户 / 平台作用域保存，参考现有 `tenant-credential` 的作用域规则 |
| 模型目录 | `model/available` + `model/config/check`（MD5 判断刷新）+ [models.json](models.json)（参数形状） | 统一成「模型编码、名称、能力类型、参数定义、输入限制」 |
| 工作空间 | `project/createOrUpdate`、`project/list` | PixMax 必需；其他平台可能没有，适配器内部按租户 / 业务懒创建并缓存 `projectUuid` |
| 素材上传 | `assets/upload`（+ 可选 `compliance/check`） | 统一成「把我们的图库 / 视频库素材换成平台素材 ID」，可按素材缓存避免重复上传 |
| 提交生成 | `task/submit` | 统一入参：能力类型、模型、提示词、输入素材、输入文本、模型参数 |
| 查询结果 | `task/detail` 轮询 | 统一状态：排队 / 运行 / 成功 / 失败 / 余额不足；结果资产拼完整 URL 后转存到图库或视频库 |
| 成本 | `credit/balance`、`credit/pricing-configs`、`task/credit/consumptions` | 用于预估扣费、对账，与我们的 `ai-billing` 服务点数做映射 |
| 合并成片 | 无 | 平台无关的自有步骤：分镜视频（+ 配音 / 字幕）用 ffmpeg 合成总片，不依赖任何适配器 |

现状：生视频已接入（`src/modules/pixmax` 客户端 + `douyin-workbench` 的 `DouyinPixmaxVideoService`，支持分镜模式与整片模式，流程为上传分镜画面 → 合规审核（火山系）→ 提交任务 → 后台轮询 → 转存视频库）；生图与文本暂未接入 PixMax。模型参数目录由本目录的 `models.json` 生成到 `src/modules/pixmax/entities/pixmax-model-catalog.ts`。
