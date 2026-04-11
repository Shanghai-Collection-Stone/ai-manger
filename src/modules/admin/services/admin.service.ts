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
  createHmac,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { DataSourceService } from '../../data-source/services/data-source.service.js';
import type {
  DataSourceCreateInput,
  DataSourceEntity,
  MongoConnectionConfig,
  DataSourceStatus,
} from '../../data-source/entities/data-source.entity.js';
import type { SassApiKeyEntity } from '../../sass/entities/sass-api-key.entity.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import { SassService } from '../../sass/services/sass.service.js';
import type {
  AdminAiProviderEntity,
  AdminAgentConfigEntity,
  AdminClawConfigEntity,
  AdminJwtPayload,
  AdminLlmSettingEntity,
  AdminSessionEntity,
  AdminUserEntity,
  AdminUserRole,
  ClawConnectStatus,
} from '../entities/admin.entity.js';

type AdminUserPublic = Omit<AdminUserEntity, 'passwordHash'> & { id: string };

/**
 * @description 后台管理服务，提供登录和后台各管理模块能力
 * @keyword-en admin management service
 */
@Injectable()
export class AdminService {
  private readonly PLATFORM_INFO_SCOPE_TENANT_ID = '__platform__';
  private readonly users: Collection<AdminUserEntity>;
  private readonly sessions: Collection<AdminSessionEntity>;
  private readonly aiProviders: Collection<AdminAiProviderEntity>;
  private readonly clawConfigs: Collection<AdminClawConfigEntity>;
  private readonly agentConfigs: Collection<AdminAgentConfigEntity>;
  private readonly llmSettings: Collection<AdminLlmSettingEntity>;
  private readonly sassTenants: Collection<SassTenantEntity>;
  private readonly sassApiKeys: Collection<SassApiKeyEntity>;
  private readonly dataSources: Collection<DataSourceEntity>;
  private readonly SESSION_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly jwtSecret: string;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly sassService: SassService,
    private readonly dataSourceService: DataSourceService,
  ) {
    this.users = db.collection<AdminUserEntity>('admin_users');
    this.sessions = db.collection<AdminSessionEntity>('admin_sessions');
    this.aiProviders =
      db.collection<AdminAiProviderEntity>('admin_ai_providers');
    this.clawConfigs =
      db.collection<AdminClawConfigEntity>('admin_claw_configs');
    this.agentConfigs =
      db.collection<AdminAgentConfigEntity>('admin_agent_configs');
    this.llmSettings =
      db.collection<AdminLlmSettingEntity>('admin_llm_settings');
    this.sassTenants = db.collection<SassTenantEntity>('sass_tenants');
    this.sassApiKeys = db.collection<SassApiKeyEntity>('sass_api_keys');
    this.dataSources = db.collection<DataSourceEntity>('data_sources');
    this.jwtSecret =
      process.env.ADMIN_JWT_SECRET?.trim() ||
      process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ||
      'ai-mvp-admin-jwt-secret';
    void this.initializeAdminInfrastructure();
  }

  /**
   * @description 顺序初始化后台基础设施
   * @keyword-en initialize admin infrastructure in sequence
   */
  private async initializeAdminInfrastructure(): Promise<void> {
    await this.ensureIndexes();
    await this.ensureBootstrapUser();
    await this.ensureProvidersFromEnv();
  }

  /**
   * @description 确保索引
   * @keyword-en ensure admin indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.users.dropIndex('username_1').catch(() => undefined);
    await this.users.createIndex(
      { username: 1, tenantId: 1 },
      { unique: true },
    );
    await this.users.createIndex({ tenantId: 1 });
    await this.sessions.createIndex({ tokenHash: 1 }, { unique: true });
    await this.sessions.createIndex({ sessionId: 1 }, { unique: true });
    await this.sessions.createIndex({ userId: 1 });
    await this.sessions.createIndex({ tenantId: 1 });
    await this.sessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
    await this.aiProviders.dropIndex('providerCode_1').catch(() => undefined);
    await this.aiProviders
      .dropIndex('providerCode_1_tenantId_1')
      .catch(() => undefined);
    await this.aiProviders.dropIndex('isDefault_1').catch(() => undefined);
    await this.aiProviders.createIndex(
      { providerCode: 1, modelCategory: 1 },
      { unique: true },
    );
    await this.aiProviders.createIndex({ enabled: 1 });
    await this.aiProviders.createIndex(
      { modelCategory: 1, isDefault: 1 },
      {
        unique: true,
        partialFilterExpression: { isDefault: true },
      },
    );
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
    tenantId?: string;
  }): Promise<{ token: string; user: AdminUserPublic }> {
    const username = input.username.trim();
    const tenantId = input.tenantId?.trim();
    const user = await this.users.findOne(
      tenantId
        ? { username, tenantId }
        : { username, tenantId: { $exists: false } },
    );
    if (!user) throw new UnauthorizedException('INVALID_USERNAME_OR_PASSWORD');
    if (!user.enabled) throw new ForbiddenException('ACCOUNT_DISABLED');
    if (!this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('INVALID_USERNAME_OR_PASSWORD');
    }
    const now = new Date();
    const exp = Math.floor((now.getTime() + this.SESSION_EXPIRE_MS) / 1000);
    const iat = Math.floor(now.getTime() / 1000);
    const sid = randomUUID().replace(/-/g, '');
    const payload: Omit<AdminJwtPayload, 'exp' | 'iat'> = {
      sub: String(user._id),
      sid,
      role: user.role,
      tenantId: user.tenantId,
      username: user.username,
    };
    const token = this.signJwt(payload, iat, exp);
    await this.sessions.insertOne({
      _id: new ObjectId(),
      sessionId: sid,
      userId: String(user._id),
      tenantId: user.tenantId,
      role: user.role,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(exp * 1000),
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
    const payload = this.verifyJwt(token);
    if (!payload) return null;
    const tokenHash = this.hashToken(token);
    const session = await this.sessions.findOne({ tokenHash });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    if (session.sessionId !== payload.sid) return null;
    if (session.userId !== payload.sub) return null;
    if ((session.tenantId ?? '') !== (payload.tenantId ?? '')) return null;
    const user = await this.users.findOne({
      _id: new ObjectId(payload.sub),
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
   * @description 获取当前用户信息（含租户名）
   * @keyword-en get current admin user with tenant name
   */
  async getMe(currentUser: AdminUserEntity): Promise<AdminUserPublic & { tenantName?: string }> {
    const base = this.toPublicUser(currentUser);
    if (currentUser.tenantId) {
      const tenant = await this.sassService.getTenant(currentUser.tenantId);
      return { ...base, tenantName: tenant?.name };
    }
    return base;
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
    void currentUser;
    return this.aiProviders
      .find({})
      .sort({ isDefault: -1, updatedAt: -1 })
      .toArray();
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
      modelCategory: 'llm' | 'em' | 'image';
      apiKey?: string;
      enabled?: boolean;
      isDefault?: boolean;
    },
  ): Promise<AdminAiProviderEntity> {
    this.assertSuperAdmin(currentUser);
    const now = new Date();
    const modelCategory: AdminAiProviderEntity['modelCategory'] =
      input.modelCategory === 'em' || input.modelCategory === 'image'
        ? input.modelCategory
        : 'llm';
    const filter: Record<string, unknown> = {
      providerCode: input.providerCode.trim(),
      modelCategory,
    };
    const doc = {
      providerCode: input.providerCode.trim(),
      name: input.name.trim(),
      baseUrl: input.baseUrl?.trim() || undefined,
      model: input.model?.trim() || undefined,
      modelCategory,
      apiKey:
        typeof input.apiKey === 'string' && input.apiKey.trim().length > 0
          ? input.apiKey.trim()
          : undefined,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? false,
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
    if (res.value.isDefault) {
      await this.aiProviders.updateMany(
        {
          _id: { $ne: res.value._id },
          modelCategory: res.value.modelCategory,
        },
        { $set: { isDefault: false, updatedAt: now } },
      );
    }
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
      modelCategory?: 'llm' | 'em' | 'image';
      apiKey?: string;
      enabled?: boolean;
      isDefault?: boolean;
    },
  ): Promise<AdminAiProviderEntity | null> {
    this.assertSuperAdmin(currentUser);
    const targetId = this.toObjectId(id, 'INVALID_AI_PROVIDER_ID');
    const target = await this.aiProviders.findOne({ _id: targetId });
    if (!target) return null;
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
    if (input.modelCategory === 'llm' || input.modelCategory === 'em' || input.modelCategory === 'image') {
      updates.modelCategory = input.modelCategory;
    }
    if (typeof input.apiKey === 'string') {
      updates.apiKey = input.apiKey.trim() || undefined;
    }
    if (typeof input.enabled === 'boolean') {
      updates.enabled = input.enabled;
    }
    if (typeof input.isDefault === 'boolean') {
      updates.isDefault = input.isDefault;
    }
    const res = await this.aiProviders.findOneAndUpdate(
      { _id: targetId },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (res.value?.isDefault) {
      await this.aiProviders.updateMany(
        {
          _id: { $ne: res.value._id },
          modelCategory: res.value.modelCategory,
        },
        { $set: { isDefault: false, updatedAt: new Date() } },
      );
    }
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
    this.assertSuperAdmin(currentUser);
    const targetId = this.toObjectId(id, 'INVALID_AI_PROVIDER_ID');
    const res = await this.aiProviders.deleteOne({ _id: targetId });
    return res.deletedCount === 1;
  }

  /**
   * @description 登录页可选租户列表
   * @keyword-en list login tenant options
   */
  async listLoginTenants(): Promise<SassTenantEntity[]> {
    return this.sassService.listTenant();
  }

  /**
   * @description 读取默认AI提供商
   * @keyword-en get default ai provider
   */
  async getDefaultAiProvider(
    modelCategory: 'llm' | 'em' | 'image' = 'llm',
  ): Promise<AdminAiProviderEntity | null> {
    const row = await this.aiProviders.findOne(
      { enabled: true, isDefault: true, modelCategory },
      { sort: { updatedAt: -1 } },
    );
    if (row) return row;
    return this.aiProviders.findOne(
      { enabled: true, modelCategory },
      { sort: { updatedAt: -1 } },
    );
  }

  /**
   * @description 读取默认提供商运行配置
   * @keyword-en get default ai provider runtime config
   */
  async getDefaultAiProviderRuntime(): Promise<{
    providerCode: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null> {
    const row = await this.getDefaultAiProvider('llm');
    if (!row) return null;
    return {
      providerCode: row.providerCode,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
    };
  }

  /**
   * @description 读取默认Embedding运行配置
   * @keyword-en get default embedding runtime config
   */
  async getDefaultEmbeddingRuntime(): Promise<{
    providerCode: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  } | null> {
    const row = await this.getDefaultAiProvider('em');
    if (!row) return null;
    const providerCode = row.providerCode;
    const model = row.model?.trim() || 'gemini-embedding-001';
    return {
      providerCode,
      model,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
    };
  }

  /**
   * @description 读取默认生图运行配置
   * @keyword-en get default image generation runtime config
   */
  async getDefaultImageProviderRuntime(): Promise<{
    providerCode: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null> {
    const row = await this.getDefaultAiProvider('image');
    if (!row) return null;
    return {
      providerCode: row.providerCode,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
    };
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
      sourceType?: 'mongo' | 'api';
      scope?: 'platform' | 'tenant';
      tenantId?: string;
      connection?: MongoConnectionConfig;
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
    if (input.sourceType === 'mongo' || input.sourceType === 'api') {
      updates.sourceType = input.sourceType;
    }
    if (input.scope === 'platform' || input.scope === 'tenant') {
      updates.scope = input.scope;
    }
    if (typeof input.tenantId === 'string') {
      updates.tenantId = input.tenantId.trim() || undefined;
    }
    if (typeof input.connection === 'object' && input.connection) {
      updates.connection = input.connection;
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
   * @description 签发JWT
   * @keyword-en sign jwt token
   */
  private signJwt(
    payload: Omit<AdminJwtPayload, 'iat' | 'exp'>,
    iat: number,
    exp: number,
  ): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const body: AdminJwtPayload = { ...payload, iat, exp };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      'base64url',
    );
    const encodedBody = Buffer.from(JSON.stringify(body)).toString('base64url');
    const unsigned = `${encodedHeader}.${encodedBody}`;
    const signature = createHmac('sha256', this.jwtSecret)
      .update(unsigned)
      .digest('base64url');
    return `${unsigned}.${signature}`;
  }

  /**
   * @description 校验JWT并解析载荷
   * @keyword-en verify jwt token
   */
  private verifyJwt(token: string): AdminJwtPayload | null {
    const segments = token.split('.');
    if (segments.length !== 3) return null;
    const [encodedHeader, encodedBody, signature] = segments;
    if (!encodedHeader || !encodedBody || !signature) return null;
    const unsigned = `${encodedHeader}.${encodedBody}`;
    const expected = createHmac('sha256', this.jwtSecret)
      .update(unsigned)
      .digest('base64url');
    if (signature.length !== expected.length) return null;
    if (
      !timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expected, 'utf8'),
      )
    ) {
      return null;
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encodedBody, 'base64url').toString('utf8'),
      ) as AdminJwtPayload;
      if (!payload || typeof payload !== 'object') return null;
      if (typeof payload.sub !== 'string' || !payload.sub.trim()) return null;
      if (typeof payload.sid !== 'string' || !payload.sid.trim()) return null;
      if (typeof payload.exp !== 'number' || payload.exp <= 0) return null;
      if (payload.exp * 1000 <= Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
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

  /**
   * @description 启动时迁移环境变量提供商元数据
   * @keyword-en migrate env providers to database
   */
  private async ensureProvidersFromEnv(): Promise<void> {
    const now = new Date();
    await this.aiProviders.updateMany(
      { modelCategory: { $exists: false }, emModel: { $exists: true } },
      { $set: { modelCategory: 'em', updatedAt: now } },
    );
    await this.aiProviders.updateMany(
      { modelCategory: { $exists: false } },
      { $set: { modelCategory: 'llm', updatedAt: now } },
    );
    await this.aiProviders.updateMany(
      {},
      { $unset: { emProviderCode: '', emModel: '' } },
    );
    const candidates = [
      {
        providerCode: 'nvidia',
        name: 'NVIDIA',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'deepseek-ai/deepseek-v3.1-terminus',
        modelCategory: 'llm' as const,
      },
      {
        providerCode: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        modelCategory: 'llm' as const,
      },
      {
        providerCode: 'gemini',
        name: 'Gemini',
        baseUrl: undefined,
        model: 'gemini-1.5-flash',
        modelCategory: 'llm' as const,
      },
      {
        providerCode: 'gemini',
        name: 'Gemini Embedding',
        baseUrl: undefined,
        model: 'gemini-embedding-001',
        modelCategory: 'em' as const,
      },
      {
        providerCode: 'openai',
        name: 'OpenAI Embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        modelCategory: 'em' as const,
      },
      {
        providerCode: 'deepseek',
        name: 'DeepSeek Embedding',
        baseUrl: 'https://api.deepseek.com',
        model: 'text-embedding-3-small',
        modelCategory: 'em' as const,
      },
      {
        providerCode: 'nvidia',
        name: 'NVIDIA Embedding',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'text-embedding-3-small',
        modelCategory: 'em' as const,
      },
      {
        providerCode: 'gemini',
        name: 'Gemini Image',
        baseUrl: undefined,
        model: 'gemini-2.0-flash-preview-image-generation',
        modelCategory: 'image' as const,
      },
      {
        providerCode: 'doubao',
        name: 'Doubao Image',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seedream-3.0-t2i-250415',
        modelCategory: 'image' as const,
      },
    ];
    for (const item of candidates) {
      await this.aiProviders.findOneAndUpdate(
        { providerCode: item.providerCode, modelCategory: item.modelCategory },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            providerCode: item.providerCode,
            name: item.name,
            baseUrl: item.baseUrl,
            model: item.model,
            modelCategory: item.modelCategory,
            enabled: true,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    const ensureDefaultForCategory = async (
      category: 'llm' | 'em' | 'image',
    ) => {
      const exists = await this.aiProviders.findOne({
        isDefault: true,
        modelCategory: category,
      });
      if (exists) return;
      const fallback = candidates.find(
        (item) => item.modelCategory === category,
      );
      if (!fallback) return;
      await this.aiProviders.updateOne(
        {
          providerCode: fallback.providerCode,
          modelCategory: fallback.modelCategory,
        },
        { $set: { isDefault: true, enabled: true, updatedAt: now } },
      );
    };
    await ensureDefaultForCategory('llm');
    await ensureDefaultForCategory('em');
    await ensureDefaultForCategory('image');
  }

  // ─── Claw Config CRUD ───────────────────────────────────────────────────────

  /**
   * @description 列出所有 Claw 接入配置
   * @keyword-en list claw configs
   */
  async listClawConfigs(): Promise<AdminClawConfigEntity[]> {
    return this.clawConfigs.find({}).sort({ createdAt: -1 }).toArray();
  }

  /**
   * @description 根据ID获取 Claw 配置
   * @keyword-en get claw config by id
   */
  async getClawConfigById(id: string): Promise<AdminClawConfigEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.clawConfigs.findOne({ _id: new ObjectId(id) });
  }

  /**
   * @description 创建 Claw 接入配置
   * @keyword-en create claw config
   */
  async createClawConfig(input: {
    name: string;
    description?: string;
    token: string;
    serviceUrl: string;
  }): Promise<AdminClawConfigEntity> {
    const now = new Date();
    const doc: AdminClawConfigEntity = {
      _id: new ObjectId(),
      name: input.name.trim(),
      description: input.description?.trim(),
      token: input.token.trim(),
      serviceUrl: input.serviceUrl.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await this.clawConfigs.insertOne(doc);
    return doc;
  }

  /**
   * @description 更新 Claw 接入配置
   * @keyword-en update claw config
   */
  async updateClawConfig(
    id: string,
    input: {
      name?: string;
      description?: string;
      token?: string;
      serviceUrl?: string;
    },
  ): Promise<AdminClawConfigEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim())
      updates.name = input.name.trim();
    if (typeof input.description === 'string')
      updates.description = input.description.trim() || undefined;
    if (typeof input.token === 'string' && input.token.trim())
      updates.token = input.token.trim();
    if (typeof input.serviceUrl === 'string' && input.serviceUrl.trim())
      updates.serviceUrl = input.serviceUrl.trim();
    const res = await this.clawConfigs.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除 Claw 接入配置
   * @keyword-en delete claw config
   */
  async deleteClawConfig(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await this.clawConfigs.deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  }

  /**
   * @description 测试 Claw 连通性，向服务地址发送 skill-new-ping 并更新连通状态
   * @keyword-en ping claw config, test connectivity, skill-new-ping
   */
  async pingClawConfig(id: string): Promise<{ status: ClawConnectStatus }> {
    if (!ObjectId.isValid(id))
      throw new BadRequestException('Invalid claw config id');
    const config = await this.getClawConfigById(id);
    if (!config) throw new BadRequestException('Claw config not found');

    let status: ClawConnectStatus = 'error';
    try {
      const baseUrl = config.serviceUrl.replace(/\/$/, '');
      const endpoint = `${baseUrl}/v1/chat/completions`;
      const reqBody = JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: JSON.stringify({ type: 'skill-new-ping' }) }],
      });
      console.log('[PingClaw] →', endpoint, reqBody);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`,
          'x-openclaw-agent-id': 'main',
          'x-openclaw-scopes': 'operator.read,operator.write',
        },
        body: reqBody,
        signal: AbortSignal.timeout(60000),
      });
      let body: unknown;
      let rawText = '';
      try {
        rawText = await response.text();
        body = JSON.parse(rawText);
      } catch {
        /* non-JSON response */
      }
      console.log('[PingClaw] ←', response.status, rawText.slice(0, 500));
      if (!response.ok) {
        status = 'error';
      } else {
        // 从 choices[0].message.content 中提取 skill-ping-res
        const content = (body as any)?.choices?.[0]?.message?.content ?? '';
        let replyJson: unknown;
        try {
          replyJson = JSON.parse(content);
        } catch {
          /* not JSON */
        }
        if (
          replyJson &&
          typeof replyJson === 'object' &&
          (replyJson as Record<string, unknown>)['type'] === 'skill-ping-res'
        ) {
          status = 'full';
        } else {
          status = 'api_only';
        }
      }
    } catch (err) {
      console.log('[PingClaw] error', err instanceof Error ? err.message : String(err));
      status = 'error';
    }

    await this.clawConfigs.updateOne(
      { _id: new ObjectId(id) },
      { $set: { connectStatus: status, connectCheckedAt: new Date(), updatedAt: new Date() } },
    );
    return { status };
  }

  // ─── Agent Config CRUD ───────────────────────────────────────────────────────

  /**
   * @description 列出所有 Agent 配置
   * @keyword-en list agent configs
   */
  async listAgentConfigs(): Promise<AdminAgentConfigEntity[]> {
    return this.agentConfigs.find({}).sort({ createdAt: -1 }).toArray();
  }

  /**
   * @description 根据ID获取 Agent 配置
   * @keyword-en get agent config by id
   */
  async getAgentConfigById(id: string): Promise<AdminAgentConfigEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.agentConfigs.findOne({ _id: new ObjectId(id) });
  }

  /**
   * @description 创建 Agent 配置
   * @keyword-en create agent config
   */
  async createAgentConfig(input: {
    name: string;
    module: string;
    clawConfigId?: string;
    clawAgentId?: string;
    prompt?: string;
    enabled?: boolean;
  }): Promise<AdminAgentConfigEntity> {
    const now = new Date();
    const doc: AdminAgentConfigEntity = {
      _id: new ObjectId(),
      name: input.name.trim(),
      module: input.module.trim(),
      clawConfigId: input.clawConfigId?.trim() || undefined,
      clawAgentId: input.clawAgentId?.trim() || undefined,
      prompt: input.prompt ?? undefined,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    await this.agentConfigs.insertOne(doc);
    return doc;
  }

  /**
   * @description 更新 Agent 配置
   * @keyword-en update agent config
   */
  async updateAgentConfig(
    id: string,
    input: {
      name?: string;
      module?: string;
      clawConfigId?: string;
      clawAgentId?: string;
      prompt?: string;
      enabled?: boolean;
    },
  ): Promise<AdminAgentConfigEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim())
      updates.name = input.name.trim();
    if (typeof input.module === 'string' && input.module.trim())
      updates.module = input.module.trim();
    if (typeof input.clawConfigId === 'string')
      updates.clawConfigId = input.clawConfigId.trim() || undefined;
    if (typeof input.clawAgentId === 'string')
      updates.clawAgentId = input.clawAgentId.trim() || undefined;
    if (typeof input.prompt === 'string')
      updates.prompt = input.prompt || undefined;
    if (typeof input.enabled === 'boolean') updates.enabled = input.enabled;
    const res = await this.agentConfigs.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除 Agent 配置
   * @keyword-en delete agent config
   */
  async deleteAgentConfig(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await this.agentConfigs.deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  }

  /**
   * @description 获取平台信息（AI补充说明）
   * @param {AdminUserEntity} adminUser - 管理员用户
   * @returns {Promise<object>} 平台信息
   * @keyword-en get platform info
   */
  async getPlatformInfo(adminUser: AdminUserEntity): Promise<object> {
    // 租户管理员只能访问自己的租户，平台管理员可以访问任何租户
    if (adminUser.role !== 'tenant_admin' && adminUser.role !== 'super_admin') {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }
    const tenantId =
      adminUser.role === 'tenant_admin'
        ? String(adminUser.tenantId ?? '').trim()
        : this.PLATFORM_INFO_SCOPE_TENANT_ID;
    if (!tenantId) throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    const info = await this.sassService.getPlatformInfo(tenantId);
    return { platformInfo: info };
  }

  /**
   * @description 更新平台信息（AI补充说明）
   * @param {AdminUserEntity} adminUser - 管理员用户
   * @param {string} aiPromptSupplement - AI补充说明
   * @param {boolean | undefined} enableAiCover - 是否开启 AI 封面
   * @returns {Promise<object>} 更新后的平台信息
   * @keyword-en upsert platform info
   */
  async upsertPlatformInfo(
    adminUser: AdminUserEntity,
    aiPromptSupplement: string,
    enableAiCover?: boolean,
  ): Promise<object> {
    // 租户管理员只能管理自己的租户，平台管理员可以管理任何租户
    if (adminUser.role !== 'tenant_admin' && adminUser.role !== 'super_admin') {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }
    const tenantId =
      adminUser.role === 'tenant_admin'
        ? String(adminUser.tenantId ?? '').trim()
        : this.PLATFORM_INFO_SCOPE_TENANT_ID;
    if (!tenantId) throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    const info = await this.sassService.upsertPlatformInfo(
      tenantId,
      aiPromptSupplement,
      enableAiCover,
    );
    return { platformInfo: info };
  }

  // ─── LLM Settings CRUD ───────────────────────────────────────────────────────

  /**
   * @description 获取 LLM 设置（单条，全局）
   * @keyword-en get llm settings
   */
  async getLlmSetting(): Promise<AdminLlmSettingEntity | null> {
    const row = await this.llmSettings.findOne({});
    if (row) return row;
    // 返回默认值
    return {
      _id: new ObjectId(),
      imageCount: 6,
      coverUseLlm: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * @description 创建或更新 LLM 设置
   * @keyword-en upsert llm setting
   */
  async upsertLlmSetting(
    currentUser: AdminUserEntity,
    input: {
      imageCount?: number;
      coverUseLlm?: boolean;
    },
  ): Promise<AdminLlmSettingEntity> {
    this.assertSuperAdmin(currentUser);
    const now = new Date();
    const doc = {
      imageCount: input.imageCount ?? 6,
      coverUseLlm: input.coverUseLlm ?? false,
      updatedAt: now,
    };
    const res = await this.llmSettings.findOneAndUpdate(
      {},
      { $set: doc, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) throw new BadRequestException('LLM_SETTING_SAVE_FAILED');
    return res.value;
  }

  /**
   * @description 更新 LLM 设置
   * @keyword-en update llm setting
   */
  async updateLlmSetting(
    currentUser: AdminUserEntity,
    input: {
      imageCount?: number;
      coverUseLlm?: boolean;
    },
  ): Promise<AdminLlmSettingEntity | null> {
    this.assertSuperAdmin(currentUser);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.imageCount === 'number') {
      updates.imageCount = input.imageCount;
    }
    if (typeof input.coverUseLlm === 'boolean') {
      updates.coverUseLlm = input.coverUseLlm;
    }
    const res = await this.llmSettings.findOneAndUpdate(
      {},
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }
}
