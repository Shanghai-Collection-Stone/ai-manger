import { ObjectId } from 'mongodb';

/**
 * @description 抖音发布任务租约时长，固定十分钟。
 * @keyword-cn 发布租约, 十分钟租约
 * @keyword-en publish-lease, ten-minute-lease
 */
export const DOUYIN_PUBLISH_LEASE_MS = 10 * 60 * 1000;

/**
 * @description 抖音发布库的数据访问作用域。
 * @keyword-cn 发布作用域
 * @keyword-en publish-scope
 */
export interface DouyinPublishScope {
  tenantId?: string;
  userId: string;
}

/**
 * @description 抖音视频发布库持久化实体。
 * @keyword-cn 发布库实体
 * @keyword-en publish-library-entity
 */
export interface DouyinPublishLibraryEntity {
  _id: ObjectId;
  tenantId?: string;
  userId: string;
  name: string;
  qrToken?: string;
  /** 抖音小程序长期 Schema（`sslocal://miniapp?ticket=…`），配置了小程序 AppID 时作为二维码内容，生成一次后复用 */
  qrSchema?: string;
  /** 生成 qrSchema 时的 AppID + 发布页 + 启动参数；与当前不一致时重新生成 */
  qrSchemaKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 抖音发布作品的发布状态。
 * @keyword-cn 作品发布状态
 * @keyword-en work-publish-status
 */
export type DouyinPublishStatus = 'unpublished' | 'published';

/**
 * @description 发布作品来源：`video` 为视频库成片入库，`manual-link` 为数据监控里按抖音链接直接建的已发布作品。
 * @keyword-cn 作品来源, 手动链接作品
 * @keyword-en work-source, manual-link-work
 */
export type DouyinPublishWorkSource = 'video' | 'manual-link';

/**
 * @description 实际发布时使用的文案快照。
 * @keyword-cn 发布文案快照
 * @keyword-en published-copy-snapshot
 */
export interface DouyinPublishedSnapshot {
  title: string;
  description: string;
  tags: string[];
}

/**
 * @description 抖音发布作品持久化实体，视频字段为入库时快照。
 * @keyword-cn 发布作品实体, 视频快照
 * @keyword-en publish-work-entity, video-snapshot
 */
export interface DouyinPublishWorkEntity {
  _id: ObjectId;
  libraryId: ObjectId;
  tenantId?: string;
  userId: string;
  topicId: number | null;
  /** 作品来源：视频库成片入库，或数据监控里手动添加的抖音链接；旧数据缺省视为 video。 */
  source?: DouyinPublishWorkSource;
  /** 手动添加链接时用户粘贴的原始抖音链接。 */
  douyinUrl?: string | null;
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  videoUrl: string;
  coverUrl: string;
  /** 视频时长，单位为秒。 */
  duration: number | null;
  status: DouyinPublishStatus;
  douyinVideoId: string | null;
  publishedAt: Date | null;
  publishedSnapshot?: DouyinPublishedSnapshot;
  lastError: string | null;
  lockExpireAt?: Date | null;
  leaseToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 发布库统计视图。
 * @keyword-cn 发布库统计
 * @keyword-en publish-library-stats
 */
export interface DouyinPublishLibraryStats {
  unpublished: number;
  published: number;
  leased: number;
  lastPublishedAt: string | null;
}

/**
 * @description 管理端发布库视图。
 * @keyword-cn 发布库视图
 * @keyword-en publish-library-view
 */
export interface DouyinPublishLibraryView {
  id: string;
  name: string;
  createdAt: string;
  stats: DouyinPublishLibraryStats;
}

/**
 * @description 管理端发布作品视图。
 * @keyword-cn 发布作品视图
 * @keyword-en publish-work-view
 */
export interface DouyinPublishWorkView {
  id: string;
  libraryId: string;
  topicId: number | null;
  source: DouyinPublishWorkSource;
  douyinUrl: string | null;
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  videoUrl: string;
  coverUrl: string;
  duration: number | null;
  status: DouyinPublishStatus;
  douyinVideoId: string | null;
  publishedAt: string | null;
  lastError: string | null;
  leased: boolean;
  createdAt: string;
  updatedAt: string;
}
