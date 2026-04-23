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
    await this.todos.createIndex({ category: 1 });
    await this.todos.createIndex({ assignee: 1 });
    await this.todos.createIndex({ taskToken: 1 }, { unique: true, sparse: true });
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
    const existing = await this.todos.findOne({
      id: input.id,
      ...this.buildTenantFilter(input.tenantId),
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
      if (k === 'id') continue;
      if (typeof v !== 'undefined') upd[k] = v;
    }
    const nextAssignee =
      typeof input.assignee !== 'undefined' ? input.assignee : existing.assignee;
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
    const res = await this.todos.findOneAndUpdate(
      { id: input.id, ...this.buildTenantFilter(input.tenantId) },
      { $set: upd },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    const updated = res.value ?? null;

    // 状态变为 done/failed 时异步触发回调
    if (
      updated &&
      (updated.status === 'done' || updated.status === 'failed') &&
      existing.status !== updated.status
    ) {
      this.callbackSvc.processCallbacks(updated as TodoEntity);
    }

    return updated;
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
  async list(userId?: string, tenantId?: string, assignee?: string, category?: string): Promise<TodoEntity[]> {
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
      return this.list(input.userId, input.tenantId, input.assignee, input.category);
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
    const assigneeText = String(assignee ?? '').trim().toLowerCase();
    const isRobot = assigneeText.startsWith('robot:');
    if (isRobot) return 'auto_execute';

    const t = String(type ?? '').trim().toLowerCase();
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
    if (['long_task', '长时任务', 'long-task', 'longtask'].includes(t)) return 'long_task';
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
