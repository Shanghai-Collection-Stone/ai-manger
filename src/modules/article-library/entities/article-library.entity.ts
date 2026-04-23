import { ObjectId } from 'mongodb';

/** @description 文章库可见范围：platform=全局可见，tenant=仅限指定租户 */
export type ArticleLibraryScope = 'platform' | 'tenant';

/** @description 文章发布状态 */
export type ArticlePublishStatus = 'unpublished' | 'published';

/**
 * @description 文章库推送配置
 * @keyword-en article library push configuration
 */
export interface ArticleLibraryPushConfig {
  /** 队列领取时允许的状态池（默认 ['unpublished']） */
  statusFilter: ArticlePublishStatus[];
  /** 推送 URL（二维码实现前先用普通链接承载；由调用方扫码后访问） */
  pushUrl?: string;
}

/**
 * @description 文章库容器实体
 * @keyword-en article library container entity
 */
export interface ArticleLibraryEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  scope: ArticleLibraryScope;
  tenantId?: string;
  name: string;
  /** 类型：自由字符串（不枚举，由使用方自定） */
  type: string;
  pushConfig: ArticleLibraryPushConfig;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 创建文章库入参
 * @keyword-en article library create input
 */
export interface ArticleLibraryCreateInput {
  userId: string;
  scope?: ArticleLibraryScope;
  tenantId?: string;
  name: string;
  type: string;
  pushConfig?: Partial<ArticleLibraryPushConfig>;
}

/**
 * @description 更新文章库入参
 * @keyword-en article library update input
 */
export interface ArticleLibraryUpdateInput {
  id: number;
  tenantId?: string;
  name?: string;
  type?: string;
  pushConfig?: Partial<ArticleLibraryPushConfig>;
}

/**
 * @description 文章库统计
 * @keyword-en article library stats
 */
export interface ArticleLibraryStats {
  total: number;
  publishedCount: number;
  unpublishedCount: number;
}
