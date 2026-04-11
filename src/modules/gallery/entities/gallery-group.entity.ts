import { ObjectId } from 'mongodb';

/** @description 数据可见范围：platform=全局可见，tenant=仅限指定租户 */
export type GalleryGroupScope = 'platform' | 'tenant';

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
