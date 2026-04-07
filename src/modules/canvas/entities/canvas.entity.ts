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
 * - collage-cover-2portrait-inner: 1横拼图封面 + 2竖内页单图
 */
export type ImageGroupLayout =
  | 'portrait-cover-2inner-collage'
  | 'collage-cover-2portrait-inner';

/** @description 图片组内单张图片信息（含版式角色） */
export interface CanvasGroupImage {
  imageId: number;
  url: string;
  thumbUrl?: string;
  isCollage: boolean;
  isPortrait?: boolean;
  tags: string[];
  /** @description 该图在版式中的角色 */
  role: 'cover' | 'inner-1' | 'inner-2';
  /** @description 封面文字叠加文案（仅 role=cover 时有值，每组不同） */
  text?: string;
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
