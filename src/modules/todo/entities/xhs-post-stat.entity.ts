import { ObjectId } from 'mongodb';

/**
 * @description 小红书热门评论快照结构
 * @keyword-en xhs top comment snapshot
 */
export interface XhsTopComment {
  /** 评论内容 */
  content: string;
  /** 该评论点赞数 */
  likeCount: number;
  /** 该评论回复数 */
  replyCount: number;
}

/**
 * @description 小红书帖子数据收集实体
 * @keyword-en xhs post stat entity, data collection
 */
export interface XhsPostStatEntity {
  _id: ObjectId;
  /** 自增序号ID */
  id: number;
  /** 关联任务ID（todos.id） */
  todoId: number;
  /** 帖子 tag（分类标签，如 #穿搭） */
  tag?: string;
  /** 帖子名称（标题） */
  postTitle: string;
  /** 帖子唯一 hash（基于标题或URL，用于去重） */
  postHash: string;
  /** 原文链接 */
  postUrl?: string;
  /** 博主主页链接 */
  authorUrl?: string;
  /** 点赞量 */
  likeCount: number;
  /** 评论量 */
  commentCount: number;
  /** 收藏量 */
  collectCount: number;
  /** 曝光/浏览量，采集端未提供时为 undefined，前端据此显示「待采集」 */
  viewCount?: number;
  /** 分享量，采集端未提供时为 undefined，前端据此显示「待采集」 */
  shareCount?: number;
  /** 归属子选题 ID，由抓取任务绑定关系回填，历史数据可能缺失 */
  topicId?: number;
  /** 归属的抓取运行记录 ID；一个周期 Todo 对应一个运行批次。 */
  crawlRunId?: number;
  /** 前 5 条热门评论快照 */
  topComments: XhsTopComment[];
  /** 数据采集时间 */
  dataAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 小红书帖子数据创建输入
 * @keyword-en xhs post stat create input
 */
export interface XhsPostStatCreateInput {
  todoId: number;
  tag?: string;
  postTitle: string;
  /** 不传时由后端基于 postTitle+postUrl 自动生成 */
  postHash?: string;
  postUrl?: string;
  authorUrl?: string;
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  viewCount?: number;
  shareCount?: number;
  topicId?: number;
  crawlRunId?: number;
  topComments?: XhsTopComment[];
  dataAt?: Date;
}

/**
 * @description 小红书帖子数据更新输入
 * @keyword-en xhs post stat update input
 */
export interface XhsPostStatUpdateInput {
  id: number;
  tag?: string;
  postTitle?: string;
  postHash?: string;
  postUrl?: string;
  authorUrl?: string;
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  viewCount?: number;
  shareCount?: number;
  topicId?: number;
  crawlRunId?: number;
  topComments?: XhsTopComment[];
  dataAt?: Date;
}
