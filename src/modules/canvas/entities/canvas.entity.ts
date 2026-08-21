import { ObjectId } from 'mongodb';

export type CanvasStatus =
  | 'generating'
  | 'completed'
  | 'requires_human'
  | 'failed';

/** @description canvas 类型：article=图文, image-group=图片组 */
export type CanvasType = 'article' | 'image-group';

/**
 * @description 图片组版式类型
 * - portrait-cover-2inner-collage: 1竖封面单图 + 2内页拼图
 * - portrait-cover-5inner: 1竖封面 + 5内页（拼图+竖图混合）
 * - collage-cover-5inner: 1横拼图封面 + 5竖内页单图
 * - collage-cover-5collage: 1横拼图封面 + 5横拼图内页
 */
export type ImageGroupLayout =
  | 'portrait-cover-5inner'
  | 'collage-cover-5inner'
  | 'collage-cover-5collage';

/**
 * @description 拼图内单张源图在拼图画布上的格子位置，坐标以拼图画布像素为单位。
 * @keyword-cn 拼图画布格式, 拼图格子
 * @keyword-en collage-canvas-format, collage-cell
 */
export interface CanvasCollageCell {
  imageId: number;
  url: string;
  thumbUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** @description 源图填充方式，与 sharp 合成时保持一致（fit:cover） */
  objectFit: 'cover' | 'contain';
}

/**
 * @description 拼图的画布格式描述：画布尺寸 + 各源图格子，供设计编辑器还原成可逐张替换的图层。
 * @keyword-cn 拼图画布格式, 可换图拼图
 * @keyword-en collage-canvas-format, swappable-collage
 */
export interface CanvasCollageLayout {
  width: number;
  height: number;
  cells: CanvasCollageCell[];
}

/**
 * @description 封面进入设计编辑器时使用的原始照片底图，和装饰素材层分开保存。
 * @keyword-cn 可编辑封面底图, 图层分离
 * @keyword-en editable-cover-base, separated-layers
 */
export interface CanvasEditableCoverBase {
  imageId: number;
  url: string;
  thumbUrl?: string;
}

/**
 * @description 可在设计编辑器中独立移动、缩放、隐藏并重新调整去底特效的图片素材层。
 * @keyword-cn 可编辑装饰素材, 图层分离
 * @keyword-en editable-decoration-material, separated-layers
 */
export interface CanvasEditableMaterialLayer {
  id: string;
  name: string;
  src: string;
  materialSrc: string;
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  /** @description 素材图像本身是否已经包含封面文字，用于避免编辑器重复创建文字图层。 */
  includesText?: boolean;
  effect?: Record<string, unknown>;
}

/** @description 图片组内单张图片信息（含版式角色） */
export interface CanvasGroupImage {
  imageId: number;
  url: string;
  thumbUrl?: string;
  isCollage: boolean;
  isPortrait?: boolean;
  tags: string[];
  /** @description 该图在版式中的角色 */
  role: 'cover' | 'inner-1' | 'inner-2' | 'inner-3' | 'inner-4' | 'inner-5';
  /** @description 封面主标题文案（仅 role=cover 时有值） */
  text?: string;
  /** @description 封面副标题文案（仅 role=cover 时有值） */
  subtitle?: string;
  /** @description 拼图画布格式（仅拼图有值），保留源图格子供后续逐张换图 */
  collage?: CanvasCollageLayout;
  /** @description 合成预览图对应的原始照片底图，进入设计编辑器时优先使用 */
  editableBase?: CanvasEditableCoverBase;
  /** @description 与底图分离的可编辑装饰素材层 */
  materials?: CanvasEditableMaterialLayer[];
}

/** @description canvas 图片组实体（一组对应一篇文章） */
export interface CanvasImageGroup {
  id: number;
  articleId?: number;
  articleTitle?: string;
  layout: ImageGroupLayout;
  images: CanvasGroupImage[];
  status: 'pending' | 'done' | 'failed';
}

/** @description 图片组 Canvas 使用状态；无字段的旧数据按 unused 处理 */
export interface CanvasImageGroupUsage {
  status: 'unused' | 'partial' | 'used';
  usedAt?: Date;
  usedByCanvasId?: number;
  usedByArticleIds?: number[];
  usedGroupIds?: number[];
}

export interface CanvasArticleEntity {
  id: number;
  title: string;
  tags: string[];
  contentJson: Record<string, unknown>;
  imageUrls?: string[];
  imageIds?: number[];
  status: 'pending' | 'done' | 'requires_human' | 'failed';
  doneNote?: string;
  /** 文章成功发送（发布到小红书等平台）的时间，null 表示未发送 */
  sentAt?: Date;
}

export interface CanvasEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  tenantId?: string;
  topic?: string;
  /** @description canvas 类型，默认 article */
  type?: CanvasType;
  outline?: Record<string, unknown>;
  style?: Record<string, unknown>;
  status: CanvasStatus;
  articles: CanvasArticleEntity[];
  /** @description 图片组列表，仅 type=image-group 时有值 */
  imageGroups?: CanvasImageGroup[];
  /** @description 图片组 Canvas 是否已被生文流程消费，仅 type=image-group 时有值 */
  imageGroupUsage?: CanvasImageGroupUsage;
  /** 画布关键词，用于向量搜索与分类过滤 */
  keywords?: string[];
  /** 嵌入向量，用于语义相似度检索 */
  embeddingVector?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CanvasCreateInput {
  userId: string;
  tenantId?: string;
  topic?: string;
  type?: CanvasType;
  outline?: Record<string, unknown>;
  style?: Record<string, unknown>;
  keywords?: string[];
}

/** @description 创建图片组 canvas 的入参：包含文章标题+标签，用于匹配配图 */
export interface CanvasImageGroupCreateInput {
  userId: string;
  tenantId?: string;
  topic?: string;
  articles: Array<{
    title: string;
    tags: string[];
    /** @description 指定版式，不传则系统交替分配 */
    layout?: ImageGroupLayout;
  }>;
  /**
   * @description 是否去重(每张源图跨生成只用一次)。默认 true=去重(排除 isUsed + 生成后 markUsed);
   *  false=不去重(命中已用图、按标签随机取图、生成后不写 isUsed，图片可无限复用)。
   */
  dedup?: boolean;
  /**
   * @description 封面生成策略。
   *  `ai-direct`(默认)=AI 基于源图二次编辑，产出物直接作为封面成品;
   *  `ai-overlay`=AI 只文生图产出文字与装饰融合的绿幕海报素材层，
   *   再用 sharp 去底并叠加到真实照片上，照片主体不被重绘。小红书专家走此模式。
   */
  coverStrategy?: CanvasCoverStrategy;

  /**
   * @description 封面文字海报的视觉风格预设 id，取值来自素材风格库
   * （`gallery/material-styles`），传 `random` 则每次随机换一条。
   * 只在 `coverStrategy: 'ai-overlay'` 下生效；缺省或选不中时回落到内置的
   * 「亮粉/明黄/奶白 波普生日海报」写死风格，行为与加这个字段之前一致。
   * @keyword-cn 封面风格预设
   * @keyword-en cover-style-preset
   */
  coverStyle?: string;
}

/**
 * @description 封面生成策略：AI 产出物是成品封面，还是叠加用的文字海报素材层。
 * @keyword-cn 封面策略, 装饰素材叠加
 * @keyword-en cover-strategy, decoration-overlay
 */
export type CanvasCoverStrategy = 'ai-direct' | 'ai-overlay';

/** @description 更新 imageGroups 的内部入参 */
export interface CanvasUpdateImageGroupsInput {
  imageGroups: CanvasImageGroup[];
}

export interface CanvasAddArticlesInput {
  articles: Array<{
    title: string;
    tags?: string[];
    contentJson: Record<string, unknown>;
  }>;
}

export interface CanvasUpdateStatusInput {
  status: CanvasStatus;
}

export interface CanvasUpdateArticleInput {
  title?: string;
  tags?: string[];
  contentJson?: Record<string, unknown>;
  imageUrls?: string[];
  status?: CanvasArticleEntity['status'];
  doneNote?: string;
}
