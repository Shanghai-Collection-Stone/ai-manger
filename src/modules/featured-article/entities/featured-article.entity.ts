import { ObjectId } from 'mongodb';

/**
 * @description Featured article workspace visible scope.
 * @keyword-en featured-article, workspace-scope
 * @keyword-cn 精选文章, 工作区作用域
 */
export type FeaturedArticleScope = 'tenant' | 'user';

/**
 * @description Featured article page image layout mode.
 * @keyword-en featured-article, image-layout
 * @keyword-cn 精选文章, 图片布局
 */
export type FeaturedArticleImageMode = 'empty' | 'gallery-stack' | 'collage';

/**
 * @description Featured article image slot standard size, matching the Xiaohongshu vertical format.
 * @keyword-en featured-article, image-slot-size
 * @keyword-cn 精选文章, 图片槽位
 */
export const FEATURED_ARTICLE_IMAGE_SLOT_SIZE = {
  width: 900,
  height: 1200,
};

/**
 * @description Image reference stored on a featured article page.
 * @keyword-en featured-article, image-reference
 * @keyword-cn 精选文章, 图片引用
 */
export interface FeaturedArticleImageRef {
  id?: number;
  url?: string;
  thumbUrl?: string;
  originalName?: string;
  tags?: string[];
  source?: string;
}

/**
 * @description One Xiaohongshu-like featured article page inside a workspace.
 * @keyword-en featured-article, article-page
 * @keyword-cn 精选文章, 文章页面
 */
export interface FeaturedArticlePage {
  id: string;
  topic: string;
  imageMode: FeaturedArticleImageMode;
  images: FeaturedArticleImageRef[];
  collageUrl?: string;
  imagePrompt?: string;
  title: string;
  body: string;
  storedLibraryId?: number;
  storedArticleId?: number;
  storedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description Featured article workspace document persisted in MongoDB.
 * @keyword-en featured-article, workspace-entity
 * @keyword-cn 精选文章, 工作区实体
 */
export interface FeaturedArticleWorkspaceEntity {
  _id: ObjectId;
  id: number;
  scope: FeaturedArticleScope;
  scopeId: string;
  tenantId?: string;
  userId: string;
  name: string;
  pages: FeaturedArticlePage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description Input for creating a featured article workspace.
 * @keyword-en featured-article, workspace-create
 * @keyword-cn 精选文章, 创建工作区
 */
export interface FeaturedArticleWorkspaceCreateInput {
  name: string;
  pages?: FeaturedArticlePageInput[];
}

/**
 * @description Input for updating a featured article workspace.
 * @keyword-en featured-article, workspace-update
 * @keyword-cn 精选文章, 更新工作区
 */
export interface FeaturedArticleWorkspaceUpdateInput {
  name?: string;
}

/**
 * @description Input shape used to create or patch a featured article page.
 * @keyword-en featured-article, page-input
 * @keyword-cn 精选文章, 页面输入
 */
export interface FeaturedArticlePageInput {
  id?: string;
  topic?: string;
  imageMode?: FeaturedArticleImageMode;
  images?: FeaturedArticleImageRef[];
  collageUrl?: string;
  imagePrompt?: string;
  title?: string;
  body?: string;
}

/**
 * @description Authenticated scope resolved from the admin user.
 * @keyword-en featured-article, auth-scope
 * @keyword-cn 精选文章, 鉴权作用域
 */
export interface FeaturedArticleAuthScope {
  tenantId?: string;
  userId: string;
}

/**
 * @description Summary returned to the workspace picker.
 * @keyword-en featured-article, workspace-summary
 * @keyword-cn 精选文章, 工作区摘要
 */
export interface FeaturedArticleWorkspaceSummary
  extends FeaturedArticleWorkspaceEntity {
  articleCount: number;
}
