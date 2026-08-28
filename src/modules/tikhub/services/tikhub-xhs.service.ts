import { Injectable, Logger } from '@nestjs/common';
import type {
  TikhubConfigScope,
  TikhubProbeResult,
  TikhubXhsCollectResult,
  TikhubXhsNoteStat,
} from '../entities/tikhub.entity.js';
import { TikhubClientService } from './tikhub-client.service.js';
import { TikhubConfigService } from './tikhub-config.service.js';

/** @type {number} 每篇笔记保留的热门评论条数，与 SuperClaw 采集端保持一致。 */
const TOP_COMMENT_LIMIT = 5;

/** @type {number} 相邻两次 TikHub 调用的间隔（毫秒），避开上游限频返回 429。 */
const CALL_GAP_MS = 300;

/** @type {string[]} 点赞量在上游可能出现的字段名。 */
const LIKE_KEYS = [
  'liked_count',
  'like_count',
  'likedCount',
  'likes',
  'likeNum',
];

/** @type {string[]} 评论量在上游可能出现的字段名。 */
const COMMENT_KEYS = [
  'comments_count',
  'comment_count',
  'commentsCount',
  'comments',
  'cmtNum',
];

/** @type {string[]} 收藏量在上游可能出现的字段名。 */
const COLLECT_KEYS = [
  'collected_count',
  'collect_count',
  'collectedCount',
  'fav_count',
  'favNum',
];

/** @type {string[]} 分享量在上游可能出现的字段名。 */
const SHARE_KEYS = ['shared_count', 'share_count', 'sharedCount', 'shareNum'];

/** @type {string[]} 曝光/浏览量在上游可能出现的字段名。 */
const VIEW_KEYS = [
  'view_count',
  'viewCount',
  'read_count',
  'readNum',
  'impNum',
  'view_num',
];

/**
 * @description TikHub 小红书采集服务：按 NoteId 拉取笔记详情与热门评论，归一化成看板要的互动指标结构。
 *   上游字段名在不同接口版本之间会变，这里统一用「按字段特征深度定位」的方式取数，
 *   取不到的指标留空而不是填 0，交由看板显示「待采集」。
 * @keyword-cn TikHub小红书采集, 字段归一化
 * @keyword-en tikhub-xhs-collect, field-normalization
 */
@Injectable()
export class TikhubXhsService {
  private readonly logger = new Logger(TikhubXhsService.name);

  constructor(
    private readonly client: TikhubClientService,
    private readonly config: TikhubConfigService,
  ) {}

  /**
   * @description 当前作用域是否具备直接走 TikHub 采集的条件（有可用 API Key）。
   * @keyword-cn 采集可用性, 密钥就绪
   * @keyword-en collector-availability, api-key-ready
   * @param scope 租户与用户作用域。
   * @returns {Promise<boolean>} 是否可用。
   */
  async isReady(scope: TikhubConfigScope): Promise<boolean> {
    return Boolean(await this.config.resolveApiKey(scope));
  }

  /**
   * @description 用当前作用域生效的 Key 和域名做一次连通性自检，供配置页「测试连接」调用。
   * @keyword-cn 连通性自检, 配置校验
   * @keyword-en connectivity-probe, config-validation
   * @param scope 租户与用户作用域。
   * @returns {Promise<TikhubProbeResult>} 自检结果。
   */
  async probe(scope: TikhubConfigScope): Promise<TikhubProbeResult> {
    return this.client.probe({
      apiKey: await this.config.resolveApiKey(scope),
      baseUrl: await this.config.resolveBaseUrl(scope),
    });
  }

  /**
   * @description 逐篇采集笔记互动数据：单篇失败不中断整批，失败原因逐条带回，
   *   由调用方决定这次抓取是 done 还是 failed。
   * @keyword-cn 批量采集笔记, 单篇失败不中断
   * @keyword-en collect-notes, per-note-failure-tolerance
   * @param notes 待采集笔记清单。
   * @param scope 租户与用户作用域，用于解析 API Key 与域名。
   * @returns {Promise<TikhubXhsCollectResult>} 成功项与失败项。
   */
  async collectNotes(
    notes: { noteId: string; title?: string }[],
    scope: TikhubConfigScope,
  ): Promise<TikhubXhsCollectResult> {
    const apiKey = await this.config.resolveApiKey(scope);
    if (!apiKey) {
      return {
        stats: [],
        failures: notes.map((note) => ({
          noteId: note.noteId,
          reason: '未配置 TikHub API Key',
        })),
      };
    }
    const options = {
      apiKey,
      baseUrl: await this.config.resolveBaseUrl(scope),
    };
    const stats: TikhubXhsNoteStat[] = [];
    const failures: { noteId: string; reason: string }[] = [];
    for (const [index, note] of notes.entries()) {
      if (index > 0) await this.delay(CALL_GAP_MS);
      try {
        const detail = await this.client.fetchNoteDetail(note.noteId, options);
        const stat = this.normalizeNoteDetail(detail, note.noteId, note.title);
        if (!stat) {
          failures.push({
            noteId: note.noteId,
            reason: '上游未返回可解析的互动数据（笔记可能已删除或 ID 无效）',
          });
          continue;
        }
        try {
          const comments = await this.client.fetchNoteComments(
            note.noteId,
            options,
          );
          stat.topComments = this.normalizeComments(comments);
        } catch (error) {
          // 评论是快照类数据，拿不到不该让整篇笔记的互动指标作废。
          this.logger.warn(
            `[collectNotes] noteId=${note.noteId} 评论采集失败：${String(error)}`,
          );
        }
        stats.push(stat);
      } catch (error) {
        failures.push({
          noteId: note.noteId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.logger.log(
      `[collectNotes] 采集完成 total=${notes.length} ok=${stats.length} failed=${failures.length}`,
    );
    return { stats, failures };
  }

  /**
   * @description 把笔记详情响应归一化成看板指标结构，找不到任何互动字段时返回 null。
   * @keyword-cn 归一化笔记详情, 指标提取
   * @keyword-en normalize-note-detail, metric-extraction
   * @param payload TikHub 原始响应体。
   * @param noteId 笔记 ID。
   * @param fallbackTitle 上游没给标题时使用的文章标题。
   * @returns {TikhubXhsNoteStat | null} 归一化结果。
   */
  private normalizeNoteDetail(
    payload: unknown,
    noteId: string,
    fallbackTitle?: string,
  ): TikhubXhsNoteStat | null {
    const interact = this.findInteractionNode(payload);
    if (!interact) return null;
    const likeCount = this.pickCount(interact, LIKE_KEYS) ?? 0;
    const commentCount = this.pickCount(interact, COMMENT_KEYS) ?? 0;
    const collectCount = this.pickCount(interact, COLLECT_KEYS) ?? 0;
    const shareCount = this.pickCount(interact, SHARE_KEYS);
    const viewCount = this.pickCount(interact, VIEW_KEYS);
    const noteNode = this.findNoteNode(payload) ?? {};
    const title =
      this.readString(noteNode, ['title', 'display_title', 'desc']) ||
      (fallbackTitle ?? '').trim() ||
      noteId;
    return {
      noteId,
      title: title.slice(0, 200),
      postUrl: `https://www.xiaohongshu.com/explore/${noteId}`,
      authorUrl: this.readAuthorUrl(payload),
      tag: this.readFirstTag(noteNode),
      likeCount,
      commentCount,
      collectCount,
      ...(shareCount === undefined ? {} : { shareCount }),
      ...(viewCount === undefined ? {} : { viewCount }),
      topComments: [],
      dataAt: new Date(),
    };
  }

  /**
   * @description 把评论响应归一化成前 N 条热门评论快照。
   * @keyword-cn 归一化评论, 评论快照
   * @keyword-en normalize-comments, comment-snapshot
   * @param payload TikHub 原始响应体。
   * @returns {{ content: string; likeCount: number; replyCount: number }[]} 热门评论。
   */
  private normalizeComments(
    payload: unknown,
  ): { content: string; likeCount: number; replyCount: number }[] {
    const list = this.findCommentArray(payload);
    return list
      .map((item) => ({
        content: this.readString(item, ['content', 'text', 'comment']),
        likeCount:
          this.pickCount(item, ['like_count', 'liked_count', 'likes']) ?? 0,
        replyCount:
          this.pickCount(item, [
            'sub_comment_count',
            'reply_count',
            'sub_comments_count',
          ]) ?? 0,
      }))
      .filter((item) => item.content)
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, TOP_COMMENT_LIMIT);
  }

  /**
   * @description 深度遍历响应，找出同时带多个互动计数字段的那个对象。
   *   上游把互动数据放在 `interact_info` 还是笔记对象本身，各版本不一致，靠字段特征认更稳。
   * @keyword-cn 定位互动节点, 深度遍历
   * @keyword-en locate-interaction-node, deep-traverse
   * @param payload 响应体。
   * @returns {Record<string, unknown> | null} 互动数据所在对象。
   */
  private findInteractionNode(
    payload: unknown,
  ): Record<string, unknown> | null {
    const groups = [
      LIKE_KEYS,
      COMMENT_KEYS,
      COLLECT_KEYS,
      SHARE_KEYS,
      VIEW_KEYS,
    ];
    let best: Record<string, unknown> | null = null;
    let bestScore = 0;
    for (const node of this.walk(payload)) {
      const score = groups.filter((keys) =>
        keys.some(
          (key) =>
            node[key] !== undefined &&
            node[key] !== null &&
            this.parseCount(node[key]) !== undefined,
        ),
      ).length;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  /**
   * @description 找出承载笔记标题的对象，用于补标题和标签。
   * @keyword-cn 定位笔记节点, 标题来源
   * @keyword-en locate-note-node, title-source
   * @param payload 响应体。
   * @returns {Record<string, unknown> | null} 笔记对象。
   */
  private findNoteNode(payload: unknown): Record<string, unknown> | null {
    for (const node of this.walk(payload)) {
      const hasTitle =
        typeof node.title === 'string' ||
        typeof node.display_title === 'string';
      if (hasTitle && (node.type !== undefined || node.desc !== undefined)) {
        return node;
      }
    }
    for (const node of this.walk(payload)) {
      if (typeof node.title === 'string' && node.title.trim()) return node;
    }
    return null;
  }

  /**
   * @description 从响应里解析博主主页链接。
   * @keyword-cn 博主主页, 作者链接
   * @keyword-en author-profile, author-url
   * @param payload 响应体。
   * @returns {string | undefined} 博主主页链接。
   */
  private readAuthorUrl(payload: unknown): string | undefined {
    for (const node of this.walk(payload)) {
      const isUser =
        typeof node.nickname === 'string' || typeof node.name === 'string';
      if (!isUser) continue;
      const id = this.readString(node, ['userid', 'user_id', 'id', 'red_id']);
      if (id) return `https://www.xiaohongshu.com/user/profile/${id}`;
    }
    return undefined;
  }

  /**
   * @description 取笔记的第一个话题标签作为看板的 tag 展示。
   * @keyword-cn 笔记标签, 话题提取
   * @keyword-en note-tag, topic-extract
   * @param noteNode 笔记对象。
   * @returns {string | undefined} 标签文本。
   */
  private readFirstTag(noteNode: Record<string, unknown>): string | undefined {
    for (const key of ['tag_list', 'tags', 'hash_tag']) {
      const value = noteNode[key];
      if (!Array.isArray(value) || !value.length) continue;
      const first: unknown = value[0];
      if (typeof first === 'string' && first.trim()) return first.trim();
      if (first && typeof first === 'object') {
        const name = this.readString(first as Record<string, unknown>, [
          'name',
          'title',
        ]);
        if (name) return name;
      }
    }
    return undefined;
  }

  /**
   * @description 找到评论数组：取第一个「元素带评论内容与点赞字段」的数组。
   * @keyword-cn 定位评论数组, 结构探测
   * @keyword-en locate-comment-array, structure-probe
   * @param payload 响应体。
   * @returns {Record<string, unknown>[]} 评论对象数组。
   */
  private findCommentArray(payload: unknown): Record<string, unknown>[] {
    const stack: unknown[] = [payload];
    while (stack.length) {
      const node = stack.shift();
      if (Array.isArray(node)) {
        const objects = node.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        );
        const looksLikeComments = objects.some(
          (item) =>
            typeof item.content === 'string' &&
            (item.like_count !== undefined ||
              item.liked_count !== undefined ||
              item.sub_comment_count !== undefined),
        );
        if (looksLikeComments) return objects;
        stack.push(...(node as unknown[]));
        continue;
      }
      if (node && typeof node === 'object') {
        stack.push(...Object.values(node as Record<string, unknown>));
      }
    }
    return [];
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
   * @description 解析小红书风格的计数值：支持 `1234`、`"1,234"`、`"1.2万"`、`"10+"`。
   * @keyword-cn 解析计数, 万亿单位
   * @keyword-en parse-count, chinese-unit
   * @param value 原始值。
   * @returns {number | undefined} 解析出的整数；不是计数时为 undefined。
   */
  private parseCount(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.round(value) : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const text = value.trim().replace(/,/g, '').replace(/\+$/, '');
    if (!text) return undefined;
    const match = /^(\d+(?:\.\d+)?)\s*(万|亿|w|k)?$/i.exec(text);
    if (!match) return undefined;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return undefined;
    const unit = (match[2] ?? '').toLowerCase();
    const factor =
      unit === '万' || unit === 'w'
        ? 10_000
        : unit === '亿'
          ? 100_000_000
          : unit === 'k'
            ? 1_000
            : 1;
    return Math.round(base * factor);
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
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  /**
   * @description 相邻两次上游调用之间的固定间隔，避免触发 TikHub 限频。
   * @keyword-cn 调用间隔, 限频规避
   * @keyword-en call-delay, rate-limit-guard
   * @param ms 间隔毫秒数。
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
