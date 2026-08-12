import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { WorkspaceService } from '../../workspace/services/workspace.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { WorkspaceEntity } from '../../workspace/entities/workspace.entity.js';
import type {
  WorkspaceTaskAssigneeType,
  WorkspaceTaskEntity,
  WorkspaceTaskFollowupEntity,
  WorkspaceTaskStatus,
} from '../entities/workspace-collab.entity.js';
import { WORKSPACE_COLLAB_AUDIT_ACTIONS } from '../constants/workspace-collab-audit.constants.js';
import { WorkspaceAgentService } from './workspace-agent.service.js';
import { WorkspaceCollabContextService } from './workspace-collab-context.service.js';

/**
 * @description 任务状态计数(侧栏任务中心筛选用)
 * @keyword-en workspace task counts
 * @keyword-cn 任务状态计数
 */
export interface WorkspaceTaskCounts {
  all: number;
  in_progress: number;
  completed: number;
  failed: number;
}

/**
 * @description 任务列表结果(列表 + 全量状态计数，计数不受筛选影响)
 * @keyword-en workspace task list result
 * @keyword-cn 任务列表结果
 */
export interface WorkspaceTaskListResult {
  items: WorkspaceTaskEntity[];
  counts: WorkspaceTaskCounts;
}

/**
 * @description 创建任务入参
 * @keyword-en create workspace task input
 * @keyword-cn 创建任务入参
 */
export interface CreateWorkspaceTaskInput {
  title: string;
  description?: string;
  assigneeType: WorkspaceTaskAssigneeType;
  assigneeId: string;
  dueAt?: string;
  attachmentIds?: string[];
}

/**
 * @description 更新任务入参
 * @keyword-en update workspace task input
 * @keyword-cn 更新任务入参
 */
export interface UpdateWorkspaceTaskInput {
  title?: string;
  description?: string;
  status?: WorkspaceTaskStatus;
  assigneeType?: WorkspaceTaskAssigneeType;
  assigneeId?: string;
  dueAt?: string | null;
  attachmentIds?: string[];
}

/**
 * @description 追加跟进入参
 * @keyword-en add task followup input
 * @keyword-cn 追加跟进入参
 */
export interface AddTaskFollowupInput {
  text: string;
  attachmentIds?: string[];
  /** 跟进同时流转任务状态，可空 */
  status?: WorkspaceTaskStatus;
}

/**
 * @description 工作区任务服务，负责任务 CRUD、状态计数与跟进记录；承接方限本工作区成员或租户 Agent，
 *   附件引用网盘真实文件节点
 * @keyword-en workspace task service
 * @keyword-cn 工作区任务服务
 */
@Injectable()
export class WorkspaceTaskService {
  private readonly tasks: Collection<WorkspaceTaskEntity>;
  private readonly followups: Collection<WorkspaceTaskFollowupEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly context: WorkspaceCollabContextService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentService: WorkspaceAgentService,
  ) {
    this.tasks = db.collection<WorkspaceTaskEntity>('workspace_tasks');
    this.followups = db.collection<WorkspaceTaskFollowupEntity>(
      'workspace_task_followups',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 初始化任务与跟进索引
   * @keyword-en ensure workspace task indexes
   * @keyword-cn 初始化任务索引
   */
  async ensureIndexes(): Promise<void> {
    await this.tasks.createIndex({ workspaceId: 1, createdAt: -1 });
    await this.tasks.createIndex({ workspaceId: 1, status: 1 });
    await this.tasks.createIndex({ tenantId: 1 });
    await this.followups.createIndex({ taskId: 1, createdAt: 1 });
  }

  /**
   * @description 任务列表(可按状态筛选)与全量状态计数
   * @keyword-en list workspace tasks
   * @keyword-cn 任务列表
   */
  async list(
    currentUser: AdminUserEntity,
    workspaceId: string,
    status?: WorkspaceTaskStatus,
  ): Promise<WorkspaceTaskListResult> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const scope = {
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
    };
    const items = await this.tasks
      .find(status ? { ...scope, status } : scope)
      .sort({ createdAt: -1 })
      .toArray();
    const grouped = await this.tasks
      .aggregate<{
        _id: WorkspaceTaskStatus;
        total: number;
      }>([
        { $match: scope },
        { $group: { _id: '$status', total: { $sum: 1 } } },
      ])
      .toArray();
    const counts: WorkspaceTaskCounts = {
      all: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of grouped) {
      if (row._id in counts) counts[row._id] = row.total;
      counts.all += row.total;
    }
    return { items, counts };
  }

  /**
   * @description 创建任务
   * @keyword-en create workspace task
   * @keyword-cn 创建任务
   */
  async create(
    currentUser: AdminUserEntity,
    workspaceId: string,
    input: CreateWorkspaceTaskInput,
  ): Promise<WorkspaceTaskEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const assignee = await this.resolveAssignee(
      currentUser,
      workspace,
      input.assigneeType,
      input.assigneeId,
    );
    const attachments = await this.context.resolveAttachments(
      workspace,
      input.attachmentIds,
    );
    const now = new Date();
    const doc: WorkspaceTaskEntity = {
      _id: new ObjectId(),
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
      title: input.title.trim(),
      description: input.description?.trim(),
      status: 'in_progress',
      createdBy: String(currentUser._id),
      createdByName: this.context.displayName(currentUser),
      assigneeType: input.assigneeType,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      dueAt: this.parseDueAt(input.dueAt),
      attachments,
      followupCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.tasks.insertOne(doc);
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.taskCreate,
      'workspace_task',
      String(doc._id),
      { workspaceId, title: doc.title, assigneeName: doc.assigneeName },
    );
    return doc;
  }

  /**
   * @description 更新任务(标题/描述/状态/承接方/截止时间/附件)
   * @keyword-en update workspace task
   * @keyword-cn 更新任务
   */
  async update(
    currentUser: AdminUserEntity,
    workspaceId: string,
    taskId: string,
    input: UpdateWorkspaceTaskInput,
  ): Promise<WorkspaceTaskEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const task = await this.requireTask(workspace, taskId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.title === 'string') updates.title = input.title.trim();
    if (typeof input.description === 'string') {
      updates.description = input.description.trim();
    }
    if (input.status) updates.status = input.status;
    if (input.assigneeType || input.assigneeId) {
      const assigneeType = input.assigneeType ?? task.assigneeType;
      const assigneeId = input.assigneeId ?? task.assigneeId;
      const assignee = await this.resolveAssignee(
        currentUser,
        workspace,
        assigneeType,
        assigneeId,
      );
      updates.assigneeType = assigneeType;
      updates.assigneeId = assignee.id;
      updates.assigneeName = assignee.name;
    }
    if (input.dueAt !== undefined) {
      updates.dueAt = input.dueAt ? this.parseDueAt(input.dueAt) : undefined;
    }
    if (input.attachmentIds) {
      updates.attachments = await this.context.resolveAttachments(
        workspace,
        input.attachmentIds,
      );
    }

    const res = await this.tasks.findOneAndUpdate(
      { _id: task._id },
      { $set: updates },
      { returnDocument: 'after' },
    );
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.taskUpdate,
      'workspace_task',
      taskId,
      { workspaceId, ...updates },
    );
    return res ?? task;
  }

  /**
   * @description 删除任务及其跟进记录
   * @keyword-en delete workspace task
   * @keyword-cn 删除任务
   */
  async remove(
    currentUser: AdminUserEntity,
    workspaceId: string,
    taskId: string,
  ): Promise<boolean> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const task = await this.requireTask(workspace, taskId);
    await this.followups.deleteMany({ taskId: String(task._id) });
    const res = await this.tasks.deleteOne({ _id: task._id });
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.taskDelete,
      'workspace_task',
      taskId,
      { workspaceId, title: task.title },
    );
    return res.deletedCount === 1;
  }

  /**
   * @description 任务跟进记录列表(时间正序)
   * @keyword-en list task followups
   * @keyword-cn 跟进记录列表
   */
  async listFollowups(
    currentUser: AdminUserEntity,
    workspaceId: string,
    taskId: string,
  ): Promise<WorkspaceTaskFollowupEntity[]> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const task = await this.requireTask(workspace, taskId);
    return this.followups
      .find({ taskId: String(task._id) })
      .sort({ createdAt: 1 })
      .toArray();
  }

  /**
   * @description 追加跟进记录(可携带网盘附件并同时流转任务状态)
   * @keyword-en add task followup
   * @keyword-cn 追加跟进记录
   */
  async addFollowup(
    currentUser: AdminUserEntity,
    workspaceId: string,
    taskId: string,
    input: AddTaskFollowupInput,
  ): Promise<WorkspaceTaskFollowupEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const task = await this.requireTask(workspace, taskId);
    const text = input.text?.trim() ?? '';
    const attachments = await this.context.resolveAttachments(
      workspace,
      input.attachmentIds,
    );
    if (!text && attachments.length === 0) {
      throw new BadRequestException('FOLLOWUP_EMPTY');
    }
    const now = new Date();
    const doc: WorkspaceTaskFollowupEntity = {
      _id: new ObjectId(),
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
      taskId: String(task._id),
      authorUserId: String(currentUser._id),
      authorName: this.context.displayName(currentUser),
      text,
      attachments,
      createdAt: now,
    };
    await this.followups.insertOne(doc);
    const taskUpdates: Record<string, unknown> = { updatedAt: now };
    if (input.status) taskUpdates.status = input.status;
    await this.tasks.updateOne(
      { _id: task._id },
      { $inc: { followupCount: 1 }, $set: taskUpdates },
    );
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.taskFollowup,
      'workspace_task',
      taskId,
      { workspaceId, attachments: attachments.length, status: input.status },
    );
    return doc;
  }

  /**
   * @description 解析并校验承接方：成员须是本工作区成员，Agent 须在本租户通讯录内
   * @keyword-en resolve task assignee
   * @keyword-cn 解析承接方
   */
  private async resolveAssignee(
    currentUser: AdminUserEntity,
    workspace: WorkspaceEntity,
    assigneeType: WorkspaceTaskAssigneeType,
    assigneeId: string,
  ): Promise<{ id: string; name: string }> {
    if (assigneeType === 'agent') {
      const agent = await this.agentService.getByKey(
        workspace.tenantId,
        assigneeId,
      );
      if (!agent) throw new NotFoundException('AGENT_NOT_FOUND');
      return { id: agent.key, name: agent.name };
    }
    const members = await this.workspaceService.listMembers(
      currentUser,
      String(workspace._id),
    );
    const member = members.find((item) => item.userId === assigneeId);
    if (!member) throw new BadRequestException('ASSIGNEE_NOT_MEMBER');
    return { id: member.userId, name: member.username };
  }

  /**
   * @description 解析截止时间(非法时间直接拒绝，避免存 Invalid Date)
   * @keyword-en parse task due date
   * @keyword-cn 解析截止时间
   */
  private parseDueAt(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('INVALID_DUE_AT');
    }
    return date;
  }

  /**
   * @description 读取并校验任务归属当前工作区
   * @keyword-en require workspace task
   * @keyword-cn 校验任务归属
   */
  private async requireTask(
    workspace: WorkspaceEntity,
    taskId: string,
  ): Promise<WorkspaceTaskEntity> {
    const task = await this.tasks.findOne({
      _id: this.context.toId(taskId, 'INVALID_TASK_ID'),
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
    });
    if (!task) throw new NotFoundException('TASK_NOT_FOUND');
    return task;
  }
}
