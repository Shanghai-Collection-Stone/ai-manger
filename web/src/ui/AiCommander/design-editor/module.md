# 模块名称 (Module Name)

设计编辑器（design-editor）

# 概述 (Overview)

提供类似在线设计工具的左中右三栏编辑界面：选择多层复杂模板、从项目图库（`/gallery`）选图、把生成的拼图按画布格式拆成逐格可换的图片图层、圆角/椭圆形状与描边框设计、艺术字与 emoji 贴纸素材、直接拖动图层、控制点缩放尺寸、中心和基线吸附对齐、图层列表拖拽换位与排序/显隐/锁定，以及 PNG 导出。底部画板栏支持多画板（小红书多图内页）与自定义画板宽高，编辑区支持撤销重做、Esc/Delete/复制粘贴等快捷键，并可直接粘贴外部图片；从文章预览进入时以原图画板初始化，不自动套用模板。

# 文件清单 (File List)

- `DesignEditorView.jsx`：设计编辑器主视图、画布拖拽、素材选择、图层管理与图片导出。

## 子模块 (Sub Modules)

- `material-lab/` — 素材工坊子模块，详见 `material-lab/module.md`。承载素材面板三页签（内置 / AI 生成 / 我的上传）、素材上传与 AI 生成，以及基于 WebGL2 的 GPU 图片特效（去底 / 描边 / 投影 / 发光）。

# 函数清单 (Function List)

- `readGalleryImageUrl(image)` — 读取图库图片可展示地址 | keywords: gallery-image-select
- `readGalleryImageLabel(image)` — 读取图库图片在画布上的图层名称 | keywords: gallery-image-select
- `normalizeGalleryImages(value)` — 规整图库图片列表并过滤无地址记录 | keywords: gallery-image-select
- `normalizeGalleryTags(value)` — 规整图库标签列表 | keywords: image-tag-filter
- `readTemplateLayout(template)` — 读取模板版式配置并回落到首个模板 | keywords: template-layout
- `resolveTemplateImageSrcs(template, images)` — 按模板槽位数从图库依次挑默认图 | keywords: gallery-image-select, multi-image-template
- `readTemplateImageCount(template)` — 读取模板的图片槽位数量 | keywords: multi-image-template
- `createImageSlotLayers(slot, index, total, src, decor)` — 构建单个图片槽位的投影/图片/边框图层 | keywords: multi-image-template, template-layers
- `createChromeLayers(template, layout)` — 按 chrome 版式构建图片之外的标题与角标图层 | keywords: template-chrome, template-layers
- `createTemplateLayers(template, imageSrcs)` — 构建选定模板的初始可编辑图层（支持 1～5 图） | keywords: template-layers, multi-image-template
- `clamp(value, min, max)` — 限制画布坐标和尺寸的数值范围 | keywords: clamp
- `clampLayerPos(value, size, bound)` — 限制图层坐标，允许移出画板但至少留 24px 在画板内 | keywords: layer-drag, overflow-bounds
- `measureImageSize(src)` — 量出图片自然宽高并缓存，供图层框换算成原图比例 | keywords: natural-size, auto-fit
- `fitWidthBox(natural, size)` — 按占满画板宽度、高度随原图比例算图层框并纵向居中 | keywords: auto-fit, natural-size
- `outlineShadow(color, size)` — 用多重 text-shadow 模拟文字描边 | keywords: art-text
- `readRadiusValue(layer)` — 读取图层圆角在滑杆上的等效像素值 | keywords: layer-radius
- `resizeBox(box, handle, dx, dy, keepRatio, bounds)` — 按控制点方向计算缩放后的图层外框，允许各方向超出画板一个画板的量 | keywords: layer-resize, overflow-bounds
- `normalizeCanvasSize(size)` — 规整画板宽高到合法范围 | keywords: canvas-size
- `rescaleLayers(layers, from, to)` — 按新旧画板尺寸等比换算图层坐标、字号与圆角 | keywords: canvas-size, layer-resize
- `createBoard(template, size, imageSrcs)` — 新建画板并把模板图层换算到画板尺寸 | keywords: artboard
- `createArticleCoverTextLayers(board)` — 把封面主副标题元数据转换为可编辑文字图层 | keywords: 可编辑封面, 封面文字图层, editable-cover, cover-text-layers
- `createCollageImageLayers(collage, size)` — 把拼图画布格式按格子还原成一组独立图片图层 | keywords: 拼图画布格式, 可换图拼图, collage-canvas-format, swappable-collage
- `createArticleMaterialLayers(materials, size)` — 把自动封面素材还原成保留原图、特效参数与文字融合标记的独立图片图层 | keywords: 可编辑装饰素材, 图层分离, editable-decoration-material, separated-layers
- `createArticleBoard(src, board)` — 优先用独立照片底图创建封面，再加入图片素材；素材标记已融合文字时不再创建原生文字层，旧数据仍兼容；拼图按格子拆层 | keywords: 文章画板, 可编辑封面, 拼图画布格式, article-canvas-board, editable-cover, collage-canvas-format
- `isEditableTarget(target)` — 判断事件是否发生在输入框中 | keywords: clipboard-paste
- `readClipboardImage(file)` — 把剪贴板图片读成 dataURL 并量出原始宽高 | keywords: clipboard-paste
- `renderShortcutKey(key, scope)` — 渲染快捷键说明里的单个键帽 | keywords: editor-shortcut
- `DesignEditorView({ onBack, initialImageUrls?, initialBoards? })` — 渲染设计编辑器及其交互状态，将文章图组初始化为无模板画板；含字海报素材默认选中素材层，旧封面文案仍加载为可编辑文字图层 | keywords: design-editor, layer-management
- `patchBoard(boardId, updater)` — 更新指定画板 | keywords: artboard
- `setLayers(updater)` — 写入当前画板的图层 | keywords: layer-update
- `updateLayer(layerId, updater)` — 更新指定画布图层 | keywords: layer-update
- `syncHistoryState()` — 把撤销/重做栈深度同步给按钮禁用态 | keywords: undo-redo
- `beginHistory()` — 开启手势事务，一次拖拽只留一条撤销记录 | keywords: undo-redo
- `endHistory()` — 结束手势事务并丢弃空改动的快照 | keywords: undo-redo
- `undo()` — 撤销上一步编辑 | keywords: undo-redo
- `redo()` — 重做被撤销的编辑 | keywords: undo-redo
- `selectBoard(boardId)` — 切换当前画板并清空选中态 | keywords: artboard
- `addBoard()` — 在当前画板后追加同尺寸画板 | keywords: artboard
- `duplicateBoard(boardId)` — 复制画板及其全部图层 | keywords: artboard
- `deleteBoard(boardId)` — 删除画板，仅剩一个时禁止 | keywords: artboard
- `applyCanvasSize(size)` — 设置当前画板宽高并等比换算已有图层 | keywords: canvas-size
- `openSizePanel()` — 打开画板尺寸面板并回填当前尺寸 | keywords: canvas-size
- `applyZoom(value)` — 设定画板显示倍率并夹回 10%~400% | keywords: canvas-zoom
- `zoomBy(factor)` — 在当前倍率上按倍数放大缩小画板 | keywords: canvas-zoom
- `resetZoom()` — 画板缩放回到自动适应窗口 | keywords: canvas-zoom
- `handleSelectTemplate(template)` — 应用模板并重置画布内容 | keywords: select-template
- `loadGalleryImages(tag)` — 拉取图库图片供画布选图 | keywords: gallery-image-select
- `loadGalleryTags()` — 拉取图库标签用于选图筛选 | keywords: image-tag-filter
- `handleSelectImage(image)` — 把图库图片填入当前图片槽位并自动跳到下一个空槽位 | keywords: gallery-image-select, image-slot
- `handlePointerDown(event, layer)` — 开始图层拖拽 | keywords: layer-drag
- `handleLayerClick(event, layerId)` — 选择图层并阻止画布取消选中事件 | keywords: layer-selection
- `handleEditorKeyDown(event)` — 编辑器快捷键：Esc 退选、Delete 删层、Ctrl+Z/Y 撤销重做、Ctrl+C/X/D 复制剪切复用、方向键微调 | keywords: editor-shortcut, keyboard-nudge
- `handleEditorPaste(event)` — 粘贴外部图片或内部复制的图层 | keywords: clipboard-paste
- `handleResizePointerDown(event, layer, handle)` — 按下控制点开始缩放图层 | keywords: layer-resize
- `handleResizeMove(event)` — 跟随指针缩放图层，Shift 保持宽高比 | keywords: layer-resize
- `handlePointerMove(event)` — 移动或缩放图层并计算中心及相邻图层吸附参考线 | keywords: baseline-snap, neighbour-snap
- `handlePointerUp()` — 结束拖拽或缩放并隐藏参考线 | keywords: drag-end
- `moveLayerById(layerId, direction)` — 调整指定图层排序 | keywords: layer-order
- `moveLayer(direction)` — 调整选中图层排序 | keywords: layer-order
- `reorderLayer(sourceId, targetId)` — 将拖拽图层插入目标图层位置 | keywords: layer-reorder
- `handleLayerDragStart(event, layerId)` — 开始拖拽图层列表项 | keywords: layer-reorder
- `handleLayerDragOver(event, layerId)` — 拖拽经过目标图层时记录落点 | keywords: layer-reorder
- `handleLayerDrop(event, layerId)` — 在目标图层上释放并完成排序 | keywords: layer-reorder
- `handleLayerDragEnd()` — 结束图层拖拽并清理落点提示 | keywords: layer-reorder
- `dropIndicatorClass(layerId)` — 计算列表项的拖拽落点样式 | keywords: drop-indicator
- `nextLayerSpot(width, height)` — 计算新元素的默认摆放位置并逐个错开 | keywords: add-element
- `addTextPreset(preset)` — 按艺术字预设新增文字图层 | keywords: art-text
- `applyTextPreset(preset)` — 把艺术字样式套用到选中文字图层 | keywords: art-text
- `addSticker(emoji)` — 新增 emoji 贴纸图层 | keywords: sticker
- `addShapePreset(preset)` — 按形状预设新增色块图层 | keywords: sticker
- `addImageLayer(image)` — 把图库图片作为独立贴纸新增图层 | keywords: sticker, gallery-image-select
- `addMaterialLayer(material)` — 把素材面板 GPU 处理后的图片落成画布图层并记住原图与特效参数 | keywords: material-layer
- `applyMaterialEffect(result)` — 特效面板确认落点，带 layerId 则原地更新图层否则新增 | keywords: material-layer, effect-edit
- `applyLayerRadius(layerId, radius)` — 设置图层圆角并同步依附的边框投影 | keywords: layer-radius
- `addImageFrame(inset)` — 为选中图片生成同形状描边框图层 | keywords: image-frame
- `duplicateLayer()` — 复制选中图层 | keywords: duplicate-layer
- `copySelectedLayer()` — 把选中图层存进内部剪贴板 | keywords: clipboard-paste
- `pasteCopiedLayer()` — 粘贴内部剪贴板里的图层 | keywords: clipboard-paste
- `pasteImageLayer(image, name)` — 把外部粘贴的图片落成图层并收进画板 | keywords: clipboard-paste
- `deleteLayerById(layerId)` — 删除指定图层 | keywords: delete-layer
- `deleteLayer()` — 删除选中图层 | keywords: delete-layer
- `nextPaint()` — 等两帧确保导出前的状态已经画到屏幕上 | keywords: export-image
- `downloadSnapshot(snapshot, fileName)` — 触发一次 PNG 下载 | keywords: export-image
- `handleExport(all)` — 导出当前或全部画板为 PNG，导出前清掉选中效果并恢复 100% 缩放，html2canvas 点击时才动态加载 | keywords: export-image, lazy-import
- `renderLayer(layer)` — 渲染画布内的可拖动图层 | keywords: canvas-layer
- `renderResizeHandles(layer)` — 渲染选中图层的八个缩放控制点 | keywords: resize-handle
- `renderThumbLayer(layer)` — 渲染画板缩略图里的静态图层 | keywords: artboard
- `renderBoardCard(board, index)` — 渲染底部画板栏里的画板缩略卡片 | keywords: artboard
- `renderTemplateThumb(template)` — 渲染模板卡片里的图片槽位缩略示意 | keywords: multi-image-template
- `renderTemplateCard(template)` — 渲染单张模板卡片 | keywords: template-layout
- `toolButton(key, label, Icon)` — 渲染左侧编辑工具入口 | keywords: editor-tool

# 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 设计编辑器 | design-editor |
| 图层管理 | layer-management |
| 模板图层 | template-layers |
| 模板版式 | template-layout |
| 模板装饰层 | template-chrome |
| 多图模板 | multi-image-template |
| 原图画板 | original-image-board |
| 自适应铺满 | auto-fit |
| 原图比例 | natural-size |
| 溢出边界 | overflow-bounds |
| 图层拖拽 | layer-drag |
| 无模板初始化 | template-free-initialization |
| 可编辑封面 | editable-cover |
| 封面文字图层 | cover-text-layers |
| 拼图画布格式 | collage-canvas-format |
| 可换图拼图 | swappable-collage |
| 文章画板 | article-canvas-board |
| 素材选图 | image-picker |
| 图库选图 | gallery-image-select |
| 图片槽位 | image-slot |
| 圆角形状 | layer-radius |
| 图片描边框 | image-frame |
| 艺术字 | art-text |
| 贴纸素材 | sticker |
| 素材落图 | material-layer |
| 特效编辑 | effect-edit |
| 新增元素 | add-element |
| 标签筛选 | image-tag-filter |
| 图层选择 | layer-selection |
| 图层拖拽排序 | layer-reorder |
| 落点提示 | drop-indicator |
| 图层缩放 | layer-resize |
| 缩放控制点 | resize-handle |
| 键盘微调 | keyboard-nudge |
| 快捷键 | editor-shortcut |
| 撤销重做 | undo-redo |
| 复制粘贴 | clipboard-paste |
| 多画板 | artboard |
| 画板尺寸 | canvas-size |
| 画板缩放 | canvas-zoom |
| 基线对齐 | baseline-snap |
| 相邻对齐 | neighbour-snap |
| 导出图片 | export-image |
| 按需加载 | lazy-import |

# 模块功能描述 (Module Function Description)

编辑器以绝对定位图层作为画布模型。`CANVAS` 540×720（小红书 3:4）现在只是**模板的设计基准画布**，真实画布尺寸存在每个画板的 `size` 上，模板落到画板时由 `rescaleLayers` 按新旧尺寸等比换算（字号和圆角取长短边缩放的较小值，避免拉扁）。模板版式由 `templateLayouts[id].images` 描述图片槽位数组（每项含 `x/y/width/height/radius`，可选 `filter`），配合 `imageDecor`（`full` 投影+外扩 8px 边框、`frame` 贴边描边、`none` 无装饰）生成图片图层，再由 `createChromeLayers` 按 `chrome` 字段补文字装饰，两者拼成初始图层；`readTemplateLayout` 统一做版式读取和缺失回落，避免各处散写兜底。

模板全部按小红书图文的实际用法来做，以图片为主、装饰层压到最少，共两组八套，由 `TEMPLATE_GROUPS` 在模板面板里分组展示，`templates[*].group` 决定归属。全部模板都是满版排图：槽位铺满画布不留外边距，槽位之间只留 6px 缝，缝里透出 `template.bg` 的浅色渐变，`imageDecor` 一律 `none`。

「小红书封面」组：`cover-big-title` 单张满版底图 + 左上彩色标签胶囊 + 三行超大标题（`chrome: 'badge'`）；`cover-split` 上图下文，图片占上方 540×480，下方 240px 白底文字区放标题与副标题（`chrome: 'split'`）；`cover-duo` 左右两张竖图对比、大字压在中缝（`chrome: 'poster'`）；`photo-three` 上方 540×442 大主图 + 下方左右两小图；`photo-five` 上方 540×310 大主图 + 下方 2×2 四格。

「拼图内页」组统一用 `chrome: 'grid'`，装饰只剩 `title` 一层：和封面一样是画布正中的居中大标题（60px 白字，y 322），不放页码、序号、张数这类角标，其余全是图——`grid-hero`（一大三小：540×540 主图 + 底部三格）、`grid-four`（四宫格 2×2）、`grid-nine`（九宫格 3×3）。

`chrome` 四种版式的文字处理：`poster` / `badge` / `grid` 压在照片上，一律白字加 `POSTER_TITLE_SHADOW`（`outlineShadow` 粗描边 + 硬投影），保证任何底图上都读得清；`split` 因为落在白底板上，改用 `layout.ink` 深色字。模板卡片用 `renderTemplateCard` + `renderTemplateThumb` 按槽位坐标画出白色小方块示意版式；槽位图层 id 依次为 `image-main`、`image-2`…，跟随的投影/边框为 `<id>-shadow` / `<id>-frame`。

图片素材全部来自项目图库：`chatService.listGalleryImages({ imageType: 'regular', tag, limit: 120 })` 拉图、`chatService.listGalleryTags` 拉标签供下拉筛选，不再内置任何外链图片；模板初始的主视觉按 `templateLayouts[*].imageIndex` 对图库长度取模挑选，图库为空或尚未返回时该图层渲染虚线占位并在图库就绪后自动补图，选图会写入 `src` / `name` / `imageId`。选图面板顶部会列出「图 1 / 图 2 …」槽位按钮（空槽位标注"空"）和「正在替换：xxx」提示，**单图画板也会显示**（只有一个「图 1」），这样单图和拼图一样看得出点图库图片会替换哪一层；点按钮即选中对应图片图层，点图库图片填入当前槽位后自动跳到下一个空槽位，因此连点 N 张即可铺满 N 图版式；槽位归属只依赖画布选中态（`activeImageLayer` = 选中的图片图层，否则取第一个），点画布上的图和点槽位按钮等价。内置模板由照片、相框、投影、标题文字和少量装饰元素组成，且全部可独立编辑；对象会吸附到画布中心线，以及相邻可见图层的上下左右边缘和中心线，并显示来源标签的辅助线。图层列表只在左侧「图层」工具面板里，一处承担排序、显隐、删除；右侧只做选中对象的属性编辑。列表支持 HTML5 拖放换位：拖起条目后经过目标条目会以内阴影提示插入到其上方或下方，释放时把被拖图层整体移动到目标位置（非相邻交换），列表按数组倒序展示，顶部即最上层。左侧工具栏为 模板 / 图片 / 文字 / 素材 / 图层 五个面板。「文字」面板是 `TEXT_PRESETS` 驱动的艺术字库（粗体大标题、描边空心、贴纸厚描边、像素冒险、魔法学院、复古街机、霓虹发光、立体投影、优雅斜体、说明小字），点预设即新增图层，选中文字图层后在属性面板点同一组预设则只换样式保留文案；文字图层新增 `font` / `italic` / `shadow` 三个字段，描边和立体效果统一用多重 `text-shadow`（`outlineShadow`）实现——因为 html2canvas 支持 text-shadow，但不支持 `-webkit-text-stroke` 和 `background-clip: text`，所以这里刻意不做渐变字和 text-stroke，保证所见即所得地导出。「素材」面板由子模块 `material-lab/MaterialPanel` 承载，分三个页签：「内置」用本文件的 `STICKER_GROUPS`（emoji 贴纸，按像素冒险 / 魔法学院 / 通用装饰分组）和 `SHAPE_PRESETS`（圆形、方块、胶囊、圆环、细线、半透底板），都是纯数据，加一行即可扩充，emoji 落成文字图层、色块落成形状图层；「AI 生成」和「我的上传」由子模块自己拉图库、上传和调生图接口，处理完的图片通过 `onAddProcessedImage` 回调走 `applyMaterialEffect` 落图层，详见 `material-lab/module.md`。这类素材图层会带上 `materialSrc`（原图地址）和 `effect`（特效参数），选中后右侧属性面板出现「编辑特效」按钮，可重开特效弹窗接着改并**原地更新该图层**，不会新增图层；它们在画布上用 `object-contain` 渲染且不加 CSS 阴影，因为去底后的素材带透明通道、方形阴影会露馅。用户自有的角色素材也可以走图库：「图片」面板缩略图右上角的 `+`（`addImageLayer`）把图片作为独立贴纸新增图层，区别于点图本身的"替换当前槽位"。新增元素统一用 `nextLayerSpot` 落在画布中心并按图层数逐个错开，避免叠成一摞。

编辑状态是「多画板」模型：组件顶层状态是 `boards` 数组（每项含 `id` / `template` / `size` / `layers`）加 `activeBoardId`，原来的 `layers` / `setLayers` / `activeTemplate` 变成当前画板的派生值，`setLayers` 保持原签名（支持函数式更新）写回当前画板，所以画布、图层列表、属性面板的代码不用感知画板概念。从文章预览传入 `initialImageUrls` 时，每张图片使用 `ORIGINAL_IMAGE_TEMPLATE` 单独创建一个画板，不生成角标、渐变、`CREATIVE STUDIO` 或拼图装饰；同时传入 `initialBoards` 时，封面画板会通过 `createArticleCoverTextLayers` 把主副标题转换成独立文字图层并默认选中主标题、打开文字面板，内页仍只含一个铺满画板的 `image-main` 图层。单图画板是「空白画板 + 一张可自由摆放的图片图层」，不是「图片就是画板」：`templateLayouts['original-image']` 的槽位带 `autoFit: true`，图层装载后由 `measureImageSize` 量出原图自然宽高，再用 `fitWidthBox` 换成**占满画板宽度、高度随原图比例、纵向居中**的框，量完清掉 `autoFit` 标记。**一律铺满宽度，不因为算出的高度超过画板就缩回去**：比画板更竖的长图宁可上下溢出（`y` 为负，溢出部分被画板的 `overflow-hidden` 裁掉，也不会进 html2canvas 导出图），也不要左右露白边——图层本来就能拖能缩，画面由用户自己定。这一步在 `boards` 的 effect 里异步做，写入时置 `historyRef.current.skip` 不占撤销步数，和「图库就绪后自动补图」同一个套路；`rescaleLayers` 会把 `autoFit` 一起带过去，所以量出结果前改画板尺寸也能按新尺寸重新适配。原图比例和画板对不上时**画板会露出空白底**（`template.bg`），这是刻意的——图片要能被拖动和缩放，就不能钉死成整块画板。`objectFit` 仍是 `cover`：图层框本身已经等于原图比例，用户拖控制点把框改成别的比例时按裁切走，框内不会出现留白。

自动封面素材若带 `includesText: true`，表示主副标题已由模型生成并融入素材像素；`createArticleBoard` 此时只恢复照片底图和含字素材层，默认选中素材并打开「素材」面板，文字不能单独修改但整层仍可移动、缩放、隐藏和重开图片特效。没有该标记的历史数据继续通过 `createArticleCoverTextLayers` 恢复原生文字，避免旧封面丢字。

**图层可以移出画板**：拖拽、方向键微调统一走 `clampLayerPos`，边界是「至少留 `MIN_VISIBLE_SIZE`(24px) 在画板内」而不是「完全不许出画板」；`resizeBox` 的 `maxWidth` / `maxHeight` 也各放宽了一个画板的量。**这条是「图片可移动」的前提**——按老的 `clamp(x, 0, canvasSize.width - layer.width)` 夹法，一张铺满宽度的图横向可动范围正好是 0，怎么拖都不动。拼图画板的每一格本来就是独立图层，边界放宽后同样可以逐格拖动、缩放、拖出画板边缘。带 `collage` 的画板走拼图画布格式：`createCollageImageLayers` 按后端给的格子（拼图画布尺寸 + 每格 `src` / `x` / `y` / `width` / `height` / `objectFit`）等比换算到画板尺寸，落成 `image-main`、`image-2`… 一格一层的图片图层，**不再放合成好的整张拼图**，所以「图片」面板会自动列出「图 1 / 图 2 …」槽位按钮，点某一格再点图库图片就只换那一张，其余格子不动；格子不足 2 个或缺地址时回落到原来的整图单层画板。只有用户主动点击模板卡片后才调用 `handleSelectTemplate` 套用模板。底部画板栏列出全部画板缩略图（`renderBoardCard` + `renderThumbLayer` 用 `transform: scale` 缩放真实图层渲染），点击切换、`+` 追加同尺寸同模板的新画板、卡片右上/右下角悬停出现删除与复制；左下角按钮打开尺寸面板，提供小红书内页 3:4（540×720，默认）/ 方图 1:1 / 竖版 9:16 / 横版 16:9 四个预设加自定义宽高输入，改尺寸时当前画板的图层等比跟着缩放。编辑单位是导出像素的一半（导出固定 `scale: 2`），所以默认画板导出就是 1080×1440。画板缩放分两态：`zoom` 为 `null` 时跟随窗口自动适应（`fitScale` 用 ResizeObserver 量舞台可用空间算出，画板再大也看得全），手动缩放后 `zoom` 固定成具体倍率（10%~400%）。右下角的缩放控件是「− / 百分比 / ＋」一组，点百分比出下拉选 25%~300% 预设或「适应窗口」回到自动态；Ctrl/⌘ + 滚轮连续缩放、Ctrl + `+` / `-` 一档 20%、Ctrl + `0` 回到适应窗口。滚轮监听必须是 `stageRef` 上的**原生非被动监听器**，React 的 `onWheel` 挂在根节点且是 passive 的，在里面 `preventDefault` 拦不住浏览器整页缩放。改画板尺寸会把 `zoom` 复位成自动适应；导出时 `capturing` 强制按 100% 截图，缩放比例不会进图。舞台用 `flex` + 子元素 `m-auto` 居中而不是 `justify-center`，放大到超出可视区时左上角才不会被裁掉、能正常滚动。指针换算读 `getBoundingClientRect().width`，所以任何缩放下拖拽和吸附精度都不受影响。

撤销重做是整棵 `boards` 的快照栈（`historyRef.past/future`，上限 60 步）：变更由 `boards` 的 effect 自动入栈，350ms 内的连续变更（打字、拖滑杆）合并成一条；拖拽和缩放这类连续手势用 `beginHistory` / `endHistory` 包成一次事务，指针按下时压入手势前快照、抬起时若没有实际改动就把这条快照丢掉，另外在 window 上补了 `pointerup` / `pointercancel` 兜底，避免指针在画布外抬起把事务锁死。图库就绪后自动补图那次写入用 `historyRef.current.skip` 跳过，不占撤销步数。快捷键统一在 `handleEditorKeyDown`（挂 window，通过 ref 转发以免闭包读到旧状态）：Esc 退出选中（快捷键说明/特效弹窗/尺寸面板打开时先关它们）、Delete / Backspace 删除选中图层、Ctrl+Z 撤销、Ctrl+Shift+Z 或 Ctrl+Y 重做、Ctrl+C / Ctrl+X / Ctrl+D 复制剪切复用，`?` 开关快捷键说明，方向键微调（Shift 十像素）；焦点在输入框里时除 Esc（失焦）外一律放行给浏览器。顶栏「快捷键」按钮和 `?` 都会打开说明弹窗，内容由模块级的 `SHORTCUT_GROUPS` 纯数据驱动、`renderShortcutKey` 渲染键帽——**改键位必须同时改 `SHORTCUT_GROUPS`**，否则说明会和实现对不上。粘贴走独立的 `paste` 监听 `handleEditorPaste`：剪贴板里有图片文件（截图、系统或聊天软件复制的图）就 `readClipboardImage` 读成 dataURL 落成新图层，尺寸按最长边收进画板的 70%；纯文本是 `data:image/` 或图片直链时同样落图；否则粘贴 `copySelectedLayer` 存下的内部图层（可跨画板粘贴）。

导出前会先把 `selectedId` 清空、参考线清掉并把显示缩放强制回 100%（`capturing`），等两帧重绘后再截图，所以紫色选中框、八个控制点和操作提示都不会进图；多画板时 `handleExport(true)` 逐个切换画板、等重绘、逐张下载，文件名带序号。

圆角形状可直接编辑：图片和形状图层的属性面板提供「直角 / 圆角 / 胶囊 / 椭圆」四个预设加一条 0～短边一半的圆角滑杆，`radius` 允许存数字像素或 `'50%'`（椭圆），`readRadiusValue` 负责把 `'50%'` 折算成滑杆值；边框和投影图层用 `frameFor` 字段指向所依附的图片图层，`applyLayerRadius` 改图片圆角时会一并改这些跟随层，因此模板里的椭圆图框、描边、投影能保持同一形状。`addImageFrame(inset)` 为选中图片新建同圆角的描边框图层（默认外扩 8px，透明填充 + 1px 描边），用于自行搭出模板那种椭圆相框。选中对象后画布上会浮出八个控制点：四角与四边均可拖拽改变尺寸，对边/对角保持锚定，按住 Shift 保持原始宽高比，最小 24px、最大可超出画板一个画板的量；右侧属性面板同时提供宽/高数值输入，图片图层另有以首次缩放尺寸（`baseWidth` / `baseHeight`）为基准的等比缩放滑杆。PNG 导出使用浏览器端 html2canvas 生成，无需服务端任务。
