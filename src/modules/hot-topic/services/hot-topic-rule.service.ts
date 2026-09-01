import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Collection, Db, Filter } from 'mongodb';
import {
  HOT_TOPIC_CATEGORIES,
  type HotTopicCategory,
  type HotTopicRuleEntity,
  type HotTopicRuleFieldPaths,
  type HotTopicRuleHealth,
  type HotTopicScope,
} from '../entities/hot-topic.entity.js';
import { HOT_TOPIC_RULE_PRESETS } from '../entities/hot-topic-presets.js';
import { HotTopicFetcherService } from './hot-topic-fetcher.service.js';

/** @type {number} 单条规则允许配置的最大保留条数。 */
const MAX_RULE_LIMIT = 200;

/** @type {number} 自检时回显的示例标题条数。 */
const HEALTH_SAMPLE_TITLE_COUNT = 3;

/**
 * @description 新建或更新一条采集规则的入参，字段与实体一一对应但全部可选（更新为增量）。
 * @keyword-cn 规则写入入参, 增量更新
 * @keyword-en rule-write-input, partial-update
 */
export interface HotTopicRuleWriteInput {
  name?: string;
  category?: HotTopicCategory;
  platform?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  listPath?: string;
  fields?: HotTopicRuleFieldPaths;
  urlTemplate?: string;
  defaultTags?: string[];
  limit?: number;
  enabled?: boolean;
}

/**
 * @description 热点采集规则仓储：规则 CRUD、内置预置规则幂等初始化、可用性自检与健康快照回写。
 *  「是否可用」不是一个静态开关，而是最近一次自检或采集的真实结果，这样管理页上看到的
 *  可用状态与实际采集行为永远一致。
 * @keyword-cn 采集规则服务, 预置规则, 可用性自检
 * @keyword-en collect-rule-service, builtin-presets, availability-probe
 */
@Injectable()
export class HotTopicRuleService {
  private readonly logger = new Logger(HotTopicRuleService.name);
  private readonly rules: Collection<HotTopicRuleEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly fetcher: HotTopicFetcherService,
  ) {
    this.rules = db.collection<HotTopicRuleEntity>('hot_topic_rules');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 建立规则业务 ID 唯一索引、作用域列表索引与内置规则幂等索引。
   * @returns {Promise<void>} 无返回值。
   * @keyword-cn 规则索引, 幂等约束
   * @keyword-en rule-indexes, idempotent-constraint
   */
  async ensureIndexes(): Promise<void> {
    await this.rules.createIndex({ id: 1 }, { unique: true });
    await this.rules.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.rules.createIndex({ tenantId: 1, userId: 1, enabled: 1 });
    await this.rules.createIndex({ tenantId: 1, userId: 1, builtinKey: 1 });
  }

  /**
   * @description 列出作用域内全部采集规则，按分类再按创建时间排序，供管理页表格直接渲染。
   * @param {HotTopicScope} scope - 租户与用户作用域。
   * @returns {Promise<HotTopicRuleEntity[]>} 规则列表。
   * @keyword-cn 列出采集规则, 管理页列表
   * @keyword-en list-collect-rules, admin-table
   */
  async list(scope: HotTopicScope): Promise<HotTopicRuleEntity[]> {
    return this.rules
      .find(this.scopeFilter(scope), { projection: { _id: 0 } })
      .sort({ category: 1, id: 1 })
      .toArray();
  }

  /**
   * @description 读取作用域内一条规则，取不到返回 null（越权按不存在处理）。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} id - 规则业务 ID。
   * @returns {Promise<HotTopicRuleEntity | null>} 规则实体。
   * @keyword-cn 读取单条规则, 越权防护
   * @keyword-en get-rule, ownership-guard
   */
  async get(
    scope: HotTopicScope,
    id: number,
  ): Promise<HotTopicRuleEntity | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.rules.findOne(
      { ...this.scopeFilter(scope), id },
      { projection: { _id: 0 } },
    );
  }

  /**
   * @description 列出本次采集要跑的规则。显式传 ruleIds 时按 ID 取，否则取全部启用规则；
   *  停用的规则即使被显式选中也不会跑，这样管理页的启用开关是唯一的真实闸门。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number[]} [ruleIds] - 显式选择的规则 ID。
   * @returns {Promise<{ runnable: HotTopicRuleEntity[]; disabled: HotTopicRuleEntity[] }>} 可跑规则与被停用规则。
   * @keyword-cn 解析待采集规则, 启用闸门
   * @keyword-en resolve-runnable-rules, enabled-gate
   */
  async resolveRunnableRules(
    scope: HotTopicScope,
    ruleIds?: number[],
  ): Promise<{
    runnable: HotTopicRuleEntity[];
    disabled: HotTopicRuleEntity[];
  }> {
    const filter: Filter<HotTopicRuleEntity> = this.scopeFilter(scope);
    const wanted = (Array.isArray(ruleIds) ? ruleIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (wanted.length > 0) filter.id = { $in: wanted };
    const rows = await this.rules
      .find(filter, { projection: { _id: 0 } })
      .sort({ category: 1, id: 1 })
      .toArray();
    return {
      runnable: rows.filter((rule) => rule.enabled === true),
      disabled: rows.filter((rule) => rule.enabled !== true),
    };
  }

  /**
   * @description 新建一条采集规则，地址先过内网拦截校验再落库。
   * @param {HotTopicScope} scope - 作用域。
   * @param {HotTopicRuleWriteInput} input - 规则内容。
   * @returns {Promise<HotTopicRuleEntity>} 新建的规则。
   * @throws {Error} 名称、地址或标题路径缺失、地址指向内网时抛出。
   * @keyword-cn 新建采集规则, 地址校验
   * @keyword-en create-collect-rule, endpoint-validation
   */
  async create(
    scope: HotTopicScope,
    input: HotTopicRuleWriteInput,
  ): Promise<HotTopicRuleEntity> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('HOT_TOPIC_RULE_NAME_REQUIRED');
    const endpoint = String(input.endpoint ?? '').trim();
    const endpointError = this.fetcher.validateEndpoint(endpoint);
    if (endpointError)
      throw new Error(`HOT_TOPIC_RULE_ENDPOINT_INVALID:${endpointError}`);
    const fields = this.normalizeFields(input.fields);
    if (!fields.title) throw new Error('HOT_TOPIC_RULE_TITLE_PATH_REQUIRED');

    const now = new Date();
    const rule: HotTopicRuleEntity = {
      id: await this.nextId(),
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      userId: scope.userId,
      name: name.slice(0, 60),
      category: this.normalizeCategory(input.category),
      platform:
        String(input.platform ?? '')
          .trim()
          .slice(0, 30) || '自定义',
      endpoint,
      ...(input.headers
        ? { headers: this.normalizeHeaders(input.headers) }
        : {}),
      listPath: String(input.listPath ?? '').trim(),
      fields,
      ...(input.urlTemplate
        ? { urlTemplate: String(input.urlTemplate).trim().slice(0, 600) }
        : {}),
      defaultTags: this.normalizeTags(input.defaultTags),
      limit: this.normalizeLimit(input.limit),
      enabled: input.enabled !== false,
      builtin: false,
      health: { status: 'unknown' },
      createdAt: now,
      updatedAt: now,
    };
    // insertOne 会把 _id 写回传入对象，而列表接口的投影是排掉 _id 的。插入副本而不是 rule 本身，
    // 「新建」和「列表」两个响应的字段口径才一致。
    await this.rules.insertOne({ ...rule });
    return rule;
  }

  /**
   * @description 增量更新一条规则。改了地址或取值路径后可用性重置为未知，必须重新自检，
   *  否则管理页会挂着上一版配置的「可用」结论误导人。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} id - 规则 ID。
   * @param {HotTopicRuleWriteInput} input - 增量字段。
   * @returns {Promise<HotTopicRuleEntity | null>} 更新后的规则，规则不存在返回 null。
   * @throws {Error} 地址非法时抛出。
   * @keyword-cn 更新采集规则, 重置可用性
   * @keyword-en update-collect-rule, reset-health
   */
  async update(
    scope: HotTopicScope,
    id: number,
    input: HotTopicRuleWriteInput,
  ): Promise<HotTopicRuleEntity | null> {
    const current = await this.get(scope, id);
    if (!current) return null;

    const patch: Partial<HotTopicRuleEntity> = { updatedAt: new Date() };
    let parseChanged = false;

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error('HOT_TOPIC_RULE_NAME_REQUIRED');
      patch.name = name.slice(0, 60);
    }
    if (input.category !== undefined) {
      patch.category = this.normalizeCategory(input.category);
    }
    if (input.platform !== undefined) {
      patch.platform = String(input.platform).trim().slice(0, 30) || '自定义';
    }
    if (input.endpoint !== undefined) {
      const endpoint = String(input.endpoint).trim();
      const endpointError = this.fetcher.validateEndpoint(endpoint);
      if (endpointError) {
        throw new Error(`HOT_TOPIC_RULE_ENDPOINT_INVALID:${endpointError}`);
      }
      if (endpoint !== current.endpoint) parseChanged = true;
      patch.endpoint = endpoint;
    }
    if (input.headers !== undefined) {
      patch.headers = this.normalizeHeaders(input.headers);
      parseChanged = true;
    }
    if (input.listPath !== undefined) {
      const listPath = String(input.listPath).trim();
      if (listPath !== current.listPath) parseChanged = true;
      patch.listPath = listPath;
    }
    if (input.fields !== undefined) {
      const fields = this.normalizeFields(input.fields);
      if (!fields.title) throw new Error('HOT_TOPIC_RULE_TITLE_PATH_REQUIRED');
      patch.fields = fields;
      parseChanged = true;
    }
    if (input.urlTemplate !== undefined) {
      patch.urlTemplate = String(input.urlTemplate).trim().slice(0, 600);
    }
    if (input.defaultTags !== undefined) {
      patch.defaultTags = this.normalizeTags(input.defaultTags);
    }
    if (input.limit !== undefined)
      patch.limit = this.normalizeLimit(input.limit);
    if (input.enabled !== undefined) patch.enabled = input.enabled === true;
    if (parseChanged) patch.health = { status: 'unknown' };

    await this.rules.updateOne({ id: current.id }, { $set: patch });
    return this.get(scope, id);
  }

  /**
   * @description 删除一条采集规则。内置规则允许删除，重新初始化预置规则时会按 `builtinKey` 补回。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} id - 规则 ID。
   * @returns {Promise<boolean>} 是否真的删掉了。
   * @keyword-cn 删除采集规则, 预置可补回
   * @keyword-en delete-collect-rule, preset-restorable
   */
  async remove(scope: HotTopicScope, id: number): Promise<boolean> {
    if (!Number.isInteger(id) || id <= 0) return false;
    const res = await this.rules.deleteOne({ ...this.scopeFilter(scope), id });
    return (res.deletedCount ?? 0) > 0;
  }

  /**
   * @description 幂等初始化平台内置预置规则：按 `builtinKey` 判重，已存在的一条都不动，
   *  只补齐缺失的。用户改过的内置规则不会被覆盖回默认值。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Promise<{ created: number; skipped: number }>} 新建与跳过条数。
   * @keyword-cn 初始化预置规则, 幂等补齐
   * @keyword-en seed-builtin-rules, idempotent-fill
   */
  async seedPresets(
    scope: HotTopicScope,
  ): Promise<{ created: number; skipped: number }> {
    const existing = await this.rules
      .find(
        { ...this.scopeFilter(scope), builtinKey: { $exists: true } },
        { projection: { builtinKey: 1 } },
      )
      .toArray();
    const existingKeys = new Set(
      existing
        .map((row) => String(row.builtinKey ?? '').trim())
        .filter((key) => key.length > 0),
    );

    let created = 0;
    const now = new Date();
    for (const preset of HOT_TOPIC_RULE_PRESETS) {
      if (existingKeys.has(preset.builtinKey)) continue;
      const rule: HotTopicRuleEntity = {
        id: await this.nextId(),
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
        userId: scope.userId,
        name: preset.name,
        category: preset.category,
        platform: preset.platform,
        endpoint: preset.endpoint,
        ...(preset.headers ? { headers: { ...preset.headers } } : {}),
        listPath: preset.listPath,
        fields: { ...preset.fields },
        ...(preset.urlTemplate ? { urlTemplate: preset.urlTemplate } : {}),
        defaultTags: [...preset.defaultTags],
        limit: preset.limit,
        enabled: true,
        builtin: true,
        builtinKey: preset.builtinKey,
        health: { status: 'unknown' },
        createdAt: now,
        updatedAt: now,
      };
      await this.rules.insertOne(rule);
      created += 1;
    }
    return { created, skipped: HOT_TOPIC_RULE_PRESETS.length - created };
  }

  /**
   * @description 对一条规则做真实的采集自检：按当前配置抓一次、解析一次，把结果写回健康快照。
   *  只跑不落库，所以自检不会污染榜单数据。
   * @param {HotTopicScope} scope - 作用域。
   * @param {number} id - 规则 ID。
   * @returns {Promise<HotTopicRuleEntity | null>} 带最新健康快照的规则。
   * @keyword-cn 规则自检, 可用性探测
   * @keyword-en rule-self-check, availability-probe
   */
  async checkRule(
    scope: HotTopicScope,
    id: number,
  ): Promise<HotTopicRuleEntity | null> {
    const rule = await this.get(scope, id);
    if (!rule) return null;
    const result = await this.fetcher.fetchRule(rule);
    await this.saveHealth(rule.id, {
      status: result.ok ? 'ok' : 'failed',
      checkedAt: new Date(),
      sampleCount: result.items.length,
      ...(result.ok
        ? { message: `解析到 ${result.items.length} 条` }
        : { message: result.message ?? '未知原因' }),
      sampleTitles: result.items
        .slice(0, HEALTH_SAMPLE_TITLE_COUNT)
        .map((item) => item.title),
    });
    return this.get(scope, id);
  }

  /**
   * @description 回写规则的可用性快照。正式采集结束后也走这里，所以「是否可用」反映的是
   *  最近一次真实抓取的结果，而不是一个手工维护的状态位。
   * @param {number} ruleId - 规则 ID。
   * @param {HotTopicRuleHealth} health - 健康快照。
   * @returns {Promise<void>} 无返回值。
   * @keyword-cn 回写可用性, 健康快照
   * @keyword-en save-health, health-snapshot
   */
  async saveHealth(ruleId: number, health: HotTopicRuleHealth): Promise<void> {
    await this.rules.updateOne(
      { id: ruleId },
      { $set: { health, updatedAt: new Date() } },
    );
  }

  /**
   * @description 生成规则业务自增 ID。
   * @returns {Promise<number>} 下一个可用 ID。
   * @keyword-cn 规则自增ID, 计数器
   * @keyword-en rule-auto-id, counter
   */
  private async nextId(): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { _id: 'hot_topic_rules' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    return Number(doc?.seq ?? 1);
  }

  /**
   * @description 构造强制作用域过滤，空 tenantId 收口成「无租户」三态匹配，和图库口径一致。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Filter<HotTopicRuleEntity>} MongoDB 过滤条件。
   * @keyword-cn 作用域过滤, 空租户归一
   * @keyword-en scope-filter, null-tenant-normalization
   */
  private scopeFilter(scope: HotTopicScope): Filter<HotTopicRuleEntity> {
    const tenantId = String(scope.tenantId ?? '').trim();
    if (tenantId) return { tenantId };
    return {
      $or: [
        { tenantId: { $exists: false } },
        { tenantId: null },
        { tenantId: '' },
      ],
    } as Filter<HotTopicRuleEntity>;
  }

  /**
   * @description 把分类收敛到合法枚举，非法值一律落到 other。
   * @param {HotTopicCategory} [value] - 待归一的分类。
   * @returns {HotTopicCategory} 合法分类。
   * @keyword-cn 归一分类, 枚举回落
   * @keyword-en normalize-category, enum-fallback
   */
  private normalizeCategory(value?: HotTopicCategory): HotTopicCategory {
    return HOT_TOPIC_CATEGORIES.includes(value as HotTopicCategory)
      ? (value as HotTopicCategory)
      : 'other';
  }

  /**
   * @description 归一化字段取值路径，全部按短字符串截断，标题路径缺省用 `title`。
   * @param {HotTopicRuleFieldPaths} [fields] - 原始路径配置。
   * @returns {HotTopicRuleFieldPaths} 归一化后的路径配置。
   * @keyword-cn 归一字段路径, 默认标题路径
   * @keyword-en normalize-field-paths, default-title-path
   */
  private normalizeFields(
    fields?: HotTopicRuleFieldPaths,
  ): HotTopicRuleFieldPaths {
    const pick = (value?: string): string =>
      (typeof value === 'string' ? value : '').trim().slice(0, 120);
    const title = pick(fields?.title) || 'title';
    const url = pick(fields?.url);
    const heat = pick(fields?.heat);
    const summary = pick(fields?.summary);
    return {
      title,
      ...(url ? { url } : {}),
      ...(heat ? { heat } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  /**
   * @description 归一化附加请求头：丢掉空键空值，最多保留 10 条，避免规则表被塞成任意请求构造器。
   * @param {Record<string, string>} [headers] - 原始请求头。
   * @returns {Record<string, string>} 归一化请求头。
   * @keyword-cn 归一请求头, 数量上限
   * @keyword-en normalize-headers, header-cap
   */
  private normalizeHeaders(
    headers?: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      const name = String(key ?? '').trim();
      const content = String(value ?? '').trim();
      if (!name || !content) continue;
      if (Object.keys(result).length >= 10) break;
      result[name.slice(0, 60)] = content.slice(0, 400);
    }
    return result;
  }

  /**
   * @description 归一化兜底标签：去空、去重、最多 5 个。
   * @param {string[]} [tags] - 原始标签。
   * @returns {string[]} 归一化标签。
   * @keyword-cn 归一兜底标签, 去重
   * @keyword-en normalize-default-tags, dedupe
   */
  private normalizeTags(tags?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(tags) ? tags : [])
          .map((tag) =>
            String(tag ?? '')
              .trim()
              .slice(0, 20),
          )
          .filter((tag) => tag.length > 0),
      ),
    ).slice(0, 5);
  }

  /**
   * @description 把单次保留条数收敛到 1-200，非法值回落 50。
   * @param {number} [value] - 原始条数。
   * @returns {number} 合法条数。
   * @keyword-cn 归一条数上限, 回落默认
   * @keyword-en normalize-limit, default-fallback
   */
  private normalizeLimit(value?: number): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(MAX_RULE_LIMIT, parsed);
  }
}
