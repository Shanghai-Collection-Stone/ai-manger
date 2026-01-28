import { Inject, Injectable } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import {
  TodoEntity,
  TodoCreateInput,
  TodoUpdateInput,
} from '../entities/todo.entity.js';

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
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.todos = db.collection<TodoEntity>('todos');
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
    await this.todos.createIndex({ userId: 1 });
    await this.todos.createIndex({ status: 1 });
    const exists = await this.counters.findOne({ _id: 'todos' });
    if (!exists) await this.counters.insertOne({ _id: 'todos', seq: 0 });
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
      userId: input.userId,
      title: input.title,
      description: input.description,
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
      { id: input.id },
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
  async delete(id: number): Promise<boolean> {
    const res = await this.todos.deleteOne({ id });
    return res.deletedCount === 1;
  }

  /**
   * @description 获取待办
   * @param {number} id - 序号ID
   * @returns {Promise<TodoEntity|null>} 实体或空
   * @keyword todo, get
   * @since 2026-01-27
   */
  async get(id: number): Promise<TodoEntity | null> {
    return (await this.todos.findOne({ id })) ?? null;
  }

  /**
   * @description 列出待办（可按用户过滤）
   * @param {string} [userId] - 指定用户
   * @returns {Promise<TodoEntity[]>} 列表
   * @keyword todo, list, user
   * @since 2026-01-27
   */
  async list(userId?: string): Promise<TodoEntity[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    return this.todos
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
  }
}
