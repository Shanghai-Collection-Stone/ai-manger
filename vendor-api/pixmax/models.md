# PixMax 模型清单

> 由官方飞书文档「PixMax 模型配置」整理，结构化原始数据见同目录 `models.json`。模型以 `POST /openapi/model/available` 的实时返回为准，本清单用于理解参数形状与做适配器映射。

- `params.model` 传**模型编码**，`params.nodeType` 传模型类型；其余参数按下表，数值型参数在官方示例里多以字符串传递（如 `"duration": "5"`）。
- 「输入限制」对应提交任务的 `inputTexts`（文本）与 `inputAssetUuids`（图片 / 视频 / 音频，需先上传）。
- 「前端类型」是 PixMax 画布里的控件类型，`range` / `stops` 是滑块，`select` / `radio` 是枚举。

## 总览

| 类型 | 模型名称 | 模型编码 | 参数 |
|---|---|---|---|
| 文本生成 | Gen 3.1 Pro | `GEN_3_1_PRO` | prompt |
| 文本生成 | Doubao Seed 2.1 Pro | `DOUBAO_SEED_2_1_PRO` | prompt |
| 文本生成 | Doubao Seed 2.1 Turbo | `DOUBAO_SEED_2_1_TURBO` | prompt |
| 文本生成 | Doubao Seed 2.0 Pro | `DOUBAO_SEED_2_PRO` | prompt |
| 文本生成 | Doubao Seed 2.0 lite | `DOUBAO_SEED_2_LITE` | prompt |
| 文本生成 | DeepSeek V4 Pro | `DEEPSEEK_V4_PRO` | prompt |
| 文本生成 | DeepSeek V4 Flash | `DEEPSEEK_V4_FLASH` | prompt |
| 文本生成 | MiniMax M3 | `MINIMAX_M3` | prompt |
| 文本生成 | GLM 5.2 | `GLM_52` | prompt |
| 图片生成 | PixImage 2.5 Flare | `PixImage_2.5_Flare` | prompt, quality, resolution, aspectRatio, count |
| 图片生成 | PixImage 2.5 Sunburst | `PixImage_2.5_Sunburst` | prompt, quality, resolution, aspectRatio, count |
| 图片生成 | Doubao Seedream 5.0 Pro | `DOUBAO_SEEDREAM_5_PRO` | prompt, resolution, aspectRatio, count |
| 图片生成 | PIX Image 2 | `PIX_IMAGE_2` | prompt, quality, resolution, aspectRatio, count |
| 图片生成 | PixNano Pro | `PIX_NANO_PRO` | prompt, resolution, aspectRatio, count |
| 图片生成 | PixNano 2 | `PIX_NANO_2` | prompt, resolution, aspectRatio, count |
| 图片生成 | 悠船 V8.2 | `MIDJOURNEY_V8_2` | prompt, aspectRatio, count |
| 图片生成 | 悠船 V8.1 | `MIDJOURNEY_V8_1` | prompt, aspectRatio, count |
| 图片生成 | 悠船 V7 | `MIDJOURNEY` | prompt, aspectRatio, count |
| 图片生成 | 悠船 Niji V7 | `MIDJOURNEY_NIJI_7` | prompt, aspectRatio, count |
| 图片生成 | Doubao Seedream 5.0 Lite | `JIMENG_5_LITE` | prompt, resolution, aspectRatio, count |
| 图片生成 | Doubao Seedream 4.5 | `DOUBAO_SEEDREAM_4_5` | prompt, resolution, aspectRatio, count |
| 图片生成 | Qwen Image Edit Max | `QWEN_IMAGE_EDIT_MAX` | prompt, resolution, aspectRatio, count, promptExtend |
| 图片生成 | MiniMax Image 01 | `MINIMAX_IMAGE_01` | prompt, aspectRatio, count |
| 图片生成 | Qwen Image Edit Plus | `QWEN_IMAGE_EDIT_PLUS` | prompt, resolution, aspectRatio, count, promptExtend |
| 图片生成 | MiniMax Image 01 Live | `MINIMAX_IMAGE_01_LIVE` | prompt, aspectRatio, count, styleType |
| 图片生成 | Image Upscale | `IMAGE_UPSCALE` | superResolutionType, resolution |
| 视频生成 | Seedance 2.5 | `SEEDANCE_2_5` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, outputFormat, count |
| 视频生成 | Seedance 2.0 | `SEEDANCE_2_0` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, bitrateMode, count |
| 视频生成 | Seedance 2.0 Fast | `SEEDANCE_2_0_FAST` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, bitrateMode, count |
| 视频生成 | Seedance 2.0 Mini | `SEEDANCE_2_0_MINI` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, bitrateMode, count |
| 视频生成 | Wan 3.0 | `WAN3_0` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, promptExtend, count |
| 视频生成 | Wan 3.0 Prime | `WAN3_0_PRIME` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, promptExtend, count |
| 视频生成 | MiniMax H3 | `MINIMAX_H3` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | MiniMax H3 Max | `MINIMAX_H3_MAX` | prompt, resolution, aspectRatio, duration, referModel, count |
| 视频生成 | Vidu Q3 Pro | `VIDU_Q3_PRO` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Vidu Q3 Mix | `VIDU_Q3_MIX` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Vidu Q2 Pro | `VIDU_Q2_PRO` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | HappyHorse 1.1 | `HAPPYHORSE_11` | prompt, resolution, aspectRatio, duration, referModel, count |
| 视频生成 | Seedance 1.5 Pro | `SEEDANCE_1_5` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | HappyHorse 1.0 | `HAPPYHORSE_10` | prompt, resolution, aspectRatio, duration, referModel, count |
| 视频生成 | Kling V3 Omni | `KLING_V3_OMNI` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Kling V3 | `KLING_V3` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Kling O1 | `KLING_O1` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Kling 2.6 | `KLING_2_6` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | PixVerse V6 | `PIXVERSE_V6` | prompt, resolution, aspectRatio, duration, extendDuration, referModel, includeAudio, count |
| 视频生成 | PixVerse C1 | `PIXVERSE_C1` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, count |
| 视频生成 | Hailuo 2.3 | `HAILUO_23` | prompt, resolution, duration, referModel, includeAudio, count |
| 视频生成 | Hailuo 02 | `HAILUO_02` | prompt, resolution, duration, referModel, includeAudio, count |
| 视频生成 | Wan 2.6 | `WAN2_6` | prompt, resolution, aspectRatio, duration, referModel, includeAudio, promptExtend, multiShot, count |
| 视频生成 | Video Upscale | `VIDEO_UPSCALE` | resolution, frameRate |
| 音频生成 | MiniMax Speech 2.8 HD | `MINIMAX_SPEECH_28_HD` | prompt, timbreId, speed, vol, pitch, voiceModifyPitch, voiceModifyIntensity, voiceModifyTimbre, voiceModifySoundEffects |
| 音频生成 | MiniMax Speech 2.8 Turbo | `MINIMAX_SPEECH_28_TURBO` | prompt, timbreId, speed, vol, pitch, voiceModifyPitch, voiceModifyIntensity, voiceModifyTimbre, voiceModifySoundEffects |
| 音频生成 | MiniMax Music 2.6 | `MINIMAX_MUSIC_26` | musicMode, prompt, lyrics |
| 3D 生成 | Hunyuan 3D Pro 3.0 | `HUNYUAN_3D_PRO_30` | referModel, prompt, generateType, enablePBR, faceCount, polygonType, count |
| 3D 生成 | Hunyuan 3D Pro 3.1 | `HUNYUAN_3D_PRO_31` | referModel, prompt, generateType, enablePBR, faceCount, count |

## 文本生成（GENERATE_TEXT）

### Gen 3.1 Pro（`GEN_3_1_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14（PNG/JPEG/JPG/WEBP/HEIC/HEIF，合计≤98MB）
- 视频数量：0~10（FLV/MOV/MPEG/MPG/MP4/WEBM/WMV/3GPP，时长 0~2700s）
- 音频数量：0~10（AAC/FLAC/MP3/M4A/MPEG/MPGA/MP4/OGG/WAV/WEBM，单个≤15MB，时长 0~30240s）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |

### Doubao Seed 2.1 Pro（`DOUBAO_SEED_2_1_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14
- 视频数量：0~10

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### Doubao Seed 2.1 Turbo（`DOUBAO_SEED_2_1_TURBO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14
- 视频数量：0~10

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### Doubao Seed 2.0 Pro（`DOUBAO_SEED_2_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14
- 视频数量：0~10

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### Doubao Seed 2.0 lite（`DOUBAO_SEED_2_LITE`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14
- 视频数量：0~10

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |

### DeepSeek V4 Pro（`DEEPSEEK_V4_PRO`）

**输入限制**

- 文本节点数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### DeepSeek V4 Flash（`DEEPSEEK_V4_FLASH`）

**输入限制**

- 文本节点数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### MiniMax M3（`MINIMAX_M3`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14（JPEG/JPG/PNG/GIF/WEBP，单个≤10MB，合计≤64MB）
- 视频数量：0~10（MP4/AVI/MOV/MKV，单个≤50MB，合计≤64MB）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

### GLM 5.2（`GLM_52`）

**输入限制**

- 文本节点数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |

## 图片生成（GENERATE_IMAGE）

### PixImage 2.5 Flare（`PixImage_2.5_Flare`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~16

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `quality` | 质量档位 | string | 是 | medium | low、medium、high、xhigh、max<br>展示：Low、Medium、High、XHigh、Max | select |
| `resolution` | 分辨率 | string | 是 | 1K | 1K、2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、1:3、3:1、3:2、2:3、4:3、3:4、4:5、5:4、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### PixImage 2.5 Sunburst（`PixImage_2.5_Sunburst`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~16

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `quality` | 质量档位 | string | 是 | medium | low、medium、high、xhigh、max<br>展示：Low、Medium、High、XHigh、Max | select |
| `resolution` | 分辨率 | string | 是 | 1K | 1K、2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、1:3、3:1、3:2、2:3、4:3、3:4、4:5、5:4、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### Doubao Seedream 5.0 Pro（`DOUBAO_SEEDREAM_5_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~10（JPEG/PNG/WEBP/BMP/TIFF/GIF/HEIC/HEIF，单个≤30MB，宽高比 1:16~16:1，分辨率 15x15~不限，像素 undefined~36000000）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 1K、2K | select |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### PIX Image 2（`PIX_IMAGE_2`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~16

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `quality` | 质量档位 | string | 是 | medium | low、medium、high<br>展示：Low、Medium、High | select |
| `resolution` | 分辨率 | string | 是 | 1K | 1K、2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | auto | 1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、9:21、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### PixNano Pro（`PIX_NANO_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14（JPEG/PNG/WEBP/HEIC/HEIF，单个≤50MB，合计≤98MB）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 1K、2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9<br>展示：Auto、1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### PixNano 2（`PIX_NANO_2`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14（JPEG/PNG/WEBP/HEIC/HEIF，单个≤50MB，合计≤98MB）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 1K、2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、1:1、1:4、1:8、2:3、3:2、3:4、4:1、4:3、4:5、5:4、8:1、9:16、16:9、21:9<br>展示：Auto、1:1、1:4、1:8、2:3、3:2、3:4、4:1、4:3、4:5、5:4、8:1、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### 悠船 V8.2（`MIDJOURNEY_V8_2`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 4 | 4<br>展示：4x | select |

### 悠船 V8.1（`MIDJOURNEY_V8_1`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：4x | select |

### 悠船 V7（`MIDJOURNEY`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：4x | select |

### 悠船 Niji V7（`MIDJOURNEY_NIJI_7`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、16:9、9:16、21:9、9:21 | select |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：4x | select |

### Doubao Seedream 5.0 Lite（`JIMENG_5_LITE`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14（JPEG/PNG/WEBP/BMP/TIFF/GIF/HEIC/HEIF，单个≤30MB，宽高比 1:16~16:1，分辨率 15x15~不限，像素 undefined~36000000）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 2K、3K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### Doubao Seedream 4.5（`DOUBAO_SEEDREAM_4_5`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 2K、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

### Qwen Image Edit Max（`QWEN_IMAGE_EDIT_MAX`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：1~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 1K | 1K、2K | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9<br>展示：Auto、1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、3、4<br>展示：1x、2x、3x、4x | select |
| `promptExtend` | 提示词扩展 | boolean | 是 | true | true、false<br>展示：Open Prompt Extend、Close Prompt Extend | switch（advanced=true） |

### MiniMax Image 01（`MINIMAX_IMAGE_01`）

**输入限制**

- 文本节点数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、16:9、4:3、3:2、2:3、3:4、9:16、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4、9<br>展示：1x、2x、4x、9x | select |

### Qwen Image Edit Plus（`QWEN_IMAGE_EDIT_PLUS`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：1~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 1K | 1K、2K | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9<br>展示：Auto、1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、3、4<br>展示：1x、2x、3x、4x | select |
| `promptExtend` | 提示词扩展 | boolean | 是 | true | true、false<br>展示：Open Prompt Extend、Close Prompt Extend | switch（advanced=true） |

### MiniMax Image 01 Live（`MINIMAX_IMAGE_01_LIVE`）

**输入限制**

- 文本节点数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `aspectRatio` | 宽高比 | string | 是 | 1:1 | 1:1、16:9、4:3、3:2、2:3、3:4、9:16 | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4、9<br>展示：1x、2x、4x、9x | select |
| `styleType` | 风格类型 | string | 是 | "" | ""、漫画、元气、中世纪、水彩<br>展示：None、Comic、Energetic、Medieval、Watercolor | select |

### Image Upscale（`IMAGE_UPSCALE`）

**输入限制**

- 图片数量：1~1（PNG/JPEG/JPG/BMP/WebP）

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `superResolutionType` | 超分类型 | string | 是 | ultra | super、ultra | select |
| `resolution` | 分辨率 | string | 是 | 1080P | 1080P、2K、4K | select |

## 视频生成（GENERATE_VIDEO）

### Seedance 2.5（`SEEDANCE_2_5`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~30（JPEG/PNG/WEBP/BMP/TIFF/GIF，单个≤30MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000）
- 视频数量：0~10（MP4/MOV，单个≤200MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000，像素 409600~8295044，时长 1~31s，帧率≤60）
- 音频数量：0~10（MP3/WAV，单个≤15MB，时长 2~30s）
- 图片、视频、音频合计数量：0~50

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | 保持无字幕，避免生成任何文字或字幕，不要生成 logo，不要生成水印。 | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 480P、720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | adaptive | adaptive、21:9、16:9、4:3、1:1、3:4、9:16<br>展示：Auto、21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 最小值 4；最大值 30；步长 1 | range |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame、videoEdit、videoExtend<br>展示：textToVideo、referToVideo、imageToVideo、firstLastFrame、videoEdit、videoExtend | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `outputFormat` | 输出格式 | string | 是 | mp4 | mp4、mov<br>展示：MP4、MOV | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频、音频合计必须为 1～50 个（30张图+10段视频+10段音频） |
| `imageToVideo` | 图生视频 | 图片有且仅有 1 个（需要将aspectRatio 置为 adaptive ） |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 （需要将aspectRatio 置为 adaptive ） |
| `videoEdit` | 视频编辑 | 视频必须为 1 个 （需要将duration 置为 -1 ，aspectRatio 置为 adaptive ） |
| `videoExtend` | 视频延长 | 视频必须为 1 个 （需要将aspectRatio 置为 adaptive ） |

### Seedance 2.0（`SEEDANCE_2_0`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9（JPEG/PNG/WEBP/BMP/TIFF/GIF，单个≤30MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000）
- 视频数量：0~3（MP4/MOV，单个≤200MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000，像素 409600~8295044，时长 1~16s，总时长≤16s，帧率≤120）
- 音频数量：0~3（MP3/WAV，单个≤15MB，时长 1~16s，总时长≤16s）
- 图片、视频、音频合计数量：0~15

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | 保持无字幕，避免生成任何文字或字幕，不要生成 logo，不要生成水印。 | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 480P、720P、1080P、4K、SUPER_720P、SUPER_1080P、SUPER_4K<br>展示：480P、720P、1080P、4K、超分 720p、超分 1080p、超分 4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 4、5、6、7、8、9、10、11、12、13、14、15<br>展示：4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame<br>展示：textToVideo、referToVideo、imageToVideo、firstLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `bitrateMode` | 码率模式 | string | 是 | standard | standard、high<br>展示：Standard、High | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频、音频合计必须为 1～15 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Seedance 2.0 Fast（`SEEDANCE_2_0_FAST`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9（JPEG/PNG/WEBP/BMP/TIFF/GIF，单个≤30MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000）
- 视频数量：0~3（MP4/MOV，单个≤50MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000，像素 409600~2086876，时长 1~16s，总时长≤16s，帧率≤120）
- 音频数量：0~3（MP3/WAV，单个≤15MB，时长 1~16s，总时长≤16s）
- 图片、视频、音频合计数量：0~15

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | 保持无字幕，避免生成任何文字或字幕，不要生成 logo，不要生成水印。 | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 480P、720P、SUPER_720P、SUPER_1080P、SUPER_4K<br>展示：480P、720P、超分 720p、超分 1080p、超分 4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 4、5、6、7、8、9、10、11、12、13、14、15<br>展示：4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame<br>展示：textToVideo、referToVideo、imageToVideo、firstLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `bitrateMode` | 码率模式 | string | 是 | standard | standard、high<br>展示：Standard、High | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频、音频合计必须为 1～15 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Seedance 2.0 Mini（`SEEDANCE_2_0_MINI`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9（JPEG/PNG/WEBP/BMP/TIFF/GIF，单个≤30MB，合计≤64MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000）
- 视频数量：0~3（MP4/MOV，单个≤50MB，宽高比 2:5~5:2，分辨率 300x300~6000x6000，像素 409600~927408，时长 1~16s，总时长≤16s）
- 音频数量：0~3
- 图片、视频、音频合计数量：0~15

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | 保持无字幕，避免生成任何文字或字幕，不要生成 logo，不要生成水印。 | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 480P、720P、SUPER_720P、SUPER_1080P、SUPER_4K<br>展示：480P、720P、超分 720p、超分 1080p、超分 4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 4、5、6、7、8、9、10、11、12、13、14、15<br>展示：4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame<br>展示：textToVideo、referToVideo、imageToVideo、firstLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `bitrateMode` | 码率模式 | string | 是 | standard | standard、high<br>展示：Standard、High | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频、音频合计必须为 1～15 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Wan 3.0（`WAN3_0`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~10（JPEG/JPG/PNG/BMP/WEBP，单个≤20MB，宽高比 1:8~8:1，分辨率 240x240~8000x8000）
- 视频数量：0~5（MP4/MOV，单个≤100MB，宽高比 1:8~8:1，时长 1~15s，总时长≤15s）
- 音频数量：0~5（WAV/MP3，单个≤15MB，时长 1~15s，总时长≤15s）
- 图片、视频、音频合计数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 1080P、720P、480P | select |
| `aspectRatio` | 宽高比 | string | 是 | adaptive | adaptive、16:9、4:3、1:1、3:4、9:16<br>展示：Adaptive、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 2、3、4、5、6、7、8、9、10、11、12、13、14、15、16、17、18、19、20、21、22、23、24、25、26、27、28、29、30<br>展示：2s、3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s、16s、17s、18s、19s、20s、21s、22s、23s、24s、25s、26s、27s、28s、29s、30s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `promptExtend` | 提示词扩展 | boolean | 是 | true | true、false<br>展示：Open Prompt Extend、Close Prompt Extend | switch（advanced=true） |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Wan 3.0 Prime（`WAN3_0_PRIME`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~10（JPEG/JPG/PNG/BMP/WEBP，宽高比 1:8~8:1，分辨率 240x240~8000x8000）
- 视频数量：0~5（MP4/MOV，宽高比 1:8~8:1，时长 1~15s，总时长≤15s）
- 音频数量：0~5（WAV/MP3，时长 1~15s，总时长≤15s）
- 图片、视频、音频合计数量：0~20

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 1080P、720P、480P | select |
| `aspectRatio` | 宽高比 | string | 是 | adaptive | adaptive、16:9、4:3、1:1、3:4、9:16<br>展示：Adaptive、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 2、3、4、5、6、7、8、9、10、11、12、13、14、15、16、17、18、19、20、21、22、23、24、25、26、27、28、29、30<br>展示：2s、3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s、16s、17s、18s、19s、20s、21s、22s、23s、24s、25s、26s、27s、28s、29s、30s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `promptExtend` | 提示词扩展 | boolean | 是 | true | true、false<br>展示：Open Prompt Extend、Close Prompt Extend | switch（advanced=true） |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### MiniMax H3（`MINIMAX_H3`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9
- 视频数量：0~3
- 音频数量：0~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 2K | 768P、2K | select |
| `aspectRatio` | 宽高比 | string | 是 | adaptive | adaptive、21:9、16:9、4:3、1:1、3:4、9:16<br>展示：Adaptive、21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、6、7、8、9、10、11、12、13、14、15<br>展示：5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame、lastFrameToVideo | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true<br>展示：Audio On | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频必须为 1～12 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `lastFrameToVideo` | 尾帧生视频 | 图片必须为 1 个 |

### MiniMax H3 Max（`MINIMAX_H3_MAX`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~2

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 768P | 480P、768P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 21:9、16:9、4:3、1:1、3:4、9:16 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、6、7、8、9、10、11、12、13、14、15<br>展示：5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame | radio |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Vidu Q3 Pro（`VIDU_Q3_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~7

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、4:3、3:4、1:1<br>展示：Auto、16:9、9:16、4:3、3:4、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 1、2、3、4、5、6、7、8、9、10、11、12、13、14、15、16<br>展示：1s、2s、3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s、16s | select |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame、imageRefer | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `imageRefer` | 图片参考生成 | 图片必须为 1～3 个 |

### Vidu Q3 Mix（`VIDU_Q3_MIX`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：1~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、4:3、3:4、1:1<br>展示：Auto、16:9、9:16、4:3、3:4、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 1、2、3、4、5、6、7、8、9、10、11、12、13、14、15、16<br>展示：1s、2s、3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s、16s | stops |
| `referModel` | 参考/生成模式 | string | 是 | imageRefer | imageRefer | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `imageRefer` | 图片参考生成 | 图片必须为 1～3 个 |

### Vidu Q2 Pro（`VIDU_Q2_PRO`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~7
- 视频数量：0~2

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、4:3、3:4、1:1<br>展示：Auto、16:9、9:16、4:3、3:4、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 1、2、3、4、5、6、7、8、9、10、0<br>展示：1s、2s、3s、4s、5s、6s、7s、8s、9s、10s、Auto | select |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | referToVideo、imageToVideo、firstAndLastFrame、imageRefer | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On(Only BGM)、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `referToVideo` | 参考素材生成 | 视频必须为 1～2 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `imageRefer` | 图片参考生成 | 图片必须为 1～7 个 |

### HappyHorse 1.1（`HAPPYHORSE_11`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 1080P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、16:9、9:16、1:1、4:3、3:4、4:5、5:4、9:21、21:9<br>展示：Auto、16:9、9:16、1:1、4:3、3:4、4:5、5:4、9:21、21:9 | select |
| `duration` | 生成时长 | string | 是 | 5 | 3、5、10、15<br>展示：3s、5s、10s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、referToVideo | radio |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：1x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `referToVideo` | 参考素材生成 | 图片必须为 1～9 个 |

### Seedance 1.5 Pro（`SEEDANCE_1_5`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~2

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 480P、720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、4:3、3:4、1:1、21:9<br>展示：Auto、16:9、9:16、4:3、3:4、1:1、21:9 | select |
| `duration` | 生成时长 | string | 是 | 5 | 4、5、6、7、8、9、10、11、12<br>展示：4s、5s、6s、7s、8s、9s、10s、11s、12s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame<br>展示：textToVideo、imageToVideo、firstLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### HappyHorse 1.0（`HAPPYHORSE_10`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~9
- 视频数量：0~1
- 音频数量：0~1

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | "" | ""、16:9、9:16、1:1、4:3、3:4<br>展示：Auto、16:9、9:16、1:1、4:3、3:4 | select |
| `duration` | 生成时长 | string | 是 | 5 | 3、5、10、15<br>展示：3s、5s、10s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、referToVideo、videoEdit | radio |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：1x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `referToVideo` | 参考素材生成 | 图片必须为 1～9 个 |
| `videoEdit` | 视频编辑 | 视频必须为 1 个 |

### Kling V3 Omni（`KLING_V3_OMNI`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~14
- 视频数量：0~10

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、1:1<br>展示：Auto、16:9、9:16、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 3、4、5、6、7、8、9、10、11、12、13、14、15<br>展示：3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame、imageRefer | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 视频必须为 1 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `imageRefer` | 图片参考生成 | 图片必须为 1～7 个 |

### Kling V3（`KLING_V3`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~2

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P、4K | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、1:1<br>展示：Auto、16:9、9:16、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 3、4、5、6、7、8、9、10、11、12、13、14、15<br>展示：3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | false | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Kling O1（`KLING_O1`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~7
- 视频数量：0~1

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、1:1<br>展示：Auto、16:9、9:16、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、10<br>展示：5s、10s | stops |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo、firstAndLastFrame、imageRefer、videoEdit | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 视频必须为 1 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `imageRefer` | 图片参考生成 | 图片必须为 1～7 个 |
| `videoEdit` | 视频编辑 | 视频必须为 1 个 |

### Kling 2.6（`KLING_2_6`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~2

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 1080P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、1:1<br>展示：Auto、16:9、9:16、1:1 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、10<br>展示：5s、10s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### PixVerse V6（`PIXVERSE_V6`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~2
- 视频数量：0~1

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 360P、540P、720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 16:9、4:3、1:1、3:4、9:16、2:3、3:2、21:9 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、8、10、15<br>展示：5s、8s、10s、15s | select |
| `extendDuration` | 扩展时长 | string | 是 | 5 | 5、8、10、15<br>展示：5s、8s、10s、15s | select |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame、videoExtend | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `videoExtend` | 视频延长 | 视频必须为 1 个 |

### PixVerse C1（`PIXVERSE_C1`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 720P | 360P、540P、720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | 16:9、4:3、1:1、3:4、9:16、2:3、3:2、21:9 | select |
| `duration` | 生成时长 | string | 是 | 5 | 5、8、10、15<br>展示：5s、8s、10s、15s | stops |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、firstAndLastFrame、referToVideo<br>展示：textToVideo、imageToVideo、firstAndLastFrame、referToVideo (@ref1/@ref2) | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true、false<br>展示：Audio On、Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |
| `referToVideo` | 参考素材生成 | 图片必须为 1～3 个 |

### Hailuo 2.3（`HAILUO_23`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 768P | 768P、1080P | select |
| `duration` | 生成时长 | string | 是 | 6 | 6、10<br>展示：6s、10s | select |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | false | false<br>展示：Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |

### Hailuo 02（`HAILUO_02`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 768P | 768P、1080P | select |
| `duration` | 生成时长 | string | 是 | 6 | 6、10<br>展示：6s、10s | select |
| `referModel` | 参考/生成模式 | string | 是 | textToVideo | textToVideo、imageToVideo、lastFrameToVideo、firstAndLastFrame | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | false | false<br>展示：Audio Off | select |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |
| `lastFrameToVideo` | 尾帧生视频 | 图片必须为 1 个 |
| `firstAndLastFrame` | 首尾帧生成 | 图片必须为 2 个 |

### Wan 2.6（`WAN2_6`）

**输入限制**

- 图片、视频合计数量：0~5
- 文本节点数量：0~20
- 图片数量：0~5
- 视频数量：0~3
- 音频数量：0~1

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | "" | 不限制 | text |
| `resolution` | 分辨率 | string | 是 | 1080P | 720P、1080P | select |
| `aspectRatio` | 宽高比 | string | 是 | 16:9 | ""、16:9、9:16、1:1、4:3、3:4<br>展示：Auto、16:9、9:16、1:1、4:3、3:4 | select |
| `duration` | 生成时长 | string | 是 | 5 | 2、3、4、5、6、7、8、9、10、11、12、13、14、15<br>展示：2s、3s、4s、5s、6s、7s、8s、9s、10s、11s、12s、13s、14s、15s | select |
| `referModel` | 参考/生成模式 | string | 是 | referToVideo | textToVideo、referToVideo、imageToVideo | radio |
| `includeAudio` | 是否包含音频 | boolean | 是 | true | true<br>展示：Audio On | select |
| `promptExtend` | 提示词扩展 | boolean | 是 | true | true、false<br>展示：Open Prompt Extend、Close Prompt Extend | switch（advanced=true） |
| `multiShot` | 多镜头 | boolean | 是 | false | false、true<br>展示：single、multi | switch（advanced=true） |
| `count` | 生成数量 | int | 是 | 1 | 1、2、4<br>展示：1x、2x、4x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textToVideo` | 文生视频 | 无需输入素材 |
| `referToVideo` | 参考素材生成 | 图片、视频必须为 1～5 个 |
| `imageToVideo` | 图生视频 | 图片必须为 1 个 |

### Video Upscale（`VIDEO_UPSCALE`）

**输入限制**

- 视频数量：1~1

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `resolution` | 分辨率 | string | 是 | 1080P | 1080P、2K、4K | — |
| `frameRate` | 帧率 | string | 否 | "" | ""、30FPS、60FPS | — |

## 音频生成（GENERATE_AUDIO）

### MiniMax Speech 2.8 HD（`MINIMAX_SPEECH_28_HD`）

**输入限制**

- 文本节点数量：0~20
- 文本总长度：0~10000

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `timbreId` | 音色 ID | string | 是 | male-qn-qingse | — | input |
| `speed` | 语速 | int | 是 | 1.0 | 最小值 0.5；最大值 2；步长 0.01 | range |
| `vol` | 音量 | int | 是 | 1 | 最小值 0；最大值 10；步长 0.01 | range |
| `pitch` | 音调 | int | 是 | 0 | 最小值 -12；最大值 12；步长 1 | range |
| `voiceModifyPitch` | 声音修改音调 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifyIntensity` | 声音修改强度 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifyTimbre` | 声音修改音色 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifySoundEffects` | 声音修改音效 | string | 是 | "" | spacious_echo、auditorium_echo、lofi_telephone、robotic<br>展示：Spacious Echo、Auditorium Echo、Lofi Telephone、Robotic | radio-switch（advanced=true） |

### MiniMax Speech 2.8 Turbo（`MINIMAX_SPEECH_28_TURBO`）

**输入限制**

- 文本节点数量：0~20
- 文本总长度：0~10000

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `timbreId` | 音色 ID | string | 是 | male-qn-qingse | — | input |
| `speed` | 语速 | int | 是 | 1.0 | 最小值 0.5；最大值 2；步长 0.01 | range |
| `vol` | 音量 | int | 是 | 1 | 最小值 0；最大值 10；步长 0.01 | range |
| `pitch` | 音调 | int | 是 | 0 | 最小值 -12；最大值 12；步长 1 | range |
| `voiceModifyPitch` | 声音修改音调 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifyIntensity` | 声音修改强度 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifyTimbre` | 声音修改音色 | int | 是 | 0 | 最小值 -100；最大值 100；步长 1 | range（advanced=true） |
| `voiceModifySoundEffects` | 声音修改音效 | string | 是 | "" | spacious_echo、auditorium_echo、lofi_telephone、robotic<br>展示：Spacious Echo、Auditorium Echo、Lofi Telephone、Robotic | radio-switch（advanced=true） |

### MiniMax Music 2.6（`MINIMAX_MUSIC_26`）

**输入限制**

- 文本节点数量：0~20
- 文本总长度：0~2000

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `musicMode` | 音乐模式 | string | 是 | CUSTOM | CUSTOM、ADAPTIVE、INSTRUMENTAL<br>展示：自定义、自适应、纯音乐 | select |
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `lyrics` | 歌词 | string | 是 | null | 长度 [0,3500] | text |

## 3D 生成（GENERATE_3D）

### Hunyuan 3D Pro 3.0（`HUNYUAN_3D_PRO_30`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~3

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `referModel` | 参考/生成模式 | string | 是 | textTo3D | textTo3D、imageTo3D、multiTo3D | radio |
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `generateType` | 生成类型 | string | 是 | Normal | Normal、LowPoly、Geometry、Sketch | select |
| `enablePBR` | 是否启用 PBR | boolean | 是 | false | false、true<br>展示：Off、On | select |
| `faceCount` | 面数 | string | 是 | 300000 | 300000、500000、0<br>展示：300000、500000、default | select |
| `polygonType` | 多边形类型 | string | 是 | triangle | triangle、quadrilateral<br>展示：Triangle、Quadrilateral | select |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：1x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textTo3D` | 文生 3D | 文本节点必须为 1～20 个 |
| `imageTo3D` | 图生 3D | 图片必须为 1 个 |
| `multiTo3D` | 多图生 3D | 图片必须为 1～3 个 |

### Hunyuan 3D Pro 3.1（`HUNYUAN_3D_PRO_31`）

**输入限制**

- 文本节点数量：0~20
- 图片数量：0~7

**参数**

| 参数 | 说明 | 类型 | 必填 | 默认值 | 可选值 / 范围 | 控件 |
|---|---|---|---|---|---|---|
| `referModel` | 参考/生成模式 | string | 是 | textTo3D | textTo3D、imageTo3D、multiTo3D | radio |
| `prompt` | 提示词 | string | 是 | null | 不限制 | text |
| `generateType` | 生成类型 | string | 是 | Normal | Normal、Geometry | select |
| `enablePBR` | 是否启用 PBR | boolean | 是 | false | false、true<br>展示：Off、On | select |
| `faceCount` | 面数 | string | 是 | 300000 | 300000、500000、0<br>展示：300000、500000、default | select |
| `count` | 生成数量 | int | 是 | 1 | 1<br>展示：1x | select |

**referModel 输入要求**

| 值 | 模式 | 必需输入 |
|---|---|---|
| `textTo3D` | 文生 3D | 文本节点必须为 1～20 个 |
| `imageTo3D` | 图生 3D | 图片必须为 1 个 |
| `multiTo3D` | 多图生 3D | 图片必须为 1～7 个 |
