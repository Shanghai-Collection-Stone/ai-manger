import { ObjectId } from 'mongodb';

/**
 * @description 图库标签字典：每个作用域内一个标签名一行，集合 `gallery_tags`，`scopeKey + name` 唯一。
 *   作用域与图片可见范围一致：有租户为 `tenant:<tenantId>`，母平台为 `platform`。
 * @keyword-cn 标签字典, 作用域标签
 * @keyword-en tag-dictionary, scoped-tag
 */
export interface GalleryTagEntity {
  _id: ObjectId;
  /** @description 标签作用域键，与图片租户可见范围一致 */
  scopeKey: string;
  /** @description 规整后的标签名（去空白、去开头井号） */
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 图片与标签的关联：一张图的一个标签一行，集合 `gallery_image_tags`，`imageId + tagId` 唯一；
 *   `order` 保留图片上标签的先后顺序，标签统计与按标签筛图只扫 `scopeKey + tagId + imageId` 索引。
 * @keyword-cn 图片标签关联, 标签中间表
 * @keyword-en image-tag-link, tag-junction
 */
export interface GalleryImageTagEntity {
  _id: ObjectId;
  /** @description 图片所属作用域键，与标签字典一致 */
  scopeKey: string;
  /** @description 图片业务自增 ID（gallery_images.id） */
  imageId: number;
  /** @description 标签字典主键（gallery_tags._id） */
  tagId: ObjectId;
  /** @description 标签在该图片上的顺序，从 0 开始 */
  order: number;
  createdAt: Date;
}
