/**
 * @description AI 生成图片与素材面板共用的固定图库标签。
 * @keyword-cn AI素材标签
 * @keyword-en ai-material-tag
 */
export const AI_GENERATED_IMAGE_TAG = 'ai素材';

/**
 * @description 标记「素材图」的系统标签：AI 生成的图（`ai素材`，含抖音分镜配图、探店人物首帧、人物形象图）、出片过程中自动存进图库的图
 *   （探店续段尾帧、探店出镜人脸照）、设计编辑器素材面板上传的素材（`我的素材`，含风格参考图）与画布保存的成品（`画布成品`，旧版 `灵感画布`）。
 *   图库「全部图片」默认不显示这些图，统一在「素材图」里看；标签字符串必须与写入方逐字一致：桌面端 `video-production/storeVisitContinuity.js`（尾帧）、
 *   `StoreVisitSpotWorkspace.jsx`（人脸）、`design-editor/material-lab/MaterialPanel.jsx`（`UPLOAD_MATERIAL_TAG`）、`design-editor/DesignEditorView.jsx`
 *   与 `article-image-sync/articleImageSync.js`（画布成品），后端 `douyin-store-visit.service.ts`（人物首帧）。
 * @keyword-cn 素材图标签, 生成素材标签
 * @keyword-en material-image-tags, generated-material-tags
 */
export const GALLERY_MATERIAL_TAGS = [
  AI_GENERATED_IMAGE_TAG,
  '探店连续生成尾帧',
  '抖音探店人脸',
  '抖音探店人物首帧',
  '我的素材',
  '画布成品',
  '灵感画布',
] as const;
