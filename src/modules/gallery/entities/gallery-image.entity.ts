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
  groupId?: string | number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  /** @description 图片宽度（像素） */
  width?: number;
  /** @description 图片高度（像素） */
  height?: number;
  /** @description 是否为竖图（高度大于宽度） */
  isPortrait?: boolean;
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
  /**
   * @description 是否已被生成消耗（动态拼图/生图组等任意一次参与后置 true）。一旦标记 true,
   * 后续 searchByTags 默认会排除该图,避免重复使用。需重新启用可调 markUsedBatch(reset=true)。
   * @keyword-en gallery-image isUsed flag for one-shot consumption
   */
  isUsed?: boolean;
  /** @description 首次被标记 isUsed=true 的时间 */
  usedAt?: Date;
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
  groupId?: string | number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  /** @description 图片宽度（像素） */
  width?: number;
  /** @description 图片高度（像素） */
  height?: number;
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
