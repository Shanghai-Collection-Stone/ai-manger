import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Db, Collection, ObjectId } from 'mongodb';
import type {
  XhsPostStatEntity,
  XhsPostStatCreateInput,
  XhsPostStatUpdateInput,
} from '../entities/xhs-post-stat.entity.js';

/**
 * @description 小红书帖子数据收集服务，提供增删改查和索引管理
 * @keyword-en xhs post stat service, data collection, mongo
 */
@Injectable()
export class XhsPostStatService {
  private readonly logger = new Logger(XhsPostStatService.name);
  private readonly stats: Collection<XhsPostStatEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.stats = db.collection<XhsPostStatEntity>('xhs_post_stats');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 确保集合索引存在
   * @keyword-en ensure collection indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.stats.createIndex({ id: 1 }, { unique: true });
    await this.stats.createIndex({ todoId: 1 });
    await this.stats.createIndex({ postHash: 1 });
    await this.stats.createIndex({ todoId: 1, postHash: 1 });
    await this.stats.createIndex({ dataAt: -1 });
    const exists = await this.counters.findOne({ _id: 'xhs_post_stats' });
    if (!exists) await this.counters.insertOne({ _id: 'xhs_post_stats', seq: 0 });
  }

  /**
   * @description 原子递增序号ID
   * @keyword-en next sequence id
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'xhs_post_stats' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 基于标题 + URL 生成帖子唯一 hash（MD5 前 16 位）
   * @keyword-en generate post hash from title and url
   */
  buildPostHash(postTitle: string, postUrl?: string): string {
    const raw = `${postTitle.trim()}|${(postUrl ?? '').trim()}`;
    return createHash('md5').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * @description 创建一条帖子数据记录
   * @keyword-en create xhs post stat
   */
  async create(input: XhsPostStatCreateInput): Promise<XhsPostStatEntity> {
    const now = new Date();
    const id = await this.nextId();
    const postHash =
      input.postHash?.trim() || this.buildPostHash(input.postTitle, input.postUrl);
    const doc: XhsPostStatEntity = {
      _id: new ObjectId(),
      id,
      todoId: input.todoId,
      tag: input.tag?.trim() || undefined,
      postTitle: input.postTitle,
      postHash,
      postUrl: input.postUrl?.trim() || undefined,
      authorUrl: input.authorUrl?.trim() || undefined,
      likeCount: input.likeCount ?? 0,
      commentCount: input.commentCount ?? 0,
      collectCount: input.collectCount ?? 0,
      topComments: input.topComments ?? [],
      dataAt: input.dataAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    await this.stats.insertOne(doc);
    this.logger.log(`[create] id=${id} todoId=${input.todoId} postHash=${postHash}`);
    return doc;
  }

  /**
   * @description 批量创建帖子数据（每次都新增，不判定重复）
   * @keyword-en bulk insert xhs post stats, always insert new record
   */
  async bulkUpsert(todoId: number, inputs: Omit<XhsPostStatCreateInput, 'todoId'>[]): Promise<{ upserted: number }> {
    let upserted = 0;
    for (const input of inputs) {
      const postHash =
        input.postHash?.trim() || this.buildPostHash(input.postTitle, input.postUrl);
      await this.create({ ...input, todoId, postHash });
      upserted++;
    }
    return { upserted };
  }

  /**
   * @description 按序号ID更新帖子数据
   * @keyword-en update xhs post stat by id
   */
  async update(input: XhsPostStatUpdateInput): Promise<XhsPostStatEntity | null> {
    const now = new Date();
    const upd: Record<string, unknown> = { updatedAt: now };
    for (const [k, v] of Object.entries(input)) {
      if (k === 'id') continue;
      if (v !== undefined) upd[k] = v;
    }
    if (typeof input.postTitle === 'string' || typeof input.postUrl === 'string') {
      const existing = await this.stats.findOne({ id: input.id });
      if (existing && !input.postHash) {
        upd.postHash = this.buildPostHash(
          (input.postTitle ?? existing.postTitle),
          (input.postUrl ?? existing.postUrl),
        );
      }
    }
    const res = await this.stats.findOneAndUpdate(
      { id: input.id },
      { $set: upd },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 按序号ID删除帖子数据
   * @keyword-en delete xhs post stat by id
   */
  async delete(id: number): Promise<boolean> {
    const res = await this.stats.deleteOne({ id });
    return res.deletedCount === 1;
  }

  /**
   * @description 按序号ID获取单条帖子数据
   * @keyword-en get xhs post stat by id
   */
  async get(id: number): Promise<XhsPostStatEntity | null> {
    return (await this.stats.findOne({ id }, { projection: { _id: 0 } })) ?? null;
  }

  /**
   * @description 列出某个任务下的所有帖子数据（按 dataAt 倒序）
   * @keyword-en list xhs post stats by todoId
   */
  async listByTodo(todoId: number): Promise<XhsPostStatEntity[]> {
    return this.stats
      .find({ todoId }, { projection: { _id: 0 } })
      .sort({ dataAt: -1 })
      .toArray();
  }

  /**
   * @description 按 postHash 查找同 todoId 下的已有记录
   * @keyword-en get xhs post stat by hash
   */
  async getByHash(todoId: number, postHash: string): Promise<XhsPostStatEntity | null> {
    return (
      (await this.stats.findOne({ todoId, postHash }, { projection: { _id: 0 } })) ?? null
    );
  }
}
