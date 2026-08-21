import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import type { ObjectId } from 'mongodb';

/**
 * @description 小红书选题生成层级，母选题用于长期内容方向，子选题用于具体文章题目。
 * @keyword-cn 选题层级, 母选题, 子选题
 * @keyword-en topic-kind, mother-topic, child-topic
 */
export type XhsTopicKind = 'mother' | 'child';

/**
 * @description Agent 通过内存追加工具写入的单条选题候选。
 * @keyword-cn 选题候选, 题目类型
 * @keyword-en topic-candidate, topic-type
 */
export interface XhsTopicCandidate {
  title: string;
  topicType: string;
}

/**
 * @description 入库选题的业务状态。
 * @keyword-cn 选题状态, 入库状态
 * @keyword-en topic-status, persistence-status
 */
export type XhsTopicStatus = 'pending' | 'draft' | 'generated' | 'published';

/**
 * @description 拼图内单张源图在拼图画布上的格子，进入灵感画布后还原成一个可单独换图的图层。
 * @keyword-cn 拼图画布格式, 拼图格子
 * @keyword-en collage-canvas-format, collage-cell
 */
export interface XhsArticleCanvasCollageCell {
  src: string;
  imageId?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  objectFit?: 'cover' | 'contain';
}

/**
 * @description 拼图图片的画布格式：拼图画布尺寸 + 各源图格子，供编辑器逐张替换拼图里的图。
 * @keyword-cn 拼图画布格式, 可换图拼图
 * @keyword-en collage-canvas-format, swappable-collage
 */
export interface XhsArticleCanvasCollage {
  width: number;
  height: number;
  cells: XhsArticleCanvasCollageCell[];
}

/**
 * @description 与封面照片分离保存的可编辑图片素材层，保留原素材、文字融合标记和去底特效参数供再次编辑。
 * @keyword-cn 可编辑装饰素材, 图层分离
 * @keyword-en editable-decoration-material, separated-layers
 */
export interface XhsArticleCanvasMaterial {
  id: string;
  name: string;
  src: string;
  materialSrc: string;
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  includesText?: boolean;
  effect?: Record<string, unknown>;
}

/**
 * @description 文章图片进入灵感画布时使用的结构化画板元数据，支持封面底图、含字海报素材、旧版文字与拼图格子分别保存。
 * @keyword-cn 文章画板, 可编辑封面, 图层分离
 * @keyword-en article-canvas-board, editable-cover, separated-layers
 */
export interface XhsArticleCanvasBoard {
  imageIndex: number;
  kind: 'cover' | 'inner';
  title?: string;
  subtitle?: string;
  baseSrc?: string;
  materials?: XhsArticleCanvasMaterial[];
  collage?: XhsArticleCanvasCollage;
}

/**
 * @description Agent 通过工具写入内存并最终持久化的小红书文章内容。
 * @keyword-cn 真实文章, 内存文章
 * @keyword-en persisted-article, in-memory-article
 */
export interface XhsTopicArticle {
  title: string;
  body: string;
  tags: string[];
  images: string[];
  canvasBoards?: XhsArticleCanvasBoard[];
  contentType: '图文' | '视频' | '直播';
  sourceTodoId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description MongoDB 中持久化的母选题或子选题实体。
 * @keyword-cn 选题实体, 数据库存储
 * @keyword-en topic-entity, database-storage
 */
export interface XhsTopicEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string | null;
  userId: string;
  kind: XhsTopicKind;
  parentId?: number;
  title: string;
  topicType: string;
  status: XhsTopicStatus;
  article?: XhsTopicArticle;
  sourceTodoId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 批量保存用户从候选弹窗中确认的选题。
 * @keyword-cn 保存选题输入, 批量入库
 * @keyword-en save-topics-input, bulk-persistence
 */
export interface XhsTopicCreateInput {
  kind: XhsTopicKind;
  parentId?: number;
  sourceTodoId?: number;
  candidates: XhsTopicCandidate[];
}

/**
 * @description 前端双列表使用的子选题数据结构。
 * @keyword-cn 子选题数据, 真实列表
 * @keyword-en child-topic-data, real-list
 */
export interface XhsChildTopicView {
  id: number;
  parentId: number;
  title: string;
  topicType: string;
  status: XhsTopicStatus;
  article?: Omit<XhsTopicArticle, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };
  sourceTodoId?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * @description 前端双列表使用的母选题及其子选题聚合结构。
 * @keyword-cn 母子选题聚合, 真实工作台
 * @keyword-en topic-workspace-group, real-workspace
 */
export interface XhsTopicWorkspaceGroup {
  id: number;
  title: string;
  topicType: string;
  topicCount: number;
  sourceTodoId?: number;
  createdAt: string;
  updatedAt: string;
  children: XhsChildTopicView[];
}

/**
 * @description 修改已入库选题标题、题目类型或状态的输入。
 * @keyword-cn 更新选题输入, 选题状态
 * @keyword-en update-topic-input, topic-status
 */
export interface XhsTopicUpdateInput {
  title?: string;
  topicType?: string;
  status?: XhsTopicStatus;
}

/**
 * @description 用户对已生成真实文章进行编辑和配图的更新输入。
 * @keyword-cn 编辑真实文章, 文章配图
 * @keyword-en update-persisted-article, article-images
 */
export interface XhsArticleUpdateInput {
  title?: string;
  body?: string;
  tags?: string[];
  images?: string[];
  canvasBoards?: XhsArticleCanvasBoard[];
  contentType?: '图文' | '视频' | '直播';
}

/**
 * @description 文章 Agent 工具在单次运行中逐步填写的内存草稿。
 * @keyword-cn 文章内存草稿, 工具写入
 * @keyword-en article-memory-draft, tool-write
 */
export interface XhsArticleMemoryDraft {
  title?: string;
  body?: string;
  tags: string[];
  imageTags: string[];
  contentType: '图文';
}

/**
 * @description 真实文章生成请求在业务层使用的输入。
 * @keyword-cn 生成真实文章, 文章提示词
 * @keyword-en generate-persisted-article, article-prompt
 */
export interface XhsArticleGenerateInput {
  prompt?: string;
  useSearch?: boolean;
  dedup?: boolean;
  /** 素材风格库预设 id；`random` 表示由服务端为本次封面随机选择。 */
  coverStyle?: string;
  regenerateImages?: boolean;
}

/**
 * @description 写入 Todo taskResult 的真实文章生成结果。
 * @keyword-cn 文章生成结果, 待办文章
 * @keyword-en article-generation-result, todo-article
 */
export interface XhsArticleGenerationResult {
  topicId: number;
  complete: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  article?: Omit<XhsTopicArticle, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };
  generatedAt: string;
  /** 失败码，例如 XHS_ARTICLE_IMAGE_WORKFLOW_INSUFFICIENT */
  error?: string;
  /** 前端可直接展示的中文失败原因 */
  errorMessage?: string;
}

/**
 * @description 单个子选题最近一次文章生成任务的状态，供前端逐条渲染进度与失败原因。
 * @keyword-cn 文章生成状态, 逐条进度
 * @keyword-en article-generation-state, per-topic-progress
 */
export interface XhsArticleGenerationState {
  topicId: number;
  todoId: number;
  status: 'running' | 'done' | 'failed';
  /** 失败码，仅 status=failed 时存在 */
  error?: string;
  /** 前端可直接展示的中文失败原因，仅 status=failed 时存在 */
  errorMessage?: string;
  updatedAt: string;
}

/**
 * @description 小红书选题生成请求在业务层使用的标准输入。
 * @keyword-cn 选题生成输入, 提示词数量
 * @keyword-en topic-generation-input, prompt-quantity
 */
export interface XhsTopicGenerateInput {
  kind: XhsTopicKind;
  prompt?: string;
  parentTopic?: string;
  count?: number;
  useSearch?: boolean;
}

/**
 * @description 保存到 Todo taskResult 的选题生成结果。
 * @keyword-cn 选题生成结果, 待办结果
 * @keyword-en topic-generation-result, todo-result
 */
export interface XhsTopicGenerationResult {
  kind: XhsTopicKind;
  prompt: string;
  parentTopic?: string;
  requestedCount: number;
  generatedCount: number;
  complete: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  candidates: XhsTopicCandidate[];
  generatedAt: string;
  error?: string;
}

/**
 * @description 小红书选题生成接口返回值，Todo 是生成过程与最终结果的持久化载体。
 * @keyword-cn 选题接口响应, 待办持久化
 * @keyword-en topic-api-response, todo-persistence
 */
export interface XhsTopicGenerateResponse {
  todo: TodoEntity;
  result: XhsTopicGenerationResult;
}
