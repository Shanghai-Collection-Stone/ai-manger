import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import type {
  FinanceBindingEntity,
  FinanceFlow,
  FinancePartyType,
  FinanceSourceItem,
} from '../entities/finance-binding.entity.js';

const VALID_FLOWS = new Set<FinanceFlow>(['in', 'out']);
const VALID_PARTY_TYPES = new Set<FinancePartyType>([
  'supplier',
  'customer',
  'employee',
  'counterparty',
]);

const NAME_MAX = 60;

/**
 * @description super_admin 无 tenantId 时使用的平台占位符;与 tenant-credential 模块保持一致
 * @keyword-en platform scope id for super admin
 */
const PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description 财务源绑定 upsert 入参
 * @keyword-en finance binding upsert input
 */
export interface FinanceBindingUpsertInput {
  name: string;
  /** 改名时传旧 name(用于"重命名"操作);不传则按 name 直接 upsert */
  previousName?: string;
  flowDefault?: FinanceFlow;
  partyTypeDefault?: FinancePartyType;
  sources: FinanceSourceItem[];
  remark?: string;
}

/**
 * @description 财务源绑定服务(每作用域 × 每 name 唯一)
 * @keyword-en finance binding service, named scope, sources crud
 */
@Injectable()
export class FinanceBindingService {
  private readonly collection: Collection<FinanceBindingEntity>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.collection = db.collection<FinanceBindingEntity>('finance_bindings');
    void this.ensureIndexes();
  }

  /**
   * @description 索引初始化(tenantId+name 唯一);旧 doc 用 category 字段 backfill name(让用户保留遗留 binding 可继续编辑改名)
   * @keyword-en ensure binding indexes with legacy category-to-name backfill
   */
  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.dropIndex('tenantId_1_category_1');
    } catch {
      // index may not exist; ignore
    }
    // 迁移:旧 doc 若有 category 但没 name,把 category 抄到 name
    await this.collection.updateMany(
      { name: { $exists: false }, category: { $exists: true } } as never,
      [{ $set: { name: '$category' } }] as never,
    );
    // 兜底:仍缺 name 的 doc 删除(无法定位)
    await this.collection.deleteMany({ name: { $exists: false } } as never);
    await this.collection.createIndex(
      { tenantId: 1, name: 1 },
      { unique: true, name: 'tenantId_1_name_1' },
    );
  }

  /**
   * @description 列出当前作用域的所有 binding
   * @keyword-en list bindings by user scope
   */
  async list(currentUser: AdminUserEntity): Promise<FinanceBindingEntity[]> {
    const scopeId = this.resolveScopeId(currentUser);
    return this.collection.find({ tenantId: scopeId }).sort({ name: 1 }).toArray();
  }

  /**
   * @description 取单个 binding(运行时使用)
   * @keyword-en get binding by name
   */
  async getByName(
    tenantId: string,
    name: string,
  ): Promise<FinanceBindingEntity | null> {
    return this.collection.findOne({ tenantId, name });
  }

  /**
   * @description Upsert binding(支持 previousName 以触发改名)
   * @keyword-en upsert binding with optional rename
   */
  async upsert(
    currentUser: AdminUserEntity,
    input: FinanceBindingUpsertInput,
  ): Promise<FinanceBindingEntity> {
    const tenantId = this.resolveScopeId(currentUser);
    const name = this.assertName(input.name);
    const previousName = input.previousName?.trim();
    const sources = this.normalizeSources(input.sources);
    const flowDefault = this.assertFlow(input.flowDefault);
    const partyTypeDefault = this.assertPartyType(input.partyTypeDefault);
    const now = new Date();

    if (previousName && previousName !== name) {
      const existed = await this.collection.findOne({
        tenantId,
        name: previousName,
      });
      if (!existed) {
        throw new BadRequestException('FINANCE_BINDING_PREVIOUS_NOT_FOUND');
      }
      const conflict = await this.collection.findOne({ tenantId, name });
      if (conflict) {
        throw new BadRequestException('FINANCE_BINDING_NAME_CONFLICT');
      }
      await this.collection.updateOne(
        { _id: existed._id },
        {
          $set: {
            name,
            sources,
            flowDefault,
            partyTypeDefault,
            remark: input.remark?.trim() || undefined,
            updatedAt: now,
          },
        },
      );
      const renamed = await this.collection.findOne({ _id: existed._id });
      if (!renamed) throw new BadRequestException('FINANCE_BINDING_SAVE_FAILED');
      return renamed;
    }

    const res = await this.collection.findOneAndUpdate(
      { tenantId, name },
      {
        $set: {
          sources,
          flowDefault,
          partyTypeDefault,
          remark: input.remark?.trim() || undefined,
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
    if (!res.value) throw new BadRequestException('FINANCE_BINDING_SAVE_FAILED');
    return res.value;
  }

  /**
   * @description 删除 binding(仅当前作用域)
   * @keyword-en delete binding by name
   */
  async delete(currentUser: AdminUserEntity, name: string): Promise<boolean> {
    const target = this.resolveScopeId(currentUser);
    this.assertName(name);
    const res = await this.collection.deleteOne({ tenantId: target, name });
    return res.deletedCount === 1;
  }

  /**
   * @description sources 标准化(去重 + 字段裁剪 + 校验 + 默认归属裁剪)
   * @keyword-en normalize sources with org defaults
   */
  private normalizeSources(sources: unknown): FinanceSourceItem[] {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new BadRequestException('FINANCE_BINDING_SOURCES_REQUIRED');
    }
    const out: FinanceSourceItem[] = [];
    const seen = new Set<string>();
    for (const raw of sources) {
      if (!raw || typeof raw !== 'object') continue;
      const obj = raw as Record<string, unknown>;
      const type = String(obj.type ?? '');
      const alias = this.optionalString(obj.alias, 80);
      if (type === 'bitable') {
        const appToken = String(obj.appToken ?? '').trim();
        const tableId = String(obj.tableId ?? '').trim();
        if (!appToken || !tableId) {
          throw new BadRequestException('FINANCE_BITABLE_FIELDS_REQUIRED');
        }
        const key = `bitable:${appToken}:${tableId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: 'bitable', appToken, tableId, alias });
      } else if (type === 'approval') {
        const approvalCode = String(obj.approvalCode ?? '').trim();
        if (!approvalCode) {
          throw new BadRequestException('FINANCE_APPROVAL_CODE_REQUIRED');
        }
        const key = `approval:${approvalCode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: 'approval', approvalCode, alias });
      } else {
        throw new BadRequestException('FINANCE_SOURCE_TYPE_INVALID');
      }
    }
    if (out.length === 0) {
      throw new BadRequestException('FINANCE_BINDING_SOURCES_REQUIRED');
    }
    return out;
  }

  /**
   * @description 解析当前用户的作用域 ID
   * @keyword-en resolve scope id
   */
  resolveScopeId(currentUser: AdminUserEntity): string {
    return currentUser.tenantId?.trim() || PLATFORM_SCOPE_ID;
  }

  /**
   * @description name 校验(非空 + 长度上限 + 去除空白)
   * @keyword-en assert binding name
   */
  assertName(value: unknown): string {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException('FINANCE_BINDING_NAME_REQUIRED');
    if (name.length > NAME_MAX) {
      throw new BadRequestException('FINANCE_BINDING_NAME_TOO_LONG');
    }
    return name;
  }

  /**
   * @description flow 可选枚举校验
   * @keyword-en assert flow optional
   */
  private assertFlow(value: unknown): FinanceFlow | undefined {
    if (value == null || value === '') return undefined;
    const v = String(value) as FinanceFlow;
    if (!VALID_FLOWS.has(v)) {
      throw new BadRequestException('FINANCE_FLOW_INVALID');
    }
    return v;
  }

  /**
   * @description partyType 可选枚举校验
   * @keyword-en assert party type optional
   */
  private assertPartyType(value: unknown): FinancePartyType | undefined {
    if (value == null || value === '') return undefined;
    const v = String(value) as FinancePartyType;
    if (!VALID_PARTY_TYPES.has(v)) {
      throw new BadRequestException('FINANCE_PARTY_TYPE_INVALID');
    }
    return v;
  }

  /**
   * @description 可选字符串裁剪 + 长度校验
   * @keyword-en optional string trim and length cap
   */
  private optionalString(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > max) {
      throw new BadRequestException('FINANCE_BINDING_FIELD_TOO_LONG');
    }
    return trimmed;
  }

  /**
   * @description 跨模块校验租户边界(agent 工具会用)
   * @keyword-en assert tenant access
   */
  assertTenantAccess(currentUser: AdminUserEntity, tenantId: string): void {
    if (!currentUser.tenantId) return;
    if (currentUser.tenantId !== tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }
}
