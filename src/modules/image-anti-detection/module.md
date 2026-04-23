# Image-Anti-Detection Module

## 模块描述
抗AI识别模块：对 AI 生图 / 拼图 / 烧字封面等图片在落盘前进行"去AI特征"处理，
降低被"AI生图检测器"识别的概率。处理手段分 5 层：
- L1 元数据剥离 (EXIF/XMP/ICC)
- L2 亮度 / 饱和度随机抖动 (modulate)
- L3 颗粒 / 噪点叠加 (SVG 稀疏噪点层)
- L4 极微量 resize 重采样 + JPEG 质量随机重编码 (模拟手机截屏压缩链路)
- L5 gamma / linear 微调 (打乱颜色直方图统计特征)

参数在每次调用随机化，避免批量指纹。模块声明为 `@Global()`，全局可注入。

文件路径: `src/modules/image-anti-detection`

## 功能描述及关键词

### services/anti-detection.service.ts
抗AI识别核心服务。
- **关键词**: anti detection, remove ai fingerprint, sharp pipeline, noise, grain, exif strip, resample, jpeg recompress, gamma
- **函数**:
  - `process`: Buffer 入口，多层处理后返回新 Buffer/mimeType/appliedParams / process image buffer with anti detection pipeline
  - `pickParams`: 依据强度档位随机生成本次处理参数 / pick randomized anti detection params
  - `buildNoiseSvg`: 构建稀疏随机噪点 SVG 层 / build sparse noise svg layer
  - `resolveFinalFormat`: 根据偏好与源格式决定输出格式 / resolve final output format
  - `loadSharp`: 兼容加载 sharp（缓存） / load sharp with module interop cache
  - `clampInt`: 整数 clamp / clamp integer value

### types/anti-detection.types.ts
类型定义。
- **关键词**: types, anti detection options, anti detection result, strength preset, output format
- **类型**:
  - `AntiDetectionStrength`: 强度档位 (light | standard | strong)
  - `AntiDetectionOutputFormat`: 输出格式偏好 (keep | jpeg | png)
  - `AntiDetectionOptions`: 处理选项
  - `AntiDetectionResult`: 处理结果

### image-anti-detection.module.ts
NestJS 模块声明（`@Global()`，导出 AntiDetectionService）。
- **关键词**: module declaration, global provider

## 接入点（调用方）
- `ai-agent/services/agent.service.ts::saveGeneratedImageBuffer`：AI 原始生图落盘前唯一处理点（standard 档）。
  所有 AI 生图（Gemini / 豆包-Doubao / 即梦 / 美图 等提供商）的 base64/URL 下载结果都会汇流到此函数，因此源头处理一次即可覆盖全部 AI 生图产物。
  非 AI 路径（图库拼图、用户真实图烧字封面）不做处理，保留真实图质感。
