import { ObjectId } from 'mongodb';

/** @description 数据可见范围：platform=全局可见，tenant=仅限指定租户 */
export type GalleryScope = 'platform' | 'tenant';

export interface GalleryImageEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  /** @description 数据可见范围，默认 tenant */
  scope: GalleryScope;
  /** @description 租户ID，scope=tenant 时必填 */
  tenantId?: string;
  groupId?: number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  tags: string[];
  description?: string;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryImageCreateInput {
  userId: string;
  /** @description 数据可见范围，默认 tenant */
  scope?: GalleryScope;
  /** @description 租户ID */
  tenantId?: string;
  groupId?: number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  tags?: string[];
  description?: string;
}

export interface GallerySearchResult {
  image: GalleryImageEntity;
  score: number;
}
