import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { DataSourceService } from '../../data-source/services/data-source.service.js';
import type {
  DataSourceCreateInput,
  DataSourceEntity,
  DataSourceStatus,
} from '../../data-source/entities/data-source.entity.js';
import type { SassApiKeyEntity } from '../../sass/entities/sass-api-key.entity.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import { SassService } from '../../sass/services/sass.service.js';
import type {
  AdminAiProviderEntity,
  AdminSessionEntity,
  AdminUserEntity,
  AdminUserRole,
} from '../entities/admin.entity.js';

type AdminUserPublic = Omit<AdminUserEntity, 'passwordHash'> & { id: string };

/**
 * @description 后台管理服务，提供登录和后台各管理模块能力
 * @keyword-en admin management service
 */
@Injectable()
export class AdminService {
  private readonly users: Collection<AdminUserEntity>;
  private readonly sessions: Collection<AdminSessionEntity>;
  private readonly aiProviders: Collection<AdminAiProviderEntity>;
  private readonly sassTenants: Collection<SassTenantEntity>;
  private readonly sassApiKeys: Collection<SassApiKeyEntity>;
  private readonly dataSources: Collection<DataSourceEntity>;
  private readonly SESSION_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly sassService: SassService,
    private readonly dataSourceService: DataSourceService,
  ) {
    this.users = db.collection<AdminUserEntity>('admin_users');
    this.sessions = db.collection<AdminSessionEntity>('admin_sessions');
    this.aiProviders =
      db.collection<AdminAiProviderEntity>('admin_ai_providers');
    this.sassTenants = db.collection<SassTenantEntity>('sass_tenants');
    this.sassApiKeys = db.collection<SassApiKeyEntity>('sass_api_keys');
    this.dataSources = db.collection<DataSourceEntity>('data_sources');
    void this.ensureIndexes();
    void this.ensureBootstrapUser();
  }

  /**
   * @description 确保索引
   * @keyword-en ensure admin indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.users.createIndex({ username: 1 }, { unique: true });
    await this.users.createIndex({ tenantId: 1 });
    await this.sessions.createIndex({ tokenHash: 1 }, { unique: true });
    await this.sessions.createIndex({ userId: 1 });
    await this.sessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
    await this.aiProviders.createIndex(
      { providerCode: 1, tenantId: 1 },
      { unique: true },
    );
    await this.aiProviders.createIndex({ tenantId: 1 });
    await this.aiProviders.createIndex({ enabled: 1 });
  }

  /**
   * @description 初始化超级管理员
   * @keyword-en bootstrap super admin
   */
  async ensureBootstrapUser(): Promise<void> {
    const exists = await this.users.findOne({});
    if (exists) return;
    const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim() || 'admin';
    const password =
      process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() || 'admin123456';
    const now = new Date();
    const doc: AdminUserEntity = {
      _id: new ObjectId(),
      username,
      passwordHash: this.hashPassword(password),
      displayName: '系统管理员',
      role: 'super_admin',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.insertOne(doc);
  }

  /**
   * @description 登录并颁发token
   * @keyword-en login and issue token
   */
  async login(input: {
    username: string;
    password: string;
  }): Promise<{ token: string; user: AdminUserPublic }> {
    const username = input.username.trim();
    const user = await this.users.findOne({ username });
    if (!user) throw new UnauthorizedException('INVALID_USERNAME_OR_PASSWORD');
    if (!user.enabled) throw new ForbiddenException('ACCOUNT_DISABLED');
    if (!this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('INVALID_USERNAME_OR_PASSWORD');
    }
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    await this.sessions.insertOne({
      _id: new ObjectId(),
      userId: String(user._id),
      tokenHash: this.hashToken(token),
      expiresAt: new Date(now.getTime() + this.SESSION_EXPIRE_MS),
      createdAt: now,
      updatedAt: now,
    });
    await this.users.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: now, updatedAt: now } },
    );
    return { token, user: this.toPublicUser({ ...user, lastLoginAt: now }) };
  }

  /**
   * @description 通过token读取登录用户
   * @keyword-en get user from token
   */
  async getUserByToken(token: string): Promise<AdminUserEntity | null> {
    const tokenHash = this.hashToken(token);
    const session = await this.sessions.findOne({ tokenHash });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.users.findOne({
      _id: new ObjectId(session.userId),
    });
    if (!user || !user.enabled) return null;
    return user;
  }

  /**
   * @description 退出登录
   * @keyword-en logout session token
   */
  async logout(token: string): Promise<void> {
    await this.sessions.deleteOne({ tokenHash: this.hashToken(token) });
  }

  /**
   * @description 获取当前用户信息
   * @keyword-en get current admin user
   */
  getMe(currentUser: AdminUserEntity): AdminUserPublic {
    return this.toPublicUser(currentUser);
  }

  /**
   * @description 用户列表
   * @keyword-en list admin users
   */
  async listUsers(currentUser: AdminUserEntity): Promise<AdminUserPublic[]> {
    const filter: Record<string, unknown> = {};
    if (currentUser.tenantId) filter.tenantId = currentUser.tenantId;
    const rows = await this.users
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();
    return rows.map((row) => this.toPublicUser(row));
  }

  /**
   * @description 创建用户
   * @keyword-en create admin user
   */
  async createUser(
    currentUser: AdminUserEntity,
    input: {
      username: string;
      displayName: string;
      password: string;
      role: AdminUserRole;
      tenantId?: string;
    },
  ): Promise<AdminUserPublic> {
    const payloadTenantId = this.resolveNewUserTenant(currentUser, input);
    const now = new Date();
    const doc: AdminUserEntity = {
      _id: new ObjectId(),
      username: input.username.trim(),
      passwordHash: this.hashPassword(input.password),
      displayName: input.displayName.trim(),
      role: input.role,
      tenantId: payloadTenantId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.users.insertOne(doc);
    } catch {
      throw new BadRequestException('USERNAME_ALREADY_EXISTS');
    }
    return this.toPublicUser(doc);
  }

  /**
   * @description 更新用户
   * @keyword-en update admin user
   */
  async updateUser(
    currentUser: AdminUserEntity,
    id: string,
    input: {
      displayName?: string;
      password?: string;
      role?: AdminUserRole;
      tenantId?: string;
      enabled?: boolean;
    },
  ): Promise<AdminUserPublic | null> {
    this.assertCanManageUser(currentUser);
    const targetId = this.toObjectId(id, 'INVALID_USER_ID');
    const target = await this.users.findOne({ _id: targetId });
    if (!target) return null;
    if (currentUser.tenantId && target.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.displayName === 'string') {
      updates.displayName = input.displayName.trim();
    }
    if (typeof input.password === 'string' && input.password.trim()) {
      updates.passwordHash = this.hashPassword(input.password);
    }
    if (typeof input.role === 'string') {
      updates.role = input.role;
    }
    if (typeof input.enabled === 'boolean') {
      updates.enabled = input.enabled;
    }
    if (typeof input.tenantId !== 'undefined') {
      updates.tenantId = this.resolveTargetTenant(currentUser, input.tenantId);
    }
    const res = await this.users.findOneAndUpdate(
      { _id: targetId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ? this.toPublicUser(res.value) : null;
  }

  /**
   * @description 删除用户
   * @keyword-en delete admin user
   */
  async deleteUser(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    this.assertCanManageUser(currentUser);
    const targetId = this.toObjectId(id, 'INVALID_USER_ID');
    if (String(currentUser._id) === String(targetId)) {
      throw new BadRequestException('SELF_DELETE_FORBIDDEN');
    }
    const target = await this.users.findOne({ _id: targetId });
    if (!target) return false;
    if (currentUser.tenantId && target.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const res = await this.users.deleteOne({ _id: targetId });
    return res.deletedCount === 1;
  }

  /**
   * @description AI提供商列表
   * @keyword-en list ai providers
   */
  async listAiProviders(
    currentUser: AdminUserEntity,
  ): Promise<AdminAiProviderEntity[]> {
    const filter = currentUser.tenantId
      ? {
          $or: [
            { tenantId: currentUser.tenantId },
            { tenantId: { $exists: false } },
          ],
        }
      : {};
    return this.aiProviders.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 创建或更新AI提供商
   * @keyword-en upsert ai provider
   */
  async upsertAiProvider(
    currentUser: AdminUserEntity,
    input: {
      providerCode: string;
      name: string;
      baseUrl?: string;
      model?: string;
      apiKey: string;
      enabled?: boolean;
      tenantId?: string;
    },
  ): Promise<AdminAiProviderEntity> {
    const tenantId = this.resolveTargetTenant(currentUser, input.tenantId);
    const now = new Date();
    const filter: Record<string, unknown> = {
      providerCode: input.providerCode.trim(),
    };
    if (tenantId) filter.tenantId = tenantId;
    else filter.tenantId = { $exists: false };
    const doc = {
      providerCode: input.providerCode.trim(),
      name: input.name.trim(),
      baseUrl: input.baseUrl?.trim() || undefined,
      model: input.model?.trim() || undefined,
      apiKey: input.apiKey.trim(),
      enabled: input.enabled ?? true,
      tenantId,
      updatedAt: now,
    };
    const res = await this.aiProviders.findOneAndUpdate(
      filter,
      {
        $set: doc,
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) throw new BadRequestException('AI_PROVIDER_SAVE_FAILED');
    return res.value;
  }

  /**
   * @description 更新AI提供商
   * @keyword-en update ai provider
   */
  async updateAiProvider(
    currentUser: AdminUserEntity,
    id: string,
    input: {
      providerCode?: string;
      name?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      enabled?: boolean;
      tenantId?: string;
    },
  ): Promise<AdminAiProviderEntity | null> {
    const targetId = this.toObjectId(id, 'INVALID_AI_PROVIDER_ID');
    const target = await this.aiProviders.findOne({ _id: targetId });
    if (!target) return null;
    this.assertSameTenantOrPlatform(currentUser, target.tenantId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.providerCode === 'string' && input.providerCode.trim()) {
      updates.providerCode = input.providerCode.trim();
    }
    if (typeof input.name === 'string' && input.name.trim()) {
      updates.name = input.name.trim();
    }
    if (typeof input.baseUrl === 'string') {
      updates.baseUrl = input.baseUrl.trim() || undefined;
    }
    if (typeof input.model === 'string') {
      updates.model = input.model.trim() || undefined;
    }
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      updates.apiKey = input.apiKey.trim();
    }
    if (typeof input.enabled === 'boolean') {
      updates.enabled = input.enabled;
    }
    if (typeof input.tenantId !== 'undefined') {
      updates.tenantId = this.resolveTargetTenant(currentUser, input.tenantId);
    }
    const res = await this.aiProviders.findOneAndUpdate(
      { _id: targetId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除AI提供商
   * @keyword-en delete ai provider
   */
  async deleteAiProvider(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<boolean> {
    const targetId = this.toObjectId(id, 'INVALID_AI_PROVIDER_ID');
    const target = await this.aiProviders.findOne({ _id: targetId });
    if (!target) return false;
    this.assertSameTenantOrPlatform(currentUser, target.tenantId);
    const res = await this.aiProviders.deleteOne({ _id: targetId });
    return res.deletedCount === 1;
  }

  /**
   * @description 租户列表
   * @keyword-en list tenants
   */
  async listTenants(currentUser: AdminUserEntity) {
    if (currentUser.tenantId) {
      const row = await this.sassService.getTenant(currentUser.tenantId);
      return row ? [row] : [];
    }
    return this.sassService.listTenant();
  }

  /**
   * @description 创建租户
   * @keyword-en create tenant
   */
  async createTenant(
    currentUser: AdminUserEntity,
    input: { name: string; description?: string },
  ) {
    this.assertSuperAdmin(currentUser);
    return this.sassService.createTenant(input);
  }

  /**
   * @description 更新租户
   * @keyword-en update tenant
   */
  async updateTenant(
    currentUser: AdminUserEntity,
    id: string,
    input: { name?: string; description?: string },
  ): Promise<SassTenantEntity | null> {
    this.assertSuperAdmin(currentUser);
    const tenantId = this.toObjectId(id, 'INVALID_TENANT_ID');
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      updates.name = input.name.trim();
    }
    if (typeof input.description === 'string') {
      updates.description = input.description.trim() || undefined;
    }
    const res = await this.sassTenants.findOneAndUpdate(
      { _id: tenantId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除租户
   * @keyword-en delete tenant
   */
  async deleteTenant(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<boolean> {
    this.assertSuperAdmin(currentUser);
    const tenantId = this.toObjectId(id, 'INVALID_TENANT_ID');
    const hasUser = await this.users.findOne({ tenantId: String(tenantId) });
    if (hasUser) {
      throw new BadRequestException('TENANT_HAS_USERS');
    }
    const res = await this.sassTenants.deleteOne({ _id: tenantId });
    return res.deletedCount === 1;
  }

  /**
   * @description Key列表
   * @keyword-en list api keys
   */
  async listKeys(currentUser: AdminUserEntity, tenantId?: string) {
    const resolvedTenantId = currentUser.tenantId ?? tenantId?.trim();
    if (
      currentUser.tenantId &&
      resolvedTenantId &&
      resolvedTenantId !== currentUser.tenantId
    ) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const filter: Record<string, unknown> = {};
    if (resolvedTenantId) filter.tenantId = resolvedTenantId;
    return this.sassApiKeys.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 创建Key
   * @keyword-en create api key
   */
  async createKey(
    currentUser: AdminUserEntity,
    input: { tenantId: string; name: string; expireDays?: number },
  ) {
    if (currentUser.tenantId && currentUser.tenantId !== input.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    return this.sassService.createApiKey(input);
  }

  /**
   * @description 撤销Key
   * @keyword-en revoke api key
   */
  async revokeKey(
    currentUser: AdminUserEntity,
    keyId: string,
  ): Promise<boolean> {
    if (!currentUser.tenantId) return this.sassService.revokeApiKey(keyId);
    const keys = await this.sassService.listApiKey(currentUser.tenantId);
    const has = keys.some((item) => String(item._id) === keyId);
    if (!has) throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    return this.sassService.revokeApiKey(keyId);
  }

  /**
   * @description 更新Key
   * @keyword-en update api key
   */
  async updateKey(
    currentUser: AdminUserEntity,
    id: string,
    input: { name?: string; expiresAt?: string; revokedAt?: string },
  ): Promise<SassApiKeyEntity | null> {
    const keyObjectId = this.toObjectId(id, 'INVALID_API_KEY_ID');
    const target = await this.sassApiKeys.findOne({ _id: keyObjectId });
    if (!target) return null;
    this.assertSameTenantOrPlatform(currentUser, target.tenantId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      updates.name = input.name.trim();
    }
    if (typeof input.expiresAt === 'string' && input.expiresAt.trim()) {
      const date = new Date(input.expiresAt);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('INVALID_EXPIRES_AT');
      }
      updates.expiresAt = date;
    }
    if (typeof input.revokedAt === 'string' && input.revokedAt.trim()) {
      const date = new Date(input.revokedAt);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('INVALID_REVOKED_AT');
      }
      updates.revokedAt = date;
    }
    const res = await this.sassApiKeys.findOneAndUpdate(
      { _id: keyObjectId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除Key
   * @keyword-en delete api key
   */
  async deleteKey(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    const keyObjectId = this.toObjectId(id, 'INVALID_API_KEY_ID');
    const target = await this.sassApiKeys.findOne({ _id: keyObjectId });
    if (!target) return false;
    this.assertSameTenantOrPlatform(currentUser, target.tenantId);
    const res = await this.sassApiKeys.deleteOne({ _id: keyObjectId });
    return res.deletedCount === 1;
  }

  /**
   * @description 数据源列表
   * @keyword-en list data sources
   */
  async listDataSources(): Promise<DataSourceEntity[]> {
    return this.dataSources.find({}).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 创建数据源
   * @keyword-en create data source
   */
  async createDataSource(
    input: DataSourceCreateInput,
  ): Promise<DataSourceEntity> {
    return this.dataSourceService.registerSource(input);
  }

  /**
   * @description 更新数据源状态
   * @keyword-en update data source status
   */
  async updateDataSourceStatus(
    code: string,
    status: DataSourceStatus,
  ): Promise<DataSourceEntity | null> {
    return this.dataSourceService.updateStatus(code, status);
  }

  /**
   * @description 更新数据源
   * @keyword-en update data source
   */
  async updateDataSource(
    code: string,
    input: {
      name?: string;
      description?: string;
      moduleRef?: string;
      status?: DataSourceStatus;
    },
  ): Promise<DataSourceEntity | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      updates.name = input.name.trim();
    }
    if (typeof input.description === 'string' && input.description.trim()) {
      updates.description = input.description.trim();
    }
    if (typeof input.moduleRef === 'string' && input.moduleRef.trim()) {
      updates.moduleRef = input.moduleRef.trim();
    }
    if (typeof input.status === 'string') {
      updates.status = input.status;
    }
    const res = await this.dataSources.findOneAndUpdate(
      { code },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除数据源
   * @keyword-en delete data source
   */
  async deleteDataSource(code: string): Promise<boolean> {
    return this.dataSourceService.deleteSource(code);
  }

  /**
   * @description 解析ObjectId
   * @keyword-en parse object id
   */
  private toObjectId(id: string, code: string): ObjectId {
    if (!ObjectId.isValid(id)) throw new BadRequestException(code);
    return new ObjectId(id);
  }

  /**
   * @description token哈希
   * @keyword-en hash token
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * @description 密码哈希
   * @keyword-en hash password
   */
  private hashPassword(password: string): string {
    const salt = randomUUID().replace(/-/g, '');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * @description 校验密码
   * @keyword-en verify password
   */
  private verifyPassword(password: string, passwordHash: string): boolean {
    const [salt, originHash] = passwordHash.split(':');
    if (!salt || !originHash) return false;
    const compareHash = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(originHash), Buffer.from(compareHash));
  }

  /**
   * @description 转公开用户
   * @keyword-en transform to public user
   */
  private toPublicUser(user: AdminUserEntity): AdminUserPublic {
    const { passwordHash, ...rest } = user;
    void passwordHash;
    return {
      ...rest,
      id: String(user._id),
    };
  }

  /**
   * @description 校验用户管理权限
   * @keyword-en assert user management permission
   */
  private assertCanManageUser(currentUser: AdminUserEntity): void {
    if (currentUser.role === 'operator') {
      throw new ForbiddenException('PERMISSION_DENIED');
    }
  }

  /**
   * @description 校验超级管理员
   * @keyword-en assert super admin permission
   */
  private assertSuperAdmin(currentUser: AdminUserEntity): void {
    if (currentUser.tenantId || currentUser.role !== 'super_admin') {
      throw new ForbiddenException('PERMISSION_DENIED');
    }
  }

  /**
   * @description 校验租户边界
   * @keyword-en assert tenant boundary
   */
  private assertSameTenantOrPlatform(
    currentUser: AdminUserEntity,
    targetTenantId?: string,
  ): void {
    if (!currentUser.tenantId) return;
    const tenantId = targetTenantId?.trim();
    if (!tenantId || tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }

  /**
   * @description 解析用户目标租户
   * @keyword-en resolve target tenant for user operation
   */
  private resolveTargetTenant(
    currentUser: AdminUserEntity,
    tenantId?: string,
  ): string | undefined {
    if (currentUser.tenantId) {
      return currentUser.tenantId;
    }
    const value = tenantId?.trim();
    return value ? value : undefined;
  }

  /**
   * @description 解析新用户租户归属
   * @keyword-en resolve tenant for new user
   */
  private resolveNewUserTenant(
    currentUser: AdminUserEntity,
    input: { role: AdminUserRole; tenantId?: string },
  ): string | undefined {
    const tenantId = this.resolveTargetTenant(currentUser, input.tenantId);
    if (input.role === 'super_admin') {
      if (currentUser.tenantId) {
        throw new ForbiddenException('PERMISSION_DENIED');
      }
      return undefined;
    }
    if (!tenantId) throw new BadRequestException('TENANT_ID_REQUIRED');
    return tenantId;
  }
}
