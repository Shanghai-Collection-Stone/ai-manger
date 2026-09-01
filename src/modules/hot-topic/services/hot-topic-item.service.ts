import { Inject, Injectable } from '@nestjs/common';
import type { AnyBulkWriteOperation, Collection, Db, Filter } from 'mongodb';
import {
  HOT_TOPIC_CATEGORIES,
  type HotTopicCategory,
  type HotTopicItemEntity,
  type HotTopicScope,
  type HotTopicTagSummary,
} from '../entities/hot-topic.entity.js';

/** @type {number} 榜单分页每页上限。 */
const MAX_PAGE_SIZE = 200;

/** @type {number} 标签汇总里每个标签回显的示例标题条数。 */
const TAG_SAMPLE_TITLE_COUNT = 5;

/**
 * @description 榜单条目查询条件：分类、来源规则与归类标签三个维度可任意组合。
 * @keyword-cn 榜单查询条件, 多维过滤
 * @keyword-en item-query, multi-filter
 */
export interface HotTopicItemQuery {
  category?: HotTopicCategory;
  ruleId?: number;
  tag?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * @description 热点条目仓储：批量入库、按作用域清库、分页查询、标签回写与标签线性汇总。
 * @keyword-cn 热点条目服务, 榜单存储
 * @keyword-en hot-topic-item-service, board-storage
 */
@Injectable()
export class HotTopicItemService {
  private readonly items: Collection<HotTopicItemEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.items = db.collection<HotTopicItemEntity>('hot_topic_items');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 建立条目业务 ID 唯一索引与作用域、批次、标签查询索引。
   * @returns {Promise<void>} 无返回值。
   * @keyword-cn 条目索引, 批次索引
   * @keyword-en item-indexes, batch-index
   */
  async ensureIndexes(): Promise<void> {
    await this.items.createIndex({ id: 1 }, { unique: true });
    await this.items.createIndex({ tenantId: 1, userId: 1, collectedAt: -1 });
    await this.items.createIndex({ tenantId: 1, userId: 1, batchId: 1 });
    await this.items.createIndex({ tenantId: 1, userId: 1, ruleId: 1 });
    await this.items.createIndex({ tenantId: 1, userId: 1, category: 1 });
    await this.items.createIndex({ tenantId: 1, userId: 1, tags: 1 });
  }

  /**
   * @description 批量写入本次采集到的热点条目，逐条分配业务自增 ID。
   * @param {HotTopicItemEntity[]} items - 待入库条目（不含 id）。
   * @returns {Promise<HotTopicItemEntity[]>} 带 id 的已入库条目。
   * @keyword-cn 批量入库热点, 分配ID
   * @keyword-en bulk-insert-items, assign-id
   */
  async insertMany(
    items: Array<Omit<HotTopicItemEntity, 'id'>>,
  ): Promise<HotTopicItemEntity[]> {
    if (items.length === 0) return [];
    const startId = await this.reserveIds(items.length);
    const rows: HotTopicItemEntity[] = items.map((item, index) => ({
      ...item,
      id: startId + index,
    }));
    await this.items.insertMany(rows);
    return rows;
  }

  /**
   * @description 清空作用域内的历史热点条目。每次采集默认先清再采，因为热榜是「当下快照」，
   *  留着上一轮的条目会让榜单混进已经过气的热点，推荐时反而干扰判断。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number[]} [ruleIds] - 只清这些规则的历史；不传则清作用域内全部。
   * @returns {Promise<number>} 清掉的条数。
   * @keyword-cn 清除历史热点, 采集前清库
   * @keyword-en clear-previous-items, pre-collect-purge
   */
  async clear(scope: HotTopicScope, ruleIds?: number[]): Promise<number> {
    const filter: Filter<HotTopicItemEntity> = this.scopeFilter(scope);
    const wanted = (Array.isArray(ruleIds) ? ruleIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (wanted.length > 0) filter.ruleId = { $in: wanted };
    const res = await this.items.deleteMany(filter);
    return res.deletedCount ?? 0;
  }

  /**
   * @description 分页查询榜单条目，按分类 / 来源规则 / 归类标签 / 标题关键词过滤，名次升序。
   * @param {HotTopicScope} scope - 作用域。
   * @param {HotTopicItemQuery} query - 查询条件。
   * @returns {Promise<{ rows: HotTopicItemEntity[]; total: number; page: number; pageSize: number }>} 分页结果。
   * @keyword-cn 分页查询榜单, 标签过滤
   * @keyword-en paged-item-list, tag-filter
   */
  async list(
    scope: HotTopicScope,
    query: HotTopicItemQuery,
  ): Promise<{
    rows: HotTopicItemEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const filter = this.buildQueryFilter(scope, query);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Math.floor(Number(query.pageSize) || 50)),
    );
    const [rows, total] = await Promise.all([
      this.items
        .find(filter, { projection: { _id: 0 } })
        .sort({ ruleId: 1, rank: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      this.items.countDocuments(filter),
    ]);
    return { rows, total, page, pageSize };
  }

  /**
   * @description 取出推荐用的候选热点，按名次升序截断到上限，只带模型需要的字段。
   * @param {HotTopicScope} scope - 作用域。
   * @param {HotTopicItemQuery & { tags?: string[]; limit?: number }} query - 候选筛选条件。
   * @returns {Promise<HotTopicItemEntity[]>} 候选热点列表。
   * @keyword-cn 推荐候选热点, 候选截断
   * @keyword-en recommend-candidates, candidate-cap
   */
  async listCandidates(
    scope: HotTopicScope,
    query: HotTopicItemQuery & {
      tags?: string[];
      ruleIds?: number[];
      limit?: number;
    },
  ): Promise<HotTopicItemEntity[]> {
    const filter = this.buildQueryFilter(scope, query);
    const ruleIds = (Array.isArray(query.ruleIds) ? query.ruleIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ruleIds.length > 0) filter.ruleId = { $in: ruleIds };
    const tags = (Array.isArray(query.tags) ? query.tags : [])
      .map((tag) => String(tag ?? '').trim())
      .filter((tag) => tag.length > 0);
    if (tags.length > 0) filter.tags = { $in: tags };
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Math.floor(Number(query.limit) || 80)),
    );
    return this.items
      .find(filter, { projection: { _id: 0 } })
      .sort({ rank: 1, ruleId: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * @description 按 ID 批量回写 AI 归类结果，一次 bulkWrite 落盘。
   * @param {Array<{ id: number; tags: string[]; tagSource: HotTopicItemEntity['tagSource'] }>} updates - 归类结果。
   * @returns {Promise<number>} 实际更新条数。
   * @keyword-cn 回写归类标签, 批量更新
   * @keyword-en save-classified-tags, bulk-update
   */
  async applyTags(
    updates: Array<{
      id: number;
      tags: string[];
      tagSource: HotTopicItemEntity['tagSource'];
    }>,
  ): Promise<number> {
    const operations: AnyBulkWriteOperation<HotTopicItemEntity>[] = updates
      .filter((update) => Number.isInteger(update.id) && update.id > 0)
      .map((update) => ({
        updateOne: {
          filter: { id: update.id },
          update: {
            $set: { tags: update.tags, tagSource: update.tagSource },
          },
        },
      }));
    if (operations.length === 0) return 0;
    const res = await this.items.bulkWrite(operations);
    return res.modifiedCount ?? 0;
  }

  /**
   * @description 列出作用域内全部归类标签及其条目数，按条目数倒序。相比 `listTagSummary` 不带示例标题，
   *  是给推荐链路第一阶段「先按 tag 粗筛」用的轻量清单——那一步只需要标签名和规模，
   *  把示例标题也塞进提示词只会白白撑大上下文。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} [limit] - 标签数量上限，默认 200。
   * @returns {Promise<Array<{ tag: string; count: number }>>} 标签与条目数。
   * @keyword-cn 标签清单, 标签粗筛
   * @keyword-en tag-list, tag-prefilter
   */
  async listTagNames(
    scope: HotTopicScope,
    limit = 200,
  ): Promise<Array<{ tag: string; count: number }>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const pipeline: Record<string, unknown>[] = [
      { $match: this.scopeFilter(scope) },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: safeLimit },
      { $project: { _id: 0, tag: '$_id', count: 1 } },
    ];
    return this.items
      .aggregate<{ tag: string; count: number }>(pipeline)
      .toArray();
  }

  /**
   * @description 汇总作用域内全部归类标签，按命中条数倒序线性铺开，供后台「查看采集标签」弹窗逐条查看。
   *  每个标签带上出现过的分类与若干示例标题，人工一眼就能判断 AI 归类是否跑偏。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Promise<HotTopicTagSummary[]>} 标签汇总列表。
   * @keyword-cn 标签汇总, 线性查看标签
   * @keyword-en tag-summary, linear-tag-view
   */
  async listTagSummary(scope: HotTopicScope): Promise<HotTopicTagSummary[]> {
    const pipeline: Record<string, unknown>[] = [
      { $match: this.scopeFilter(scope) },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          categories: { $addToSet: '$category' },
          latestAt: { $max: '$collectedAt' },
          sampleTitles: { $push: '$title' },
        },
      },
      { $sort: { count: -1, _id: 1 } },
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1,
          categories: 1,
          latestAt: 1,
          sampleTitles: { $slice: ['$sampleTitles', TAG_SAMPLE_TITLE_COUNT] },
        },
      },
    ];
    return this.items.aggregate<HotTopicTagSummary>(pipeline).toArray();
  }

  /**
   * @description 取出作用域内尚未被 AI 归类（`tagSource !== 'ai'`）的条目，供补跑归类使用。
   *  直接按 `tagSource` 查而不是翻分页列表：一轮采集就可能有几百条，翻页只能覆盖第一页，
   *  剩下的会被永远漏掉。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} [limit] - 单次补跑的条数上限，默认 500。
   * @returns {Promise<HotTopicItemEntity[]>} 未归类条目。
   * @keyword-cn 未归类条目, 补跑归类
   * @keyword-en untagged-items, retag-pending
   */
  async listUntagged(
    scope: HotTopicScope,
    limit = 500,
  ): Promise<HotTopicItemEntity[]> {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.items
      .find(
        { ...this.scopeFilter(scope), tagSource: { $ne: 'ai' } },
        { projection: { _id: 0 } },
      )
      .sort({ id: 1 })
      .limit(safeLimit)
      .toArray();
  }

  /**
   * @description 统计作用域内榜单概况：总条数、已归类条数与最近采集时间，供管理页顶部摘要。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Promise<{ total: number; tagged: number; latestAt: Date | null }>} 概况统计。
   * @keyword-cn 榜单概况, 归类进度
   * @keyword-en board-summary, tagging-progress
   */
  async summarize(
    scope: HotTopicScope,
  ): Promise<{ total: number; tagged: number; latestAt: Date | null }> {
    const filter = this.scopeFilter(scope);
    const [total, tagged, latest] = await Promise.all([
      this.items.countDocuments(filter),
      this.items.countDocuments({ ...filter, tagSource: 'ai' }),
      this.items
        .find(filter, { projection: { collectedAt: 1 } })
        .sort({ collectedAt: -1 })
        .limit(1)
        .next(),
    ]);
    return { total, tagged, latestAt: latest?.collectedAt ?? null };
  }

  /**
   * @description 组装条目查询过滤条件，作用域强制生效，其余维度按需叠加。
   * @param {HotTopicScope} scope - 作用域。
   * @param {HotTopicItemQuery} query - 查询条件。
   * @returns {Filter<HotTopicItemEntity>} MongoDB 过滤条件。
   * @keyword-cn 组装查询条件, 作用域强制
   * @keyword-en build-query-filter, enforced-scope
   */
  private buildQueryFilter(
    scope: HotTopicScope,
    query: HotTopicItemQuery,
  ): Filter<HotTopicItemEntity> {
    const filter: Filter<HotTopicItemEntity> = this.scopeFilter(scope);
    if (query.category && HOT_TOPIC_CATEGORIES.includes(query.category)) {
      filter.category = query.category;
    }
    const ruleId = Number(query.ruleId);
    if (Number.isInteger(ruleId) && ruleId > 0) filter.ruleId = ruleId;
    const tag = String(query.tag ?? '').trim();
    if (tag) filter.tags = tag;
    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      filter.title = {
        $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }
    return filter;
  }

  /**
   * @description 构造强制作用域过滤，空 tenantId 收口成「无租户」三态匹配。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Filter<HotTopicItemEntity>} MongoDB 过滤条件。
   * @keyword-cn 作用域过滤, 空租户归一
   * @keyword-en scope-filter, null-tenant-normalization
   */
  private scopeFilter(scope: HotTopicScope): Filter<HotTopicItemEntity> {
    const tenantId = String(scope.tenantId ?? '').trim();
    if (tenantId) return { tenantId };
    return {
      $or: [
        { tenantId: { $exists: false } },
        { tenantId: null },
        { tenantId: '' },
      ],
    } as Filter<HotTopicItemEntity>;
  }

  /**
   * @description 一次性预留一段连续的条目业务 ID，避免逐条打计数器。
   * @param {number} count - 需要的 ID 数量。
   * @returns {Promise<number>} 该段的起始 ID。
   * @keyword-cn 预留自增ID, 连续段
   * @keyword-en reserve-auto-ids, id-block
   */
  private async reserveIds(count: number): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { _id: 'hot_topic_items' },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: 'after' },
    );
    const end = Number(doc?.seq ?? count);
    return end - count + 1;
  }
}
