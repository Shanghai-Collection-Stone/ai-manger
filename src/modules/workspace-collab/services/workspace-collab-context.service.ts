import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { AuditLogService } from '../../audit-log/services/audit-log.service.js';
import { WorkspaceService } from '../../workspace/services/workspace.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { WorkspaceEntity } from '../../workspace/entities/workspace.entity.js';
import type { DiskNodeEntity } from '../../netdisk/entities/netdisk.entity.js';
import type { AuditTargetType } from '../../audit-log/entities/audit-log.entity.js';
import type { WorkspaceAttachment } from '../entities/workspace-collab.entity.js';

/**
 * @description 工作区协作公共服务，收敛工作区归属校验、网盘附件解析、ObjectId 转换与审计埋点，
 *   供 Agent/会话/任务三个服务共用，保证租户与工作区边界只有一处实现
 * @keyword-en workspace collab context service
 * @keyword-cn 工作区协作公共服务
 */
@Injectable()
export class WorkspaceCollabContextService {
  private readonly diskNodes: Collection<DiskNodeEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly workspaceService: WorkspaceService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.diskNodes = db.collection<DiskNodeEntity>('disk_nodes');
  }

  /**
   * @description 读取工作区并校验调用者的租户边界(工作区不存在或跨租户直接抛错)
   * @keyword-en require workspace
   * @keyword-cn 校验工作区
   */
  async requireWorkspace(
    currentUser: AdminUserEntity,
    workspaceId: string,
  ): Promise<WorkspaceEntity> {
    return this.workspaceService.get(currentUser, workspaceId);
  }

  /**
   * @description 解析附件：按网盘节点 ID 校验节点存在、属于本租户与本工作区且为文件，返回冗余快照
   * @keyword-en resolve attachments
   * @keyword-cn 解析附件
   */
  async resolveAttachments(
    workspace: WorkspaceEntity,
    nodeIds?: string[],
  ): Promise<WorkspaceAttachment[]> {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return [];
    const ids = [...new Set(nodeIds.map((id) => String(id)))];
    const objectIds = ids.map((id) => this.toId(id, 'INVALID_ATTACHMENT_ID'));
    const nodes = await this.diskNodes
      .find({
        _id: { $in: objectIds },
        tenantId: workspace.tenantId,
        workspaceId: String(workspace._id),
        type: 'file',
      })
      .toArray();
    if (nodes.length !== ids.length) {
      throw new BadRequestException('ATTACHMENT_NOT_FOUND');
    }
    return nodes.map((node) => ({
      nodeId: String(node._id),
      name: node.name,
      sizeBytes: Number(node.sizeBytes) || 0,
    }));
  }

  /**
   * @description 转换并校验 ObjectId
   * @keyword-en to object id
   * @keyword-cn 转换对象ID
   */
  toId(id: string, code = 'INVALID_ID'): ObjectId {
    if (!ObjectId.isValid(id)) throw new BadRequestException(code);
    return new ObjectId(id);
  }

  /**
   * @description 展示用作者名(优先昵称，回落用户名)
   * @keyword-en display name
   * @keyword-cn 展示名
   */
  displayName(user: AdminUserEntity): string {
    return user.displayName?.trim() || user.username;
  }

  /**
   * @description 埋点写入审计事件(封装 actor/tenant 上下文)
   * @keyword-en write collab audit
   * @keyword-cn 协作审计埋点
   */
  async audit(
    currentUser: AdminUserEntity,
    action: string,
    targetType: AuditTargetType,
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
