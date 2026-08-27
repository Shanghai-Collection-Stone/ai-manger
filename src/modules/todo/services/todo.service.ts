import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import {
  TodoEntity,
  TodoCreateInput,
  TodoUpdateInput,
} from '../entities/todo.entity.js';
import type {
  TodoItemCreateInput,
  TodoItemEntity,
  TodoItemUpdateInput,
} from '../entities/todo-item.entity.js';
import { TaskCallbackService } from './task-callback.service.js';

/**
 * @description 待办服务，提供序号ID的CRUD，并保证AI字段完整
 * @param {Db} db - 注入的主数据库连接（DS_MONGO_DB）
 * @returns {void}
 * @keyword todo, service, mongo
 * @since 2026-01-27
 */
@Injectable()
export class TodoService {
  private readonly logger = new Logger(TodoService.name);
  private readonly todos: Collection<TodoEntity>;
  private readonly todoItems: Collection<TodoItemEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly callbackSvc: TaskCallbackService,
  ) {
    this.todos = db.collection<TodoEntity>('todos');
    this.todoItems = db.collection<TodoItemEntity>('todo_items');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 确保索引与计数器存在
   * @returns {Promise<void>}
   * @keyword todo, ensure, indexes
   * @since 2026-01-27
   */
  async ensureIndexes(): Promise<void> {
    await this.todos.createIndex({ id: 1 }, { unique: true });
    await this.todos.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.todos.createIndex({ userId: 1 });
    await this.todos.createIndex({ status: 1 });
    await this.todos.createIndex({ type: 1 });
    await this.todos.createIndex({ workspaceId: 1, status: 1, createdAt: 1 });
    await this.todos.createIndex({ category: 1 });
    await this.todos.createIndex({ assignee: 1 });
    await this.todos.createIndex({
      tenantId: 1,
      assignee: 1,
      status: 1,
      deadline: 1,
      createdAt: 1,
    });
    await this.todos.createIndex({
      taskDeliverySuperClawId: 1,
      taskDeliveryLeaseExpiresAt: 1,
      status: 1,
    });
    await this.todos.createIndex({
      tenantId: 1,
      status: 1,
      taskDeliveryAckDeadline: 1,
    });
    await this.todos.createIndex({
      tenantId: 1,
      status: 1,
      taskDeliveryLeaseExpiresAt: 1,
    });
    await this.todos.createIndex(
      { taskToken: 1 },
      { unique: true, sparse: true },
    );
    await this.todoItems.createIndex({ id: 1 }, { unique: true });
    await this.todoItems.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.todoItems.createIndex({ todoId: 1 });
    await this.todoItems.createIndex({ userId: 1 });
    await this.todoItems.createIndex({ status: 1 });
    await this.todoItems.createIndex({ plannedAt: 1 });
    const exists = await this.counters.findOne({ _id: 'todos' });
    if (!exists) await this.counters.insertOne({ _id: 'todos', seq: 0 });
    const existsItems = await this.counters.findOne({ _id: 'todo_items' });
    if (!existsItems)
      await this.counters.insertOne({ _id: 'todo_items', seq: 0 });
  }

  /**
   * @description 确保任务有 taskToken，如果不存在则生成并写入
   * @keyword-en ensure task token exists, generate if absent
   */
  async ensureTaskToken(id: number, tenantId?: string): Promise<string> {
    const existing = await this.todos.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    if (!existing) throw new Error('TODO_NOT_FOUND');
    if (existing.taskToken) return existing.taskToken;
    const token = randomUUID().replace(/-/g, '');
    await this.todos.updateOne(
      { id, ...this.buildTenantFilter(tenantId) },
      { $set: { taskToken: token, updatedAt: new Date() } },
    );
    return token;
  }

  /**
   * @description 通过 taskToken 查找对应任务
   * @keyword-en get todo by task token
   */
  async getByTaskToken(token: string): Promise<TodoEntity | null> {
    return (await this.todos.findOne({ taskToken: token })) ?? null;
  }

  /**
   * @description 原子地生成下一个序号ID
   * @returns {Promise<number>} 序号
   * @keyword todo, seq, counter
   * @since 2026-01-27
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'todos' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  private async nextItemId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'todo_items' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 创建待办（含AI字段），返回创建的实体
   * @param {TodoCreateInput} input - 创建输入
   * @returns {Promise<TodoEntity>} 创建后的实体
   * @throws {Error} 输入无效或写入失败
   * @keyword todo, create, ai
   * @example
   * await service.create({ userId:'u1', title:'整理报表', aiConsideration:'...', decisionReason:'...', aiPlan:'...' });
   * @since 2026-01-27
   */
  async create(input: TodoCreateInput): Promise<TodoEntity> {
    const now = new Date();
    const id = await this.nextId();
    const normalizedType = this.normalizeTodoType(input.type, input.assignee);
    const resource = String(input.resource ?? '').trim() || undefined;
    const doc: TodoEntity = {
      _id: new ObjectId(),
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title,
      description: input.description,
      resource,
      associatedResources: input.associatedResources,
      type: normalizedType,
      category: input.category,
      assignee: input.assignee,
      aiConsideration: input.aiConsideration,
      decisionReason: input.decisionReason,
      aiPlan: input.aiPlan,
      workspaceId: input.workspaceId,
      sessionKey: input.sessionKey,
      deadline: input.deadline,
      callbacks: input.callbacks,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await this.todos.insertOne(doc);
    return doc;
  }

  /**
   * @description 更新待办，返回更新后的实体
   * @param {TodoUpdateInput} input - 更新输入
   * @returns {Promise<TodoEntity|null>} 更新后实体或空
   * @keyword todo, update
   * @since 2026-01-27
   */
  async update(input: TodoUpdateInput): Promise<TodoEntity | null> {
    const authFilter = input.expectedTaskToken
      ? { taskToken: input.expectedTaskToken }
      : {};
    const existing = await this.todos.findOne({
      id: input.id,
      ...this.buildTenantFilter(input.tenantId),
      ...authFilter,
    });
    if (!existing) {
      this.logger.warn(
        `[update] todo not found: id=${input.id} tenantId=${String(input.tenantId ?? '')}`,
      );
      return null;
    }

    // 状态变更日志
    if (input.status !== undefined && input.status !== existing.status) {
      this.logger.log(
        `[update] STATUS CHANGE id=${input.id}: '${existing.status}' → '${input.status}'`,
      );
    } else if (input.status !== undefined) {
      this.logger.log(
        `[update] status unchanged id=${input.id}: '${existing.status}'`,
      );
    }

    const now = new Date();
    const upd: Record<string, unknown> = { updatedAt: now };
    for (const [k, v] of Object.entries(input)) {
      if (k === 'id' || k === 'expectedTaskToken') continue;
      if (typeof v !== 'undefined') upd[k] = v;
    }
    const nextAssignee =
      typeof input.assignee !== 'undefined'
        ? input.assignee
        : existing.assignee;
    const nextType = this.normalizeTodoType(
      typeof input.type !== 'undefined' ? input.type : existing.type,
      nextAssignee,
    );
    upd.type = nextType;
    if (typeof input.resource !== 'undefined') {
      const r = String(input.resource ?? '').trim();
      upd.resource = r || undefined;
    }
    if (typeof input.associatedResources !== 'undefined') {
      upd.associatedResources = input.associatedResources;
    }
    const terminal =
      input.status === 'done' ||
      input.status === 'failed' ||
      input.status === 'cancelled';
    if (terminal && existing.taskDeliveryId) {
      upd.taskToken = randomUUID().replace(/-/g, '');
    }
    const res = await this.todos.findOneAndUpdate(
      {
        id: input.id,
        ...this.buildTenantFilter(input.tenantId),
        ...authFilter,
      },
      {
        $set: upd,
        ...(terminal
          ? {
              $unset: {
                taskDeliveryId: '',
                taskDeliverySuperClawId: '',
                taskDeliveryAckDeadline: '',
                taskDeliveryLeaseExpiresAt: '',
                taskDeliveryAcknowledgedAt: '',
              },
            }
          : {}),
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    const updated = res.value ?? null;

    // 状态变为 done/failed 时异步触发回调
    if (
      updated &&
      (updated.status === 'done' || updated.status === 'failed') &&
      existing.status !== updated.status
    ) {
      this.callbackSvc.processCallbacks(updated);
    }

    return updated;
  }

  /**
   * @description 用户完成扫码或简短回复后恢复等待中的 Todo；有效租约仍在时回到执行中，
   *   否则清理旧投递、轮换 Token 并回到 pending 等待重新下发。
   * @keyword-cn 恢复等待用户任务, 轮换旧令牌
   * @keyword-en resume-waiting-user-task, rotate-stale-token
   */
  async resumeAfterInteraction(
    id: number,
    tenantId?: string,
  ): Promise<TodoEntity | null> {
    const existing = await this.todos.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
      status: 'waiting_user',
    });
    if (!existing) return null;
    const now = new Date();
    const leaseActive = Boolean(
      existing.taskDeliveryId &&
        existing.taskDeliveryAcknowledgedAt &&
        existing.taskDeliveryLeaseExpiresAt &&
        existing.taskDeliveryLeaseExpiresAt.getTime() > now.getTime(),
    );
    const result = await this.todos.findOneAndUpdate(
      {
        id,
        ...this.buildTenantFilter(tenantId),
        status: 'waiting_user',
      },
      leaseActive
        ? {
            $set: { status: 'in_progress', updatedAt: now },
            $unset: { abnormalReason: '' },
          }
        : {
            $set: {
              status: 'pending',
              taskToken: randomUUID().replace(/-/g, ''),
              updatedAt: now,
            },
            $unset: {
              abnormalReason: '',
              taskDeliveryId: '',
              taskDeliverySuperClawId: '',
              taskDeliveryAckDeadline: '',
              taskDeliveryLeaseExpiresAt: '',
              taskDeliveryAcknowledgedAt: '',
            },
          },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value ?? null;
  }

  /**
   * @description 删除待办（按序号ID）
   * @param {number} id - 序号ID
   * @returns {Promise<boolean>} 是否删除
   * @keyword todo, delete
   * @since 2026-01-27
   */
  async delete(id: number, tenantId?: string): Promise<boolean> {
    const res = await this.todos.deleteOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    return res.deletedCount === 1;
  }

  /**
   * @description 获取待办
   * @param {number} id - 序号ID
   * @returns {Promise<TodoEntity|null>} 实体或空
   * @keyword todo, get
   * @since 2026-01-27
   */
  async get(id: number, tenantId?: string): Promise<TodoEntity | null> {
    return (
      (await this.todos.findOne({ id, ...this.buildTenantFilter(tenantId) })) ??
      null
    );
  }

  /**
   * @description 列出待办（可按用户和指派人过滤）
   * @param {string} [userId] - 指定用户
   * @param {string} [tenantId] - 租户ID
   * @param {string} [assignee] - 指派人（支持 robot:xxx 格式）
   * @returns {Promise<TodoEntity[]>} 列表
   * @keyword todo, list, user
   * @since 2026-01-27
   */
  async list(
    userId?: string,
    tenantId?: string,
    assignee?: string,
    category?: string,
  ): Promise<TodoEntity[]> {
    const filter: Record<string, unknown> = this.buildTenantFilter(tenantId);
    if (userId) filter.userId = userId;
    if (assignee) filter.assignee = assignee;
    if (category) filter.category = category;
    return this.todos
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  /**
   * @description 按角色权限列出任务
   * @keyword-en list todos by scope
   */
  async listByScope(input: {
    canViewAll: boolean;
    userId?: string;
    assignee?: string;
    tenantId?: string;
    category?: string;
  }): Promise<TodoEntity[]> {
    if (input.canViewAll) {
      return this.list(
        input.userId,
        input.tenantId,
        input.assignee,
        input.category,
      );
    }
    const filter: Record<string, unknown> = {
      ...this.buildTenantFilter(input.tenantId),
      $or: [],
    };
    const orList = filter.$or as Record<string, unknown>[];
    if (input.userId) orList.push({ userId: input.userId });
    if (input.assignee) orList.push({ assignee: input.assignee });
    if (input.category) filter.category = input.category;
    if (orList.length === 0) {
      return [];
    }
    return this.todos
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  /**
   * @description 按租户和专用 Agent assignee 原子领取最早的 pending 任务并推进为 in_progress；跳过已被主动推送预留的任务。
   * @keyword-cn 原子领取任务, SuperClaw下发
   * @keyword-en atomic-task-claim, super-claw-dispatch
   * @param input 租户与允许领取的 assignee 集合。
   * @returns {Promise<TodoEntity | null>} 领取后的任务，无待领任务时为 null。
   */
  async claimNextByAssignees(input: {
    tenantId: string;
    assignees: string[];
  }): Promise<TodoEntity | null> {
    if (input.assignees.length === 0) return null;
    const now = new Date();
    return await this.todos.findOneAndUpdate(
      {
        tenantId: input.tenantId,
        assignee: { $in: input.assignees },
        status: 'pending',
        $and: [
          {
            $or: [{ deadline: { $exists: false } }, { deadline: { $gt: now } }],
          },
          // 主动推送通道已经预留但还没 ACK 的任务在此不可见，
          // 否则拉取端会与推送端同时领走同一条任务并重复启动抓取。
          {
            $or: [
              { taskDeliveryAckDeadline: { $exists: false } },
              { taskDeliveryAckDeadline: { $lte: now } },
            ],
          },
        ],
      },
      { $set: { status: 'in_progress', updatedAt: now } },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
  }

  /**
   * @description 为平台主动推送原子预留节点所辖租户中最早的 pending 任务，并在同一写操作轮换任务 Token。
   * @keyword-cn 预留推送任务, 轮换任务令牌
   * @keyword-en reserve-push-task, rotate-task-token
   */
  async reserveNextForDelivery(input: {
    tenantIds: string[];
    workspaceIds: string[];
    assignees: string[];
    includePlatform?: boolean;
    superClawId: string;
    deliveryId: string;
    ackDeadline: Date;
    maxExecutionAttempts?: number;
  }): Promise<TodoEntity | null> {
    if (
      (!input.tenantIds.length && !input.includePlatform) ||
      !input.workspaceIds.length ||
      !input.assignees.length
    ) {
      return null;
    }
    await this.requeueExpiredTaskDeliveries(
      input.tenantIds,
      input.includePlatform,
    );
    if (input.maxExecutionAttempts) {
      await this.failExhaustedTaskDeliveries(
        input.workspaceIds,
        input.maxExecutionAttempts,
      );
    }
    const now = new Date();
    return await this.todos.findOneAndUpdate(
      {
        $or: [
          ...(input.tenantIds.length
            ? [{ tenantId: { $in: input.tenantIds } }]
            : []),
          ...(input.includePlatform
            ? [
                { tenantId: '' },
                { tenantId: { $type: 'null' as const } },
                { tenantId: { $exists: false } },
              ]
            : []),
        ],
        workspaceId: { $in: input.workspaceIds },
        assignee: { $in: input.assignees },
        status: 'pending',
        $and: [
          {
            $or: [{ deadline: { $exists: false } }, { deadline: { $gt: now } }],
          },
          {
            $or: [
              { taskDeliveryAckDeadline: { $exists: false } },
              { taskDeliveryAckDeadline: { $lte: now } },
            ],
          },
          ...(input.maxExecutionAttempts
            ? [
                {
                  $or: [
                    { taskExecutionAttempts: { $exists: false } },
                    {
                      taskExecutionAttempts: {
                        $lt: input.maxExecutionAttempts,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      {
        $set: {
          taskToken: randomUUID().replace(/-/g, ''),
          taskDeliveryId: input.deliveryId,
          taskDeliverySuperClawId: input.superClawId,
          taskDeliveryAckDeadline: input.ackDeadline,
          updatedAt: now,
        },
        $unset: {
          taskDeliveryLeaseExpiresAt: '',
          taskDeliveryAcknowledgedAt: '',
        },
        $inc: { taskDispatchAttempts: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
  }

  /**
   * @description 确认节点已经收到推送任务，并把预留转为带服务端租约的 in_progress。
   * @keyword-cn 确认推送任务, 启动执行租约
   * @keyword-en acknowledge-push-task, start-execution-lease
   */
  async acknowledgeTaskDelivery(input: {
    id: number;
    superClawId: string;
    deliveryId: string;
    leaseExpiresAt: Date;
  }): Promise<TodoEntity | null> {
    const now = new Date();
    return await this.todos.findOneAndUpdate(
      {
        id: input.id,
        status: 'pending',
        taskDeliveryId: input.deliveryId,
        taskDeliverySuperClawId: input.superClawId,
        taskDeliveryAckDeadline: { $gt: now },
      },
      {
        $set: {
          status: 'in_progress',
          taskDeliveryAcknowledgedAt: now,
          taskDeliveryLeaseExpiresAt: input.leaseExpiresAt,
          updatedAt: now,
        },
        // ACK 才代表节点真正开始跑这条任务，重复领取的封顶只按这个计数，
        // 避免 EXECUTOR_BUSY 这类未开工的 NACK 也消耗重试额度。
        $inc: { taskExecutionAttempts: 1 },
        $unset: { taskDeliveryAckDeadline: '' },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 续期已确认任务的服务端执行租约；等待人工介入期间节点仍持有租约。
   * @keyword-cn 续期任务租约, 节点执行心跳
   * @keyword-en renew-task-lease, node-execution-heartbeat
   */
  async renewTaskDeliveryLease(input: {
    id: number;
    superClawId: string;
    deliveryId: string;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const result = await this.todos.updateOne(
      {
        id: input.id,
        status: { $in: ['in_progress', 'waiting_user'] },
        taskDeliveryId: input.deliveryId,
        taskDeliverySuperClawId: input.superClawId,
      },
      {
        $set: {
          taskDeliveryLeaseExpiresAt: input.leaseExpiresAt,
          updatedAt: new Date(),
        },
      },
    );
    return result.modifiedCount > 0;
  }

  /**
   * @description 释放断线、拒绝或超时投递并立即轮换 Token；普通任务退回 pending，
   *   等待人工介入的任务保持 waiting_user，避免尚未处理就被重复投递。
   * @keyword-cn 释放任务租约, 失效旧令牌
   * @keyword-en release-task-lease, invalidate-stale-token
   */
  async releaseTaskDelivery(input: {
    id: number;
    superClawId: string;
    deliveryId: string;
  }): Promise<boolean> {
    const existing = await this.todos.findOne({
      id: input.id,
      status: { $in: ['pending', 'in_progress', 'waiting_user'] },
      taskDeliveryId: input.deliveryId,
      taskDeliverySuperClawId: input.superClawId,
    });
    if (!existing) return false;
    const result = await this.todos.updateOne(
      {
        id: input.id,
        status: existing.status,
        taskDeliveryId: input.deliveryId,
        taskDeliverySuperClawId: input.superClawId,
      },
      {
        $set: {
          status:
            existing.status === 'waiting_user' ? 'waiting_user' : 'pending',
          taskToken: randomUUID().replace(/-/g, ''),
          updatedAt: new Date(),
        },
        $unset: {
          taskDeliveryId: '',
          taskDeliverySuperClawId: '',
          taskDeliveryAckDeadline: '',
          taskDeliveryLeaseExpiresAt: '',
          taskDeliveryAcknowledgedAt: '',
        },
      },
    );
    return result.modifiedCount > 0;
  }

  /**
   * @description 把已经被节点反复领取但始终没写入终态的任务标记为 failed，阻断无限重投与重复启动抓取。
   * @keyword-cn 封顶重复领取, 阻断无限重投
   * @keyword-en cap-repeated-claim, stop-infinite-redelivery
   * @param workspaceIds 参与主动推送的工作区集合。
   * @param maxExecutionAttempts 允许节点开始执行同一任务的最大次数。
   * @returns {Promise<number>} 被判定为耗尽重试的任务数量。
   */
  async failExhaustedTaskDeliveries(
    workspaceIds: string[],
    maxExecutionAttempts: number,
  ): Promise<number> {
    if (!workspaceIds.length || maxExecutionAttempts < 1) return 0;
    const now = new Date();
    const result = await this.todos.updateMany(
      {
        workspaceId: { $in: workspaceIds },
        status: 'pending',
        taskExecutionAttempts: { $gte: maxExecutionAttempts },
      },
      {
        $set: {
          status: 'failed',
          abnormalReason: `SUPER_CLAW_REDELIVERY_EXHAUSTED: 已被节点领取执行 ${maxExecutionAttempts} 次仍未写入终态，平台停止重投。`,
          taskToken: randomUUID().replace(/-/g, ''),
          updatedAt: now,
        },
        $unset: {
          taskDeliveryId: '',
          taskDeliverySuperClawId: '',
          taskDeliveryAckDeadline: '',
          taskDeliveryLeaseExpiresAt: '',
          taskDeliveryAcknowledgedAt: '',
        },
      },
    );
    if (result.modifiedCount > 0) {
      this.logger.warn(
        `[failExhaustedTaskDeliveries] count=${result.modifiedCount} maxExecutionAttempts=${maxExecutionAttempts}`,
      );
    }
    return result.modifiedCount;
  }

  /**
   * @description 回收节点异常退出或服务重启后已经过期的任务租约，并轮换全部旧 Token。
   * @keyword-cn 回收过期租约, 恢复待推送任务
   * @keyword-en reclaim-expired-leases, recover-pending-dispatch
   */
  async requeueExpiredTaskDeliveries(
    tenantIds: string[],
    includePlatform = false,
  ): Promise<number> {
    if (!tenantIds.length && !includePlatform) return 0;
    const now = new Date();
    const tenantScope = [
      ...(tenantIds.length ? [{ tenantId: { $in: tenantIds } }] : []),
      ...(includePlatform
        ? [
            { tenantId: '' },
            { tenantId: { $type: 'null' as const } },
            { tenantId: { $exists: false } },
          ]
        : []),
    ];
    const rows = await this.todos
      .find({
        status: { $in: ['pending', 'in_progress', 'waiting_user'] },
        $and: [
          { $or: tenantScope },
          {
            $or: [
              { taskDeliveryAckDeadline: { $lte: now } },
              { taskDeliveryLeaseExpiresAt: { $lte: now } },
            ],
          },
        ],
      })
      .project<{
        id: number;
        tenantId?: string | null;
        status: TodoEntity['status'];
      }>({ id: 1, tenantId: 1, status: 1 })
      .toArray();
    let reclaimed = 0;
    for (const row of rows) {
      const result = await this.todos.updateOne(
        {
          id: row.id,
          ...(row.tenantId
            ? { tenantId: row.tenantId }
            : {
                $or: [
                  { tenantId: '' },
                  { tenantId: { $type: 'null' as const } },
                  { tenantId: { $exists: false } },
                ],
              }),
          status: row.status,
          $or: [
            { taskDeliveryAckDeadline: { $lte: now } },
            { taskDeliveryLeaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: row.status === 'waiting_user' ? 'waiting_user' : 'pending',
            taskToken: randomUUID().replace(/-/g, ''),
            updatedAt: now,
          },
          $unset: {
            taskDeliveryId: '',
            taskDeliverySuperClawId: '',
            taskDeliveryAckDeadline: '',
            taskDeliveryLeaseExpiresAt: '',
            taskDeliveryAcknowledgedAt: '',
          },
        },
      );
      reclaimed += result.modifiedCount;
    }
    return reclaimed;
  }

  async createItem(input: TodoItemCreateInput): Promise<TodoItemEntity> {
    const parent = await this.todos.findOne({
      id: input.todoId,
      ...this.buildTenantFilter(input.tenantId),
    });
    if (!parent) throw new Error('TODO_NOT_FOUND');

    const now = new Date();
    const id = await this.nextItemId();
    const doc: TodoItemEntity = {
      _id: new ObjectId(),
      id,
      todoId: input.todoId,
      tenantId: parent.tenantId,
      userId: parent.userId,
      title: input.title,
      description: input.description,
      plannedAt: input.plannedAt,
      status: input.status ?? 'pending',
      stage: input.stage,
      doneNote: input.doneNote,
      createdAt: now,
      updatedAt: now,
    };
    await this.todoItems.insertOne(doc);
    return doc;
  }

  async updateItem(input: TodoItemUpdateInput): Promise<TodoItemEntity | null> {
    const now = new Date();
    const upd: Record<string, unknown> = { updatedAt: now };

    // 节点状态变更前日志
    if (input.status !== undefined) {
      const existingItem = await this.todoItems.findOne({
        id: input.id,
        ...this.buildTenantFilter(input.tenantId),
      });
      const prevStatus = existingItem?.status ?? 'unknown';
      if (prevStatus !== input.status) {
        this.logger.log(
          `[updateItem] STATUS CHANGE id=${input.id}: '${prevStatus}' → '${input.status}'`,
        );
      }
    }

    for (const [k, v] of Object.entries(input)) {
      if (k === 'id') continue;
      if (typeof v !== 'undefined') upd[k] = v;
    }
    const res = await this.todoItems.findOneAndUpdate(
      { id: input.id, ...this.buildTenantFilter(input.tenantId) },
      { $set: upd },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  async deleteItem(id: number, tenantId?: string): Promise<boolean> {
    const res = await this.todoItems.deleteOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    return res.deletedCount === 1;
  }

  async getItem(id: number, tenantId?: string): Promise<TodoItemEntity | null> {
    return (
      (await this.todoItems.findOne({
        id,
        ...this.buildTenantFilter(tenantId),
      })) ?? null
    );
  }

  async listItems(
    todoId: number,
    tenantId?: string,
  ): Promise<TodoItemEntity[]> {
    return this.todoItems
      .find(
        { todoId, ...this.buildTenantFilter(tenantId) },
        { projection: { _id: 0 } },
      )
      .sort({ plannedAt: 1, id: 1 })
      .toArray();
  }

  /**
   * @description 返回历史接单人名称列表（去重）
   */
  async listAssignees(tenantId?: string): Promise<string[]> {
    const values = await this.todos.distinct(
      'assignee',
      this.buildTenantFilter(tenantId),
    );
    return values.filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
  }

  /**
   * @description 接单：设置 assignee 并将状态改为 in_progress
   */
  async acceptTask(
    id: number,
    assignee: string,
    tenantId?: string,
  ): Promise<TodoEntity | null> {
    const current = await this.todos.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    if (!current) return null;

    const now = new Date();
    const nextType = this.normalizeTodoType(current.type, assignee);
    const res = await this.todos.findOneAndUpdate(
      { id, ...this.buildTenantFilter(tenantId) },
      {
        $set: {
          assignee,
          type: nextType,
          status: 'in_progress' as const,
          updatedAt: now,
        },
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 统一归一化任务类型：自动执行/线下执行/其他。
   * @param {string} type - 原始类型。
   * @param {string} assignee - 接单人。
   * @returns {string} 归一化类型。
   * @keyword-en normalize todo type
   */
  private normalizeTodoType(type?: string, assignee?: string): string {
    const assigneeText = String(assignee ?? '')
      .trim()
      .toLowerCase();
    const isRobot = assigneeText.startsWith('robot:');
    if (isRobot) return 'auto_execute';

    const t = String(type ?? '')
      .trim()
      .toLowerCase();
    if (!t) return 'other';
    if (['auto_execute', '自动执行', 'auto'].includes(t)) return 'auto_execute';
    if (
      [
        'offline_execute',
        '线下执行',
        'cleaning',
        'security',
        'repair',
        'inspection',
      ].includes(t)
    ) {
      return 'offline_execute';
    }
    if (['long_task', '长时任务', 'long-task', 'longtask'].includes(t))
      return 'long_task';
    if (['other', '其他'].includes(t)) return 'other';
    return 'other';
  }

  /**
   * @description 构造租户过滤条件
   * @keyword-en build tenant filter
   */
  private buildTenantFilter(tenantId?: string | null): Record<string, unknown> {
    if (typeof tenantId === 'undefined' || tenantId === null) return {};
    const value = String(tenantId).trim();
    if (!value) return { tenantId: { $exists: false } };
    return { tenantId: value };
  }
}
