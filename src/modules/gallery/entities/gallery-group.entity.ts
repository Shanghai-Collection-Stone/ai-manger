import { ObjectId } from 'mongodb';

/** @description 数据可见范围：platform=全局可见，tenant=仅限指定租户 */
export type GalleryGroupScope = 'platform' | 'tenant';

/**
 * @description 系统固定分组标识：`store-visit-scene` 是探店「场景图库」，自动创建，不能改名或删除。
 * @keyword-cn 固定分组标识, 场景图库
 * @keyword-en system-group-key, scene-gallery
 */
export type GalleryGroupSystemKey = 'store-visit-scene';

/**
 * @description 探店「场景图库」固定分组的系统标识值。
 * @keyword-cn 场景图库标识, 固定分组
 * @keyword-en scene-group-key, system-group
 */
export const GALLERY_SCENE_GROUP_SYSTEM: GalleryGroupSystemKey = 'store-visit-scene';

export interface GalleryGroupEntity {
  _id: ObjectId;
  id: string | number;
  userId: string;
  /** @description 数据可见范围，默认 tenant */
  scope: GalleryGroupScope;
  /** @description 租户ID，scope=tenant 时必填 */
  tenantId?: string;
  name: string;
  description?: string;
  tags: string[];
  /** @description 系统固定分组标识；有值时不能改名或删除 */
  system?: GalleryGroupSystemKey;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryGroupCreateInput {
  userId: string;
  /** @description 数据可见范围，默认 tenant */
  scope?: GalleryGroupScope;
  /** @description 租户ID */
  tenantId?: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface GalleryGroupUpdateInput {
  id: string | number;
  name?: string;
  description?: string;
  tags?: string[];
}

export interface GalleryGroupSearchResult {
  group: GalleryGroupEntity;
  score: number;
}
