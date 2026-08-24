import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { AuditLogService } from '../../audit-log/services/audit-log.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type {
  WorkspaceEntity,
  WorkspaceMemberEntity,
  WorkspaceMemberRole,
} from '../entities/workspace.entity.js';
import { WORKSPACE_AUDIT_ACTIONS } from '../constants/workspace-audit.constants.js';
import { SuperClawService } from '../../super-claw/services/super-claw.service.js';

/**
 * @description 创建工作区入参
 * @keyword-en create workspace input
 * @keyword-cn 创建工作区入参
 */
export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  capacityBytes?: number;
  tenantId?: string;
}

/**
 * @description 更新工作区入参
 * @keyword-en update workspace input
 * @keyword-cn 更新工作区入参
 */
export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  capacityBytes?: number;
}

/**
 * @description 工作区服务，负责 SuperClaw 子工作区 CRUD、成员管理、网盘容量记账与审计
 * @keyword-en workspace service
 * @keyword-cn 工作区服务
 */
@Injectable()
export class WorkspaceService {
  private readonly workspaces: Collection<WorkspaceEntity>;
  private readonly members: Collection<WorkspaceMemberEntity>;
  private readonly adminUsers: Collection<AdminUserEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly auditLogService: AuditLogService,
    private readonly superClawService: SuperClawService,
  ) {
    this.workspaces = db.collection<WorkspaceEntity>('workspaces');
    this.members = db.collection<WorkspaceMemberEntity>('workspace_members');
    this.adminUsers = db.collection<AdminUserEntity>('admin_users');
    void this.ensureIndexes();
  }

  /**
   * @description 初始化工作区与成员索引
   * @keyword-en ensure workspace indexes
   * @keyword-cn 初始化工作区索引
   */
  async ensureIndexes(): Promise<void> {
    await this.workspaces.createIndex(
      { tenantId: 1, name: 1 },
      { unique: true },
    );
    await this.workspaces.createIndex({ tenantId: 1, updatedAt: -1 });
    await this.workspaces.createIndex({ superClawId: 1 });
    await this.members.createIndex(
      { workspaceId: 1, userId: 1 },
      { unique: true },
    );
    await this.members.createIndex({ tenantId: 1 });
  }

  /**
   * @description 工作区列表(租户隔离；平台超管可跨租户)
   * @keyword-en list workspaces
   * @keyword-cn 工作区列表
   */
  async list(currentUser: AdminUserEntity): Promise<WorkspaceEntity[]> {
    const filter: Record<string, unknown> = {};
    if (currentUser.tenantId) filter.tenantId = currentUser.tenantId;
    return this.workspaces.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 获取单个工作区(校验租户边界)
   * @keyword-en get workspace by id
   * @keyword-cn 获取工作区
   */
  async get(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<WorkspaceEntity> {
    const ws = await this.workspaces.findOne({ _id: this.toId(id) });
    if (!ws) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    this.assertTenant(currentUser, ws.tenantId);
    return ws;
  }

  /**
   * @description 在租户所属 SuperClaw 下创建工作区并占用一个节点槽位
   * @keyword-en create-workspace, reserve-super-claw-slot
   * @keyword-cn 创建工作区, 占用节点槽位
   */
  async create(
    currentUser: AdminUserEntity,
    input: CreateWorkspaceInput,
  ): Promise<WorkspaceEntity> {
    const tenantId = this.resolveTenant(currentUser, input.tenantId);
    const capacityBytes = this.normalizeCapacity(input.capacityBytes);
    const superClawId =
      await this.superClawService.reserveWorkspaceForTenant(tenantId);
    const now = new Date();
    const doc: WorkspaceEntity = {
      _id: new ObjectId(),
      tenantId,
      superClawId,
      name: input.name.trim(),
      description: input.description?.trim(),
      capacityBytes,
      usedBytes: 0,
      createdBy: String(currentUser._id),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.workspaces.insertOne(doc);
    } catch {
      await this.superClawService.releaseWorkspace(superClawId);
      throw new BadRequestException('WORKSPACE_NAME_ALREADY_EXISTS');
    }
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.create,
      'workspace',
      String(doc._id),
      {
        name: doc.name,
        capacityBytes: doc.capacityBytes,
      },
    );
    return doc;
  }

  /**
   * @description 更新工作区(名称/描述/容量设定)
   * @keyword-en update workspace
   * @keyword-cn 更新工作区
   */
  async update(
    currentUser: AdminUserEntity,
    id: string,
    input: UpdateWorkspaceInput,
  ): Promise<WorkspaceEntity> {
    const ws = await this.get(currentUser, id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string') updates.name = input.name.trim();
    if (typeof input.description === 'string') {
      updates.description = input.description.trim();
    }
    if (typeof input.capacityBytes === 'number') {
      const capacity = this.normalizeCapacity(input.capacityBytes);
      if (capacity !== 0 && capacity < ws.usedBytes) {
        throw new BadRequestException('CAPACITY_BELOW_USED');
      }
      updates.capacityBytes = capacity;
    }
    const res = await this.workspaces.findOneAndUpdate(
      { _id: ws._id },
      { $set: updates },
      { returnDocument: 'after' },
    );
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.update,
      'workspace',
      id,
      updates,
    );
    return res ?? ws;
  }

  /**
   * @description 删除工作区及成员，并释放所属 SuperClaw 的一个工作区槽位
   * @keyword-en delete-workspace, release-super-claw-slot
   * @keyword-cn 删除工作区, 释放节点槽位
   */
  async remove(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    const ws = await this.get(currentUser, id);
    if (ws.usedBytes > 0) {
      throw new BadRequestException('WORKSPACE_NOT_EMPTY');
    }
    await this.members.deleteMany({ workspaceId: id });
    const res = await this.workspaces.deleteOne({ _id: ws._id });
    if (res.deletedCount === 1) {
      await this.superClawService.releaseWorkspace(ws.superClawId);
    }
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.delete,
      'workspace',
      id,
      {
        name: ws.name,
      },
    );
    return res.deletedCount === 1;
  }

  /**
   * @description 工作区成员列表
   * @keyword-en list workspace members
   * @keyword-cn 成员列表
   */
  async listMembers(
    currentUser: AdminUserEntity,
    workspaceId: string,
  ): Promise<WorkspaceMemberEntity[]> {
    await this.get(currentUser, workspaceId);
    return this.members.find({ workspaceId }).sort({ createdAt: 1 }).toArray();
  }

  /**
   * @description 添加工作区成员(校验目标用户存在且同租户)
   * @keyword-en add workspace member
   * @keyword-cn 添加成员
   */
  async addMember(
    currentUser: AdminUserEntity,
    workspaceId: string,
    input: { userId: string; role: WorkspaceMemberRole },
  ): Promise<WorkspaceMemberEntity> {
    const ws = await this.get(currentUser, workspaceId);
    const target = await this.adminUsers.findOne({
      _id: this.toId(input.userId, 'INVALID_USER_ID'),
    });
    if (!target) throw new NotFoundException('USER_NOT_FOUND');
    if ((target.tenantId ?? undefined) !== ws.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const now = new Date();
    const doc: WorkspaceMemberEntity = {
      _id: new ObjectId(),
      workspaceId,
      tenantId: ws.tenantId,
      userId: input.userId,
      username: target.username,
      role: input.role,
      addedBy: String(currentUser._id),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.members.insertOne(doc);
    } catch {
      throw new BadRequestException('MEMBER_ALREADY_EXISTS');
    }
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.memberAdd,
      'workspace_member',
      String(doc._id),
      {
        workspaceId,
        userId: input.userId,
        role: input.role,
      },
    );
    return doc;
  }

  /**
   * @description 更新成员角色
   * @keyword-en update workspace member role
   * @keyword-cn 更新成员角色
   */
  async updateMember(
    currentUser: AdminUserEntity,
    workspaceId: string,
    userId: string,
    role: WorkspaceMemberRole,
  ): Promise<WorkspaceMemberEntity> {
    await this.get(currentUser, workspaceId);
    const res = await this.members.findOneAndUpdate(
      { workspaceId, userId },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!res) throw new NotFoundException('MEMBER_NOT_FOUND');
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.memberUpdate,
      'workspace_member',
      String(res._id),
      {
        workspaceId,
        userId,
        role,
      },
    );
    return res;
  }

  /**
   * @description 移除工作区成员
   * @keyword-en remove workspace member
   * @keyword-cn 移除成员
   */
  async removeMember(
    currentUser: AdminUserEntity,
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    await this.get(currentUser, workspaceId);
    const res = await this.members.findOneAndDelete({ workspaceId, userId });
    if (!res) return false;
    await this.audit(
      currentUser,
      WORKSPACE_AUDIT_ACTIONS.memberRemove,
      'workspace_member',
      String(res._id),
      {
        workspaceId,
        userId,
      },
    );
    return true;
  }

  /**
   * @description 供网盘模块读取工作区做配额判断(不校验调用者，内部使用)
   * @keyword-en get workspace for quota
   * @keyword-cn 配额读取工作区
   */
  async getForQuota(
    tenantId: string,
    workspaceId: string,
  ): Promise<WorkspaceEntity | null> {
    return this.workspaces.findOne({
      _id: this.toId(workspaceId),
      tenantId,
    });
  }

  /**
   * @description 供网盘模块原子增减工作区已用容量(delta 可负)
   * @keyword-en add workspace used bytes
   * @keyword-cn 增减已用容量
   */
  async addUsedBytes(workspaceId: string, delta: number): Promise<void> {
    await this.workspaces.updateOne(
      { _id: this.toId(workspaceId) },
      { $inc: { usedBytes: delta }, $set: { updatedAt: new Date() } },
    );
  }

  /**
   * @description 归一化容量值(非负整数，默认 0=不限)
   * @keyword-en normalize capacity bytes
   * @keyword-cn 归一化容量
   */
  private normalizeCapacity(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Math.floor(value);
  }

  /**
   * @description 解析新工作区归属租户(租户用户用自身，平台超管须显式传 tenantId)
   * @keyword-en resolve workspace tenant
   * @keyword-cn 解析工作区租户
   */
  private resolveTenant(
    currentUser: AdminUserEntity,
    tenantId?: string,
  ): string {
    if (currentUser.tenantId) return currentUser.tenantId;
    const value = tenantId?.trim();
    if (!value) throw new BadRequestException('TENANT_ID_REQUIRED');
    return value;
  }

  /**
   * @description 校验当前用户对目标租户的访问边界
   * @keyword-en assert tenant boundary
   * @keyword-cn 校验租户边界
   */
  private assertTenant(
    currentUser: AdminUserEntity,
    targetTenantId: string,
  ): void {
    if (currentUser.tenantId && currentUser.tenantId !== targetTenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }

  /**
   * @description 转换并校验 ObjectId
   * @keyword-en to object id
   * @keyword-cn 转换对象ID
   */
  private toId(id: string, code = 'INVALID_WORKSPACE_ID'): ObjectId {
    if (!ObjectId.isValid(id)) throw new BadRequestException(code);
    return new ObjectId(id);
  }

  /**
   * @description 埋点写入审计事件(封装 actor/tenant 上下文)
   * @keyword-en write workspace audit
   * @keyword-cn 工作区审计埋点
   */
  private async audit(
    currentUser: AdminUserEntity,
    action: string,
    targetType: 'workspace' | 'workspace_member',
    targetId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record({
      tenantId: currentUser.tenantId,
      actorUserId: String(currentUser._id),
      actorUsername: currentUser.username,
      action,
      targetType,
      targetId,
      detail,
    });
  }
}
