import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import type {
  FinancePushConfigEntity,
  FinancePushConfigInput,
  FinancePushTestStatus,
} from '../entities/finance-push-config.entity.js';

const PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description 财务推送配置 CRUD(每作用域唯一一份;统一推送 /events/upsert)
 * @keyword-en finance push config service, scoped single, base url, api key
 */
@Injectable()
export class FinancePushConfigService {
  private readonly collection: Collection<FinancePushConfigEntity>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.collection = db.collection<FinancePushConfigEntity>(
      'finance_push_configs',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 索引(tenantId 唯一,externalTenantId 唯一);迁移旧"每作用域 × 每 category 一份"为"每作用域一份"(保留最新 updatedAt 那条)
   * @keyword-en ensure push config indexes with legacy category dedup
   */
  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.dropIndex('tenantId_1_category_1');
    } catch {
      // ignore
    }
    // 迁移:同 tenantId 下若有多条(旧 category 维度),保留最新一条
    const dups = await this.collection
      .aggregate([
        {
          $group: {
            _id: '$tenantId',
            count: { $sum: 1 },
            ids: { $push: '$_id' },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();
    for (const dup of dups) {
      const docs = await this.collection
        .find({ tenantId: dup._id as string })
        .sort({ updatedAt: -1 })
        .toArray();
      const keep = docs[0]?._id;
      if (keep) {
        await this.collection.deleteMany({
          tenantId: dup._id as string,
          _id: { $ne: keep },
        });
      }
    }
    await this.collection.createIndex(
      { tenantId: 1 },
      { unique: true, name: 'tenantId_1' },
    );
    await this.collection.createIndex(
      { externalTenantId: 1 },
      {
        unique: true,
        name: 'externalTenantId_1',
        partialFilterExpression: { externalTenantId: { $type: 'string' } },
      },
    );
  }

  /**
   * @description 取作用域 push config(运行时使用)
   * @keyword-en get push config by scope
   */
  async get(scopeId: string): Promise<FinancePushConfigEntity | null> {
    return this.collection.findOne({ tenantId: scopeId });
  }

  /**
   * @description 通过外部财务系统租户 ID 查找本系统作用域配置
   * @keyword-cn 外部租户映射, 推送配置
   * @keyword-en get-push-config-by-external-tenant, external-tenant-mapping
   */
  async getByExternalTenantId(
    externalTenantId: string,
  ): Promise<FinancePushConfigEntity | null> {
    const normalized = externalTenantId.trim();
    if (!normalized) return null;
    return this.collection.findOne({ externalTenantId: normalized });
  }

  /**
   * @description Upsert push config,including external tenant mapping for webhooks
   * @keyword-en upsert finance push config
   */
  async upsert(
    currentUser: AdminUserEntity,
    input: FinancePushConfigInput,
  ): Promise<FinancePushConfigEntity> {
    const tenantId = this.resolveScopeId(currentUser);
    const baseUrl = String(input.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, '');
    const apiKey = String(input.apiKey ?? '').trim();
    const externalTenantId = String(input.externalTenantId ?? '').trim();
    if (!baseUrl) throw new BadRequestException('PUSH_BASE_URL_REQUIRED');
    if (!apiKey) throw new BadRequestException('PUSH_API_KEY_REQUIRED');
    const now = new Date();
    try {
      const res = await this.collection.findOneAndUpdate(
        { tenantId },
        {
          $set: {
            baseUrl,
            apiKey,
            updatedAt: now,
            ...(externalTenantId ? { externalTenantId } : {}),
          },
          ...(externalTenantId ? {} : { $unset: { externalTenantId: '' } }),
          $setOnInsert: {
            _id: new ObjectId(),
            tenantId,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true },
      );
      if (!res.value) throw new BadRequestException('PUSH_CONFIG_SAVE_FAILED');
      return res.value;
    } catch (err) {
      if (this.isDuplicateExternalTenantError(err)) {
        throw new BadRequestException('PUSH_EXTERNAL_TENANT_ALREADY_BOUND');
      }
      throw err;
    }
  }

  /**
   * @description 判断是否为 externalTenantId 唯一索引冲突
   * @keyword-cn 外部租户映射, 重复键
   * @keyword-en detect-external-tenant-duplicate, external-tenant-mapping
   */
  private isDuplicateExternalTenantError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      code?: unknown;
      keyPattern?: unknown;
      message?: unknown;
    };
    const keyPattern = candidate.keyPattern;
    const message =
      typeof candidate.message === 'string' ? candidate.message : '';
    return (
      candidate.code === 11000 &&
      ((!!keyPattern &&
        typeof keyPattern === 'object' &&
        'externalTenantId' in keyPattern) ||
        message.includes('externalTenantId'))
    );
  }

  /**
   * @description 删除 push config(仅当前作用域)
   * @keyword-en delete finance push config
   */
  async delete(currentUser: AdminUserEntity): Promise<boolean> {
    const tenantId = this.resolveScopeId(currentUser);
    const res = await this.collection.deleteOne({ tenantId });
    return res.deletedCount === 1;
  }

  /**
   * @description 写入"上次连通性测试"结果
   * @keyword-en record push connectivity test result
   */
  async recordTest(
    scopeId: string,
    status: FinancePushTestStatus,
    message?: string,
  ): Promise<void> {
    await this.collection.updateOne(
      { tenantId: scopeId },
      {
        $set: {
          lastTestedAt: new Date(),
          lastTestStatus: status,
          lastTestMessage: message?.slice(0, 500),
        },
      },
    );
  }

  /**
   * @description 写入"上次推送"结果
   * @keyword-en record push run result
   */
  async recordPush(
    scopeId: string,
    payload: {
      name: string;
      totalRows: number;
      successCount: number;
      batches: number;
      failedReason?: string;
    },
  ): Promise<void> {
    await this.collection.updateOne(
      { tenantId: scopeId },
      {
        $set: {
          lastPushName: payload.name,
          lastPushAt: new Date(),
          lastPushTotalRows: payload.totalRows,
          lastPushSuccessCount: payload.successCount,
          lastPushBatches: payload.batches,
          lastPushFailedReason: payload.failedReason?.slice(0, 1000),
        },
      },
    );
  }

  /**
   * @description 解析作用域 ID
   * @keyword-en resolve scope id
   */
  resolveScopeId(currentUser: AdminUserEntity): string {
    return currentUser.tenantId?.trim() || PLATFORM_SCOPE_ID;
  }
}
