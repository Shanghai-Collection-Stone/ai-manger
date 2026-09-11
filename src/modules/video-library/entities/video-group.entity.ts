import { ObjectId } from 'mongodb';

/**
 * @description 视频分组实体。与图库分组同构，但不带 embedding——视频库没有向量检索需求，
 *   建了就是每次写入都白跑一次 embedding 调用。
 * @keyword-cn 视频分组实体
 * @keyword-en video-group-entity
 */
export interface VideoGroupEntity {
  _id: ObjectId;
  /** @description 自增业务 ID。 */
  id: number;
  userId: string;
  /** @description 租户 ID，空表示母平台数据。 */
  tenantId?: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 分组创建入参。
 * @keyword-cn 分组创建入参
 * @keyword-en video-group-create-input
 */
export interface VideoGroupCreateInput {
  userId: string;
  tenantId?: string;
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * @description 分组更新入参。
 * @keyword-cn 分组更新入参
 * @keyword-en video-group-update-input
 */
export interface VideoGroupUpdateInput {
  name?: string;
  description?: string;
  tags?: string[];
}

/**
 * @description 列表返回的分组视图，`video_count` 由聚合算出，前端侧栏直接显示。
 * @keyword-cn 分组视图, 分组计数
 * @keyword-en video-group-view, group-count
 */
export interface VideoGroupView extends Omit<VideoGroupEntity, '_id'> {
  video_count: number;
}
