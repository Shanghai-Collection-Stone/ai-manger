import { ObjectId } from 'mongodb';
import type { ArticlePublishStatus } from './article-library.entity.js';

/**
 * @description 文章内容载荷（可由 canvas 搬运，也可手工录入）
 * @keyword-en article content payload
 */
export interface ArticleContent {
  title: string;
  tags?: string[];
  contentJson?: Record<string, unknown>;
  text?: string;
  imageUrls?: string[];
  imageIds?: number[];
  meta?: Record<string, unknown>;
}

/**
 * @description 文章实体（所属文章库 + 发布状态 + 租约字段）
 * @keyword-en article entity with publish status and lease fields
 */
export interface ArticleEntity extends ArticleContent {
  _id: ObjectId;
  id: number;
  libraryId: number;
  userId: string;
  tenantId?: string;
  publishStatus: ArticlePublishStatus;
  /** 租约过期时间；被领取时写入 now+15min，过期后视为可再次领取 */
  lockExpireAt?: Date;
  /** 最后一次领取时间 */
  lastLeaseAt?: Date;
  /** 最后一次领取生成的 leaseToken（状态回写时比对防抢占覆盖） */
  lastLeaseToken?: string;
  publishedAt?: Date;
  /** 来源标识：canvas | manual | 自定义字符串 */
  source?: string;
  /** 来源引用 */
  sourceRef?: {
    canvasId?: number;
    canvasArticleId?: number;
    featuredWorkspaceId?: number;
    featuredPageId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 文章入库入参
 * @keyword-en article create input
 */
export interface ArticleCreateInput extends ArticleContent {
  libraryId: number;
  userId: string;
  tenantId?: string;
  publishStatus?: ArticlePublishStatus;
  source?: string;
  sourceRef?: {
    canvasId?: number;
    canvasArticleId?: number;
    featuredWorkspaceId?: number;
    featuredPageId?: string;
  };
}

/**
 * @description 文章更新入参
 * @keyword-en article update input
 */
export interface ArticleUpdateInput {
  id: number;
  libraryId?: number;
  tenantId?: string;
  title?: string;
  tags?: string[];
  contentJson?: Record<string, unknown>;
  text?: string;
  imageUrls?: string[];
  imageIds?: number[];
  meta?: Record<string, unknown>;
  publishStatus?: ArticlePublishStatus;
}

/**
 * @description 队列领取结果
 * @keyword-en article lease result
 */
export interface ArticleLeaseResult {
  article: ArticleEntity;
  leaseToken: string;
  leaseExpireAt: Date;
}
