import { Injectable } from '@nestjs/common';
import { XhsPostStatService } from '../../todo/services/xhs-post-stat.service.js';
import type { XhsPostStatEntity } from '../../todo/entities/xhs-post-stat.entity.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';
import type {
  XhsTopicDetailRow,
  XhsTopicMetricValue,
  XhsTopicOverview,
  XhsTopicTrendPoint,
} from '../entities/xhs-topic-data.entity.js';
import { XhsTopicCrawlService } from './xhs-topic-crawl.service.js';

/** @type {number} 单篇互动量达到该阈值即计入爆文。 */
export const HOT_POST_INTERACTION_THRESHOLD = 1000;

/**
 * @description 一次抓取批次：同一个抓取 Todo 回写的全部帖子数据。
 * @keyword-cn 抓取批次, 同任务数据
 * @keyword-en crawl-batch, same-task-stats
 */
interface CrawlBatch {
  /** 抓取运行记录 ID；历史数据没有运行记录时回退成 `todo:<id>` */
  key: string;
  at: Date;
  stats: XhsPostStatEntity[];
}

/**
 * @description 子选题数据服务：把抓取批次聚合成总览指标、趋势与分页明细，并支持按自然日删除数据。
 * @keyword-cn 数据总览聚合, 数据明细分页, 按天删除
 * @keyword-en overview-aggregation, paged-details, delete-by-day
 */
@Injectable()
export class XhsTopicDataService {
  constructor(
    private readonly postStats: XhsPostStatService,
    private readonly crawl: XhsTopicCrawlService,
  ) {}

  /**
   * @description 聚合子选题的数据总览：核心指标卡、派生指标、趋势曲线与最后/下次抓取时间。
   * @keyword-cn 数据总览, 指标聚合, 最后抓取时间
   * @keyword-en data-overview, metric-aggregation, last-crawled-at
   * @param topic 子选题实体。
   * @returns {Promise<XhsTopicOverview>} 总览返回体。
   */
  async buildOverview(topic: XhsTopicEntity): Promise<XhsTopicOverview> {
    await this.crawl.syncTaskStatuses(topic.id);
    const stats = await this.postStats.listByTopic(topic.id);
    const batches = this.groupByBatch(stats);
    const latest = batches[batches.length - 1];
    const intervalMinutes = await this.crawl.getIntervalMinutes({
      tenantId: topic.tenantId,
      userId: topic.userId,
    });

    const trend: XhsTopicTrendPoint[] = batches.map((batch) => {
      const sums = this.sumBatch(batch.stats);
      return {
        at: batch.at.toISOString(),
        likeCount: sums.likeCount,
        commentCount: sums.commentCount,
        collectCount: sums.collectCount,
        viewCount: sums.viewAvailable ? sums.viewCount : undefined,
        shareCount: sums.shareAvailable ? sums.shareCount : undefined,
        interaction: sums.interaction,
      };
    });

    const metrics = this.buildMetrics(batches);
    const latestSums = this.sumBatch(latest ? latest.stats : []);
    const postCount = new Set(stats.map((item) => item.postHash)).size;
    const latestPostCount = latest
      ? new Set(latest.stats.map((item) => item.postHash)).size
      : 0;
    const hotPostCount = this.countHotPosts(stats);
    const topPost = this.pickTopPost(stats);
    const lastCrawledAt =
      topic.crawl?.lastCrawledAt ?? (latest ? latest.at : undefined);
    const lastScheduledAt = topic.crawl?.lastScheduledAt;
    const nextBaseline = lastScheduledAt ?? lastCrawledAt;

    return {
      topicId: topic.id,
      crawlStatus: topic.crawl?.status ?? 'crawling',
      metrics,
      postCount,
      averageInteraction:
        latestPostCount > 0
          ? Math.round(latestSums.interaction / latestPostCount)
          : 0,
      hotPostCount,
      hotPostThreshold: HOT_POST_INTERACTION_THRESHOLD,
      topPost,
      interactionRate:
        latestSums.viewAvailable && latestSums.viewCount > 0
          ? latestSums.interaction / latestSums.viewCount
          : undefined,
      lastCrawledAt: lastCrawledAt
        ? new Date(lastCrawledAt).toISOString()
        : undefined,
      lastCrawledCount: latest ? latest.stats.length : 0,
      nextCrawlAt:
        topic.crawl?.status === 'cancelled' || !nextBaseline
          ? undefined
          : new Date(
              new Date(nextBaseline).getTime() + intervalMinutes * 60_000,
            ).toISOString(),
      crawlIntervalMinutes: intervalMinutes,
      trend,
    };
  }

  /**
   * @description 分页读取子选题的抓取明细，每行带自然日与互动量，供表格与按天删除使用。
   * @keyword-cn 数据明细分页, 抓取记录表格
   * @keyword-en paged-details, crawl-record-table
   * @param topicId 子选题业务 ID。
   * @param page 页码，从 1 开始。
   * @param pageSize 每页条数。
   * @returns {Promise<{items: XhsTopicDetailRow[], total: number}>} 明细行与总数。
   */
  async listDetails(
    topicId: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: XhsTopicDetailRow[]; total: number }> {
    const { items, total } = await this.postStats.listByTopicPaged(
      topicId,
      page,
      pageSize,
    );
    return { items: items.map((item) => this.toDetailRow(item)), total };
  }

  /**
   * @description 删除子选题在某个自然日采集的全部数据，日期按服务器本地时区解析。
   * @keyword-cn 按天删除数据, 清理某天抓取
   * @keyword-en delete-by-day, purge-day-stats
   * @param topicId 子选题业务 ID。
   * @param day 自然日字符串 `YYYY-MM-DD`。
   * @returns {Promise<number>} 删除条数。
   */
  async deleteDay(topicId: number, day: string): Promise<number> {
    const [year, month, date] = day.split('-').map((part) => Number(part));
    const start = new Date(year, month - 1, date, 0, 0, 0, 0);
    const end = new Date(year, month - 1, date + 1, 0, 0, 0, 0);
    return await this.postStats.deleteByTopicDay(topicId, start, end);
  }

  /**
   * @description 把同一次抓取运行回写的数据归为一个批次，按批次时间升序，作为环比与趋势的最小单位。
   * @keyword-cn 抓取批次分组, 环比基准, 按运行分批
   * @keyword-en batch-grouping, comparison-baseline, group-by-run
   * @param stats 子选题全部抓取数据。
   * @returns {CrawlBatch[]} 按时间升序的批次。
   */
  private groupByBatch(stats: XhsPostStatEntity[]): CrawlBatch[] {
    const map = new Map<string, CrawlBatch>();
    for (const stat of stats) {
      const at = new Date(stat.dataAt);
      // 按抓取运行分批，而不是按 Todo：长时采集任务在同一个 todoId 下跑好几天，
      // 按 Todo 分会把好几天的数据挤成一个批次，环比和趋势就全没了。
      const key =
        typeof stat.crawlRunId === 'number'
          ? `run:${stat.crawlRunId}`
          : `todo:${stat.todoId}`;
      const existing = map.get(key);
      if (existing) {
        existing.stats.push(stat);
        if (at > existing.at) existing.at = at;
      } else {
        map.set(key, { key, at, stats: [stat] });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
  }

  /**
   * @description 汇总一个批次内全部笔记的各项指标，并标记曝光/分享是否已被采集到。
   * @keyword-cn 批次汇总, 待采集判定
   * @keyword-en batch-summary, availability-check
   * @param stats 批次内的帖子数据。
   * @returns 汇总值与可用性标记。
   */
  private sumBatch(stats: XhsPostStatEntity[]): {
    likeCount: number;
    commentCount: number;
    collectCount: number;
    viewCount: number;
    shareCount: number;
    interaction: number;
    viewAvailable: boolean;
    shareAvailable: boolean;
  } {
    let likeCount = 0;
    let commentCount = 0;
    let collectCount = 0;
    let viewCount = 0;
    let shareCount = 0;
    let viewAvailable = false;
    let shareAvailable = false;
    for (const stat of stats) {
      likeCount += stat.likeCount ?? 0;
      commentCount += stat.commentCount ?? 0;
      collectCount += stat.collectCount ?? 0;
      if (typeof stat.viewCount === 'number') {
        viewCount += stat.viewCount;
        viewAvailable = true;
      }
      if (typeof stat.shareCount === 'number') {
        shareCount += stat.shareCount;
        shareAvailable = true;
      }
    }
    return {
      likeCount,
      commentCount,
      collectCount,
      viewCount,
      shareCount,
      interaction: likeCount + commentCount + collectCount + shareCount,
      viewAvailable,
      shareAvailable,
    };
  }

  /**
   * @description 生成核心指标卡：当前累计值、较上一批次的增量与整段走势采样。
   * @keyword-cn 指标卡, 环比增量, 走势采样
   * @keyword-en metric-cards, period-delta, trend-samples
   * @param batches 按时间升序的抓取批次。
   * @returns {XhsTopicMetricValue[]} 指标卡数组。
   */
  private buildMetrics(batches: CrawlBatch[]): XhsTopicMetricValue[] {
    const summaries = batches.map((batch) => this.sumBatch(batch.stats));
    const latest = summaries[summaries.length - 1];
    const previous = summaries[summaries.length - 2];
    const specs: {
      key: string;
      label: string;
      pick: (s: (typeof summaries)[number]) => number;
      available: boolean;
    }[] = [
      {
        key: 'interaction',
        label: '互动总量',
        pick: (s) => s.interaction,
        available: summaries.length > 0,
      },
      {
        key: 'viewCount',
        label: '曝光量',
        pick: (s) => s.viewCount,
        available: summaries.some((s) => s.viewAvailable),
      },
      {
        key: 'likeCount',
        label: '点赞',
        pick: (s) => s.likeCount,
        available: summaries.length > 0,
      },
      {
        key: 'commentCount',
        label: '评论',
        pick: (s) => s.commentCount,
        available: summaries.length > 0,
      },
      {
        key: 'collectCount',
        label: '收藏',
        pick: (s) => s.collectCount,
        available: summaries.length > 0,
      },
      {
        key: 'shareCount',
        label: '分享',
        pick: (s) => s.shareCount,
        available: summaries.some((s) => s.shareAvailable),
      },
    ];
    return specs.map((spec) => {
      const value = latest ? spec.pick(latest) : 0;
      const base = previous ? spec.pick(previous) : undefined;
      return {
        key: spec.key,
        label: spec.label,
        value,
        delta: base === undefined ? undefined : value - base,
        deltaRate:
          base === undefined || base === 0 ? undefined : (value - base) / base,
        available: spec.available,
        trend: summaries.map((s) => spec.pick(s)),
      };
    });
  }

  /**
   * @description 统计互动量达到爆文阈值的笔记数，同一篇笔记按最高一次互动计。
   * @keyword-cn 爆文统计, 互动阈值
   * @keyword-en hot-post-count, interaction-threshold
   * @param stats 子选题全部抓取数据。
   * @returns {number} 爆文笔记数。
   */
  private countHotPosts(stats: XhsPostStatEntity[]): number {
    const best = new Map<string, number>();
    for (const stat of stats) {
      const interaction = this.interactionOf(stat);
      const current = best.get(stat.postHash) ?? 0;
      if (interaction > current) best.set(stat.postHash, interaction);
    }
    let count = 0;
    for (const value of best.values()) {
      if (value >= HOT_POST_INTERACTION_THRESHOLD) count++;
    }
    return count;
  }

  /**
   * @description 挑出互动量最高的一条笔记快照。
   * @keyword-cn 最高互动笔记, 榜首笔记
   * @keyword-en top-post, best-interaction
   * @param stats 子选题全部抓取数据。
   * @returns 最高互动笔记，无数据时为 undefined。
   */
  private pickTopPost(
    stats: XhsPostStatEntity[],
  ): { postTitle: string; postUrl?: string; interaction: number } | undefined {
    let top: XhsPostStatEntity | undefined;
    let topInteraction = -1;
    for (const stat of stats) {
      const interaction = this.interactionOf(stat);
      if (interaction > topInteraction) {
        topInteraction = interaction;
        top = stat;
      }
    }
    return top
      ? {
          postTitle: top.postTitle,
          postUrl: top.postUrl,
          interaction: topInteraction,
        }
      : undefined;
  }

  /**
   * @description 计算单条抓取记录的互动量：点赞 + 评论 + 收藏 + 分享。
   * @keyword-cn 互动量计算, 单条互动
   * @keyword-en interaction-calc, per-record-interaction
   * @param stat 单条抓取记录。
   * @returns {number} 互动量。
   */
  private interactionOf(stat: XhsPostStatEntity): number {
    return (
      (stat.likeCount ?? 0) +
      (stat.commentCount ?? 0) +
      (stat.collectCount ?? 0) +
      (stat.shareCount ?? 0)
    );
  }

  /**
   * @description 把一条抓取记录转换成明细表格行，补齐自然日、互动量与互动率。
   * @keyword-cn 明细行转换, 自然日
   * @keyword-en detail-row-mapping, calendar-day
   * @param stat 单条抓取记录。
   * @returns {XhsTopicDetailRow} 明细表格行。
   */
  private toDetailRow(stat: XhsPostStatEntity): XhsTopicDetailRow {
    const dataAt = new Date(stat.dataAt);
    const interaction = this.interactionOf(stat);
    return {
      id: stat.id,
      day: this.toLocalDay(dataAt),
      dataAt: dataAt.toISOString(),
      postTitle: stat.postTitle,
      postUrl: stat.postUrl,
      authorUrl: stat.authorUrl,
      tag: stat.tag,
      likeCount: stat.likeCount ?? 0,
      commentCount: stat.commentCount ?? 0,
      collectCount: stat.collectCount ?? 0,
      viewCount: stat.viewCount,
      shareCount: stat.shareCount,
      interaction,
      interactionRate:
        typeof stat.viewCount === 'number' && stat.viewCount > 0
          ? interaction / stat.viewCount
          : undefined,
      topComments: stat.topComments ?? [],
    };
  }

  /**
   * @description 按服务器本地时区把时间转成 `YYYY-MM-DD`，与按天删除的区间口径保持一致。
   * @keyword-cn 本地自然日, 日期格式化
   * @keyword-en local-day, date-format
   * @param date 采集时间。
   * @returns {string} 自然日字符串。
   */
  private toLocalDay(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
