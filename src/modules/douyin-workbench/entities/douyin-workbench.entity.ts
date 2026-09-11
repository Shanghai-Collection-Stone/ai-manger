import { ObjectId } from 'mongodb';

/**
 * @description 抖音分镜引用的真实图库或视频库素材。
 * @keyword-cn 分镜引用素材, 图片视频引用
 * @keyword-en storyboard-media-reference, image-video-reference
 */
export interface DouyinMediaReference {
  type: 'image' | 'video';
  id: number;
  name: string;
  url: string;
  coverUrl?: string;
}

/**
 * @description 抖音短视频的一段可编辑分镜。
 * @keyword-cn 分镜段落, 镜头脚本
 * @keyword-en storyboard-shot, shot-script
 */
export interface DouyinStoryboardShot {
  id: string;
  duration: number;
  shotType: string;
  visual: string;
  narration: string;
  transition: string;
  media?: DouyinMediaReference | null;
}

/**
 * @description 抖音母选题或子选题持久化实体。
 * @keyword-cn 抖音选题实体, 母子选题
 * @keyword-en douyin-topic-entity, parent-child-topics
 */
export interface DouyinTopicEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string;
  userId: string;
  kind: 'mother' | 'child';
  parentId?: number;
  title: string;
  topicType?: string;
  platform: 'douyin';
  storyboard: DouyinStoryboardShot[];
  status: 'draft' | 'storyboard_ready' | 'video_ready' | 'published';
  generatedVideoId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 前端工作台使用的母选题与子选题聚合视图。
 * @keyword-cn 抖音工作台视图, 选题聚合
 * @keyword-en douyin-workspace-view, topic-aggregation
 */
export interface DouyinWorkspaceGroup extends Omit<DouyinTopicEntity, '_id'> {
  children: Array<Omit<DouyinTopicEntity, '_id'>>;
}

/**
 * @description 抖音工作台后台 LLM 生成任务的类型：为子选题生成分镜，或为母选题生成子选题。
 * @keyword-cn 后台生成任务, 生成任务类型
 * @keyword-en background-generation-job, generation-job-kind
 */
export type DouyinGenerationJobKind = 'storyboard' | 'children';

/**
 * @description 后台生成任务的真实进度：`current` 是工具已写入的分镜段数或子选题数，`total` 是子选题规划数量（分镜没有固定总数）。
 * @keyword-cn 生成任务进度, 工具写入计数
 * @keyword-en generation-job-progress, tool-write-count
 */
export interface DouyinGenerationJobProgress {
  stage: 'preparing' | 'planning' | 'writing' | 'saving';
  current: number;
  total?: number;
}

/**
 * @description 后台生成任务的前端视图，前端轮询它渲染进度条与失败原因。
 * @keyword-cn 生成任务视图, 进度轮询
 * @keyword-en generation-job-view, progress-polling
 */
export interface DouyinGenerationJobView {
  id: string;
  kind: DouyinGenerationJobKind;
  /** 分镜任务是子选题 ID，子选题任务是母选题 ID */
  topicId: number;
  status: 'running' | 'done' | 'failed';
  progress: DouyinGenerationJobProgress;
  error?: string;
  errorMessage?: string;
  result?: {
    shotCount?: number;
    decidedCount?: number;
    createdTopicIds?: number[];
  };
  startedAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
}

/**
 * @description 持久化的后台生成任务，保存在 `douyin_generation_jobs`，页面刷新或切走后仍能看到进度。
 * @keyword-cn 后台生成任务, 任务持久化
 * @keyword-en background-generation-job, job-persistence
 */
export interface DouyinGenerationJobEntity extends DouyinGenerationJobView {
  _id: ObjectId;
  tenantId?: string;
  userId: string;
  prompt?: string;
}

/**
 * @description 抖音发布或数据抓取任务的前端安全视图。
 * @keyword-cn 抖音任务视图, 发布抓取状态
 * @keyword-en douyin-task-view, publish-crawl-status
 */
export interface DouyinOperationView {
  id: string;
  operation: 'generate' | 'publish' | 'crawl';
  topicId: number;
  status: string;
  externalId?: string;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 视频生成、发布或抓取直连接口的一次持久化调用记录。
 * @keyword-cn 抖音调用记录, 直连接口审计
 * @keyword-en douyin-operation-record, direct-api-audit
 */
export interface DouyinOperationEntity extends DouyinOperationView {
  _id: ObjectId;
  tenantId?: string;
  userId: string;
  request: Record<string, unknown>;
}
