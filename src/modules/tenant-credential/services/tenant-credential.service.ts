import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type {
  TenantFeishuCredentialEntity,
  TenantFeishuCredentialInput,
} from '../entities/tenant-feishu-credential.entity.js';

/**
 * @description 租户飞书凭证服务，作用域边界为登录用户 tenantId；super_admin 无 tenantId 时落到平台自身（PLATFORM_SCOPE_ID）
 * @keyword-en tenant feishu credential service, crud, scoped, platform self
 */
const PLATFORM_SCOPE_ID = '__platform__';

@Injectable()
export class TenantCredentialService {
  private readonly collection: Collection<TenantFeishuCredentialEntity>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.collection = db.collection<TenantFeishuCredentialEntity>(
      'tenant_feishu_credentials',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 索引初始化（作用域唯一）
   * @keyword-en ensure tenant credential indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ tenantId: 1 }, { unique: true });
  }

  /**
   * @description 列出当前作用域的飞书凭证（最多一份）；super_admin 落到平台自身
   * @keyword-en list current scope feishu credential
   */
  async list(
    currentUser: AdminUserEntity,
  ): Promise<TenantFeishuCredentialEntity[]> {
    const scopeId = this.resolveScopeId(currentUser);
    const found = await this.collection.findOne({ tenantId: scopeId });
    return found ? [found] : [];
  }

  /**
   * @description 按租户读取凭证（供财务源运行时使用）
   * @keyword-en get feishu credential by tenant
   */
  async getByTenant(
    tenantId: string,
  ): Promise<TenantFeishuCredentialEntity | null> {
    const id = String(tenantId ?? '').trim();
    if (!id) return null;
    return this.collection.findOne({ tenantId: id });
  }

  /**
   * @description Upsert 当前作用域凭证（scope 来自登录用户，super_admin 用平台占位符）
   * @keyword-en upsert feishu credential for current scope
   */
  async upsert(
    currentUser: AdminUserEntity,
    input: TenantFeishuCredentialInput,
  ): Promise<TenantFeishuCredentialEntity> {
    const tenantId = this.resolveScopeId(currentUser);
    const appId = String(input.appId ?? '').trim();
    const appSecret = String(input.appSecret ?? '').trim();
    if (!appId || !appSecret) {
      throw new BadRequestException('FEISHU_APP_ID_OR_SECRET_REQUIRED');
    }
    const now = new Date();
    const remark = input.remark?.trim() || undefined;
    const res = await this.collection.findOneAndUpdate(
      { tenantId },
      {
        $set: { appId, appSecret, remark, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), tenantId, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) {
      throw new BadRequestException('FEISHU_CREDENTIAL_SAVE_FAILED');
    }
    return res.value;
  }

  /**
   * @description 按 ID 更新凭证（强制校验目标作用域与当前用户一致）
   * @keyword-en update feishu credential
   */
  async update(
    currentUser: AdminUserEntity,
    id: string,
    input: Partial<TenantFeishuCredentialInput>,
  ): Promise<TenantFeishuCredentialEntity | null> {
    const scopeId = this.resolveScopeId(currentUser);
    const objectId = this.toObjectId(id);
    const target = await this.collection.findOne({ _id: objectId });
    if (!target) throw new NotFoundException('FEISHU_CREDENTIAL_NOT_FOUND');
    if (target.tenantId !== scopeId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.appId === 'string' && input.appId.trim()) {
      updates.appId = input.appId.trim();
    }
    if (typeof input.appSecret === 'string' && input.appSecret.trim()) {
      updates.appSecret = input.appSecret.trim();
    }
    if (typeof input.remark === 'string') {
      updates.remark = input.remark.trim() || undefined;
    }
    const res = await this.collection.findOneAndUpdate(
      { _id: objectId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除凭证（仅当前作用域）
   * @keyword-en delete feishu credential
   */
  async delete(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    const scopeId = this.resolveScopeId(currentUser);
    const objectId = this.toObjectId(id);
    const target = await this.collection.findOne({ _id: objectId });
    if (!target) return false;
    if (target.tenantId !== scopeId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const res = await this.collection.deleteOne({ _id: objectId });
    return res.deletedCount === 1;
  }

  /**
   * @description 解析当前用户的作用域 ID：tenant_admin 用自身 tenantId；super_admin 用平台占位符
   * @keyword-en resolve current scope id for credential ops
   */
  private resolveScopeId(currentUser: AdminUserEntity): string {
    const tenantId = currentUser.tenantId?.trim();
    return tenantId || PLATFORM_SCOPE_ID;
  }

  /**
   * @description ObjectId 校验
   * @keyword-en parse credential object id
   */
  private toObjectId(id: string): ObjectId {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException('INVALID_FEISHU_CREDENTIAL_ID');
    }
    return new ObjectId(id);
  }
}
