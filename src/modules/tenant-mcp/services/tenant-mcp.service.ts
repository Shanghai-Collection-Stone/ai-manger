import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type {
  TenantMcpEndpoint,
  TenantMcpKey,
  TenantMcpPrincipal,
} from '../entities/tenant-mcp.entity.js';
import { TENANT_MCP_TOOLS } from '../tenant-mcp.tools.js';

/** @keyword-en tenant-mcp, key-management */
@Injectable()
export class TenantMcpService implements OnModuleInit {
  private readonly endpoints: Collection<TenantMcpEndpoint>;
  private readonly keys: Collection<TenantMcpKey>;

  /** @keyword-en tenant-mcp, key-management */
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.endpoints = db.collection('tenant_mcp_endpoints');
    this.keys = db.collection('tenant_mcp_keys');
  }

  /** @keyword-en mcp-indexes, tenant-isolation */
  async onModuleInit(): Promise<void> {
    await this.endpoints.createIndex({ tenantId: 1, createdAt: -1 });
    await this.keys.createIndex({ secretHash: 1 }, { unique: true });
    await this.keys.createIndex({ tenantId: 1, endpointId: 1, createdAt: -1 });
  }

  /** @keyword-en mcp-scope, tenant-isolation */
  scope(user: AdminUserEntity, requested?: string): string {
    if (!['super_admin', 'tenant_admin'].includes(user.role))
      throw new ForbiddenException('MCP_ADMIN_REQUIRED');
    if (requested && user.role !== 'super_admin' && requested !== user.tenantId)
      throw new ForbiddenException('MCP_TENANT_MISMATCH');
    const tenantId =
      user.role === 'super_admin' ? requested || user.tenantId : user.tenantId;
    if (!tenantId || !ObjectId.isValid(tenantId))
      throw new BadRequestException('MCP_TENANT_REQUIRED');
    return tenantId;
  }

  /** @keyword-en mcp-id, input-validation */
  private objectId(value: string): ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value))
      throw new BadRequestException('INVALID_MCP_ID');
    return new ObjectId(value);
  }

  /** @keyword-en mcp-endpoint, tenant-isolation */
  async requireEndpoint(
    tenantId: string,
    endpointId: string,
  ): Promise<TenantMcpEndpoint> {
    const endpoint = await this.endpoints.findOne({
      _id: this.objectId(endpointId),
      tenantId,
    });
    if (!endpoint) throw new NotFoundException('MCP_ENDPOINT_NOT_FOUND');
    return endpoint;
  }

  /** @keyword-en mcp-endpoint-view, secret-redaction */
  private endpointView(endpoint: TenantMcpEndpoint) {
    const path = `/api/mcp/${endpoint._id.toHexString()}`;
    const base = String(this.config.get<string>('APP_URL') || '').replace(
      /\/+$/,
      '',
    );
    return {
      id: endpoint._id.toHexString(),
      name: endpoint.name,
      enabled: endpoint.enabled,
      path,
      url: `${base}${path}`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  /** @keyword-en mcp-key-view, secret-redaction */
  private keyView(key: TenantMcpKey) {
    return {
      id: key._id.toHexString(),
      endpointId: key.endpointId,
      name: key.name,
      prefix: key.prefix,
      permissions: key.permissions,
      enabled: key.enabled,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    };
  }

  /** @keyword-en mcp-list, key-management */
  async list(tenantId: string) {
    const [endpoints, keys] = await Promise.all([
      this.endpoints.find({ tenantId }).sort({ createdAt: -1 }).toArray(),
      this.keys.find({ tenantId }).sort({ createdAt: -1 }).toArray(),
    ]);
    return {
      endpoints: endpoints.map((item) => ({
        ...this.endpointView(item),
        keys: keys
          .filter((key) => key.endpointId === item._id.toHexString())
          .map((key) => this.keyView(key)),
      })),
      tools: Object.entries(TENANT_MCP_TOOLS).map(([name, tool]) => ({
        name,
        title: tool.title,
        description: tool.description,
      })),
    };
  }

  /** @keyword-en mcp-create-endpoint, key-management */
  async createEndpoint(
    tenantId: string,
    user: AdminUserEntity,
    input: { name: string },
  ) {
    if (
      !(await this.db
        .collection('sass_tenants')
        .findOne({ _id: this.objectId(tenantId) }, { projection: { _id: 1 } }))
    )
      throw new NotFoundException('MCP_TENANT_NOT_FOUND');
    const now = new Date();
    const endpoint: TenantMcpEndpoint = {
      _id: new ObjectId(),
      tenantId,
      name: input.name,
      enabled: true,
      createdBy: user._id.toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.endpoints.insertOne(endpoint);
    return this.endpointView(endpoint);
  }

  /** @keyword-en mcp-update-endpoint, key-management */
  async updateEndpoint(
    tenantId: string,
    endpointId: string,
    input: { name?: string; enabled?: boolean },
  ) {
    await this.requireEndpoint(tenantId, endpointId);
    const changes: Partial<TenantMcpEndpoint> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim())
        throw new BadRequestException('INVALID_MCP_NAME');
      changes.name = input.name.trim();
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean')
        throw new BadRequestException('INVALID_MCP_ENABLED');
      changes.enabled = input.enabled;
    }
    await this.endpoints.updateOne(
      { _id: this.objectId(endpointId), tenantId },
      { $set: changes },
    );
    return this.endpointView(await this.requireEndpoint(tenantId, endpointId));
  }

  /** @keyword-en mcp-delete-endpoint, key-revocation */
  async deleteEndpoint(tenantId: string, endpointId: string) {
    await this.requireEndpoint(tenantId, endpointId);
    await this.endpoints.deleteOne({
      _id: this.objectId(endpointId),
      tenantId,
    });
    await this.keys.deleteMany({ tenantId, endpointId });
    return { ok: true };
  }

  /** @keyword-en mcp-permissions, input-validation */
  private validatePermissions(permissions: string[]): string[] {
    if (
      !Array.isArray(permissions) ||
      permissions.some((name) => !Object.hasOwn(TENANT_MCP_TOOLS, name))
    )
      throw new BadRequestException('INVALID_MCP_PERMISSIONS');
    return [...new Set(permissions)];
  }

  /** @keyword-en mcp-expiry, input-validation */
  private expiry(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      throw new BadRequestException('MCP_EXPIRY_MUST_BE_FUTURE');
    return date;
  }

  /** @keyword-en mcp-create-key, one-time-secret */
  async createKey(
    tenantId: string,
    endpointId: string,
    user: AdminUserEntity,
    input: { name: string; permissions: string[]; expiresAt?: string | null },
  ) {
    await this.requireEndpoint(tenantId, endpointId);
    const permissions = this.validatePermissions(input.permissions);
    const expiresAt = this.expiry(input.expiresAt);
    const secret = `tmcp_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const key: TenantMcpKey = {
      _id: new ObjectId(),
      tenantId,
      endpointId,
      name: input.name,
      secretHash: createHash('sha256').update(secret).digest('hex'),
      prefix: secret.slice(0, 13),
      permissions,
      enabled: true,
      expiresAt,
      createdBy: user._id.toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.keys.insertOne(key);
    return { key: this.keyView(key), secret };
  }

  /** @keyword-en mcp-update-key, tool-permission */
  async updateKey(
    tenantId: string,
    endpointId: string,
    keyId: string,
    input: {
      name?: string;
      permissions?: string[];
      enabled?: boolean;
      expiresAt?: string | null;
    },
  ) {
    await this.requireEndpoint(tenantId, endpointId);
    const changes: Partial<TenantMcpKey> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim())
        throw new BadRequestException('INVALID_MCP_NAME');
      changes.name = input.name.trim();
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean')
        throw new BadRequestException('INVALID_MCP_ENABLED');
      changes.enabled = input.enabled;
    }
    if (input.permissions !== undefined)
      changes.permissions = this.validatePermissions(input.permissions);
    if (input.expiresAt !== undefined)
      changes.expiresAt = this.expiry(input.expiresAt);
    const key = await this.keys.findOneAndUpdate(
      { _id: this.objectId(keyId), tenantId, endpointId },
      { $set: changes },
      { returnDocument: 'after' },
    );
    if (!key) throw new NotFoundException('MCP_KEY_NOT_FOUND');
    return this.keyView(key);
  }

  /** @keyword-en mcp-delete-key, key-revocation */
  async deleteKey(tenantId: string, endpointId: string, keyId: string) {
    await this.requireEndpoint(tenantId, endpointId);
    const result = await this.keys.deleteOne({
      _id: this.objectId(keyId),
      tenantId,
      endpointId,
    });
    if (!result.deletedCount) throw new NotFoundException('MCP_KEY_NOT_FOUND');
    return { ok: true };
  }

  /** @keyword-en mcp-auth, tenant-isolation */
  async authenticate(
    endpointId: string,
    authorization?: string,
  ): Promise<TenantMcpPrincipal> {
    const secret = /^Bearer (tmcp_[A-Za-z0-9_-]{43})$/.exec(
      authorization || '',
    )?.[1];
    if (!secret || !/^[a-f\d]{24}$/i.test(endpointId))
      throw new UnauthorizedException('INVALID_MCP_CREDENTIALS');
    const key = await this.keys.findOne({
      endpointId,
      secretHash: createHash('sha256').update(secret).digest('hex'),
      enabled: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });
    if (!key) throw new UnauthorizedException('INVALID_MCP_CREDENTIALS');
    const endpoint = await this.endpoints.findOne({
      _id: new ObjectId(endpointId),
      tenantId: key.tenantId,
      enabled: true,
    });
    const owner = await this.db
      .collection<AdminUserEntity>('admin_users')
      .findOne({
        _id: new ObjectId(key.createdBy),
        enabled: true,
        deletedAt: { $exists: false },
      });
    const tenant = await this.db
      .collection('sass_tenants')
      .findOne(
        { _id: this.objectId(key.tenantId) },
        { projection: { _id: 1 } },
      );
    if (
      !endpoint ||
      !tenant ||
      !owner ||
      !['super_admin', 'tenant_admin'].includes(owner.role) ||
      (owner.role !== 'super_admin' && owner.tenantId !== key.tenantId)
    )
      throw new UnauthorizedException('INVALID_MCP_CREDENTIALS');
    await this.keys.updateOne(
      { _id: key._id },
      { $set: { lastUsedAt: new Date() } },
    );
    return {
      tenantId: key.tenantId,
      endpointId,
      keyId: key._id.toHexString(),
      permissions: key.permissions,
      userId: owner._id.toHexString(),
      username: owner.username,
    };
  }
}
