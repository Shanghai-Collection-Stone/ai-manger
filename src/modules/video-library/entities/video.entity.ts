import { ObjectId } from 'mongodb';

/**
 * @description 视频记录实体。二进制存在 OSS，这里只留对象键与元数据——库里没有任何视频字节，
 *   删除记录时要同时按 `key` / `coverKey` 去清对象存储。
 * @keyword-cn 视频实体, 视频记录
 * @keyword-en video-entity, video-record
 */
export interface VideoEntity {
  _id: ObjectId;
  /** @description 自增业务 ID，也是列表游标（`cursorId`）的取值。 */
  id: number;
  userId: string;
  /** @description 租户 ID，空表示母平台数据。 */
  tenantId?: string;
  /** @description 展示名，默认取上传时的文件名。 */
  name: string;
  /** @description OSS 对象键，删除与重签地址都以它为准。 */
  key: string;
  /** @description 可播放地址（可能是 CDN 域名），由服务端签票据时算好并回存。 */
  url: string;
  /** @description 封面对象键，前端抓帧失败时为空。 */
  coverKey?: string;
  /** @description 封面可访问地址。 */
  coverUrl?: string;
  contentType?: string;
  sizeBytes: number;
  /** @description 时长毫秒，前端探测不出（编码不被支持）时为 null。 */
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  tags: string[];
  /** @description 所属分组 ID，null 表示未分组。 */
  groupId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 直传完成后的登记入参。
 * @keyword-cn 视频登记入参
 * @keyword-en video-create-input
 */
export interface VideoCreateInput {
  userId: string;
  tenantId?: string;
  name: string;
  key: string;
  url?: string;
  coverKey?: string;
  coverUrl?: string;
  contentType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  tags?: string[];
  groupId?: number | null;
}

/**
 * @description 视频可改字段：名称、标签、分组。对象键与地址不可改——改了就对不上 OSS 里的实体。
 * @keyword-cn 视频更新入参
 * @keyword-en video-update-input
 */
export interface VideoUpdateInput {
  name?: string;
  tags?: string[];
  groupId?: number | null;
}
