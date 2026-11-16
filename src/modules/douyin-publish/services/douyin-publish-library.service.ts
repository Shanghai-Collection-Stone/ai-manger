import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  DouyinMiniappVersionType,
  DouyinPublishLibraryEntity,
  DouyinPublishLibraryStats,
  DouyinPublishLibraryView,
  DouyinPublishScope,
  DouyinPublishWorkEntity,
} from '../entities/douyin-publish.entity.js';
import {
  DouyinMiniappSchemaError,
  DouyinMiniappSchemaService,
} from './douyin-miniapp-schema.service.js';

/**
 * @description 管理抖音视频发布库、二维码 token 与聚合统计。
 * @keyword-cn 发布库服务, 二维码令牌
 * @keyword-en publish-library-service, qr-token
 */
@Injectable()
export class DouyinPublishLibraryService {
  private readonly logger = new Logger(DouyinPublishLibraryService.name);
  private readonly libraries: Collection<DouyinPublishLibraryEntity>;
  private readonly works: Collection<DouyinPublishWorkEntity>;
  /** 同一发布库同一时刻只生成一次 Schema，避免并发打开二维码时重复占用长期 Schema 配额 */
  private readonly schemaInFlight = new Map<string, Promise<string>>();

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly config: ConfigService,
    private readonly schemas: DouyinMiniappSchemaService,
  ) {
    this.libraries = db.collection<DouyinPublishLibraryEntity>(
      'douyin_publish_libraries',
    );
    this.works = db.collection<DouyinPublishWorkEntity>('douyin_publish_works');
    void this.ensureIndexes();
  }

  /**
   * @description 建立发布库作用域索引与仅约束字符串的二维码 token 唯一索引。
   * @keyword-cn 发布库索引, 二维码唯一索引
   * @keyword-en publish-library-indexes, qr-token-unique-index
   */
  async ensureIndexes(): Promise<void> {
    await this.libraries.createIndex({ tenantId: 1, userId: 1, createdAt: 1 });
    await this.libraries.createIndex(
      { qrToken: 1 },
      {
        unique: true,
        partialFilterExpression: { qrToken: { $type: 'string' } },
      },
    );
  }

  /**
   * @description 构造与抖音工作台一致的租户和用户双重过滤。
   * @keyword-cn 发布作用域过滤, 用户隔离
   * @keyword-en publish-scope-filter, user-isolation
   */
  scopeFilter(scope: DouyinPublishScope): Record<string, unknown> {
    return {
      userId: scope.userId,
      ...(scope.tenantId
        ? { tenantId: scope.tenantId }
        : {
            $or: [
              { tenantId: { $exists: false } },
              { tenantId: null },
              { tenantId: '' },
            ],
          }),
    };
  }

  /**
   * @description 新建当前作用域的视频发布库。
   * @keyword-cn 新建发布库
   * @keyword-en create-publish-library
   */
  async create(
    name: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishLibraryView> {
    const now = new Date();
    const entity: DouyinPublishLibraryEntity = {
      _id: new ObjectId(),
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      name: this.normalizeName(name),
      createdAt: now,
      updatedAt: now,
    };
    await this.libraries.insertOne(entity);
    return this.toView(entity, this.emptyStats());
  }

  /**
   * @description 一次聚合列出当前作用域全部发布库及其作品统计，避免逐库查询。
   * @keyword-cn 发布库列表, 批量统计
   * @keyword-en list-publish-libraries, batch-library-stats
   */
  async list(scope: DouyinPublishScope): Promise<DouyinPublishLibraryView[]> {
    const now = new Date();
    const rows = await this.libraries
      .aggregate<
        DouyinPublishLibraryEntity & {
          workStats: Array<{
            unpublished: number;
            published: number;
            leased: number;
            lastPublishedAt: Date | null;
          }>;
        }
      >([
        { $match: this.scopeFilter(scope) },
        { $sort: { createdAt: 1 } },
        {
          $lookup: {
            from: 'douyin_publish_works',
            let: { currentLibraryId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$libraryId', '$$currentLibraryId'] },
                },
              },
              {
                $group: {
                  _id: null,
                  unpublished: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'unpublished'] }, 1, 0],
                    },
                  },
                  published: {
                    $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] },
                  },
                  leased: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ['$status', 'unpublished'] },
                            { $gt: ['$lockExpireAt', now] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  lastPublishedAt: { $max: '$publishedAt' },
                },
              },
            ],
            as: 'workStats',
          },
        },
      ])
      .toArray();
    return rows.map((row) => {
      const stats = row.workStats[0];
      return this.toView(
        row,
        stats
          ? {
              unpublished: stats.unpublished,
              published: stats.published,
              leased: stats.leased,
              lastPublishedAt: stats.lastPublishedAt?.toISOString() ?? null,
            }
          : this.emptyStats(),
      );
    });
  }

  /**
   * @description 按字符串 ObjectId 读取当前作用域发布库。
   * @keyword-cn 读取发布库, 所有权校验
   * @keyword-en get-publish-library, ownership-check
   */
  async get(
    id: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishLibraryEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.libraries.findOne({
      _id: new ObjectId(id),
      ...this.scopeFilter(scope),
    });
  }

  /**
   * @description 要求当前作用域内发布库存在，不存在时返回 404。
   * @keyword-cn 要求发布库, 发布库不存在
   * @keyword-en require-publish-library, publish-library-not-found
   */
  async require(
    id: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishLibraryEntity> {
    const library = await this.get(id, scope);
    if (!library)
      throw new NotFoundException('DOUYIN_PUBLISH_LIBRARY_NOT_FOUND');
    return library;
  }

  /**
   * @description 更新当前作用域发布库名称。
   * @keyword-cn 更新发布库
   * @keyword-en update-publish-library
   */
  async update(
    id: string,
    name: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishLibraryView> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('DOUYIN_PUBLISH_LIBRARY_NOT_FOUND');
    const result = await this.libraries.findOneAndUpdate(
      { _id: new ObjectId(id), ...this.scopeFilter(scope) },
      { $set: { name: this.normalizeName(name), updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value)
      throw new NotFoundException('DOUYIN_PUBLISH_LIBRARY_NOT_FOUND');
    return this.toView(result.value, await this.getStats(result.value._id));
  }

  /**
   * @description 仅允许删除没有作品的发布库。
   * @keyword-cn 删除发布库, 非空库保护
   * @keyword-en delete-publish-library, non-empty-library-guard
   */
  async remove(id: string, scope: DouyinPublishScope): Promise<void> {
    const library = await this.require(id, scope);
    if ((await this.works.countDocuments({ libraryId: library._id })) > 0) {
      throw new ConflictException('DOUYIN_PUBLISH_LIBRARY_NOT_EMPTY');
    }
    await this.libraries.deleteOne({
      _id: library._id,
      ...this.scopeFilter(scope),
    });
  }

  /**
   * @description 按后端统一版本配置生成同一发布库扫码入口；开发测试版必须使用官方 Schema。
   *   本地开发时打印可直接粘贴到小程序发布页的入口 JSON，复用二维码缓存时同样打印。
   * @keyword-cn 生成发布二维码, 懒生成令牌
   * @keyword-en build-publish-qr, lazy-qr-token
   */
  async getQr(id: string, scope: DouyinPublishScope) {
    const versionType = this.schemas.getVersionType();
    let library = await this.require(id, scope);
    if (!library.qrToken) {
      for (let attempt = 0; attempt < 3 && !library.qrToken; attempt += 1) {
        const token = randomBytes(32).toString('base64url');
        try {
          const result = await this.libraries.findOneAndUpdate(
            {
              _id: library._id,
              $and: [
                this.scopeFilter(scope),
                {
                  $or: [
                    { qrToken: { $exists: false } },
                    { qrToken: null },
                    { qrToken: '' },
                  ],
                },
              ],
            },
            { $set: { qrToken: token, updatedAt: new Date() } },
            { returnDocument: 'after', includeResultMetadata: true },
          );
          library = result.value ?? (await this.require(id, scope));
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
        }
      }
    }
    if (!library.qrToken)
      throw new ConflictException('DOUYIN_PUBLISH_QR_TOKEN_FAILED');
    const query = { token: library.qrToken, tenantId: library.tenantId ?? '' };
    const path = JSON.stringify(query);
    const environment = String(
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '',
    )
      .trim()
      .toLowerCase();
    if (['', 'development', 'dev'].includes(environment)) {
      this.logger.log(
        `[qr] entry_json library=${library._id.toHexString()} version=${versionType}\n${path}`,
      );
    }
    if (this.schemas.isConfigured()) {
      return {
        libraryId: library._id.toHexString(),
        token: library.qrToken,
        path,
        versionType,
        qrContent: await this.resolveQrSchema(library, query, versionType),
        qrContentType: 'douyin-schema' as const,
      };
    }
    if (versionType === 'latest')
      throw new ServiceUnavailableException(
        'DOUYIN_PUBLISH_TEST_QR_NOT_CONFIGURED',
      );
    const template = String(
      this.config.get<string>('DOUYIN_PUBLISH_QR_LINK_TEMPLATE') ?? '',
    ).trim();
    return {
      libraryId: library._id.toHexString(),
      token: library.qrToken,
      path,
      versionType,
      qrContent: template.includes('{path}')
        ? template.replaceAll('{path}', encodeURIComponent(path))
        : path,
      qrContentType: template.includes('{path}')
        ? ('template' as const)
        : ('json' as const),
    };
  }

  /**
   * @description 按版本分别复用发布库长期 Schema，正式版兼容旧缓存；并发生成也按版本隔离。
   *   启动参数是扁平的 `{token, tenantId}`，小程序在 onLoad 的 options 里直接读这两个键。
   * @keyword-cn 发布库Schema, 生成一次复用
   * @keyword-en publish-library-schema, generate-once-reuse
   * @throws {BadGatewayException} 抖音开放平台调用失败（`DOUYIN_PUBLISH_QR_SCHEMA_FAILED`）。
   */
  private async resolveQrSchema(
    library: DouyinPublishLibraryEntity,
    query: { token: string; tenantId: string },
    versionType: DouyinMiniappVersionType,
  ): Promise<string> {
    const key = this.schemas.buildSchemaKey(query);
    const cached = library.qrSchemas?.[versionType];
    if (cached?.schema && key && cached.key === key) return cached.schema;
    if (
      versionType === 'current' &&
      library.qrSchema &&
      key &&
      library.qrSchemaKey === key
    ) {
      return library.qrSchema;
    }
    const inflightKey = `${library._id.toHexString()}|${key}`;
    let pending = this.schemaInFlight.get(inflightKey);
    if (!pending) {
      pending = (
        /** 生成并持久化所选版本的二维码，不修改作品或发布库统计。 @name generateVersionSchema
         * @keyword-cn 版本二维码缓存, 生成一次复用
         * @keyword-en version-qr-cache, generate-once-reuse
         */ async () => {
          const schema = await this.schemas.generatePermanentSchema(query);
          // 只在 token 没变时写回；不改 updatedAt，二维码生成不算发布库内容变化
          await this.libraries.updateOne(
            { _id: library._id, qrToken: query.token },
            {
              $set: {
                [`qrSchemas.${versionType}`]: { schema, key: key ?? '' },
                ...(versionType === 'current'
                  ? { qrSchema: schema, qrSchemaKey: key ?? '' }
                  : {}),
              },
            },
          );
          return schema;
        }
      )().finally(
        /** 清除本次版本生成的进程内去重标记。 @name clearVersionSchemaFlight
         * @keyword-cn 版本二维码缓存, 生成一次复用
         * @keyword-en version-qr-cache, generate-once-reuse
         */ () => this.schemaInFlight.delete(inflightKey),
      );
      this.schemaInFlight.set(inflightKey, pending);
    }
    try {
      return await pending;
    } catch (error) {
      const code =
        error instanceof DouyinMiniappSchemaError ? error.code : 'UNKNOWN';
      const detail =
        error instanceof DouyinMiniappSchemaError
          ? (error.detail ?? '')
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.warn(
        `[qr] schema_failed library=${library._id.toHexString()} code=${code} ${detail}`,
      );
      throw new BadGatewayException('DOUYIN_PUBLISH_QR_SCHEMA_FAILED');
    }
  }

  /**
   * @description 通过全局唯一二维码 token 读取发布库。
   * @keyword-cn 二维码鉴权查询
   * @keyword-en find-library-by-token
   */
  async findByToken(token: string): Promise<DouyinPublishLibraryEntity | null> {
    return this.libraries.findOne({ qrToken: token });
  }

  /**
   * @description 聚合一个发布库的未发布、已发布、有效租约和最近发布时间。
   * @keyword-cn 发布库统计聚合
   * @keyword-en aggregate-library-stats
   */
  async getStats(libraryId: ObjectId): Promise<DouyinPublishLibraryStats> {
    const now = new Date();
    const rows = await this.works
      .aggregate<{
        unpublished: number;
        published: number;
        leased: number;
        lastPublishedAt: Date | null;
      }>([
        { $match: { libraryId } },
        {
          $group: {
            _id: null,
            unpublished: {
              $sum: { $cond: [{ $eq: ['$status', 'unpublished'] }, 1, 0] },
            },
            published: {
              $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] },
            },
            leased: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'unpublished'] },
                      { $gt: ['$lockExpireAt', now] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            lastPublishedAt: { $max: '$publishedAt' },
          },
        },
      ])
      .toArray();
    const row = rows[0];
    return row
      ? {
          unpublished: row.unpublished,
          published: row.published,
          leased: row.leased,
          lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
        }
      : this.emptyStats();
  }

  /**
   * @description 返回全零发布库统计。
   * @keyword-cn 空发布统计
   * @keyword-en empty-publish-stats
   */
  private emptyStats(): DouyinPublishLibraryStats {
    return { unpublished: 0, published: 0, leased: 0, lastPublishedAt: null };
  }

  /**
   * @description 去除库名首尾空白并校验一至三十个字符。
   * @keyword-cn 发布库名称归一化
   * @keyword-en normalize-library-name
   */
  private normalizeName(name: string): string {
    const normalized = String(name ?? '').trim();
    if (!normalized || normalized.length > 30) {
      throw new BadRequestException('DOUYIN_PUBLISH_LIBRARY_NAME_INVALID');
    }
    return normalized;
  }

  /**
   * @description 把发布库实体转换为接口视图。
   * @keyword-cn 发布库视图转换
   * @keyword-en publish-library-view-mapping
   */
  private toView(
    entity: DouyinPublishLibraryEntity,
    stats: DouyinPublishLibraryStats,
  ): DouyinPublishLibraryView {
    return {
      id: entity._id.toHexString(),
      name: entity.name,
      createdAt: entity.createdAt.toISOString(),
      stats,
    };
  }
}
