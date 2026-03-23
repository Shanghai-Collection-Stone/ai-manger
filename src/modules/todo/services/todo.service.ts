import { Inject, Injectable } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
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

/**
 * @description 待办服务，提供序号ID的CRUD，并保证AI字段完整
 * @param {Db} db - 注入的主数据库连接（DS_MONGO_DB）
 * @returns {void}
 * @keyword todo, service, mongo
 * @since 2026-01-27
 */
@Injectable()
export class TodoService {
  private readonly todos: Collection<TodoEntity>;
  private readonly todoItems: Collection<TodoItemEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
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
    await this.todos.createIndex({ assignee: 1 });
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
    const doc: TodoEntity = {
      _id: new ObjectId(),
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title,
      description: input.description,
      type: input.type,
      assignee: input.assignee,
      aiConsideration: input.aiConsideration,
      decisionReason: input.decisionReason,
      aiPlan: input.aiPlan,
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
    const now = new Date();
    const upd: Record<string, unknown> = { updatedAt: now };
    for (const [k, v] of Object.entries(input)) {
      if (k === 'id') continue;
      if (typeof v !== 'undefined') upd[k] = v;
    }
    const res = await this.todos.findOneAndUpdate(
      { id: input.id, ...this.buildTenantFilter(input.tenantId) },
      { $set: upd },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
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
  async list(userId?: string, tenantId?: string, assignee?: string): Promise<TodoEntity[]> {
    const filter: Record<string, unknown> = this.buildTenantFilter(tenantId);
    if (userId) filter.userId = userId;
    if (assignee) filter.assignee = assignee;
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
  }): Promise<TodoEntity[]> {
    if (input.canViewAll) {
      return this.list(input.userId, input.tenantId, input.assignee);
    }
    const filter: Record<string, unknown> = {
      ...this.buildTenantFilter(input.tenantId),
      $or: [],
    };
    const orList = filter.$or as Record<string, unknown>[];
    if (input.userId) orList.push({ userId: input.userId });
    if (input.assignee) orList.push({ assignee: input.assignee });
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
    const now = new Date();
    const res = await this.todos.findOneAndUpdate(
      { id, ...this.buildTenantFilter(tenantId) },
      { $set: { assignee, status: 'in_progress' as const, updatedAt: now } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 构造租户过滤条件
   * @keyword-en build tenant filter
   */
  private buildTenantFilter(tenantId?: string): Record<string, unknown> {
    if (typeof tenantId === 'undefined') return {};
    const value = tenantId.trim();
    if (!value) return { tenantId: { $exists: false } };
    return { tenantId: value };
  }
}
