import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import { TransformValidatorService } from '../../transform/services/transform-validator.service.js';
import type { TransformDsl } from '../../transform/types/transform-dsl.types.js';
import type { FinanceTransformEntity } from '../entities/finance-transform.entity.js';

const PLATFORM_SCOPE_ID = '__platform__';
const NAME_MAX = 60;

/**
 * @description Transform upsert 入参
 * @keyword-en finance transform upsert input
 */
export interface FinanceTransformUpsertInput {
  name: string;
  /** 改名时传旧 name */
  previousName?: string;
  dsl: unknown;
  explanation?: string;
}

/**
 * @description 财务 Transform 持久化服务(每作用域 × 每 name 唯一,落库前 validator 校验)
 * @keyword-en finance transform persistence service, dsl crud, named scope
 */
@Injectable()
export class FinanceTransformService {
  private readonly collection: Collection<FinanceTransformEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly validator: TransformValidatorService,
  ) {
    this.collection =
      db.collection<FinanceTransformEntity>('finance_transforms');
    void this.ensureIndexes();
  }

  /**
   * @description 索引(tenantId+name 唯一);旧 doc 用 category 字段 backfill name
   * @keyword-en ensure transform indexes with legacy category-to-name backfill
   */
  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.dropIndex('tenantId_1_category_1');
    } catch {
      // ignore
    }
    await this.collection.updateMany(
      { name: { $exists: false }, category: { $exists: true } } as never,
      [{ $set: { name: '$category' } }] as never,
    );
    await this.collection.deleteMany({ name: { $exists: false } } as never);
    await this.collection.createIndex(
      { tenantId: 1, name: 1 },
      { unique: true, name: 'tenantId_1_name_1' },
    );
  }

  /**
   * @description 列出当前作用域的所有 transform
   * @keyword-en list transforms by user scope
   */
  async list(currentUser: AdminUserEntity): Promise<FinanceTransformEntity[]> {
    const scopeId = this.resolveScopeId(currentUser);
    return this.collection
      .find({ tenantId: scopeId })
      .sort({ name: 1 })
      .toArray();
  }

  /**
   * @description 取单个 transform
   * @keyword-en get transform by name
   */
  async getByName(
    tenantId: string,
    name: string,
  ): Promise<FinanceTransformEntity | null> {
    return this.collection.findOne({ tenantId, name });
  }

  /**
   * @description Upsert transform(支持 previousName 触发改名;落库前 validator 校验 DSL)
   * @keyword-en upsert transform with optional rename
   */
  async upsert(
    currentUser: AdminUserEntity,
    input: FinanceTransformUpsertInput,
  ): Promise<FinanceTransformEntity> {
    const tenantId = this.resolveScopeId(currentUser);
    const name = this.assertName(input.name);
    const previousName = input.previousName?.trim();
    const dsl: TransformDsl = this.validator.validate(input.dsl);
    const now = new Date();

    if (previousName && previousName !== name) {
      const existed = await this.collection.findOne({
        tenantId,
        name: previousName,
      });
      if (!existed) {
        // 没有旧记录就当作普通 upsert
      } else {
        const conflict = await this.collection.findOne({ tenantId, name });
        if (conflict) {
          throw new BadRequestException('FINANCE_TRANSFORM_NAME_CONFLICT');
        }
        await this.collection.updateOne(
          { _id: existed._id },
          {
            $set: {
              name,
              dsl,
              explanation: input.explanation?.trim() || undefined,
              updatedAt: now,
            },
          },
        );
        const renamed = await this.collection.findOne({ _id: existed._id });
        if (!renamed)
          throw new BadRequestException('FINANCE_TRANSFORM_SAVE_FAILED');
        return renamed;
      }
    }

    const res = await this.collection.findOneAndUpdate(
      { tenantId, name },
      {
        $set: {
          dsl,
          explanation: input.explanation?.trim() || undefined,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          tenantId,
          name,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value)
      throw new BadRequestException('FINANCE_TRANSFORM_SAVE_FAILED');
    return res.value;
  }

  /**
   * @description 删除 transform(仅当前作用域)
   * @keyword-en delete transform by name
   */
  async delete(currentUser: AdminUserEntity, name: string): Promise<boolean> {
    const target = this.resolveScopeId(currentUser);
    this.assertName(name);
    const res = await this.collection.deleteOne({ tenantId: target, name });
    return res.deletedCount === 1;
  }

  /**
   * @description 解析作用域 ID
   * @keyword-en resolve scope id
   */
  resolveScopeId(currentUser: AdminUserEntity): string {
    return currentUser.tenantId?.trim() || PLATFORM_SCOPE_ID;
  }

  /**
   * @description name 校验
   * @keyword-en assert transform name
   */
  assertName(value: unknown): string {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException('FINANCE_TRANSFORM_NAME_REQUIRED');
    if (name.length > NAME_MAX) {
      throw new BadRequestException('FINANCE_TRANSFORM_NAME_TOO_LONG');
    }
    return name;
  }

  /**
   * @description 跨模块校验租户边界
   * @keyword-en assert tenant access
   */
  assertTenantAccess(currentUser: AdminUserEntity, tenantId: string): void {
    if (!currentUser.tenantId) return;
    if (currentUser.tenantId !== tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }
}
