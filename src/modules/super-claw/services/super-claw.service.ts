import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import { Inject } from '@nestjs/common';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import type { WorkspaceEntity } from '../../workspace/entities/workspace.entity.js';
import type {
  SuperClawEntity,
  SuperClawHeartbeatRequest,
  SuperClawHeartbeatResponse,
  SuperClawRegisterRequest,
  SuperClawRegisterResponse,
  SuperClawView,
} from '../entities/super-claw.entity.js';

/**
 * @description SuperClaw 心跳建议间隔（秒）
 * @keyword-cn 心跳间隔, 在线判定
 * @keyword-en heartbeat-interval, online-detection
 */
export const SUPER_CLAW_HEARTBEAT_INTERVAL_SECONDS = 30;

/**
 * @description SuperClaw 节点、令牌、注册连接和工作区槽位容量服务
 * @keyword-cn 节点服务, 工作区容量
 * @keyword-en node-service, workspace-capacity
 */
@Injectable()
export class SuperClawService implements OnModuleInit {
  private readonly superClaws: Collection<SuperClawEntity>;
  private readonly tenants: Collection<SassTenantEntity>;
  private readonly workspaces: Collection<WorkspaceEntity>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.superClaws = db.collection<SuperClawEntity>('super_claws');
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
    this.workspaces = db.collection<WorkspaceEntity>('workspaces');
  }

  /**
   * @description 初始化节点索引并按工作区记录校准已占用槽位
   * @keyword-cn 初始化索引, 容量校准
   * @keyword-en initialize-indexes, capacity-reconciliation
   */
  async onModuleInit(): Promise<void> {
    await this.ensureIndexes();
    await this.reconcileAllocatedCapacity();
  }

  /**
   * @description 建立节点名称和 Token 哈希唯一索引
   * @keyword-cn 节点索引, 令牌唯一
   * @keyword-en node-indexes, unique-token
   */
  async ensureIndexes(): Promise<void> {
    await this.superClaws.createIndex({ name: 1 }, { unique: true });
    await this.superClaws.createIndex({ tokenHash: 1 }, { unique: true });
    await this.superClaws.createIndex({ lastHeartbeatAt: 1 });
    await this.tenants.createIndex({ superClawId: 1 });
    await this.workspaces.createIndex({ superClawId: 1 });
  }

  /**
   * @description 列出平台全部 SuperClaw 节点并计算在线状态和剩余容量
   * @keyword-cn 节点列表, 剩余容量
   * @keyword-en list-nodes, remaining-capacity
   */
  async list(): Promise<SuperClawView[]> {
    const rows = await this.superClaws
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 创建节点并返回只展示一次的明文 Token
   * @keyword-cn 创建节点, 一次性令牌
   * @keyword-en create-node, one-time-token
   */
  async create(input: {
    name: string;
    description?: string;
    capacity: number;
  }): Promise<{ superClaw: SuperClawView; token: string }> {
    const token = this.generateToken();
    const now = new Date();
    const row: SuperClawEntity = {
      _id: new ObjectId(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      tokenHash: this.hashToken(token),
      tokenPrefix: token.slice(0, 12),
      capacity: input.capacity,
      allocatedCapacity: 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.superClaws.insertOne(row);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new BadRequestException('SUPER_CLAW_NAME_EXISTS');
      }
      throw error;
    }
    return { superClaw: this.toView(row), token };
  }

  /**
   * @description 更新节点基础信息和总容量，禁止缩容到已分配容量以下
   * @keyword-cn 更新节点, 缩容保护
   * @keyword-en update-node, capacity-shrink-guard
   */
  async update(
    id: string,
    input: { name?: string; description?: string; capacity?: number },
  ): Promise<SuperClawView> {
    const objectId = this.toObjectId(id, 'INVALID_SUPER_CLAW_ID');
    const current = await this.superClaws.findOne({ _id: objectId });
    if (!current) throw new NotFoundException('SUPER_CLAW_NOT_FOUND');
    if (
      typeof input.capacity === 'number' &&
      input.capacity < current.allocatedCapacity
    ) {
      throw new BadRequestException('SUPER_CLAW_CAPACITY_BELOW_ALLOCATED');
    }
    const updates: Partial<SuperClawEntity> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      updates.name = input.name.trim();
    }
    if (typeof input.description === 'string') {
      updates.description = input.description.trim() || undefined;
    }
    if (typeof input.capacity === 'number') updates.capacity = input.capacity;
    try {
      const filter: Record<string, unknown> = { _id: objectId };
      if (typeof input.capacity === 'number') {
        filter.$expr = { $lte: ['$allocatedCapacity', input.capacity] };
      }
      const row = await this.superClaws.findOneAndUpdate(
        filter,
        { $set: updates },
        { returnDocument: 'after' },
      );
      if (!row && typeof input.capacity === 'number') {
        throw new BadRequestException('SUPER_CLAW_CAPACITY_BELOW_ALLOCATED');
      }
      if (!row) throw new NotFoundException('SUPER_CLAW_NOT_FOUND');
      return this.toView(row);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new BadRequestException('SUPER_CLAW_NAME_EXISTS');
      }
      throw error;
    }
  }

  /**
   * @description 删除没有租户归属且没有工作区占用的节点
   * @keyword-cn 删除节点, 占用保护
   * @keyword-en delete-node, allocation-guard
   */
  async remove(id: string): Promise<boolean> {
    const objectId = this.toObjectId(id, 'INVALID_SUPER_CLAW_ID');
    const assignedTenant = await this.tenants.findOne({ superClawId: id });
    if (assignedTenant) {
      throw new BadRequestException('SUPER_CLAW_HAS_TENANT_ALLOCATIONS');
    }
    const result = await this.superClaws.deleteOne({
      _id: objectId,
      allocatedCapacity: 0,
    });
    if (result.deletedCount === 1) return true;
    const exists = await this.superClaws.findOne({ _id: objectId });
    if (!exists) throw new NotFoundException('SUPER_CLAW_NOT_FOUND');
    throw new BadRequestException('SUPER_CLAW_HAS_TENANT_ALLOCATIONS');
  }

  /**
   * @description 轮换节点 Token 并返回新的单次明文 Token
   * @keyword-cn 轮换令牌, 密钥失效
   * @keyword-en rotate-token, secret-revocation
   */
  async rotateToken(
    id: string,
  ): Promise<{ superClaw: SuperClawView; token: string }> {
    const objectId = this.toObjectId(id, 'INVALID_SUPER_CLAW_ID');
    const token = this.generateToken();
    const row = await this.superClaws.findOneAndUpdate(
      { _id: objectId },
      {
        $set: {
          tokenHash: this.hashToken(token),
          tokenPrefix: token.slice(0, 12),
          status: 'pending',
          updatedAt: new Date(),
        },
        $unset: { lastHeartbeatAt: '', lastRegisteredAt: '' },
      },
      { returnDocument: 'after' },
    );
    if (!row) throw new NotFoundException('SUPER_CLAW_NOT_FOUND');
    return { superClaw: this.toView(row), token };
  }

  /**
   * @description 调整租户所属节点并整体迁移其工作区，按工作区数量原子预留目标槽位
   * @keyword-cn 分配租户节点, 迁移工作区
   * @keyword-en assign-tenant-node, migrate-workspaces
   */
  async assignTenant(
    tenantId: string,
    superClawId?: string | null,
  ): Promise<SassTenantEntity> {
    const tenantObjectId = this.toObjectId(tenantId, 'INVALID_TENANT_ID');
    const tenant = await this.tenants.findOne({ _id: tenantObjectId });
    if (!tenant) throw new NotFoundException('TENANT_NOT_FOUND');

    const nextId = superClawId?.trim() || undefined;
    const workspaceCount = await this.workspaces.countDocuments({ tenantId });
    if (!nextId) {
      return tenant.superClawId
        ? this.unassignTenant(tenant, workspaceCount)
        : tenant;
    }

    const nextObjectId = this.toObjectId(nextId, 'INVALID_SUPER_CLAW_ID');
    const currentId = tenant.superClawId;
    const alreadyOnTarget = await this.workspaces.countDocuments({
      tenantId,
      superClawId: nextId,
    });
    const delta =
      currentId === nextId ? workspaceCount - alreadyOnTarget : workspaceCount;
    const reserved = await this.reserveCapacity(nextObjectId, delta);
    if (!reserved) {
      throw new BadRequestException('SUPER_CLAW_CAPACITY_EXCEEDED');
    }

    try {
      const allocationFilter: Record<string, unknown> = {
        _id: tenantObjectId,
        superClawId: currentId || { $exists: false },
      };
      const updated = await this.tenants.findOneAndUpdate(
        allocationFilter,
        { $set: { superClawId: nextId, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new BadRequestException('SUPER_CLAW_TENANT_ALLOCATION_CONFLICT');
      }
      await this.workspaces.updateMany(
        { tenantId },
        { $set: { superClawId: nextId, updatedAt: new Date() } },
      );
      if (currentId && currentId !== nextId) {
        const previousWorkspaceCount = workspaceCount - alreadyOnTarget;
        await this.releaseCapacity(currentId, previousWorkspaceCount);
      }
      return updated;
    } catch (error) {
      await this.releaseCapacity(nextId, delta);
      throw error;
    }
  }

  /**
   * @description 创建工作区前按租户归属节点原子占用一个工作区槽位
   * @keyword-cn 占用工作区槽位, 租户节点归属
   * @keyword-en reserve-workspace-slot, tenant-node-assignment
   */
  async reserveWorkspaceForTenant(tenantId: string): Promise<string> {
    const tenantObjectId = this.toObjectId(tenantId, 'INVALID_TENANT_ID');
    const tenant = await this.tenants.findOne({ _id: tenantObjectId });
    if (!tenant) throw new NotFoundException('TENANT_NOT_FOUND');
    if (!tenant.superClawId) {
      throw new BadRequestException('TENANT_SUPER_CLAW_REQUIRED');
    }
    const reserved = await this.reserveCapacity(
      this.toObjectId(tenant.superClawId, 'INVALID_SUPER_CLAW_ID'),
      1,
    );
    if (!reserved) {
      throw new BadRequestException('SUPER_CLAW_CAPACITY_EXCEEDED');
    }
    return tenant.superClawId;
  }

  /**
   * @description 删除工作区或创建失败时释放一个 SuperClaw 工作区槽位
   * @keyword-cn 释放工作区槽位, 容量归还
   * @keyword-en release-workspace-slot, capacity-return
   */
  async releaseWorkspace(superClawId: string): Promise<void> {
    await this.releaseCapacity(superClawId, 1);
  }

  /**
   * @description 校验 gRPC Token 并返回对应节点 ID
   * @keyword-cn 校验令牌, 节点身份
   * @keyword-en authenticate-token, node-identity
   */
  async authenticateToken(token: string): Promise<string | null> {
    const normalized = token.trim();
    if (!normalized) return null;
    const hash = this.hashToken(normalized);
    const row = await this.superClaws.findOne({ tokenHash: hash });
    if (!row) return null;
    const expected = Buffer.from(row.tokenHash, 'hex');
    const actual = Buffer.from(hash, 'hex');
    return expected.length === actual.length &&
      timingSafeEqual(expected, actual)
      ? String(row._id)
      : null;
  }

  /**
   * @description 注册 SuperClaw 实例并把连接状态更新为在线
   * @keyword-cn 注册实例, 建立连接
   * @keyword-en register-instance, establish-connection
   */
  async register(
    superClawId: string,
    request: SuperClawRegisterRequest,
  ): Promise<SuperClawRegisterResponse> {
    const instanceId = request.instanceId?.trim();
    if (!instanceId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'INSTANCE_ID_REQUIRED',
      });
    }
    const now = new Date();
    const row = await this.superClaws.findOneAndUpdate(
      { _id: this.toObjectId(superClawId, 'INVALID_SUPER_CLAW_ID') },
      {
        $set: {
          instanceId,
          endpoint: request.endpoint?.trim() || undefined,
          version: request.version?.trim() || undefined,
          status: 'online',
          lastRegisteredAt: now,
          lastHeartbeatAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (!row) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    return {
      superClawId: String(row._id),
      registered: true,
      capacity: row.capacity,
      allocatedCapacity: row.allocatedCapacity,
      heartbeatIntervalSeconds: SUPER_CLAW_HEARTBEAT_INTERVAL_SECONDS,
      serverTime: now.toISOString(),
    };
  }

  /**
   * @description 接收已注册节点心跳并续期在线状态
   * @keyword-cn 接收心跳, 连接续期
   * @keyword-en receive-heartbeat, renew-connection
   */
  async heartbeat(
    superClawId: string,
    request: SuperClawHeartbeatRequest,
  ): Promise<SuperClawHeartbeatResponse> {
    const now = new Date();
    const updates: Partial<SuperClawEntity> = {
      status: 'online',
      lastHeartbeatAt: now,
      updatedAt: now,
    };
    if (request.instanceId?.trim())
      updates.instanceId = request.instanceId.trim();
    if (Number.isInteger(request.usedCapacity) && request.usedCapacity! >= 0) {
      updates.reportedUsedCapacity = request.usedCapacity;
    }
    const row = await this.superClaws.findOneAndUpdate(
      { _id: this.toObjectId(superClawId, 'INVALID_SUPER_CLAW_ID') },
      { $set: updates },
      { returnDocument: 'after' },
    );
    if (!row) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    return {
      accepted: true,
      capacity: row.capacity,
      allocatedCapacity: row.allocatedCapacity,
      serverTime: now.toISOString(),
    };
  }

  /**
   * @description 仅允许没有工作区的租户解除 SuperClaw 节点归属
   * @keyword-cn 解除租户节点, 工作区保护
   * @keyword-en unassign-tenant-node, workspace-guard
   */
  private async unassignTenant(
    tenant: SassTenantEntity,
    workspaceCount: number,
  ): Promise<SassTenantEntity> {
    if (workspaceCount > 0) {
      throw new BadRequestException('TENANT_HAS_WORKSPACES');
    }
    const allocationFilter: Record<string, unknown> = {
      _id: tenant._id,
      superClawId: tenant.superClawId,
    };
    const updated = await this.tenants.findOneAndUpdate(
      allocationFilter,
      {
        $unset: { superClawId: '' },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throw new BadRequestException('SUPER_CLAW_TENANT_ALLOCATION_CONFLICT');
    }
    return updated;
  }

  /**
   * @description 使用 Mongo 条件更新原子预留节点容量
   * @keyword-cn 原子预留, 容量上限
   * @keyword-en atomic-reservation, capacity-limit
   */
  private async reserveCapacity(id: ObjectId, delta: number): Promise<boolean> {
    if (delta === 0) return Boolean(await this.superClaws.findOne({ _id: id }));
    const row = await this.superClaws.findOneAndUpdate(
      {
        _id: id,
        $expr: {
          $and: [
            { $gte: [{ $add: ['$allocatedCapacity', delta] }, 0] },
            {
              $lte: [{ $add: ['$allocatedCapacity', delta] }, '$capacity'],
            },
          ],
        },
      },
      { $inc: { allocatedCapacity: delta }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return Boolean(row);
  }

  /**
   * @description 将容量归还给指定节点
   * @keyword-cn 归还容量, 配额回滚
   * @keyword-en release-capacity, quota-rollback
   */
  private async releaseCapacity(id: string, capacity: number): Promise<void> {
    if (!ObjectId.isValid(id) || capacity === 0) return;
    await this.superClaws.updateOne(
      { _id: new ObjectId(id) },
      {
        $inc: { allocatedCapacity: -capacity },
        $set: { updatedAt: new Date() },
      },
    );
  }

  /**
   * @description 先将租户节点归属同步到工作区，再按工作区数量校准节点已用槽位
   * @keyword-cn 容量校准, 工作区汇总
   * @keyword-en capacity-reconciliation, workspace-aggregation
   */
  private async reconcileAllocatedCapacity(): Promise<void> {
    await this.tenants.updateMany({}, { $unset: { superClawCapacity: '' } });
    const assignedTenants = await this.tenants
      .find({ superClawId: { $type: 'string' } })
      .toArray();
    for (const tenant of assignedTenants) {
      await this.workspaces.updateMany(
        { tenantId: String(tenant._id) },
        { $set: { superClawId: tenant.superClawId! } },
      );
    }
    await this.superClaws.updateMany({}, { $set: { allocatedCapacity: 0 } });
    const allocations = await this.workspaces
      .aggregate<{ _id: string; capacity: number }>([
        {
          $match: {
            superClawId: { $type: 'string' },
          },
        },
        { $group: { _id: '$superClawId', capacity: { $sum: 1 } } },
      ])
      .toArray();
    for (const allocation of allocations) {
      if (!ObjectId.isValid(allocation._id)) continue;
      await this.superClaws.updateOne(
        { _id: new ObjectId(allocation._id) },
        { $set: { allocatedCapacity: allocation.capacity } },
      );
    }
  }

  /**
   * @description 将节点实体转换为安全后台视图并按心跳时间计算离线状态
   * @keyword-cn 安全视图, 离线判定
   * @keyword-en safe-view, offline-detection
   */
  private toView(row: SuperClawEntity): SuperClawView {
    const { tokenHash: _tokenHash, ...safe } = row;
    const offlineAfterMs = SUPER_CLAW_HEARTBEAT_INTERVAL_SECONDS * 3 * 1000;
    const status =
      row.status === 'online' &&
      row.lastHeartbeatAt &&
      Date.now() - row.lastHeartbeatAt.getTime() <= offlineAfterMs
        ? 'online'
        : row.lastRegisteredAt
          ? 'offline'
          : 'pending';
    return {
      ...safe,
      status,
      remainingCapacity: Math.max(0, row.capacity - row.allocatedCapacity),
    };
  }

  /**
   * @description 生成带固定前缀的高熵 SuperClaw Token
   * @keyword-cn 生成令牌, 随机密钥
   * @keyword-en generate-token, random-secret
   */
  private generateToken(): string {
    return `sc_${randomBytes(32).toString('base64url')}`;
  }

  /**
   * @description 对 Token 做 SHA-256 哈希后再持久化或检索
   * @keyword-cn 令牌哈希, 安全存储
   * @keyword-en hash-token, secure-storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * @description 校验并转换 Mongo ObjectId
   * @keyword-cn 对象标识校验, 参数错误
   * @keyword-en object-id-validation, invalid-parameter
   */
  private toObjectId(value: string, errorCode: string): ObjectId {
    if (!ObjectId.isValid(value)) throw new BadRequestException(errorCode);
    return new ObjectId(value);
  }
}
