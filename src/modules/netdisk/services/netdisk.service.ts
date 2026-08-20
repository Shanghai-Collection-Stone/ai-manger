import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { unlink } from 'fs/promises';
import { AuditLogService } from '../../audit-log/services/audit-log.service.js';
import { WorkspaceService } from '../../workspace/services/workspace.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type {
  DiskNodeEntity,
  DiskRootEntity,
} from '../entities/netdisk.entity.js';
import { NETDISK_AUDIT_ACTIONS } from '../constants/netdisk-audit.constants.js';
import { NetdiskStorageService } from './netdisk-storage.service.js';

/**
 * @description 节点作用域(租户级或工作区级)
 * @keyword-en disk node scope
 * @keyword-cn 网盘节点作用域
 */
export interface NodeScope {
  workspaceId?: string;
  parentId?: string;
  /** 目标租户；租户用户忽略此值(锁死自身)，平台超管必须显式指定 */
  tenantId?: string;
}

/**
 * @description 网盘服务，租户网盘文件/文件夹增删改查、真实文件落盘、容量配额与审计埋点
 * @keyword-en netdisk service
 * @keyword-cn 网盘服务
 */
@Injectable()
export class NetdiskService {
  private readonly nodes: Collection<DiskNodeEntity>;
  private readonly roots: Collection<DiskRootEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly storage: NetdiskStorageService,
    private readonly workspaceService: WorkspaceService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.nodes = db.collection<DiskNodeEntity>('disk_nodes');
    this.roots = db.collection<DiskRootEntity>('disk_roots');
    void this.ensureIndexes();
  }

  /**
   * @description 初始化网盘索引
   * @keyword-en ensure netdisk indexes
   * @keyword-cn 初始化网盘索引
   */
  async ensureIndexes(): Promise<void> {
    await this.nodes.createIndex({ tenantId: 1, workspaceId: 1, parentId: 1 });
    await this.nodes.createIndex({ tenantId: 1, updatedAt: -1 });
    await this.roots.createIndex({ tenantId: 1 }, { unique: true });
  }

  /**
   * @description 读取或初始化租户网盘根配置
   * @keyword-en ensure tenant disk root
   * @keyword-cn 初始化租户网盘根
   */
  async ensureRoot(tenantId: string): Promise<DiskRootEntity> {
    const existing = await this.roots.findOne({ tenantId });
    if (existing) return existing;
    const now = new Date();
    const doc: DiskRootEntity = {
      _id: new ObjectId(),
      tenantId,
      capacityBytes: 0,
      usedBytes: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.roots.insertOne(doc);
      return doc;
    } catch {
      // 并发创建兜底
      return (await this.roots.findOne({ tenantId })) ?? doc;
    }
  }

  /**
   * @description 获取租户网盘根(容量/已用)
   * @keyword-en get tenant disk root
   * @keyword-cn 获取网盘根
   */
  async getRoot(
    currentUser: AdminUserEntity,
    tenantId?: string,
  ): Promise<DiskRootEntity> {
    return this.ensureRoot(this.resolveTenant(currentUser, tenantId));
  }

  /**
   * @description 设置租户网盘总容量
   * @keyword-en update tenant disk capacity
   * @keyword-cn 设置网盘容量
   */
  async updateRootCapacity(
    currentUser: AdminUserEntity,
    capacityBytes: number,
    targetTenantId?: string,
  ): Promise<DiskRootEntity> {
    const tenantId = this.resolveTenant(currentUser, targetTenantId);
    const root = await this.ensureRoot(tenantId);
    const capacity = this.normalizeCapacity(capacityBytes);
    if (capacity !== 0 && capacity < root.usedBytes) {
      throw new BadRequestException('CAPACITY_BELOW_USED');
    }
    const res = await this.roots.findOneAndUpdate(
      { tenantId },
      { $set: { capacityBytes: capacity, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    await this.audit(currentUser, NETDISK_AUDIT_ACTIONS.rootUpdate, 'disk_root', tenantId, {
      capacityBytes: capacity,
    });
    return res ?? root;
  }

  /**
   * @description 列出某作用域下的子节点(文件夹在前，按名称)
   * @keyword-en list disk nodes
   * @keyword-cn 列出网盘节点
   */
  async listNodes(
    currentUser: AdminUserEntity,
    scope: NodeScope,
  ): Promise<DiskNodeEntity[]> {
    const tenantId = this.resolveTenant(currentUser, scope.tenantId);
    return this.nodes
      .find({
        tenantId,
        // Mongo 查 null 同时匹配"字段缺失"与"值为 null"，用于根/租户级(无 workspace/parent)节点
        workspaceId: scope.workspaceId ?? null,
        parentId: scope.parentId ?? null,
      })
      .sort({ type: 1, name: 1 })
      .toArray();
  }

  /**
   * @description 创建文件夹
   * @keyword-en create disk folder
   * @keyword-cn 创建文件夹
   */
  async createFolder(
    currentUser: AdminUserEntity,
    input: { name: string } & NodeScope,
  ): Promise<DiskNodeEntity> {
    const tenantId = this.resolveTenant(currentUser, input.tenantId);
    await this.assertScope(tenantId, input);
    const now = new Date();
    const doc: DiskNodeEntity = {
      _id: new ObjectId(),
      tenantId,
      workspaceId: input.workspaceId ?? null,
      parentId: input.parentId ?? null,
      type: 'folder',
      name: input.name.trim(),
      sizeBytes: 0,
      createdBy: String(currentUser._id),
      createdAt: now,
      updatedAt: now,
    };
    await this.nodes.insertOne(doc);
    await this.audit(currentUser, NETDISK_AUDIT_ACTIONS.folderCreate, 'disk_node', String(doc._id), {
      name: doc.name,
      workspaceId: input.workspaceId,
    });
    return doc;
  }

  /**
   * @description 完成文件上传:校验作用域与容量配额，落库并记账，失败清理物理文件
   * @keyword-en finalize file upload
   * @keyword-cn 完成文件上传
   */
  async finalizeUpload(
    currentUser: AdminUserEntity,
    file: Express.Multer.File,
    scope: NodeScope,
  ): Promise<DiskNodeEntity> {
    const size = file.size;
    let tenantId: string;
    try {
      tenantId = this.resolveTenant(currentUser, scope.tenantId);
      await this.assertScope(tenantId, scope);
      await this.assertCapacity(tenantId, scope.workspaceId, size);
    } catch (error) {
      await this.cleanupUploaded(file);
      throw error;
    }

    const now = new Date();
    const doc: DiskNodeEntity = {
      _id: new ObjectId(),
      tenantId,
      workspaceId: scope.workspaceId ?? null,
      parentId: scope.parentId ?? null,
      type: 'file',
      name: this.decodeOriginalName(file.originalname),
      sizeBytes: size,
      storageKey: this.storage.storageKeyOf(file.path),
      mimeType: file.mimetype,
      createdBy: String(currentUser._id),
      createdAt: now,
      updatedAt: now,
    };
    await this.nodes.insertOne(doc);
    await this.reserveUsage(tenantId, scope.workspaceId, size);
    await this.audit(currentUser, NETDISK_AUDIT_ACTIONS.fileUpload, 'disk_node', String(doc._id), {
      name: doc.name,
      sizeBytes: size,
      workspaceId: scope.workspaceId,
    });
    return doc;
  }

  /**
   * @description 获取用于下载的文件节点及绝对路径
   * @keyword-en get file for download
   * @keyword-cn 获取下载文件
   */
  async getFileForDownload(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<{ node: DiskNodeEntity; absPath: string }> {
    const node = await this.nodes.findOne({ _id: this.toId(id) });
    if (!node || node.type !== 'file' || !node.storageKey) {
      throw new NotFoundException('FILE_NOT_FOUND');
    }
    this.assertTenant(currentUser, node.tenantId);
    return { node, absPath: this.storage.absPathOf(node.storageKey) };
  }

  /**
   * @description 重命名节点
   * @keyword-en rename disk node
   * @keyword-cn 重命名节点
   */
  async renameNode(
    currentUser: AdminUserEntity,
    id: string,
    name: string,
  ): Promise<DiskNodeEntity> {
    const existing = await this.nodes.findOne({ _id: this.toId(id) });
    if (!existing) throw new NotFoundException('NODE_NOT_FOUND');
    this.assertTenant(currentUser, existing.tenantId);
    const res = await this.nodes.findOneAndUpdate(
      { _id: existing._id },
      { $set: { name: name.trim(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!res) throw new NotFoundException('NODE_NOT_FOUND');
    await this.audit(currentUser, NETDISK_AUDIT_ACTIONS.nodeRename, 'disk_node', id, {
      name: res.name,
    });
    return res;
  }

  /**
   * @description 删除节点:文件删物理文件并回收配额;文件夹须为空
   * @keyword-en delete disk node
   * @keyword-cn 删除节点
   */
  async deleteNode(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    const node = await this.nodes.findOne({ _id: this.toId(id) });
    if (!node) return false;
    this.assertTenant(currentUser, node.tenantId);
    const tenantId = node.tenantId;
    if (node.type === 'folder') {
      const childCount = await this.nodes.countDocuments({ parentId: id });
      if (childCount > 0) throw new BadRequestException('FOLDER_NOT_EMPTY');
    }
    await this.nodes.deleteOne({ _id: node._id });
    if (node.type === 'file' && node.sizeBytes > 0) {
      await this.reserveUsage(tenantId, node.workspaceId ?? undefined, -node.sizeBytes);
      if (node.storageKey) await this.storage.deleteByKey(node.storageKey);
    }
    await this.audit(currentUser, NETDISK_AUDIT_ACTIONS.nodeDelete, 'disk_node', id, {
      name: node.name,
      type: node.type,
    });
    return true;
  }

  /**
   * @description 校验作用域合法性(工作区存在且同租户，父节点存在且为同作用域文件夹)
   * @keyword-en assert node scope
   * @keyword-cn 校验节点作用域
   */
  private async assertScope(tenantId: string, scope: NodeScope): Promise<void> {
    if (scope.workspaceId) {
      const ws = await this.workspaceService.getForQuota(
        tenantId,
        scope.workspaceId,
      );
      if (!ws) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }
    if (scope.parentId) {
      const parent = await this.nodes.findOne({
        _id: this.toId(scope.parentId, 'INVALID_PARENT_ID'),
        tenantId,
      });
      if (!parent || parent.type !== 'folder') {
        throw new BadRequestException('INVALID_PARENT');
      }
      if ((parent.workspaceId ?? undefined) !== (scope.workspaceId ?? undefined)) {
        throw new BadRequestException('PARENT_SCOPE_MISMATCH');
      }
    }
  }

  /**
   * @description 校验租户与工作区容量是否足够容纳新增字节
   * @keyword-en assert capacity available
   * @keyword-cn 校验容量配额
   */
  private async assertCapacity(
    tenantId: string,
    workspaceId: string | undefined,
    size: number,
  ): Promise<void> {
    const root = await this.ensureRoot(tenantId);
    if (root.capacityBytes > 0 && root.usedBytes + size > root.capacityBytes) {
      throw new PayloadTooLargeException('INSUFFICIENT_TENANT_CAPACITY');
    }
    if (workspaceId) {
      const ws = await this.workspaceService.getForQuota(tenantId, workspaceId);
      if (!ws) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      if (ws.capacityBytes > 0 && ws.usedBytes + size > ws.capacityBytes) {
        throw new PayloadTooLargeException('INSUFFICIENT_WORKSPACE_CAPACITY');
      }
    }
  }

  /**
   * @description 记账:增减租户根与工作区已用容量(delta 可负)
   * @keyword-en reserve usage bytes
   * @keyword-cn 容量记账
   */
  private async reserveUsage(
    tenantId: string,
    workspaceId: string | undefined,
    delta: number,
  ): Promise<void> {
    await this.roots.updateOne(
      { tenantId },
      { $inc: { usedBytes: delta }, $set: { updatedAt: new Date() } },
    );
    if (workspaceId) {
      await this.workspaceService.addUsedBytes(workspaceId, delta);
    }
  }

  /**
   * @description 清理上传失败残留的物理文件
   * @keyword-en cleanup uploaded file
   * @keyword-cn 清理残留文件
   */
  private async cleanupUploaded(file: Express.Multer.File): Promise<void> {
    if (!file?.path) return;
    try {
      await unlink(file.path);
    } catch {
      // 忽略
    }
  }

  /**
   * @description 修正 multer latin1 原始文件名为 UTF-8(中文名不乱码)
   * @keyword-en decode original file name
   * @keyword-cn 修正文件名编码
   */
  private decodeOriginalName(name: string): string {
    return Buffer.from(name, 'latin1').toString('utf8');
  }

  /**
   * @description 解析本次操作的目标租户：租户用户锁死自身(传入不一致直接拒绝)；
   *   平台超管(无租户上下文)须显式指定 tenantId，用于跨租户分配与管理网盘
   * @keyword-en resolve netdisk tenant
   * @keyword-cn 解析网盘租户
   */
  private resolveTenant(
    currentUser: AdminUserEntity,
    tenantId?: string,
  ): string {
    const own = currentUser.tenantId;
    const requested = tenantId?.trim();
    if (own) {
      if (requested && requested !== own) {
        throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
      }
      return own;
    }
    if (!requested) throw new BadRequestException('TENANT_ID_REQUIRED');
    return requested;
  }

  /**
   * @description 校验当前用户对既有节点所属租户的访问边界(超管放行，租户用户仅限自身)
   * @keyword-en assert netdisk tenant boundary
   * @keyword-cn 校验网盘租户边界
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
   * @description 归一化容量值(非负整数，0=不限)
   * @keyword-en normalize capacity bytes
   * @keyword-cn 归一化容量
   */
  private normalizeCapacity(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  }

  /**
   * @description 转换并校验 ObjectId
   * @keyword-en to object id
   * @keyword-cn 转换对象ID
   */
  private toId(id: string, code = 'INVALID_NODE_ID'): ObjectId {
    if (!ObjectId.isValid(id)) throw new BadRequestException(code);
    return new ObjectId(id);
  }

  /**
   * @description 埋点写入审计事件(封装 actor/tenant 上下文)
   * @keyword-en write netdisk audit
   * @keyword-cn 网盘审计埋点
   */
  private async audit(
    currentUser: AdminUserEntity,
    action: string,
    targetType: 'disk_node' | 'disk_root',
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
