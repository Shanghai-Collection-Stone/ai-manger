# 模块名称 (Module Name)

素材工坊（material-lab）

# 概述 (Overview)

设计编辑器的素材子模块：素材面板分「内置 / AI 生成 / 我的上传」三个页签，支持本地上传素材和调后端 AI 生成贴纸素材；上传或生成的图片进入「图片特效」弹窗，用 WebGL2 在 GPU 上做去底（背景移除）、按图像形状的描边、投影与发光，处理结果以 PNG dataURL 落到画布图层。

# 文件清单 (File List)

- `gpuImageEffects.js`：WebGL2 特效引擎，六段片元着色器串成四背景色去底 + JFA 距离场 + 特效合成管线，并保留原 PNG 透明通道。
- `effectPresets.js`：特效分类与预设表，纯数据。
- `ImageEffectDialog.jsx`：图片特效弹窗，分类侧栏 + 预设缩略图实时预览 + 去底强度/背景取样/擦除恢复笔刷 + 应用到画布。
- `MaterialPanel.jsx`：素材面板，三页签、上传、AI 生成与素材列表。

# 函数清单 (Function List)

- `compileShader(gl, type, source)` — 编译单个着色器并抛出 GLSL 日志 | keywords: compile-shader
- `buildProgram(gl, fragmentSource)` — 链接片元程序并缓存 uniform 位置 | keywords: build-program
- `acquireContext()` — 惰性创建并复用共享 WebGL2 上下文与全部程序 | keywords: gpu-context
- `isGpuEffectsSupported()` — 检测浏览器能否跑 GPU 特效管线 | keywords: gpu-support-check
- `uniformOf(gl, entry, name)` — 读取并缓存 uniform 位置 | keywords: uniform-location
- `createTexture(gl, width, height, source)` — 创建 RGBA8 纹理，上传外部图像时翻 Y | keywords: create-texture
- `useNearest(gl, texture)` — 把种子纹理改成最近邻采样 | keywords: nearest-filter
- `renderPass(ctx, entry, target, width, height, setup)` — 执行一趟离屏或上屏渲染 | keywords: render-pass
- `parseColor(value, fallback)` — 解析 #rrggbb 为 0~1 RGB | keywords: parse-color
- `backgroundDistance(a, b)` — CPU 侧背景色距离，与着色器度量严格一致 | keywords: background-distance
- `measureRemovableArea(pixels, size, color, tolerance)` — 试算某候选色能去掉的连通面积占比 | keywords: measure-removable-area
- `estimateBackgroundColors(source, tolerance, pickedColors)` — 合并人工取样与自动候选色，按实际可去除面积选最多四种背景色 | keywords: estimate-background, dominant-color-histogram
- `sourceHasTransparency(source)` — 检测原图透明通道并避免重复去底 | keywords: source-alpha-check
- `deriveCutout(cutout)` — 把单条去底强度展开成引擎实际用的一整套阈值 | keywords: cutout-strength
- `resolvePadding(effect, scale)` — 计算特效需要外扩的像素边距 | keywords: effect-padding
- `renderImageEffect(source, effect, options)` — 跑完整 GPU 特效管线并返回结果画布 | keywords: render-image-effect, gpu-render
- `renderEffectToDataUrl(source, effect, options)` — 跑特效并输出 PNG dataURL | keywords: render-image-effect
- `decodeImageSource(input)` — 把 File/Blob/URL 解码成可上传 GPU 的位图 | keywords: decode-image
- `presetsOfGroup(groupId)` — 按分类筛出该页签的特效预设 | keywords: effect-group
- `readValue(effect, section, key, fallback)` — 读取特效配置字段并给缺省值 | keywords: read-effect-value
- `patchSection(effect, section, patch)` — 不可变改写特效配置的某个分组 | keywords: patch-effect
- `patchOutline(effect, index, patch)` — 改写或删除指定描边层 | keywords: patch-outline
- `Slider(props)` — 带数值回显的参数滑杆 | keywords: slider-field
- `ColorField(props)` — 颜色选择行 | keywords: color-field
- `SectionHead(props)` — 分组开关标题 | keywords: section-toggle
- `normalizedPoint(event)` — 将预览指针位置转换为可跨分辨率复用的坐标 | keywords: normalized-point
- `sampleBackgroundColor(source, point)` — 读取点击处邻域的背景取样色 | keywords: sample-background-color
- `applyCleanupStrokes(source, strokes)` — 以非破坏式遮罩合成擦除与恢复笔画 | keywords: apply-cleanup-strokes
- `ImageEffectDialog(props)` — 渲染图片特效弹窗 | keywords: image-effect-dialog
- `handlePickPreset(preset)` — 套用预设的装饰参数，完整保留已调好的去底成果 | keywords: effect-preset, keep-cutout
- `handleSampleBackground(event)` — 将点击残留色加入优先背景样本 | keywords: add-background-sample
- `handleBrushStart(event)` — 开始记录擦除或恢复笔画 | keywords: begin-cleanup-stroke
- `handleBrushMove(event)` — 追加笔刷轨迹并刷新轻量预览 | keywords: extend-cleanup-stroke
- `handleBrushEnd()` — 提交可保存、可撤销的笔画 | keywords: commit-cleanup-stroke
- `handleApply()` — 用导出分辨率重跑特效并回传结果与参数 | keywords: apply-effect
- `readImageUrl(image)` — 读取图库图片可展示地址 | keywords: material-image-url
- `MaterialPanel(props)` — 渲染素材面板三页签 | keywords: material-panel, material-tabs
- `loadMaterials(key)` — 按页签标签拉取素材列表 | keywords: material-list
- `handleUpload(fileList)` — 上传本地素材到图库并弹出特效面板 | keywords: material-upload
- `handleReferenceUpload(fileList)` — 上传一张只用于配色、字体气质和构成语言的生成风格参考图 | keywords: 风格参考图, style-reference-image
- `handleGenerate()` — 调后端生成 AI 素材并弹出特效面板 | keywords: ai-material-generate

# 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 素材面板 | material-panel |
| 素材页签 | material-tabs |
| 素材上传 | material-upload |
| 素材列表 | material-list |
| 素材地址 | material-image-url |
| AI素材生成 | ai-material-generate |
| 风格参考图 | style-reference-image |
| 图片特效 | image-effect-dialog |
| 特效预设 | effect-preset |
| 去底保留 | keep-cutout |
| 特效分类 | effect-group |
| 应用特效 | apply-effect |
| 特效编辑 | patch-effect |
| 描边层改写 | patch-outline |
| 参数读取 | read-effect-value |
| 参数滑杆 | slider-field |
| 颜色选择 | color-field |
| 分组开关 | section-toggle |
| 主色统计 | dominant-color-histogram |
| 去除面积评估 | measure-removable-area |
| 背景色距离 | background-distance |
| 去底强度 | cutout-strength |
| 透明通道检测 | source-alpha-check |
| 背景取样 | sample-background-color |
| 归一化坐标 | normalized-point |
| 清理笔刷 | apply-cleanup-strokes |
| 素材特效渲染 | render-image-effect |
| GPU渲染 | gpu-render |
| GPU上下文 | gpu-context |
| GPU支持检测 | gpu-support-check |
| 着色器编译 | compile-shader |
| 着色器程序 | build-program |
| 渲染趟次 | render-pass |
| 纹理创建 | create-texture |
| 最近邻采样 | nearest-filter |
| uniform位置 | uniform-location |
| 背景色估计 | estimate-background |
| 特效边距 | effect-padding |
| 颜色解析 | parse-color |
| 图像解码 | decode-image |

# 类型导出 (Type Exports)

- `UPLOAD_MATERIAL_TAG` — 上传素材的固定标签 `我的素材`。
- `AI_MATERIAL_TAG` — AI 生成素材的固定标签 `ai素材`，与后端 `gallery.controller.ts` 的同名常量必须一致。
- `EFFECT_GROUPS` / `EFFECT_PRESETS` — 特效分类与预设表。

# 模块功能描述 (Module Function Description)

素材面板分「内置 / AI 生成 / 我的上传」三个页签。「AI 生成」以文字描述决定素材内容，并可上传一张风格参考图；参考图只传递配色、字体气质、描边方式和构成语言，不复制其中具体文字与人物。服务端仍强制输出单主体、纯色背景和无文字：示例海报里的生日帽、心形、星芒等适合生成成图片素材层，标题文案应使用编辑器原生文字层，才能真正改字。生成结果进入特效面板去底后落成保留 `materialSrc` 与 `effect` 的可回改图层。

特效引擎（`gpuImageEffects.js`）全程在 GPU 上跑，六段片元着色器串成一条管线，共享一个惰性创建的 WebGL2 上下文（`acquireContext`），程序和 uniform 位置都缓存，反复调用不重建 GPU 资源：

1. **cutout** — 把 RGB 转 YCbCr，色度分量加权高于亮度（背景纯色时主体的明暗变化不会被误判成背景），算出每像素的「像背景」程度。

   背景色由 `estimateBackgroundColors` 给出，判据是**实际能去掉的面积**，不是出现次数。流程分两步：128² 降采样后按每通道 3bit 量化做直方图，取计数最高的 `CANDIDATE_COUNT`(8) 个桶作为**候选**（桶中心太粗糙，用桶内均值作实际颜色）；然后对每个候选调 `measureRemovableArea`，在降采样图上按该色做一次 CPU 连通洪水填充，统计「与画布边缘连通」的可去除面积占比，取占比最大的当选。

   之所以要按去除面积选而不是按出现次数：一个颜色出现得再多，只要它主要长在主体内部（艺术字的黑描边、被主体包住的同色区域），连通判定就到不了它，可去除面积自然很小，不会被误选成背景。反过来只按边框一圈采样也不行——「艺术字压在大块底色上、底色又和描边连成一片」这种素材，底色未必出现在最外沿。去除比例超过 `MAX_REMOVAL_RATIO`(0.92) 的候选直接判 0 分排除，那是会把主体一起吃光的异常解；一个候选都去不掉时退回出现次数最多的色，让用户自己调强度。自动候选最多两种，和用户点击残留取得的颜色合并、去重后最多四种，覆盖棋盘格、渐变底和局部色块残留。

   评估用的容差就是当前去底强度对应的 `strict`，所以**滑杆一动选色跟着重算**；CPU 侧的 `backgroundDistance` 与着色器里的 `bgDistance` 度量严格一致，否则评估结论会和 GPU 实际抠图结果对不上。8 个候选 × 16k 像素只有几毫秒，每次渲染重算无压力。

   输出两个通道：`r` 是**严格**判定，只认铁定是背景的像素，用来控制连通传播、防止顺着相近色钻进主体；`g` 是**宽松**判定，把主体边缘那圈混了背景色的抗锯齿像素也算进来。宽松阈值只比严格放开一档（`strict * 1.9 + 0.04`），够吃掉 1~3px 残边又不至于宽到能钻进主体。
2. **flood（两级）** — 只有与画布边缘连通的背景才算真背景。做法是门控膨胀 ping-pong：`bgness` 低的像素挡住传播，采样越界即视为外部种子，3×3 取最大值把外部标记从四边推进来。有了它，主体内部的白眼球、浅色高光这类与背景同色的区域不会被一起挖掉，这是纯阈值抠图做不到的。**关键在于分两级做**：降采样层（`FLOOD_SIZE`=192，`FLOOD_PASSES`=320 趟）解决长距离连通问题，因为 300+ 趟传播在 192² 上是毫秒级、放全分辨率完全跑不动；但降采样掩膜直接线性放大回全分辨率会把边界糊掉六七个像素（这正是早期版本"去底不干净"的主因），所以接着 `seedUpscale` 只把 `outside > 0.75` 的**确定外部核心**放大成种子、边界几个像素故意留空，再在全分辨率上跑 `⌈1/floodScale⌉ + REFINE_MARGIN` 趟同一个门控膨胀，把边界精确吸附回真实轮廓。全分辨率趟数很少，代价小，但边缘干净度提升是决定性的。
   全分辨率精修的最后 `FRINGE_PASSES`(3) 趟会把门控从严格通道切到宽松通道，做**边缘关联扩散**：只在已经确认与背景连通的地方，把紧贴着的那圈抗锯齿残边一并吃进来。这是「关联去除」的落点——判定放宽到能清掉残边，靠连通性保证不误伤主体。

3. **resolve** — alpha 用**宽松**判定算，但乘上「是否与画布边缘连通」这个门：`1 - bgness.g * outside`。于是同一个黑色，背景那片因为连通被去掉、主体内部的黑描边因为不连通被完整保留。接着按背景色反解半透明边缘的原色做去色溢出（despill），消掉黑边/绿边/白边。这一步输出**非预乘**，留给 refine 平滑完再预乘，否则边缘平滑会把背景色混进来。
4. **refine** — 边缘精修，对 alpha 做 3×3 加权平滑再用 `smoothstep(0.5 + choke ∓ feather, ...)` 重映射。一步同时解决三件事：去掉阈值造成的锯齿、按 `choke` 收边吃掉残留的背景光晕、用 `feather` 控制边缘软硬，顺带把孤立单像素噪点抹平。输出预乘 alpha 交给后续合成。
5. **jfaInit / jfaStep** — Jump Flooding 算外部距离场。种子坐标用 RGBA8 编码（x、y 各拆高低字节占两个通道），因此不依赖 `EXT_color_buffer_float` 之类的浮点纹理扩展，任何支持 WebGL2 的环境都能跑；步长从 2^⌈log2(N)⌉⁻¹ 折半到 1，只需 log2(N) 趟。种子纹理必须 `NEAREST` 采样，线性插值会把编码坐标混成非法值。
6. **composite** — 描边、投影、发光三种特效全部由这一张距离场推导，所以天然「按图像形状」走而不是矩形框：描边是 `d ≤ width` 的阈值带（±1px 过渡做抗锯齿）；投影是在 `v_uv - offset` 处采距离场，等价于把整个形状平移后取距离，因此投影也贴着形状；发光是 `pow(1 - d/radius, falloff)` 的衰减。合成顺序自下而上为 发光 → 投影 → 外层描边 → 内层描边 → 主体，全程预乘 alpha 的 source-over，最后一步转回非预乘交给画布。

朝向上有两个必须注意的点：GL 纹理原点在左下而画布原点在左上，所以上传外部图像时开 `UNPACK_FLIP_Y_WEBGL`，中间纹理是渲染出来的、同一套朝向不能翻；uv 的 y 轴朝上，预设里 `shadow.dy` 按「向下为正」书写，传进 shader 前取负。

分辨率分三档：预设缩略图 168px、大预览 560px、应用到画布 1024px（`THUMB_SIZE` / `PREVIEW_SIZE` / `EXPORT_SIZE`）。缩略图用 `requestAnimationFrame` 逐个切片渲染并按预设 id 缓存（`renderedRef`），且一律用 `THUMB_CUTOUT` 这套固定去底参数——缩略图只是给人看版式差别的，跟着右侧调参走会导致每拖一下滑杆整屏预设重算。特效外扩的边距由 `resolvePadding` 按描边宽度、投影可达距离和发光半径取最大值算出，画布按此外扩，描边和光晕不会被裁掉；预设里的长度单位都是 512px 工作分辨率下的像素，引擎按实际尺寸等比换算。

弹窗是四栏布局：分类侧栏 → 预设网格 → 大预览 + 确认按钮 → **参数设置面板**。预设只负责给描边/投影/发光这些装饰参数的一组初值（`handlePickPreset`），选完之后所有调整都在右侧设置面板里实时改，大预览随参数变化即时重渲。

**切预设不会动去底**：`handlePickPreset` 只替换装饰参数，`cutout` 整段（取样色 `backgroundColors`、去底强度、抠洞开关、擦除笔画 `manualStrokes`）原封不动带过去——预设表里所有预设的 `cutout` 本来就都等于 `DEFAULT_CUTOUT`、没带自己的去底调校，重置它只会逼用户对着同一张图重新取样一遍。预设显式关掉去底（「原图」）时只翻 `enabled` 标志，取样数据留在参数里，再开回来立刻恢复原来的抠图结果。同理，落到画布的图层保存的 `effect` 里就带着这些取样数据，重新打开特效弹窗由 `initialEffect` 回填，接着调也不用重新取样。设置面板分四组，每组带开关：**去底只有「去底强度」一条 0~1 的滑杆**、描边（可加到两层，每层宽度 + 颜色）、投影（横纵偏移 / 扩散 / 模糊 / 不透明度 / 颜色）、发光（半径 / 强度 / 衰减 / 颜色）。改写走 `patchSection` / `patchOutline` 两个不可变工具函数。

去底刻意只暴露一条参数：判定阈值、过渡带、收边、边缘软硬、去色溢出全部由 `deriveCutout` 从这一条推导，因为这几项本来就该同向变化（判定放宽就该配更狠的收边和更强的去色溢出），拆成五条只会让人调不出好结果。若自动判断仍有残留，用户可在预览切到「取样」点选残留色；对于只有局部才应删除或误删需找回的区域，可切到「擦除 / 恢复」笔刷。笔画以归一化坐标存进 `cutout.manualStrokes`，在预览和导出时都作为独立透明遮罩合成，因此可撤销并能在重新编辑时继续修改；原图带透明通道时则直接保留 alpha，不再二次按颜色扣图。

**特效是可回改的，不是一次性烘焙**。落到画布的素材图层会同时记住 `materialSrc`（原图地址）和 `effect`（这次的全部参数），选中该图层后右侧属性面板出现「编辑特效」按钮，重新打开弹窗时用 `initialEffect` 回填参数、`layerId` 标明目标图层，确认后 `applyMaterialEffect` 走 `updateLayer` **原地替换该图层的图和参数**、保留位置与尺寸，而不是再往画布上堆一张新图。只有不带 `layerId` 时才新增图层。

结果以 PNG dataURL 交给父组件，落成 `radius: 0` 的图片图层（圆角会裁掉描边），并且这类图层在画布上渲染时用 `object-contain` 且不加 CSS 阴影——去底后的素材带透明通道，`shadow-lg` 会沿外框画出一圈矩形阴影。用 dataURL 而不是再传回服务端，一是免去一次往返，二是 html2canvas 导出画布时 dataURL 不涉及跨域，所见即所得。
