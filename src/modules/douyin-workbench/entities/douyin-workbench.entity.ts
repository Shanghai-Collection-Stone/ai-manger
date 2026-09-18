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
 * @description 抖音短视频的一段可编辑分镜。`imagePrompt` 是这一镜配图的文生图描述，重新生成画面时直接用它；
 *   `videoId` 是这一镜最近一次生成成功的分镜视频，整条成片仍记在选题的 `generatedVideoId` 上。
 * @keyword-cn 分镜段落, 镜头脚本, 分镜配图提示, 分镜视频
 * @keyword-en storyboard-shot, shot-script, shot-image-prompt, shot-video
 */
export interface DouyinStoryboardShot {
  id: string;
  duration: number;
  shotType: string;
  visual: string;
  narration: string;
  transition: string;
  media?: DouyinMediaReference | null;
  imagePrompt?: string;
  videoId?: number;
}

/**
 * @description 脚本拆分镜时的配图偏向：`generate` 先写文字分镜再逐镜文生图，`gallery` 从租户图库挑图，
 *   `galleryTags` 非空时只在带这些标签（任一命中）的图片里挑。
 * @keyword-cn 分镜配图偏向, 图库标签限定
 * @keyword-en storyboard-image-preference, gallery-tag-filter
 */
export interface DouyinStoryboardPreference {
  imageSource: 'generate' | 'gallery';
  galleryTags: string[];
}

/**
 * @description 生成视频的声音设置（结构化，按脚本保存，整片与分镜共用）：
 *   `voiceover` 按口播稿配音，`music` 只要背景音乐与环境音，`mute` 无声；`language` 为配音语言。
 * @keyword-cn 视频声音设置, 配音语言
 * @keyword-en video-audio-setting, voiceover-language
 */
export interface DouyinVideoAudioSetting {
  mode: 'voiceover' | 'music' | 'mute';
  language: 'zh-CN' | 'yue' | 'en';
}

/**
 * @description AI 生成、还没被用户挑选入库的候选脚本，暂存在子选题生成任务的结果里。
 * @keyword-cn 候选脚本, 待选择脚本
 * @keyword-en script-draft, pending-script-selection
 */
export interface DouyinScriptDraft {
  key: string;
  title: string;
  script: string;
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
  /** @description 子选题（脚本）的口播正文，母选题为空；分镜按它逐段拆解 */
  script?: string;
  topicType?: string;
  /** @description 子选题（脚本）拆分镜时的配图偏向，缺省按图库自找、不限标签 */
  storyboardPreference?: DouyinStoryboardPreference;
  /** @description 生成视频的声音设置，缺省为普通话配音 */
  videoAudio?: DouyinVideoAudioSetting;
  /** @description 整片模式的目标时长（秒），为空表示按分镜总时长自动决定 */
  fullVideoDuration?: number;
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
 *   分镜任务在 `queued` 阶段等待并发名额；`imaging` 阶段文字分镜已保存，`current/total` 是已出图数 / 需出图镜头数。
 * @keyword-cn 生成任务进度, 工具写入计数, 先文字后配图
 * @keyword-en generation-job-progress, tool-write-count, text-first-imaging
 */
export interface DouyinGenerationJobProgress {
  stage: 'queued' | 'preparing' | 'planning' | 'writing' | 'imaging' | 'saving';
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
    /** 分镜任务 AI 出图成功 / 失败的镜头数 */
    imageCount?: number;
    imageFailedCount?: number;
    decidedCount?: number;
    /** 子选题任务生成的候选脚本，用户挑选后才入库 */
    drafts?: DouyinScriptDraft[];
    /** 候选脚本已保存或已放弃的时间，之后不再提示挑选 */
    draftsSettledAt?: Date;
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
  /** @description 分镜级视频生成才有：对应 `DouyinStoryboardShot.id`；为空表示整条成片 */
  shotId?: string;
  /** @description 视频生成走的通道：`direct` 为环境变量直连服务，`pixmax` 为后台节点指定的 PixMax */
  provider?: 'direct' | 'pixmax';
  /** @description 视频生成模式：`shot` 单镜，`full` 所有分镜一次生成整片 */
  mode?: 'shot' | 'full';
  /** @description 实际使用的模型编码（PixMax 通道） */
  model?: string;
  /** @description 供应商回报的生成进度百分比 */
  progress?: number;
  /** @description PixMax 通道本次实际采用的生成方案（生成方式、参考图张数、实际 / 计划时长、是否压缩） */
  plan?: {
    referModel?: string;
    imageCount: number;
    duration?: number;
    plannedSeconds?: number;
    durationClamped: boolean;
    /** 用户设定的目标时长（秒），自动时为空 */
    targetSeconds?: number;
    /** 本次采用的声音设置 */
    audioMode?: DouyinVideoAudioSetting['mode'];
    audioLanguage?: DouyinVideoAudioSetting['language'];
    /** 是否把脚本正文（整片）或本镜口播（分镜）作为口播稿提交 */
    scriptIncluded?: boolean;
  };
  status: string;
  externalId?: string;
  result?: unknown;
  /** @description 给用户看的失败说明（中文） */
  error?: string;
  /** @description 失败的原始信息（供排查，前端折叠显示） */
  errorDetail?: string;
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
  /** @description PixMax 通道使用的提供商记录 ID，轮询时据此取 Key */
  providerId?: string;
}
