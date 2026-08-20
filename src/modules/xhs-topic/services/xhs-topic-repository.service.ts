import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db, Document, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type {
  XhsArticleCanvasCollage,
  XhsArticleUpdateInput,
  XhsChildTopicView,
  XhsTopicArticle,
  XhsTopicCreateInput,
  XhsTopicEntity,
  XhsTopicUpdateInput,
  XhsTopicWorkspaceGroup,
} from '../entities/xhs-topic.entity.js';

/**
 * @description 小红书选题 MongoDB 仓储，提供租户用户隔离的列表、批量创建与级联删除。
 * @keyword-cn 选题数据库服务, 租户隔离
 * @keyword-en topic-repository, tenant-isolation
 */
@Injectable()
export class XhsTopicRepositoryService {
  private readonly topics: Collection<XhsTopicEntity>;
  private readonly articles: Collection<Document>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.topics = db.collection<XhsTopicEntity>('xhs_topics');
    this.articles = db.collection('articles');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建选题业务 ID、租户用户列表和父子关系索引。
   * @keyword-cn 选题索引, 父子关系
   * @keyword-en topic-indexes, parent-child-relation
   */
  async ensureIndexes(): Promise<void> {
    await this.topics.createIndex({ id: 1 }, { unique: true });
    await this.topics.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.topics.createIndex({ tenantId: 1, userId: 1, parentId: 1 });
    await this.topics.createIndex({ tenantId: 1, userId: 1, kind: 1 });
    const latest = await this.topics
      .find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .next();
    const maximumId = Number(latest?.id);
    await this.ensureCounterAtLeast(
      Number.isFinite(maximumId) && maximumId > 0 ? maximumId : 0,
    );
  }

  /**
   * @description 在给定子选题里挑出已经存入文章库的那些 ID。
   * 只按选题 ID 反查入库记录：选题集合的 userId 存后台用户 ObjectId，文章集合的 userId 存用户名，
   * 两个口径不一致，用 userId 关联会永远查不到，所以隔离交给传入的选题 ID 与租户条件。
   * @keyword-cn 已入库子选题, 文章库来源
   * @keyword-en stored-topic-ids, article-library-source
   * @param scope 当前租户与用户作用域。
   * @param topicIds 待判定的子选题业务 ID 列表。
   */
  private async listStoredArticleTopicIds(
    scope: { tenantId?: string; userId: string },
    topicIds: number[],
  ): Promise<Set<number>> {
    const candidateIds = topicIds.filter(
      (topicId) => Number.isInteger(topicId) && topicId > 0,
    );
    if (!candidateIds.length) return new Set();
    const tenantId = String(scope.tenantId ?? '').trim();
    const filter: Filter<Document> = {
      source: 'xhs-topic',
      'meta.xhsTopicId': { $in: candidateIds },
    };
    if (tenantId) filter.tenantId = tenantId;
    const storedArticles = await this.articles
      .find(filter, { projection: { 'meta.xhsTopicId': 1 } })
      .toArray();
    return new Set(
      storedArticles
        .map((article) => Number(article.meta?.xhsTopicId))
        .filter((topicId) => Number.isInteger(topicId) && topicId > 0),
    );
  }

  /**
   * @description 按当前租户和用户读取母题及其未存入文章库的真实子题列表。
   * @keyword-cn 读取选题工作台, 母子聚合
   * @keyword-en list-topic-workspace, parent-child-aggregation
   */
  async listWorkspace(scope: {
    tenantId?: string;
    userId: string;
  }): Promise<XhsTopicWorkspaceGroup[]> {
    const entities = await this.topics
      .find(this.buildScopeFilter(scope))
      .sort({ createdAt: 1, id: 1 })
      .toArray();
    const storedTopicIds = await this.listStoredArticleTopicIds(
      scope,
      entities
        .filter((entity) => entity.kind === 'child')
        .map((entity) => Number(entity.id)),
    );
    const childrenByParent = new Map<number, XhsChildTopicView[]>();
    for (const entity of entities) {
      if (entity.kind !== 'child' || !entity.parentId) continue;
      if (storedTopicIds.has(entity.id)) continue;
      const children = childrenByParent.get(entity.parentId) ?? [];
      children.push(this.toChildView(entity));
      childrenByParent.set(entity.parentId, children);
    }
    return entities
      .filter((entity) => entity.kind === 'mother')
      .map((entity) => {
        const children = childrenByParent.get(entity.id) ?? [];
        return {
          id: entity.id,
          title: entity.title,
          topicType: entity.topicType,
          topicCount: children.length,
          sourceTodoId: entity.sourceTodoId,
          createdAt: entity.createdAt.toISOString(),
          updatedAt: entity.updatedAt.toISOString(),
          children,
        };
      });
  }

  /**
   * @description 批量保存用户确认的候选，子题必须关联当前用户拥有的母题。
   * @keyword-cn 批量创建选题, 父题校验
   * @keyword-en create-topics, parent-validation
   */
  async createMany(
    input: XhsTopicCreateInput,
    scope: { tenantId?: string; userId: string },
  ): Promise<XhsTopicEntity[]> {
    if (input.kind === 'child') {
      if (!input.parentId) throw new Error('XHS_TOPIC_PARENT_REQUIRED');
      const parent = await this.topics.findOne({
        ...this.buildScopeFilter(scope),
        id: input.parentId,
        kind: 'mother',
      });
      if (!parent) throw new Error('XHS_TOPIC_PARENT_NOT_FOUND');
    }
    const candidates = input.candidates
      .map((candidate) => ({
        title: String(candidate.title ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        topicType: String(candidate.topicType ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
      }))
      .filter((candidate) => candidate.title && candidate.topicType)
      .filter(
        (candidate, index, list) =>
          list.findIndex((item) => item.title === candidate.title) === index,
      );
    if (!candidates.length) throw new Error('XHS_TOPIC_CANDIDATES_EMPTY');

    const duplicateFilter: Filter<XhsTopicEntity> = {
      ...this.buildScopeFilter(scope),
      kind: input.kind,
      title: { $in: candidates.map((candidate) => candidate.title) },
    };
    if (input.kind === 'child') duplicateFilter.parentId = input.parentId;
    const existing = await this.topics
      .find(duplicateFilter)
      .project<{ id: number; title: string }>({ id: 1, title: 1 })
      .toArray();
    const storedTopicIds = await this.listStoredArticleTopicIds(
      scope,
      existing.map((entity) => Number(entity.id)),
    );
    const existingTitles = new Set(
      existing
        .filter((entity) => !storedTopicIds.has(Number(entity.id)))
        .map((entity) => entity.title),
    );
    const freshCandidates = candidates.filter(
      (candidate) => !existingTitles.has(candidate.title),
    );
    if (!freshCandidates.length) return [];

    const now = new Date();
    const ids = await this.nextIds(freshCandidates.length);
    const documents: XhsTopicEntity[] = freshCandidates.map(
      (candidate, index) => ({
        _id: new ObjectId(),
        id: ids[index],
        tenantId: String(scope.tenantId ?? '').trim() || null,
        userId: scope.userId,
        kind: input.kind,
        parentId: input.kind === 'child' ? input.parentId : undefined,
        title: candidate.title.slice(0, 100),
        topicType: candidate.topicType.slice(0, 30),
        status: 'pending',
        sourceTodoId: input.sourceTodoId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await this.topics.insertMany(documents);
    return documents;
  }

  /**
   * @description 按作用域读取一条当前用户拥有的真实选题。
   * @keyword-cn 读取真实选题, 文章生成上下文
   * @keyword-en get-owned-topic, article-generation-context
   */
  async getOwnedTopic(
    id: number,
    scope: { tenantId?: string; userId: string },
  ): Promise<XhsTopicEntity | null> {
    return await this.topics.findOne({ ...this.buildScopeFilter(scope), id });
  }

  /**
   * @description 将 Agent 内存中完成的真实文章写入子选题并更新生成状态。
   * @keyword-cn 保存生成文章, 文章落库
   * @keyword-en save-generated-article, persist-article
   */
  async saveGeneratedArticle(
    id: number,
    article: Omit<XhsTopicArticle, 'createdAt' | 'updatedAt'>,
    scope: { tenantId?: string; userId: string },
  ): Promise<XhsTopicEntity | null> {
    const now = new Date();
    return await this.topics.findOneAndUpdate(
      { ...this.buildScopeFilter(scope), id, kind: 'child' },
      {
        $set: {
          article: { ...article, createdAt: now, updatedAt: now },
          status: 'generated',
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 修改已生成文章的标题、正文、标签、真实配图或内容形式。
   * @keyword-cn 更新真实文章, 文章配图
   * @keyword-en update-persisted-article, article-images
   */
  async updateArticle(
    id: number,
    input: XhsArticleUpdateInput,
    scope: { tenantId?: string; userId: string },
  ): Promise<XhsTopicEntity | null> {
    const topic = await this.topics.findOne({
      ...this.buildScopeFilter(scope),
      id,
      kind: 'child',
      article: { $exists: true },
    });
    if (!topic?.article) return null;
    const article = { ...topic.article };
    if (typeof input.title === 'string') {
      const title = input.title.replace(/\s+/g, ' ').trim();
      if (title) article.title = title.slice(0, 100);
    }
    if (typeof input.body === 'string') {
      const body = input.body.trim();
      if (body) article.body = body.slice(0, 5000);
    }
    if (Array.isArray(input.tags)) {
      article.tags = this.normalizeStringList(input.tags, 20, 30);
    }
    if (Array.isArray(input.images)) {
      article.images = this.normalizeStringList(input.images, 20, 2000);
    }
    if (Array.isArray(input.canvasBoards)) {
      article.canvasBoards = input.canvasBoards.slice(0, 20).map((board) => ({
        imageIndex: Math.max(0, Math.min(19, Math.floor(board.imageIndex))),
        kind: board.kind === 'cover' ? 'cover' : 'inner',
        ...(board.title
          ? { title: String(board.title).trim().slice(0, 100) }
          : {}),
        ...(board.subtitle
          ? { subtitle: String(board.subtitle).trim().slice(0, 100) }
          : {}),
        ...(board.baseSrc
          ? { baseSrc: String(board.baseSrc).trim().slice(0, 2000) }
          : {}),
        ...(Array.isArray(board.materials)
          ? {
              materials: board.materials.slice(0, 8).map((material) => ({
                id: String(material.id).trim().slice(0, 100),
                name: String(material.name).trim().slice(0, 100),
                src: String(material.src).trim().slice(0, 2000),
                materialSrc: String(material.materialSrc).trim().slice(0, 2000),
                x: Number(material.x),
                y: Number(material.y),
                width: Math.max(1, Number(material.width)),
                height: Math.max(1, Number(material.height)),
                canvasWidth: Math.max(1, Number(material.canvasWidth)),
                canvasHeight: Math.max(1, Number(material.canvasHeight)),
                ...(material.includesText === true
                  ? { includesText: true }
                  : {}),
                ...(material.effect && typeof material.effect === 'object'
                  ? { effect: material.effect }
                  : {}),
              })),
            }
          : {}),
        ...this.normalizeCanvasCollage(board.collage),
      }));
    }
    if (input.contentType) article.contentType = input.contentType;
    article.updatedAt = new Date();
    return await this.topics.findOneAndUpdate(
      { ...this.buildScopeFilter(scope), id, kind: 'child' },
      { $set: { article, updatedAt: article.updatedAt } },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 归一化画板里的拼图画布格式，过滤空地址与非法尺寸格子，不足两格视为普通单图。
   * @keyword-cn 拼图画布格式, 可换图拼图
   * @keyword-en collage-canvas-format, swappable-collage
   */
  private normalizeCanvasCollage(collage?: XhsArticleCanvasCollage): {
    collage?: XhsArticleCanvasCollage;
  } {
    const width = Number(collage?.width);
    const height = Number(collage?.height);
    if (!(width > 0) || !(height > 0)) return {};
    const cells = (collage?.cells ?? [])
      .slice(0, 4)
      .map((cell) => ({
        src: String(cell?.src ?? '')
          .trim()
          .slice(0, 2000),
        ...(Number.isFinite(Number(cell?.imageId))
          ? { imageId: Math.max(0, Math.floor(Number(cell.imageId))) }
          : {}),
        x: Math.max(0, Number(cell?.x) || 0),
        y: Math.max(0, Number(cell?.y) || 0),
        width: Number(cell?.width) || 0,
        height: Number(cell?.height) || 0,
        objectFit: cell?.objectFit === 'contain' ? 'contain' : 'cover',
      }))
      .filter(
        (cell) => Boolean(cell.src) && cell.width > 0 && cell.height > 0,
      ) as XhsArticleCanvasCollage['cells'];
    if (cells.length < 2) return {};
    return { collage: { width, height, cells } };
  }

  /**
   * @description 删除当前用户指定选题，命中母题时同时删除其所有子题。
   * @keyword-cn 删除选题, 级联子题
   * @keyword-en delete-topics, cascade-children
   */
  async deleteMany(
    ids: number[],
    scope: { tenantId?: string; userId: string },
  ): Promise<number> {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id)))];
    if (!uniqueIds.length) return 0;
    const mothers = await this.topics
      .find({
        ...this.buildScopeFilter(scope),
        id: { $in: uniqueIds },
        kind: 'mother',
      })
      .project<{ id: number }>({ id: 1 })
      .toArray();
    const result = await this.topics.deleteMany({
      ...this.buildScopeFilter(scope),
      $or: [
        { id: { $in: uniqueIds } },
        { parentId: { $in: mothers.map((entity) => entity.id) } },
      ],
    });
    return result.deletedCount;
  }

  /**
   * @description 修改当前用户选题的标题、题目类型或状态。
   * @keyword-cn 更新选题, 发布状态
   * @keyword-en update-topic, publish-status
   */
  async update(
    id: number,
    input: XhsTopicUpdateInput,
    scope: { tenantId?: string; userId: string },
  ): Promise<XhsTopicEntity | null> {
    const updates: Partial<XhsTopicEntity> = { updatedAt: new Date() };
    if (typeof input.title === 'string') {
      const title = input.title.replace(/\s+/g, ' ').trim();
      if (title) updates.title = title.slice(0, 100);
    }
    if (typeof input.topicType === 'string') {
      const topicType = input.topicType.replace(/\s+/g, ' ').trim();
      if (topicType) updates.topicType = topicType.slice(0, 30);
    }
    if (input.status) updates.status = input.status;
    return await this.topics.findOneAndUpdate(
      { ...this.buildScopeFilter(scope), id },
      { $set: updates },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 校准计数器后一次分配一段小红书选题业务 ID。
   * @keyword-cn 批量选题业务ID, 自增计数器
   * @keyword-en allocate-topic-ids, sequence-counter
   */
  private async nextIds(count: number): Promise<number[]> {
    const size = Math.max(1, Math.floor(count));
    const latest = await this.topics
      .find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .next();
    const maximumId = Number(latest?.id);
    await this.ensureCounterAtLeast(
      Number.isFinite(maximumId) && maximumId > 0 ? maximumId : 0,
    );
    const result = await this.counters.findOneAndUpdate(
      { _id: 'xhs_topics' },
      { $inc: { seq: size } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const lastId =
      typeof result.value?.seq === 'number' ? result.value.seq : size;
    return Array.from({ length: size }, (_item, index) =>
      Number(lastId - size + index + 1),
    );
  }

  /**
   * @description 将选题计数器推进到已有最大业务 ID，避免历史数据与新 ID 冲突。
   * @keyword-cn 选题计数器校准, 业务ID防冲突
   * @keyword-en topic-counter-calibration, id-collision-guard
   */
  private async ensureCounterAtLeast(sequence: number): Promise<void> {
    const nextSequence = Math.max(0, Math.floor(Number(sequence) || 0));
    await this.counters.updateOne(
      { _id: 'xhs_topics' },
      [
        {
          $set: {
            seq: {
              $cond: [
                { $gte: [{ $ifNull: ['$seq', 0] }, nextSequence] },
                '$seq',
                nextSequence,
              ],
            },
          },
        },
      ],
      { upsert: true },
    );
  }

  /**
   * @description 构造严格的租户和用户查询条件，无租户时兼容 MongoDB 的 null 与缺失字段。
   * @keyword-cn 查询作用域, 用户隔离
   * @keyword-en scope-filter, user-isolation
   */
  private buildScopeFilter(scope: {
    tenantId?: string;
    userId: string;
  }): Filter<XhsTopicEntity> {
    const tenantId = String(scope.tenantId ?? '').trim();
    return {
      userId: scope.userId,
      tenantId: tenantId || null,
    };
  }

  /**
   * @description 规整文章标签或图片地址列表并去重截断。
   * @keyword-cn 规整文章列表, 去重截断
   * @keyword-en normalize-article-list, deduplicate-values
   */
  private normalizeStringList(
    values: string[],
    maximumItems: number,
    maximumLength: number,
  ): string[] {
    return [
      ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
    ]
      .slice(0, maximumItems)
      .map((value) => value.slice(0, maximumLength));
  }

  /**
   * @description 将子选题数据库实体转换为前端列表结构。
   * @keyword-cn 子选题转换, 接口视图
   * @keyword-en child-topic-view, api-view
   */
  private toChildView(entity: XhsTopicEntity): XhsChildTopicView {
    return {
      id: entity.id,
      parentId: entity.parentId as number,
      title: entity.title,
      topicType: entity.topicType,
      status: entity.status,
      article: entity.article
        ? {
            ...entity.article,
            createdAt: entity.article.createdAt.toISOString(),
            updatedAt: entity.article.updatedAt.toISOString(),
          }
        : undefined,
      sourceTodoId: entity.sourceTodoId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
