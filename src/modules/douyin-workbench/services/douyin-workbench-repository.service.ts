import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import type {
  DouyinStoryboardShot,
  DouyinTopicEntity,
  DouyinWorkspaceGroup,
} from '../entities/douyin-workbench.entity.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 持久化抖音母子选题、分镜与真实素材引用，并强制租户用户隔离。
 * @keyword-cn 抖音工作台仓储, 租户隔离
 * @keyword-en douyin-workbench-repository, tenant-isolation
 */
@Injectable()
export class DouyinWorkbenchRepositoryService {
  private readonly topics: Collection<DouyinTopicEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly gallery: Collection<Record<string, unknown>>;
  private readonly videos: Collection<Record<string, unknown>>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.topics = db.collection<DouyinTopicEntity>('douyin_topics');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    this.gallery = db.collection('gallery_images');
    this.videos = db.collection('videos');
    void this.ensureIndexes();
  }

  /**
   * @description 创建选题业务 ID、租户用户和父子查询索引。
   * @keyword-cn 抖音选题索引, 父子查询
   * @keyword-en douyin-topic-indexes, parent-child-query
   */
  async ensureIndexes(): Promise<void> {
    await this.topics.createIndex({ id: 1 }, { unique: true });
    await this.topics.createIndex({
      tenantId: 1,
      userId: 1,
      kind: 1,
      updatedAt: -1,
    });
    await this.topics.createIndex({
      tenantId: 1,
      userId: 1,
      parentId: 1,
      updatedAt: -1,
    });
  }

  /**
   * @description 返回当前用户真实母选题及其子选题和分镜。
   * @keyword-cn 查询抖音工作台, 母子聚合
   * @keyword-en list-douyin-workspace, parent-child-aggregation
   */
  async listWorkspace(scope: DouyinScope): Promise<DouyinWorkspaceGroup[]> {
    const rows = await this.topics
      .find(this.scopeFilter(scope))
      .sort({ createdAt: 1 })
      .toArray();
    const children = new Map<number, Array<Omit<DouyinTopicEntity, '_id'>>>();
    for (const row of rows) {
      if (row.kind !== 'child' || !row.parentId) continue;
      const bucket = children.get(row.parentId) ?? [];
      bucket.push(this.toView(row));
      children.set(row.parentId, bucket);
    }
    return rows
      .filter((row) => row.kind === 'mother')
      .map((row) => ({
        ...this.toView(row),
        children: children.get(row.id) ?? [],
      }));
  }

  /**
   * @description 人工新建真实母选题，子选题只能由专用 LLM 生成链路批量写入。
   * @keyword-cn 新建抖音母题, 人工母题
   * @keyword-en create-douyin-mother, manual-mother-topic
   */
  async create(
    input: {
      kind: 'mother';
      title: string;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const now = new Date();
    const doc: DouyinTopicEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      tenantId: scope.tenantId,
      userId: scope.userId,
      kind: 'mother',
      title: input.title.trim(),
      platform: 'douyin',
      storyboard: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await this.topics.insertOne(doc);
    return doc;
  }

  /**
   * @description 校验母选题归属后批量保存 LLM 生成的子选题，并把内容类型固定为短视频。
   * @keyword-cn 保存AI子选题, 固定短视频
   * @keyword-en persist-ai-child-topics, fixed-short-video
   */
  async createChildren(
    parentId: number,
    titles: string[],
    scope: DouyinScope,
  ): Promise<Array<Omit<DouyinTopicEntity, '_id'>>> {
    const parent = await this.topics.findOne({
      ...this.scopeFilter(scope),
      id: parentId,
      kind: 'mother',
    });
    if (!parent) throw new NotFoundException('DOUYIN_PARENT_NOT_FOUND');

    const normalizedTitles = titles
      .map((title) =>
        String(title ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100),
      )
      .filter(Boolean);
    if (!normalizedTitles.length) {
      throw new BadRequestException('DOUYIN_CHILD_TOPICS_REQUIRED');
    }
    const uniqueTitles = new Set(
      normalizedTitles.map((title) => title.toLocaleLowerCase()),
    );
    if (uniqueTitles.size !== normalizedTitles.length) {
      throw new BadRequestException('DOUYIN_CHILD_TOPICS_DUPLICATED');
    }

    const now = new Date();
    const docs: DouyinTopicEntity[] = [];
    for (const title of normalizedTitles) {
      docs.push({
        _id: new ObjectId(),
        id: await this.nextId(),
        tenantId: scope.tenantId,
        userId: scope.userId,
        kind: 'child',
        parentId,
        title,
        topicType: '短视频',
        platform: 'douyin',
        storyboard: [],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.topics.insertMany(docs);
    return docs.map((doc) => this.toView(doc));
  }

  /**
   * @description 按作用域读取一个真实抖音选题。
   * @keyword-cn 读取抖音选题, 所有权校验
   * @keyword-en get-douyin-topic, ownership-check
   */
  async get(id: number, scope: DouyinScope): Promise<DouyinTopicEntity | null> {
    return await this.topics.findOne({ ...this.scopeFilter(scope), id });
  }

  /**
   * @description 保存标题、类型、完整分镜或最终视频素材绑定。
   * @keyword-cn 更新抖音选题, 持久化分镜
   * @keyword-en update-douyin-topic, persist-storyboard
   */
  async update(
    id: number,
    input: {
      title?: string;
      topicType?: string;
      storyboard?: DouyinStoryboardShot[];
      generatedVideoId?: number;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity | null> {
    const current = await this.get(id, scope);
    if (!current) return null;
    if (input.storyboard)
      await this.validateStoryboardMedia(input.storyboard, scope);
    if (input.generatedVideoId)
      await this.requireVideo(input.generatedVideoId, scope);
    const updates: Partial<DouyinTopicEntity> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.topicType !== undefined)
      updates.topicType = input.topicType.trim() || undefined;
    if (input.storyboard !== undefined) {
      updates.storyboard = input.storyboard;
      updates.status = input.storyboard.length ? 'storyboard_ready' : 'draft';
    }
    if (input.generatedVideoId !== undefined) {
      updates.generatedVideoId = input.generatedVideoId;
      updates.status = 'video_ready';
    }
    return await this.topics.findOneAndUpdate(
      { ...this.scopeFilter(scope), id },
      { $set: updates },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 删除当前用户选题，母题会级联删除其全部子题。
   * @keyword-cn 删除抖音选题, 级联删除
   * @keyword-en delete-douyin-topic, cascade-delete
   */
  async remove(id: number, scope: DouyinScope): Promise<number> {
    const current = await this.get(id, scope);
    if (!current) return 0;
    const ids =
      current.kind === 'mother'
        ? (
            await this.topics
              .find({ ...this.scopeFilter(scope), parentId: id })
              .toArray()
          )
            .map((row) => row.id)
            .concat(id)
        : [id];
    const result = await this.topics.deleteMany({
      ...this.scopeFilter(scope),
      id: { $in: ids },
    });
    return result.deletedCount;
  }

  /**
   * @description 校验并返回当前租户可见的真实视频库记录。
   * @keyword-cn 校验视频素材, 视频库归属
   * @keyword-en require-video-asset, video-library-ownership
   */
  async requireVideo(
    id: number,
    scope: DouyinScope,
  ): Promise<Record<string, unknown>> {
    const row = await this.videos.findOne({
      id,
      ...this.tenantFilter(scope.tenantId),
    });
    if (!row) throw new NotFoundException('DOUYIN_VIDEO_ASSET_NOT_FOUND');
    return row;
  }

  /**
   * @description 校验分镜里每个素材 ID 确实属于当前租户的图库或视频库。
   * @keyword-cn 校验分镜素材, 防伪造引用
   * @keyword-en validate-storyboard-media, prevent-forged-reference
   */
  private async validateStoryboardMedia(
    storyboard: DouyinStoryboardShot[],
    scope: DouyinScope,
  ): Promise<void> {
    for (const shot of storyboard) {
      const media = shot.media;
      if (!media) continue;
      const collection = media.type === 'video' ? this.videos : this.gallery;
      const row = await collection.findOne({
        id: media.id,
        ...this.tenantFilter(scope.tenantId),
      });
      if (!row)
        throw new BadRequestException('DOUYIN_STORYBOARD_MEDIA_NOT_FOUND');
    }
  }

  /**
   * @description 生成全局递增的抖音选题业务 ID。
   * @keyword-cn 抖音选题自增ID, 计数器
   * @keyword-en next-douyin-topic-id, counter
   */
  private async nextId(): Promise<number> {
    const result = await this.counters.findOneAndUpdate(
      { _id: 'douyin_topics' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value?.seq ?? 1;
  }

  /**
   * @description 构造用户与租户双重作用域过滤。
   * @keyword-cn 抖音作用域过滤, 用户隔离
   * @keyword-en douyin-scope-filter, user-isolation
   */
  private scopeFilter(scope: DouyinScope): Filter<DouyinTopicEntity> {
    return { userId: scope.userId, ...this.tenantFilter(scope.tenantId) };
  }

  /**
   * @description 构造租户过滤，母平台只访问无 tenantId 的平台数据。
   * @keyword-cn 母平台数据边界, 租户过滤
   * @keyword-en platform-data-boundary, tenant-filter
   */
  private tenantFilter(tenantId?: string): Record<string, unknown> {
    return tenantId
      ? { tenantId }
      : {
          $or: [
            { tenantId: { $exists: false } },
            { tenantId: null },
            { tenantId: '' },
          ],
        };
  }

  /**
   * @description 移除 Mongo _id 后生成前端安全选题视图。
   * @keyword-cn 抖音选题视图, 隐藏数据库ID
   * @keyword-en douyin-topic-view, hide-database-id
   */
  private toView(row: DouyinTopicEntity): Omit<DouyinTopicEntity, '_id'> {
    const view = { ...row } as Partial<DouyinTopicEntity>;
    delete view._id;
    return view as Omit<DouyinTopicEntity, '_id'>;
  }
}
