import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  HotTopicCollectResult,
  HotTopicCollectRuleOutcome,
  HotTopicItemEntity,
  HotTopicRuleEntity,
  HotTopicScope,
} from '../entities/hot-topic.entity.js';
import { HotTopicFetcherService } from './hot-topic-fetcher.service.js';
import { HotTopicItemService } from './hot-topic-item.service.js';
import { HotTopicRuleService } from './hot-topic-rule.service.js';
import { HotTopicTaggingService } from './hot-topic-tagging.service.js';

/**
 * @description 一次采集的入参。`clearPrevious` 缺省为 true——热榜是当下快照，默认每次采集
 *  都先清掉上一轮，需要跨轮次留档时才显式传 false。
 * @keyword-cn 采集入参, 默认清除历史
 * @keyword-en collect-input, clear-previous-default
 */
export interface HotTopicCollectInput {
  /** 只跑这些规则；不传则跑全部启用规则 */
  ruleIds?: number[];
  /** 采集前是否清除历史条目，缺省 true */
  clearPrevious?: boolean;
  /** 采集后是否立刻做 AI 归类，缺省 true */
  autoTag?: boolean;
}

/**
 * @description 热点采集编排：解析待跑规则 → 按需清除历史 → 逐条规则直采公开榜单 → 入库 →
 *  AI 归类打标 → 回写每条规则的可用性快照。单条规则失败只体现在它自己的回执与健康状态上，
 *  不会让整次采集失败。
 * @keyword-cn 热点采集编排, 清除历史, 可用性回写
 * @keyword-en hot-topic-collect-orchestration, clear-previous, health-writeback
 */
@Injectable()
export class HotTopicCollectService {
  private readonly logger = new Logger(HotTopicCollectService.name);

  constructor(
    private readonly ruleService: HotTopicRuleService,
    private readonly itemService: HotTopicItemService,
    private readonly fetcher: HotTopicFetcherService,
    private readonly tagging: HotTopicTaggingService,
  ) {}

  /**
   * @description 执行一次热点采集。
   * @param {HotTopicScope} scope - 租户与用户作用域。
   * @param {HotTopicCollectInput} input - 采集入参。
   * @returns {Promise<HotTopicCollectResult>} 本次采集结果与逐规则回执。
   * @throws {Error} 作用域内没有任何可跑规则时抛出 `HOT_TOPIC_NO_RUNNABLE_RULE`。
   * @keyword-cn 执行热点采集, 采集批次
   * @keyword-en run-hot-topic-collect, collect-batch
   */
  async collect(
    scope: HotTopicScope,
    input: HotTopicCollectInput,
  ): Promise<HotTopicCollectResult> {
    const startedAt = new Date();
    const { runnable, disabled } = await this.ruleService.resolveRunnableRules(
      scope,
      input.ruleIds,
    );
    if (runnable.length === 0) {
      throw new Error('HOT_TOPIC_NO_RUNNABLE_RULE');
    }

    // 默认清除上一轮：热榜条目带名次，混着旧批次会让"当前榜单"失真，也会污染推荐候选。
    const clearPrevious = input.clearPrevious !== false;
    const cleared = clearPrevious
      ? await this.itemService.clear(
          scope,
          // 只跑部分规则时只清这部分规则的历史，避免顺手抹掉没参与本次采集的榜单
          input.ruleIds && input.ruleIds.length > 0
            ? runnable.map((rule) => rule.id)
            : undefined,
        )
      : 0;

    const batchId = randomUUID();
    const outcomes: HotTopicCollectRuleOutcome[] = disabled.map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      ok: false,
      collected: 0,
      message: '规则已停用，本次跳过',
    }));

    const collectedItems: HotTopicItemEntity[] = [];
    for (const rule of runnable) {
      const outcome = await this.collectOneRule(scope, rule, batchId);
      outcomes.push(outcome.receipt);
      collectedItems.push(...outcome.items);
    }

    let tagged = 0;
    if (input.autoTag !== false && collectedItems.length > 0) {
      const fallbackTags = new Map<number, string[]>(
        runnable.map((rule) => [rule.id, rule.defaultTags ?? []]),
      );
      tagged = await this.tagging.tagItems(
        collectedItems,
        fallbackTags,
        scope.tenantId,
      );
    }

    const finishedAt = new Date();
    this.logger.log(
      `[hot-topic] collect_done batch=${batchId} rules=${runnable.length} ` +
        `collected=${collectedItems.length} tagged=${tagged} cleared=${cleared}`,
    );
    return {
      batchId,
      cleared,
      collected: collectedItems.length,
      tagged,
      rules: outcomes,
      startedAt,
      finishedAt,
    };
  }

  /**
   * @description 采集单条规则：抓取解析 → 入库 → 回写可用性快照。正式采集的结果同样写进健康快照，
   *  所以管理页的「是否可用」不需要用户额外点自检就会随采集刷新。
   * @param {HotTopicScope} scope - 作用域。
   * @param {HotTopicRuleEntity} rule - 采集规则。
   * @param {string} batchId - 本次采集批次号。
   * @returns {Promise<{ receipt: HotTopicCollectRuleOutcome; items: HotTopicItemEntity[] }>} 回执与入库条目。
   * @keyword-cn 单规则采集, 采集回写可用性
   * @keyword-en collect-one-rule, collect-health-writeback
   */
  private async collectOneRule(
    scope: HotTopicScope,
    rule: HotTopicRuleEntity,
    batchId: string,
  ): Promise<{
    receipt: HotTopicCollectRuleOutcome;
    items: HotTopicItemEntity[];
  }> {
    const result = await this.fetcher.fetchRule(rule);
    const checkedAt = new Date();

    if (!result.ok) {
      await this.ruleService.saveHealth(rule.id, {
        status: 'failed',
        checkedAt,
        sampleCount: 0,
        message: result.message ?? '未知原因',
      });
      return {
        receipt: {
          ruleId: rule.id,
          ruleName: rule.name,
          ok: false,
          collected: 0,
          message: result.message ?? '未知原因',
        },
        items: [],
      };
    }

    const rows = await this.itemService.insertMany(
      result.items.map((item) => ({
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
        userId: scope.userId,
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        platform: rule.platform,
        batchId,
        rank: item.rank,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(item.heat ? { heat: item.heat } : {}),
        ...(item.summary ? { summary: item.summary } : {}),
        // 先落 none，AI 归类完成后统一回写；归类失败也能看到条目本身
        tags: [],
        tagSource: 'none' as const,
        collectedAt: checkedAt,
      })),
    );

    await this.ruleService.saveHealth(rule.id, {
      status: 'ok',
      checkedAt,
      sampleCount: rows.length,
      message: `采集到 ${rows.length} 条`,
      sampleTitles: rows.slice(0, 3).map((row) => row.title),
    });

    return {
      receipt: {
        ruleId: rule.id,
        ruleName: rule.name,
        ok: true,
        collected: rows.length,
      },
      items: rows,
    };
  }

  /**
   * @description 对作用域内尚未被 AI 归类的条目补跑一次归类，供管理页「重新归类」按钮使用。
   * @param {HotTopicScope} scope - 作用域。
   * @returns {Promise<{ pending: number; tagged: number }>} 待归类条数与实际归类条数。
   * @keyword-cn 补跑归类, 未归类条目
   * @keyword-en retag-pending, untagged-items
   */
  async retagPending(
    scope: HotTopicScope,
  ): Promise<{ pending: number; tagged: number }> {
    const pending = await this.itemService.listUntagged(scope);
    if (pending.length === 0) return { pending: 0, tagged: 0 };
    const rules = await this.ruleService.list(scope);
    const fallbackTags = new Map<number, string[]>(
      rules.map((rule) => [rule.id, rule.defaultTags ?? []]),
    );
    const tagged = await this.tagging.tagItems(
      pending,
      fallbackTags,
      scope.tenantId,
    );
    return { pending: pending.length, tagged };
  }
}
