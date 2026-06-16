import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  ArticleLibraryCreateInput,
  ArticleLibraryEntity,
  ArticleLibraryPushConfig,
  ArticleLibraryScope,
  ArticleLibraryStats,
  ArticleLibraryUpdateInput,
  ArticlePublishStatus,
} from '../entities/article-library.entity.js';
import type { ArticleEntity } from '../entities/article.entity.js';

/**
 * @title 文章库容器服务 Article Library Container Service
 * @description 管理文章库（容器）的增删改查与统计，不负责具体文章文档操作。
 * @keyword-en article library container service crud stats
 */
@Injectable()
export class ArticleLibraryService {
  private readonly logger = new Logger(ArticleLibraryService.name);
  private readonly libraries: Collection<ArticleLibraryEntity>;
  private readonly articles: Collection<ArticleEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly COUNTER_KEY = 'article_libraries';

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly config: ConfigService,
  ) {
    this.libraries = db.collection<ArticleLibraryEntity>('article_libraries');
    this.articles = db.collection<ArticleEntity>('articles');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建集合索引，并把文章库 counter 校准到当前最大业务 ID。
   * @keyword-cn 文章库计数器校准
   * @keyword-en article-library-counter
   */
  async ensureIndexes(): Promise<void> {
    await this.libraries.createIndex({ id: 1 }, { unique: true });
    await this.libraries.createIndex({ scope: 1, tenantId: 1, userId: 1 });
    await this.libraries.createIndex({ scope: 1, tenantId: 1, type: 1 });
    await this.libraries.createIndex(
      { 'pushConfig.qrToken': 1 },
      { unique: true, sparse: true },
    );
    await this.libraries.createIndex({ createdAt: -1 });
    await this.ensureCounterAtLeast(await this.getMaxArticleLibraryId());
  }

  /**
   * @description 读取 article_libraries 集合当前最大业务 ID，用于修复 counter 落后导致的 duplicate key。
   * @keyword-cn 文章库计数器校准
   * @keyword-en article-library-counter
   */
  private async getMaxArticleLibraryId(): Promise<number> {
    const latest = await this.libraries
      .find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .next();
    const id = Number(latest?.id);
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
  }

  /**
   * @description 将 article_libraries counter 至少推进到指定下限，避免新建库撞上既有 ID。
   * @keyword-cn 文章库计数器校准
   * @keyword-en article-library-counter
   */
  private async ensureCounterAtLeast(seq: number): Promise<void> {
    const nextSeq = Math.max(0, Math.floor(Number(seq) || 0));
    await this.counters.updateOne(
      { _id: this.COUNTER_KEY },
      [
        {
          $set: {
            seq: {
              $cond: [
                { $gte: [{ $ifNull: ['$seq', 0] }, nextSeq] },
                '$seq',
                nextSeq,
              ],
            },
          },
        },
      ],
      { upsert: true },
    );
  }

  /**
   * @description 分配新的文章库业务 ID，分配前先把 counter 推进到已有最大文章库 ID。
   * @returns {Promise<number>} 下一个可用 ID。
   * @keyword-cn 文章库计数器校准
   * @keyword-en article-library-counter
   */
  private async nextId(): Promise<number> {
    await this.ensureCounterAtLeast(await this.getMaxArticleLibraryId());
    const res = await this.counters.findOneAndUpdate(
      { _id: this.COUNTER_KEY },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 规范化 pushConfig（statusFilter 为历史兼容字段，固定仅未发布）
   * @keyword-en article library normalize push config
   */
  private normalizePushConfig(
    input?: Partial<ArticleLibraryPushConfig>,
  ): ArticleLibraryPushConfig {
    const statusFilter: ArticlePublishStatus[] = ['unpublished'];
    const pushUrl =
      typeof input?.pushUrl === 'string'
        ? input.pushUrl.trim() || undefined
        : undefined;
    const qrToken =
      typeof input?.qrToken === 'string'
        ? input.qrToken.trim() || undefined
        : undefined;
    return { statusFilter, pushUrl, qrToken };
  }

  /**
   * @description 创建文章库
   * @keyword-en article library create
   */
  async create(
    input: ArticleLibraryCreateInput,
  ): Promise<ArticleLibraryEntity> {
    const now = new Date();
    const scope: ArticleLibraryScope = input.scope ?? 'tenant';
    const id = await this.nextId();
    const doc: ArticleLibraryEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      scope,
      tenantId: scope === 'tenant' ? input.tenantId : undefined,
      name: input.name.trim(),
      type: String(input.type ?? '').trim(),
      pushConfig: this.normalizePushConfig(input.pushConfig),
      createdAt: now,
      updatedAt: now,
    };
    await this.libraries.insertOne(doc);
    return doc;
  }

  /**
   * @description 构造强制租户作用域过滤片段；空 tenantId 收口为「仅无租户(平台)库」，绝不放开到全部租户。
   * @param {string} [tenantId] - 调用方租户；为空表示无租户调用者（平台态）。
   * @returns {Record<string, unknown>} 可并入查询的 tenantId 过滤片段。
   * @keyword-en tenant scope filter mandatory isolation
   * @keyword-cn 租户作用域过滤
   */
  private tenantScope(tenantId?: string): Record<string, unknown> {
    const t = tenantId?.trim();
    return t ? { tenantId: t } : { tenantId: null };
  }

  /**
   * @description 按 ID 获取文章库（强制租户隔离）
   * @keyword-en article library get by id
   */
  async get(
    id: number,
    tenantId?: string,
  ): Promise<ArticleLibraryEntity | null> {
    return this.libraries.findOne({ id, ...this.tenantScope(tenantId) });
  }

  /**
   * @description 确保文章库有二维码 token，如不存在则生成并写入
   * @keyword-en ensure article library qr token
   */
  async ensureQrToken(id: number, tenantId?: string): Promise<string> {
    const existing = await this.get(id, tenantId);
    if (!existing) throw new Error('LIBRARY_NOT_FOUND');
    const current = existing.pushConfig?.qrToken;
    if (typeof current === 'string' && current.trim().length > 0) {
      return current.trim();
    }
    const token = randomUUID().replace(/-/g, '');
    const res = await this.libraries.findOneAndUpdate(
      { id, ...this.tenantScope(tenantId) },
      {
        $set: {
          'pushConfig.qrToken': token,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    const next = res.value?.pushConfig?.qrToken;
    if (typeof next === 'string' && next.trim().length > 0) {
      return next.trim();
    }
    return token;
  }

  /**
   * @description 从环境变量读取文章库小红书二维码短链模板。
   * @returns {string | null} 短链 URL；未配置时返回 null。
   * @keyword-en article-library-qr, env-short-link
   */
  private resolveConfiguredXhsQrShortLink(): string | null {
    const keys = [
      'ARTICLE_LIBRARY_XHS_QR_SHORT_LINK',
      'XHS_ARTICLE_LIBRARY_QR_SHORT_LINK',
      'XHS_MINIAPP_QR_SHORT_LINK',
      'XHS_QR_SHORT_LINK',
    ];
    for (const key of keys) {
      const value = String(this.config.get<string>(key) ?? '').trim();
      if (value) return value;
    }
    return null;
  }

  /**
   * @description 解析小红书短链 301/302 跳转，返回最终落地链接。
   * @param {string} shortLink - xhslink.com 短链。
   * @returns {Promise<string | null>} 跳转后的 URL；失败时返回 null。
   * @keyword-en article-library-qr, short-link-redirect
   */
  async resolveXhsShortLinkRedirect(shortLink: string): Promise<string | null> {
    const start = String(shortLink ?? '').trim();
    if (!/^https?:\/\//i.test(start)) return null;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    };

    try {
      let current = new URL(start);
      for (let i = 0; i < 8; i += 1) {
        const response = await fetch(current, {
          method: 'HEAD',
          redirect: 'manual',
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) return current.toString();
          current = new URL(location, current);
          continue;
        }
        if (response.ok) {
          return response.url || current.toString();
        }
        throw new Error(`HEAD_REDIRECT_STATUS:${response.status}`);
      }
      return current.toString();
    } catch (error) {
      this.logger.warn(
        `[article-library][qr] head_redirect_failed shortLink=${start} message=${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const response = await fetch(start, {
        method: 'GET',
        redirect: 'follow',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      return response.url || start;
    } catch (error) {
      this.logger.warn(
        `[article-library][qr] get_redirect_failed shortLink=${start} message=${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * @description 解析小红书 miniapp qrcode 链接，把原二维码 JSON 写入 p.path 与 p.xhsMpBizQuery。
   * @param {string} redirectUrl - 短链跳转后的 miniapp qrcode URL。
   * @param {string} qrContent - 原始二维码内容 JSON。
   * @returns {string | null} 写回 p 参数后的新 URL。
   * @keyword-en article-library-qr, p-param-rewrite
   */
  rewriteXhsQrcodePParam(
    redirectUrl: string,
    qrContent: string,
  ): string | null {
    const target = String(redirectUrl ?? '').trim();
    const payload = String(qrContent ?? '').trim();
    if (!target || !payload) return null;
    try {
      const url = new URL(target);
      const p = url.searchParams.get('p');
      if (!p) return null;

      const nested = new URL(p, 'https://xhs.local');
      const xhsQuery = `path=${payload}`;
      const rewrittenP = `${nested.pathname}?path=${payload}&xhsMpBizQuery=${encodeURIComponent(xhsQuery)}${nested.hash}`;
      url.searchParams.set('p', rewrittenP);
      url.searchParams.delete('xhsMpBizQuery');
      return url.toString();
    } catch (error) {
      this.logger.warn(
        `[article-library][qr] rewrite_p_failed message=${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * @description 构建文章库二维码内容；配置短链时输出改写后的小红书 qrcode URL。
   * @param {{ token: string; articleLibraryId: number }} input - 二维码原始 payload。
   * @returns {Promise<{ qrPayload: { token: string; articleLibraryId: number }; qrContent: string; qrContentType: 'json' | 'xhs-miniapp-url'; qrSourceContent: string; xhsQrcodeUrl: string | null }>} 二维码内容。
   * @keyword-en article-library-qr, qr-content-build
   */
  async buildPushQrContent(input: {
    token: string;
    articleLibraryId: number;
  }): Promise<{
    qrPayload: { token: string; articleLibraryId: number };
    qrContent: string;
    qrContentType: 'json' | 'xhs-miniapp-url';
    qrSourceContent: string;
    xhsQrcodeUrl: string | null;
  }> {
    const qrPayload = {
      token: String(input.token ?? '').trim(),
      articleLibraryId: Number(input.articleLibraryId),
    };
    const qrSourceContent = JSON.stringify(qrPayload);
    const shortLink = this.resolveConfiguredXhsQrShortLink();
    if (!shortLink) {
      return {
        qrPayload,
        qrContent: qrSourceContent,
        qrContentType: 'json',
        qrSourceContent,
        xhsQrcodeUrl: null,
      };
    }

    const redirected = await this.resolveXhsShortLinkRedirect(shortLink);
    const rewritten = redirected
      ? this.rewriteXhsQrcodePParam(redirected, qrSourceContent)
      : null;
    if (!rewritten) {
      this.logger.warn(
        `[article-library][qr] xhs_qrcode_unavailable shortLink=${shortLink} redirected=${redirected ?? '<null>'}`,
      );
      return {
        qrPayload,
        qrContent: qrSourceContent,
        qrContentType: 'json',
        qrSourceContent,
        xhsQrcodeUrl: null,
      };
    }
    return {
      qrPayload,
      qrContent: rewritten,
      qrContentType: 'xhs-miniapp-url',
      qrSourceContent,
      xhsQrcodeUrl: rewritten,
    };
  }

  /**
   * @description 通过文章库 ID 与二维码 token 获取文章库
   * @keyword-en get article library by qr token
   */
  async getByQrToken(
    id: number,
    token: string,
  ): Promise<ArticleLibraryEntity | null> {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) return null;
    return (
      (await this.libraries.findOne({
        id,
        'pushConfig.qrToken': trimmed,
      })) ?? null
    );
  }

  /**
   * @description 列出文章库（按 tenant/user 作用域）
   * @keyword-en article library list
   */
  async list(params: {
    tenantId?: string;
    userId?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ArticleLibraryEntity[]; total: number }> {
    const filter: Record<string, unknown> = {
      ...this.tenantScope(params.tenantId),
    };
    if (params.userId) filter.userId = params.userId;
    if (params.type && params.type.trim().length > 0)
      filter.type = params.type.trim();
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const offset = Math.max(0, params.offset ?? 0);
    const [items, total] = await Promise.all([
      this.libraries
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.libraries.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * @description 更新文章库（名称 / 类型 / 推送配置）
   * @keyword-en article library update
   */
  async update(
    input: ArticleLibraryUpdateInput,
  ): Promise<ArticleLibraryEntity | null> {
    const existing = await this.get(input.id, input.tenantId);
    if (!existing) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim().length > 0)
      set.name = input.name.trim();
    if (typeof input.type === 'string') set.type = input.type.trim();
    if (input.pushConfig !== undefined) {
      set.pushConfig = this.normalizePushConfig({
        ...existing.pushConfig,
        ...input.pushConfig,
      });
    }
    const res = await this.libraries.findOneAndUpdate(
      { id: input.id, ...this.tenantScope(input.tenantId) },
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除文章库（并级联删除所属文章）
   * @keyword-en article library delete cascade articles
   */
  async delete(id: number, tenantId?: string): Promise<boolean> {
    const existing = await this.get(id, tenantId);
    if (!existing) return false;
    await this.articles.deleteMany({ libraryId: id });
    const res = await this.libraries.deleteOne({ id });
    return res.deletedCount === 1;
  }

  /**
   * @description 统计文章库内各状态数量与当前租约占用数量
   * @keyword-en article library stats aggregate by status and occupied leases
   */
  async getStats(libraryId: number): Promise<ArticleLibraryStats> {
    const now = new Date();
    const [rows, occupiedCount] = await Promise.all([
      this.articles
        .aggregate<{
          _id: ArticlePublishStatus;
          count: number;
        }>([
          { $match: { libraryId } },
          { $group: { _id: '$publishStatus', count: { $sum: 1 } } },
        ])
        .toArray(),
      this.articles.countDocuments({
        libraryId,
        publishStatus: 'unpublished',
        lockExpireAt: { $gt: now },
      }),
    ]);
    let publishedCount = 0;
    let unpublishedCount = 0;
    for (const row of rows) {
      if (row._id === 'published') publishedCount = row.count;
      else if (row._id === 'unpublished') unpublishedCount = row.count;
    }
    return {
      total: publishedCount + unpublishedCount,
      publishedCount,
      unpublishedCount,
      occupiedCount,
    };
  }

  /**
   * @description 取文章库缩略图所需的前 N 篇文章首图
   * @keyword-en article library thumbnail sources by first image
   */
  async getThumbnailImages(libraryId: number, limit = 4): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 9));
    const docs = await this.articles
      .find(
        { libraryId, imageUrls: { $exists: true, $ne: [] } },
        { projection: { imageUrls: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .toArray();
    return docs
      .map((d) => (Array.isArray(d.imageUrls) ? d.imageUrls[0] : undefined))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  }
}
