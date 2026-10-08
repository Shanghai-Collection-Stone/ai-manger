import { ObjectId } from 'mongodb';

/**
 * @description 图库标签库中的一个分类。
 * @keyword-cn 标签分类, 图库标签库
 * @keyword-en tag-category, gallery-tag-library
 */
export interface GalleryTagCategory {
  id: string;
  name: string;
  tags: string[];
}

/**
 * @description 每个图库可见作用域唯一的标签库记录。
 * @keyword-cn 标签库实体, 租户作用域
 * @keyword-en tag-library-entity, tenant-scope
 */
export interface GalleryTagLibraryEntity {
  _id: ObjectId;
  scopeKey: string;
  categories: GalleryTagCategory[];
  createdAt: Date;
  updatedAt: Date;
}
