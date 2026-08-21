# Gallery-Material-Styles Module

## 模块描述
AI 素材风格库子模块：给 `POST /gallery/ai-material` 提供一组可选的「视觉处理方式」预设，解决同一句描述反复生成时素材气质雷同的问题。

预设本身是一张静态注册表（`material-style.presets.ts`），每条只描述 **配色 / 笔触质感 / 描边方式 / 装饰元素语言**，刻意不描述版面结构、不含任何文字内容——`ai-material` 的产物是单主体、纯色背景、无文字的贴纸，排版由前端画布的文字图层和宫格模板负责。

调用方在 `stylePreset` 里传预设 `id`，或传保留值 `random` 让服务端每次现挑一条；传空或未知 id 时返回 `null`，走老的「纯描述词生成」分支，行为与加这个字段之前完全一致。

**参考图不在服务端**：每条预设对应的参考图打进桌面端安装包（`xhs-manger` 的 `src/workbench/views/design-editor/material-lab/style-presets/{id}.jpg`），只作为素材面板里给用户看的选择依据，不上传、不参与生图。服务端与安装包仅靠 `id` 对齐，接口也不下发缩略图地址。

**新增一条风格** = 本文件的注册表追加一条 + 安装包 `style-presets/` 放一张同名 `.jpg`，两处 `id` 必须逐字相同。

文件路径: `src/modules/gallery/material-styles`

## 功能描述及关键词

### material-style.presets.ts
风格预设静态注册表，纯数据。
- **关键词**: material-style-preset, style-registry, material-style-group, 素材风格预设, 风格注册表, 风格分组
- **类型**:
  - `MaterialStyleGroupId`: `'pop' | 'handwrite' | 'collage' | 'guochao' | 'clean'`
  - `MaterialStylePreset`: `{ id, label, group, summary, descriptor }`，其中 `descriptor` 是拼进提示词的风格描述，不对外下发
- **常量**:
  - `MATERIAL_STYLE_GROUPS`: 风格分组与中文展示名，供前端分区渲染 | keywords: material-style-group, 风格分组
  - `MATERIAL_STYLE_PRESETS`: 全部风格预设（当前 14 条，取自实拍参考图提炼） | keywords: material-style-preset, 素材风格预设

### services/material-style.service.ts
风格预设的查询与提示词拼装。
- **关键词**: material-style-service, resolve-material-style, random-style, build-style-prompt, 素材风格服务, 随机风格, 风格提示词
- **常量**:
  - `RANDOM_MATERIAL_STYLE` = `random`：随机风格的保留标识，与前端 `materialStyles.js` 同名常量必须逐字一致 | keywords: random-style, 随机风格
- **类型**:
  - `MaterialStyleOption`: `Pick<MaterialStylePreset, 'id' | 'label' | 'group' | 'summary'>`，对外下发字段，刻意不含 `descriptor`
- **函数**:
  - `listStyles()` — 列出全部风格预设与分组，供素材面板渲染风格选择区 | keywords: list-material-styles, material-style-group
  - `resolveStyle(id?)` — 按 id 解析预设，`random` 随机挑一条，空/未知 id 返回 null 表示不套风格 | keywords: resolve-material-style, random-style
  - `buildStylePrompt(preset)` — 把预设拼成提示词里的独立风格段落，并再声明一次「只借视觉处理、不要文字」 | keywords: build-style-prompt, style-paragraph

## 关键词索引

| 中文 | English |
| --- | --- |
| 素材风格预设 | material-style-preset |
| 风格注册表 | style-registry |
| 风格分组 | material-style-group |
| 风格选项 | material-style-option |
| 素材风格服务 | material-style-service |
| 素材风格列表 | list-material-styles |
| 解析风格 | resolve-material-style |
| 随机风格 | random-style |
| 风格提示词 | build-style-prompt |
| 风格段落 | style-paragraph |
| 风格预设结构 | material-style-shape |

## 鉴权说明
本子模块只提供 service，没有自己的 controller。对外入口 `GET /gallery/material-styles` 挂在 `GalleryController` 上，沿用该控制器统一的 `resolveAuthScope(req)`（Bearer token → `AdminService.getUserByToken`），与同模块其余入口一致；详见 `../module.md` 的「鉴权说明」。
