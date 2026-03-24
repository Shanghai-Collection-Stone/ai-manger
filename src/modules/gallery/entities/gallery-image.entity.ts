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
  /** @description 是否为两图拼图（640x853） */
  isCollage?: boolean;
  /** @description 拼图来源图片ID（固定2张） */
  collageSourceImageIds?: number[];
  /** @description 拼图尺寸/分辨率元数据 */
  collageMeta?: {
    width: number;
    height: number;
    dpi: number;
  };
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
  isCollage?: boolean;
  collageSourceImageIds?: number[];
  collageMeta?: {
    width: number;
    height: number;
    dpi: number;
  };
}

export interface GallerySearchResult {
  image: GalleryImageEntity;
  score: number;
}
