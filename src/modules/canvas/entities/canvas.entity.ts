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
 */
export type ImageGroupLayout =
  | 'portrait-cover-5inner'
  | 'collage-cover-5inner';

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
}

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
