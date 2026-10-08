import { Injectable, Logger } from '@nestjs/common';
import type {
  TikhubConfigScope,
  TikhubDouyinVideoStat,
} from '../entities/tikhub.entity.js';
import { TikhubClientService } from './tikhub-client.service.js';
import { TikhubConfigService } from './tikhub-config.service.js';

/** @type {string[]} 点赞量在抖音上游可能出现的字段名。 */
const LIKE_KEYS = ['digg_count', 'like_count', 'diggCount', 'likeCount'];

/** @type {string[]} 评论量在抖音上游可能出现的字段名。 */
const COMMENT_KEYS = ['comment_count', 'commentCount'];

/** @type {string[]} 收藏量在抖音上游可能出现的字段名。 */
const COLLECT_KEYS = ['collect_count', 'collectCount'];

/** @type {string[]} 分享量在抖音上游可能出现的字段名。 */
const SHARE_KEYS = ['share_count', 'shareCount'];

/** @type {string[]} 播放量在抖音上游可能出现的字段名。 */
const PLAY_KEYS = ['play_count', 'playCount', 'view_count'];

/**
 * @description TikHub 抖音采集服务：按 aweme_id 拉取作品详情并归一化成数据看板要的互动指标。
 *   先走 App V3 接口，拿不到数据再走 Web 接口；上游字段靠「按字段特征深度定位」取数，取不到的指标留空不填 0。
 * @keyword-cn TikHub抖音采集, 字段归一化
 * @keyword-en tikhub-douyin-collect, field-normalization
 */
@Injectable()
export class TikhubDouyinService {
  private readonly logger = new Logger(TikhubDouyinService.name);

  constructor(
    private readonly client: TikhubClientService,
    private readonly config: TikhubConfigService,
  ) {}

  /**
   * @description 当前作用域是否具备走 TikHub 采集抖音数据的条件（有可用 API Key）。
   * @keyword-cn 抖音采集可用性, 密钥就绪
   * @keyword-en douyin-collector-availability, api-key-ready
   * @param scope 租户与用户作用域。
   * @returns {Promise<boolean>} 是否可用。
   */
  async isReady(scope: TikhubConfigScope): Promise<boolean> {
    return Boolean(await this.config.resolveApiKey(scope));
  }

  /**
   * @description 采集一个抖音作品的互动数据：App 接口失败或解析不到时改走 Web 接口，两路都失败时抛出可读原因。
   *   TikHub 对无效 ID 仍会计费，所以每条通道只调一次、不重试。
   * @keyword-cn 采集抖音作品, 双通道回退
   * @keyword-en collect-douyin-video, dual-endpoint-fallback
   * @param awemeId 抖音作品 ID（纯数字）。
   * @param scope 租户与用户作用域，用于解析 API Key 与域名。
   * @returns {Promise<TikhubDouyinVideoStat>} 归一化后的作品数据。
   * @throws {Error} 未配置 Key 或上游两路都拿不到数据。
   */
  async collectVideo(
    awemeId: string,
    scope: TikhubConfigScope,
  ): Promise<TikhubDouyinVideoStat> {
    const apiKey = await this.config.resolveApiKey(scope);
    if (!apiKey) throw new Error('未配置 TikHub API Key');
    const options = {
      apiKey,
      baseUrl: await this.config.resolveBaseUrl(scope),
    };
    const reasons: string[] = [];
    for (const fetcher of [
      () => this.client.fetchDouyinVideoDetail(awemeId, options),
      () => this.client.fetchDouyinWebVideoDetail(awemeId, options),
    ]) {
      try {
        const stat = this.normalizeVideoDetail(await fetcher(), awemeId);
        if (stat) return stat;
        reasons.push(
          '上游未返回可解析的互动数据（作品可能已删除、设为私密或 ID 无效）',
        );
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error));
      }
    }
    this.logger.warn(
      `[collectVideo] awemeId=${awemeId} 采集失败：${reasons.join(' | ')}`,
    );
    throw new Error(reasons[reasons.length - 1] ?? '抖音作品数据采集失败');
  }

  /**
   * @description 把作品详情响应归一化成看板指标结构；定位不到互动数据时返回 null。
   *   播放量为 0 而其它互动大于 0 时视为上游隐藏播放量，留空。
   * @keyword-cn 归一化抖音作品详情, 指标提取
   * @keyword-en normalize-douyin-video-detail, metric-extraction
   * @param payload TikHub 原始响应体。
   * @param awemeId 抖音作品 ID。
   * @returns {TikhubDouyinVideoStat | null} 归一化结果。
   */
  private normalizeVideoDetail(
    payload: unknown,
    awemeId: string,
  ): TikhubDouyinVideoStat | null {
    const aweme = this.findAwemeNode(payload, awemeId);
    const statistics =
      (aweme?.statistics && typeof aweme.statistics === 'object'
        ? (aweme.statistics as Record<string, unknown>)
        : null) ?? this.findStatisticsNode(payload);
    if (!statistics) return null;
    const likeCount = this.pickCount(statistics, LIKE_KEYS) ?? 0;
    const commentCount = this.pickCount(statistics, COMMENT_KEYS) ?? 0;
    const collectCount = this.pickCount(statistics, COLLECT_KEYS);
    const shareCount = this.pickCount(statistics, SHARE_KEYS);
    const rawPlay = this.pickCount(statistics, PLAY_KEYS);
    const engaged =
      likeCount + commentCount + (collectCount ?? 0) + (shareCount ?? 0);
    const playCount = rawPlay === 0 && engaged > 0 ? undefined : rawPlay;
    const title = aweme ? this.readString(aweme, ['desc', 'title']) : '';
    return {
      awemeId,
      title: (title || awemeId).slice(0, 200),
      coverUrl: aweme ? this.readCoverUrl(aweme) : undefined,
      shareUrl: `https://www.douyin.com/video/${awemeId}`,
      likeCount,
      commentCount,
      ...(collectCount === undefined ? {} : { collectCount }),
      ...(shareCount === undefined ? {} : { shareCount }),
      ...(playCount === undefined ? {} : { playCount }),
      dataAt: new Date(),
    };
  }

  /**
   * @description 找出 aweme_id 与目标一致且带 statistics 的作品对象；没有精确命中时取第一个带 statistics 的作品。
   * @keyword-cn 定位作品节点, 作品ID匹配
   * @keyword-en locate-aweme-node, aweme-id-match
   * @param payload 响应体。
   * @param awemeId 抖音作品 ID。
   * @returns {Record<string, unknown> | null} 作品对象。
   */
  private findAwemeNode(
    payload: unknown,
    awemeId: string,
  ): Record<string, unknown> | null {
    const candidates = this.walk(payload).filter(
      (node) =>
        node.aweme_id !== undefined &&
        Boolean(node.statistics) &&
        typeof node.statistics === 'object',
    );
    return (
      candidates.find((node) => String(node.aweme_id) === awemeId) ??
      candidates[0] ??
      null
    );
  }

  /**
   * @description 没有作品对象时，深度遍历找出同时带多个互动计数字段的对象。
   * @keyword-cn 定位互动节点, 深度遍历
   * @keyword-en locate-interaction-node, deep-traverse
   * @param payload 响应体。
   * @returns {Record<string, unknown> | null} 互动数据所在对象。
   */
  private findStatisticsNode(payload: unknown): Record<string, unknown> | null {
    const groups = [LIKE_KEYS, COMMENT_KEYS, COLLECT_KEYS, SHARE_KEYS];
    let best: Record<string, unknown> | null = null;
    let bestScore = 0;
    for (const node of this.walk(payload)) {
      const score = groups.filter((keys) =>
        keys.some((key) => this.parseCount(node[key]) !== undefined),
      ).length;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  /**
   * @description 读取作品封面：依次尝试 `video.cover` / `video.origin_cover` / `video.dynamic_cover` 的 url_list。
   * @keyword-cn 读取作品封面, 封面地址
   * @keyword-en read-video-cover, cover-url
   * @param aweme 作品对象。
   * @returns {string | undefined} 封面地址。
   */
  private readCoverUrl(aweme: Record<string, unknown>): string | undefined {
    const video = aweme.video;
    if (!video || typeof video !== 'object') return undefined;
    for (const key of ['cover', 'origin_cover', 'dynamic_cover']) {
      const cover = (video as Record<string, unknown>)[key];
      const list =
        cover && typeof cover === 'object'
          ? (cover as Record<string, unknown>).url_list
          : undefined;
      if (Array.isArray(list)) {
        const url = list.find(
          (item): item is string =>
            typeof item === 'string' && /^https?:\/\//.test(item),
        );
        if (url) return url;
      }
    }
    return undefined;
  }

  /**
   * @description 广度遍历响应里的全部普通对象节点。
   * @keyword-cn 遍历对象节点, 广度优先
   * @keyword-en walk-object-nodes, breadth-first
   * @param payload 响应体。
   * @returns {Record<string, unknown>[]} 全部对象节点。
   */
  private walk(payload: unknown): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    const stack: unknown[] = [payload];
    while (stack.length) {
      const node = stack.shift();
      if (Array.isArray(node)) {
        stack.push(...(node as unknown[]));
        continue;
      }
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        result.push(record);
        stack.push(...Object.values(record));
      }
    }
    return result;
  }

  /**
   * @description 在候选字段名里取第一个能解析成数字的计数值。
   * @keyword-cn 取计数字段, 候选字段
   * @keyword-en pick-count-field, candidate-keys
   * @param node 数据对象。
   * @param keys 候选字段名。
   * @returns {number | undefined} 计数值；一个都取不到时为 undefined。
   */
  private pickCount(
    node: Record<string, unknown>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const parsed = this.parseCount(node[key]);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  /**
   * @description 解析计数值：数字直接取整，字符串支持 `1234`、`"1,234"`、`"1.2万"`、`"1.2w"`。
   * @keyword-cn 解析计数, 万亿单位
   * @keyword-en parse-count, chinese-unit
   * @param value 原始值。
   * @returns {number | undefined} 解析出的整数；不是计数时为 undefined。
   */
  private parseCount(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0
        ? Math.round(value)
        : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const match = /^(\d+(?:\.\d+)?)\s*(万|亿|w)?$/i.exec(
      value.trim().replace(/,/g, '').replace(/\+$/, ''),
    );
    if (!match) return undefined;
    const unit = (match[2] ?? '').toLowerCase();
    const factor = unit === '亿' ? 100_000_000 : unit ? 10_000 : 1;
    return Math.round(Number(match[1]) * factor);
  }

  /**
   * @description 在候选字段名里取第一个非空字符串。
   * @keyword-cn 取字符串字段, 候选字段
   * @keyword-en pick-string-field, candidate-keys
   * @param node 数据对象。
   * @param keys 候选字段名。
   * @returns {string} 命中的字符串；没有时为空串。
   */
  private readString(node: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = node[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }
}
