import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { McpAdaptersService } from '../../function-call/mcp/services/mcp-adapter.service.js';
import { TodoService } from '../../todo/services/todo.service.js';
import type {
  BatchTaskAddPostsInput,
  BatchTaskCallbackInput,
  BatchTaskCreateInput,
  BatchTaskEntity,
  BatchTaskGraphJobClaim,
  BatchTaskGraphJobInputXhs,
  BatchTaskPostEntity,
  BatchTaskRunInput,
} from '../entities/batch-task.entity.js';

@Injectable()
export class BatchTaskService {
  private readonly tasks: Collection<BatchTaskEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly todo: TodoService,
    private readonly mcp: McpAdaptersService,
  ) {
    this.tasks = db.collection<BatchTaskEntity>('batch_tasks');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 截断标题到 MCP 侧限制（最多 20 个字符单位，按 code point 处理）。
   * @param {string} title - 原始标题。
   * @returns {string} 截断后的标题。
   * @keyword-en title, truncate, xhs
   */
  private normalizeMcpTitle(title: string): string {
    const s = String(title ?? '').trim();
    if (!s) return s;
    return Array.from(s).slice(0, 20).join('');
  }

  /**
   * @description 将本地静态资源相对路径转换为可访问的绝对 URL（用于 MCP 拉取图片）。
   * @param {string} input - 图片路径或 URL。
   * @returns {string} 绝对 URL 或原值。
   * @keyword-en static, url, resolve, assets
   */
  private resolvePublicAssetUrl(input: string): string {
    const s = String(input ?? '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (!s.startsWith('/')) return s;

    const baseCandidates = [
      process.env.APP_PUBLIC_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.APP_URL,
      process.env.BASE_URL,
    ]
      .map((x) => String(x ?? '').trim())
      .filter((x) => x.length > 0);

    const portRaw = String(process.env.PORT ?? '').trim();
    const portNum = portRaw.length > 0 ? Number(portRaw) : undefined;
    const port =
      typeof portNum === 'number' && Number.isFinite(portNum) && portNum > 0
        ? portNum
        : 3011;

    const base = baseCandidates[0] ?? `http://localhost:${port}`;
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${b}${s}`;
  }

  /**
   * @description 从本地 payload 组装 MCP 的 BatchPost（参考 open-md/mcp.md）。
   * @param {object} input - 组装输入。
   * @param {string} input.title - 标题。
   * @param {string} [input.scheduleAt] - RFC3339/ISO8601 定时发布时间。
   * @param {Record<string, unknown>} [input.payload] - 生成阶段产生的 payload。
   * @returns {Record<string, unknown>} MCP post 对象（title/content/images/tags/location/schedule_at）。
   * @throws {Error} 当缺少 content/images 等必填字段时抛出。
   * @keyword-en mcp, batch post, build, validate
   */
  private buildMcpPost(input: {
    title: string;
    scheduleAt?: string;
    payload?: Record<string, unknown>;
  }): Record<string, unknown> {
    const payload =
      input.payload && typeof input.payload === 'object' ? input.payload : {};

    const contentRaw = payload['content'];
    const content =
      typeof contentRaw === 'string'
        ? contentRaw.trim()
        : contentRaw && typeof contentRaw === 'object'
          ? JSON.stringify(contentRaw)
          : '';
    if (!content) throw new Error('MCP_POST_MISSING_CONTENT');

    const imagesRaw =
      payload['images'] ?? payload['imageUrls'] ?? payload['image_urls'];
    const images = Array.isArray(imagesRaw)
      ? (imagesRaw as unknown[])
          .map((x) =>
            typeof x === 'string' ? this.resolvePublicAssetUrl(x.trim()) : '',
          )
          .filter((x) => x.length > 0)
          .slice(0, 18)
      : [];
    if (images.length === 0) throw new Error('MCP_POST_MISSING_IMAGES');

    const tagsRaw = payload['tags'];
    const tags = Array.isArray(tagsRaw)
      ? (tagsRaw as unknown[])
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, 20)
      : undefined;

    const locationRaw = payload['location'];
    const location =
      typeof locationRaw === 'string' && locationRaw.trim().length > 0
        ? locationRaw.trim()
        : undefined;

    let scheduleAt =
      typeof input.scheduleAt === 'string' && input.scheduleAt.trim().length > 0
        ? input.scheduleAt.trim()
        : undefined;
    if (typeof scheduleAt === 'string') {
      const ms = new Date(scheduleAt).getTime();
      const now = Date.now();
      if (!Number.isFinite(ms)) scheduleAt = undefined;
      else if (ms < now + 60 * 60_000) scheduleAt = undefined;
      else if (ms > now + 14 * 24 * 60 * 60_000) scheduleAt = undefined;
    }

    const post: Record<string, unknown> = {
      title: this.normalizeMcpTitle(input.title),
      content,
      images,
    };
    if (Array.isArray(tags) && tags.length > 0) post['tags'] = tags;
    if (typeof location === 'string') post['location'] = location;
    if (typeof scheduleAt === 'string') post['schedule_at'] = scheduleAt;
    return post;
  }

  /**
   * @description 创建 batch_tasks 所需索引，并初始化自增计数器。
   * @returns {Promise<void>} 无返回值。
   * @throws {Error} 当MongoDB创建索引或写入计数器失败时抛出。
   * @keyword batch-task, mongo, index
   * @since 2026-02-04
   */
  async ensureIndexes(): Promise<void> {
    await this.tasks.createIndex({ id: 1 }, { unique: true });
    await this.tasks.createIndex({ userId: 1 });
    await this.tasks.createIndex({ status: 1 });
    await this.tasks.createIndex({ mcpTaskId: 1 });
    await this.tasks.createIndex({ userId: 1, canvasId: 1, updatedAt: -1 });
    // 队列认领索引：与 claimNextGraphJob 的 query + sort 逐字对齐，
    // partialFilterExpression 只收录 queued 文档，索引体积与队列长度同阶。
    await this.tasks.createIndex(
      {
        'graphJob.status': 1,
        'graphJob.input.kind': 1,
        'graphJob.enqueuedAt': 1,
        updatedAt: 1,
      },
      {
        name: 'graphJob_claim_queued',
        partialFilterExpression: { 'graphJob.status': 'queued' },
      },
    );
    // 旧索引覆盖不了 kind 过滤与 enqueuedAt 排序，会退化成 FETCH + 内存 SORT，移除。
    for (const stale of [
      'graphJob.status_1_updatedAt_-1',
      'graphJob.input.kind_1_updatedAt_-1',
    ]) {
      try {
        await this.tasks.dropIndex(stale);
      } catch {
        // 索引不存在时忽略
      }
    }
    // 租户隔离索引
    await this.tasks.createIndex({ tenantId: 1, userId: 1 });
    const exists = await this.counters.findOne({ _id: 'batch_tasks' });
    if (!exists) await this.counters.insertOne({ _id: 'batch_tasks', seq: 0 });
  }

  /**
   * @description 构建租户过滤条件
   * @param {string | undefined} tenantId - 租户ID
   * @returns {Record<string, unknown>} MongoDB filter 对象
   * @keyword-en build tenant filter
   * @since 2026-03-24
   */
  private buildTenantFilter(tenantId?: string): Record<string, unknown> {
    const currentTenantId = tenantId?.trim();
    if (!currentTenantId) {
      return {
        $or: [
          { tenantId: { $exists: false } },
          { tenantId: null },
          { tenantId: '' },
        ],
      };
    }
    return { tenantId: currentTenantId };
  }

  /**
   * @description 获取批量任务自增ID。
   * @returns {Promise<number>} 下一个可用的自增ID。
   * @throws {Error} 当计数器更新失败时抛出。
   * @keyword batch-task, counter, id
   * @since 2026-02-04
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'batch_tasks' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 创建批量任务，并创建待办总览（todoId）用于待办池联动追踪。
   * @param {BatchTaskCreateInput} input - 创建参数（userId/platform/topic/canvasId/mcpTaskId）。
   * @returns {Promise<BatchTaskEntity>} 新建的批量任务实体。
   * @throws {Error} 当待办创建或数据库写入失败时抛出。
   * @keyword batch-task, create, todo-linkage
   * @since 2026-02-04
   */
  async create(input: BatchTaskCreateInput): Promise<BatchTaskEntity> {
    const now = new Date();
    const id = await this.nextId();

    const titleParts = [
      input.platform ? `批量发布任务：${input.platform}` : '批量发布任务',
      input.topic ? input.topic : undefined,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    const todoTitle = titleParts.join('/');
    const descParts: string[] = [`${todoTitle}，任务编号 #${id}。`];
    if (input.canvasId) descParts.push(`画布：${input.canvasId}`);
    if (input.topic) descParts.push(`主题：${input.topic}`);
    descParts.push('状态：等待执行');
    const todoDescription = descParts.join('  ');

    const providedTodoIdRaw = input.todoId;
    const providedTodoId =
      typeof providedTodoIdRaw === 'number' &&
      Number.isFinite(providedTodoIdRaw)
        ? Math.floor(providedTodoIdRaw)
        : undefined;
    let todoId: number | undefined;
    if (typeof providedTodoId === 'number' && providedTodoId > 0) {
      const existed = await this.todo.get(providedTodoId);
      if (!existed) throw new BadRequestException('TODO_NOT_FOUND');
      todoId = providedTodoId;
    } else {
      const todo = await this.todo.create({
        userId: input.userId,
        tenantId: input.tenantId,
        title: todoTitle,
        description: todoDescription,
        type: 'auto_execute',
        aiConsideration: 'Auto created by batch task linkage',
        decisionReason: 'Create overview todo for batch publishing tracking',
        aiPlan: 'Track each release as a todo item with status and done note',
      });
      todoId = todo.id;
    }

    const doc: BatchTaskEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      tenantId: input.tenantId,
      platform: input.platform,
      topic: input.topic,
      canvasId: input.canvasId,
      mcpTaskId: input.mcpTaskId,
      todoId,
      status: 'pending',
      posts: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.tasks.insertOne(doc);
    return doc;
  }

  /**
   * @description 根据自增ID获取批量任务（租户隔离）。
   * @param {number} id - 批量任务ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<BatchTaskEntity | null>} 任务实体，不存在时返回 null。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword batch-task, get, mongo
   * @since 2026-02-04
   */
  async get(id: number, tenantId?: string): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne(
      { id, ...this.buildTenantFilter(tenantId) },
      { projection: { _id: 0 } },
    );
    return (doc as BatchTaskEntity | null) ?? null;
  }

  /**
   * @description 列出批量任务，支持按 userId 过滤（租户隔离）。
   * @param {string} [userId] - 用户ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<BatchTaskEntity[]>} 任务列表，按 updatedAt 倒序。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword batch-task, list, user-filter
   * @since 2026-02-04
   */
  async list(userId?: string, tenantId?: string): Promise<BatchTaskEntity[]> {
    const filter = this.buildTenantFilter(tenantId);
    if (userId) filter.userId = userId;
    return this.tasks
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  /**
   * @description 查找同一用户在同一 Canvas 上最近的“活跃批量任务”（pending/in_progress）。
   * @param {string} userId - 用户ID。
   * @param {string} canvasId - Canvas ID（与任务存储一致的字符串）。
   * @param {number} [freshWithinMs] - 仅返回在该时间窗口内更新过的任务。
   * @returns {Promise<BatchTaskEntity | null>} 最近活跃任务或 null。
   * @keyword batch-task, idempotency, dedupe
   * @since 2026-02-05
   */
  async findLatestActiveByUserCanvas(
    userId: string,
    canvasId: string,
    freshWithinMs: number = 10 * 60_000,
  ): Promise<BatchTaskEntity | null> {
    const now = Date.now();
    const after = new Date(now - Math.max(0, Math.floor(freshWithinMs)));
    const doc = await this.tasks
      .find(
        {
          userId,
          canvasId,
          status: { $in: ['pending', 'in_progress'] },
          updatedAt: { $gte: after },
        },
        { projection: { _id: 0 } },
      )
      .sort({ updatedAt: -1 })
      .limit(1)
      .next();
    return (doc as BatchTaskEntity | null) ?? null;
  }

  /**
   * @description 为批量任务创建/绑定 MCP 侧任务ID（若尚未打开）。
   * @param {number} id - 批量任务ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<BatchTaskEntity | null>} 更新后的任务实体，不存在时返回 null。
   * @throws {Error} 当 MCP 调用或数据库写入失败时抛出。
   * @keyword batch-task, mcp, open
   * @keyword-en batch-task, mcp, open
   * @since 2026-02-04
   */
  async openMcpTask(
    id: number,
    tenantId?: string,
  ): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    if (!doc) return null;
    if (doc.mcpTaskId && doc.mcpTaskId.length > 0)
      return await this.get(id, tenantId);

    // batch_task_open 工具不接受任何参数，只返回任务ID
    console.log('[openMcpTask] Calling batch_task_open with empty input');

    try {
      const res = await this.mcp.invokeTool('batch_task_open', {});
      console.log('[openMcpTask] batch_task_open response:', res);

      const mcpTaskId =
        (res as Record<string, unknown>)?.['mcpTaskId'] ??
        (res as Record<string, unknown>)?.['taskId'] ??
        (res as Record<string, unknown>)?.['task_id'] ??
        (res as Record<string, unknown>)?.['id'];

      console.log(
        '[openMcpTask] Extracted mcpTaskId:',
        mcpTaskId,
        'type:',
        typeof mcpTaskId,
      );

      const next = await this.tasks.findOneAndUpdate(
        { id },
        {
          $set: {
            mcpTaskId: typeof mcpTaskId === 'string' ? mcpTaskId : undefined,
            status: 'pending',
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after', includeResultMetadata: true },
      );
      console.log(
        '[openMcpTask] Updated task mcpTaskId:',
        next.value?.mcpTaskId,
      );
      return (next.value as BatchTaskEntity | null) ?? null;
    } catch (err) {
      console.error('[openMcpTask] batch_task_open failed:', err);
      throw err;
    }
  }

  /**
   * @description 并行追加发布条目：先创建待办清单条目，再并行调用 MCP 入队。
   * @param {number} id - 批量任务ID。
   * @param {BatchTaskAddPostsInput} input - 发布条目列表与并发度。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<BatchTaskEntity | null>} 更新后的任务实体，不存在时返回 null。
   * @throws {Error} 当任务未绑定 todoId 或未打开 MCP 任务时抛出。
   * @keyword batch-task, parallel, todo-items
   * @keyword-en batch-task, parallel, todo-items
   * @example
   * // 并行入队 10 条发布，最大并发 6
   * await batchTaskService.addPostsParallel(1, {
   *   concurrency: 6,
   *   posts: [{ title: 'post-1', plannedAt: '2026-02-04T00:00:00.000Z' }],
   * });
   * @since 2026-02-04
   */
  async addPostsParallel(
    id: number,
    input: BatchTaskAddPostsInput,
    tenantId?: string,
  ): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    if (!doc) return null;
    if (!doc.todoId) throw new Error('BATCH_TASK_TODO_NOT_FOUND');
    if (!doc.mcpTaskId) throw new Error('BATCH_TASK_MCP_NOT_OPENED');

    const now = new Date();
    const startIndex = (doc.posts?.length ?? 0) + 1;
    const concurrency =
      typeof input.concurrency === 'number' && input.concurrency > 0
        ? Math.min(20, Math.floor(input.concurrency))
        : 6;

    const drafts = input.posts.map((p, idx) => {
      const plannedAt = p.plannedAt ? new Date(p.plannedAt) : undefined;
      const postId = startIndex + idx;
      return { postId, title: p.title, plannedAt, payload: p.payload };
    });

    const todoItemsRes = await this.runPool(
      drafts,
      concurrency,
      async (p): Promise<{ postId: number; todoItemId: number }> => {
        const item = await this.todo.createItem({
          todoId: doc.todoId as number,
          title: p.title,
          plannedAt: p.plannedAt,
          status: 'pending',
          stage: '未开始',
        });
        return { postId: p.postId, todoItemId: item.id };
      },
    );

    const todoItems = todoItemsRes
      .filter(
        (x): x is { ok: true; value: { postId: number; todoItemId: number } } =>
          x.ok,
      )
      .map((x) => x.value);

    const todoItemByPostId = new Map<number, number>();
    for (const m of todoItems) todoItemByPostId.set(m.postId, m.todoItemId);

    const postEntities: BatchTaskPostEntity[] = drafts.map((p) => ({
      id: p.postId,
      title: p.title,
      plannedAt: p.plannedAt,
      todoItemId: todoItemByPostId.get(p.postId),
      payload: p.payload,
      status: 'pending',
      stage: '未开始',
    }));

    await this.tasks.updateOne(
      { id },
      {
        $push: { posts: { $each: postEntities } },
        $set: { updatedAt: now },
      },
    );

    const addResultsRes = await this.runPool(
      postEntities,
      concurrency,
      async (p): Promise<{ postId: number; res: unknown }> => {
        const res = await this.retry(async () => {
          const scheduleAt = p.plannedAt
            ? p.plannedAt.toISOString()
            : undefined;
          const post = this.buildMcpPost({
            title: p.title,
            scheduleAt,
            payload: p.payload ?? {},
          });
          return await this.mcp.invokeTool('batch_task_add_post', {
            task_id: doc.mcpTaskId,
            post,
          });
        });
        return { postId: p.id, res };
      },
      async (p, e) => {
        const msg = e instanceof Error ? e.message : String(e);
        const todoItemId = p.todoItemId;
        if (typeof todoItemId === 'number') {
          await this.todo.updateItem({
            id: todoItemId,
            status: 'failed',
            doneNote: msg,
          });
        }
        await this.tasks.updateOne(
          { id, 'posts.id': p.id },
          {
            $set: {
              'posts.$.status': 'failed',
              'posts.$.doneNote': msg,
              updatedAt: new Date(),
            },
          },
        );
      },
    );

    const addResults = addResultsRes
      .filter(
        (x): x is { ok: true; value: { postId: number; res: unknown } } => x.ok,
      )
      .map((x) => x.value);

    if (addResults.length === 0) {
      await this.tasks.updateOne(
        { id },
        { $set: { status: 'failed', updatedAt: new Date() } },
      );
      await this.updateTodoSummary({
        batchTaskId: id,
        status: 'failed',
        description: 'NO_MCP_POSTS_ENQUEUED',
      });
      throw new Error('BATCH_TASK_HAS_NO_POSTS');
    }

    for (const r of addResults) {
      const any = (r.res as Record<string, unknown>) ?? {};
      const mcpPostId =
        (any['mcpPostId'] as string) ||
        (any['postId'] as string) ||
        (any['id'] as string) ||
        undefined;
      await this.tasks.updateOne(
        { id, 'posts.id': r.postId },
        {
          $set: {
            'posts.$.mcpPostId': mcpPostId,
            updatedAt: new Date(),
          },
        },
      );
    }

    return await this.get(id, tenantId);
  }

  async initPosts(
    id: number,
    input: BatchTaskAddPostsInput,
  ): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne({ id });
    if (!doc) return null;
    if (!doc.todoId) throw new Error('BATCH_TASK_TODO_NOT_FOUND');

    const now = new Date();
    const startIndex = (doc.posts?.length ?? 0) + 1;
    const concurrency =
      typeof input.concurrency === 'number' && input.concurrency > 0
        ? Math.min(20, Math.floor(input.concurrency))
        : 6;

    const drafts = input.posts.map((p, idx) => {
      const plannedAt = p.plannedAt ? new Date(p.plannedAt) : undefined;
      const postId = startIndex + idx;
      return { postId, title: p.title, plannedAt, payload: p.payload };
    });

    const todoItemsRes = await this.runPool(
      drafts,
      concurrency,
      async (p): Promise<{ postId: number; todoItemId: number }> => {
        const item = await this.todo.createItem({
          todoId: doc.todoId as number,
          title: p.title,
          plannedAt: p.plannedAt,
          status: 'pending',
          stage: '未开始',
        });
        return { postId: p.postId, todoItemId: item.id };
      },
    );

    const todoItems = todoItemsRes
      .filter(
        (x): x is { ok: true; value: { postId: number; todoItemId: number } } =>
          x.ok,
      )
      .map((x) => x.value);

    const todoItemByPostId = new Map<number, number>();
    for (const m of todoItems) todoItemByPostId.set(m.postId, m.todoItemId);

    const postEntities: BatchTaskPostEntity[] = drafts.map((p) => ({
      id: p.postId,
      title: p.title,
      plannedAt: p.plannedAt,
      todoItemId: todoItemByPostId.get(p.postId),
      payload: p.payload,
      status: 'pending',
      stage: '未开始',
    }));

    await this.tasks.updateOne(
      { id },
      {
        $push: { posts: { $each: postEntities } },
        $set: { updatedAt: now },
      },
    );

    return await this.get(id);
  }

  async updatePostProgress(input: {
    batchTaskId: number;
    postId: number;
    status?: BatchTaskPostEntity['status'];
    stage?: string;
    doneNote?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const task = await this.tasks.findOne({ id: input.batchTaskId });
    if (!task) throw new Error('BATCH_TASK_NOT_FOUND');
    const post = (task.posts ?? []).find((p) => p.id === input.postId);
    const todoItemId = post?.todoItemId;

    const normalizedStage =
      typeof input.stage === 'string'
        ? input.stage
        : input.status === 'pending'
          ? '未开始'
          : input.status === 'done'
            ? '完成'
            : undefined;

    if (typeof todoItemId === 'number') {
      await this.todo.updateItem({
        id: todoItemId,
        status: input.status,
        stage: normalizedStage,
        doneNote: input.doneNote,
      });
    }

    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.status === 'string') upd['posts.$.status'] = input.status;
    if (typeof normalizedStage === 'string')
      upd['posts.$.stage'] = normalizedStage;
    if (typeof input.doneNote === 'string')
      upd['posts.$.doneNote'] = input.doneNote;
    if (input.payload && typeof input.payload === 'object')
      upd['posts.$.payload'] = input.payload;

    await this.tasks.updateOne(
      { id: input.batchTaskId, 'posts.id': input.postId },
      { $set: upd },
    );
  }

  /**
   * @description 更新单条发布的计划时间，并同步待办条目的 plannedAt。
   * @param {object} input - 输入参数。
   * @param {number} input.batchTaskId - 本地批量任务ID。
   * @param {number} input.postId - 本地条目ID。
   * @param {string} input.plannedAt - ISO8601/RFC3339 时间字符串。
   * @returns {Promise<void>} 无返回值。
   * @keyword-en batch-task, plannedAt, schedule, todo
   */
  async updatePostPlannedAt(input: {
    batchTaskId: number;
    postId: number;
    plannedAt: string;
  }): Promise<void> {
    const d = new Date(input.plannedAt);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return;

    const task = await this.tasks.findOne({ id: input.batchTaskId });
    if (!task) throw new Error('BATCH_TASK_NOT_FOUND');
    const post = (task.posts ?? []).find((p) => p.id === input.postId);
    if (!post) throw new Error('BATCH_TASK_POST_NOT_FOUND');

    if (typeof post.todoItemId === 'number') {
      await this.todo.updateItem({ id: post.todoItemId, plannedAt: d });
    }

    await this.tasks.updateOne(
      { id: input.batchTaskId, 'posts.id': input.postId },
      { $set: { 'posts.$.plannedAt': d, updatedAt: new Date() } },
    );
  }

  /**
   * @description 将单条内容组装为 MCP post 并入队到 batch_task_add_post。
   * @param {object} input - 入队参数。
   * @param {number} input.batchTaskId - 本地批量任务ID。
   * @param {number} input.postId - 本地条目ID。
   * @param {string} [input.title] - 覆盖标题。
   * @param {string} [input.plannedAt] - RFC3339/ISO8601 定时发布时间。
   * @param {Record<string, unknown>} [input.payload] - 内容与图片等 payload。
   * @param {(e: unknown) => Promise<void>} [onError] - 失败回调。
   * @returns {Promise<{ ok: boolean; mcpPostId?: string; raw?: unknown }>} 入队结果。
   * @keyword-en batch-task, enqueue, mcp, batch_task_add_post
   */
  async enqueuePost(
    input: {
      batchTaskId: number;
      postId: number;
      title?: string;
      plannedAt?: string;
      payload?: Record<string, unknown>;
    },
    onError?: (e: unknown) => Promise<void>,
  ): Promise<{ ok: boolean; mcpPostId?: string; raw?: unknown }> {
    const task = await this.tasks.findOne({ id: input.batchTaskId });
    if (!task) throw new Error('BATCH_TASK_NOT_FOUND');
    if (!task.mcpTaskId) throw new Error('BATCH_TASK_MCP_NOT_OPENED');

    const post = (task.posts ?? []).find((p) => p.id === input.postId);
    if (!post) throw new Error('BATCH_TASK_POST_NOT_FOUND');

    const title =
      typeof input.title === 'string' && input.title.trim().length > 0
        ? input.title.trim()
        : post.title;
    const plannedAt =
      typeof input.plannedAt === 'string' && input.plannedAt.trim().length > 0
        ? input.plannedAt.trim()
        : post.plannedAt
          ? post.plannedAt.toISOString()
          : undefined;

    try {
      const res = await this.retry(async () => {
        const postObj = this.buildMcpPost({
          title,
          scheduleAt: plannedAt,
          payload: input.payload ?? post.payload ?? {},
        });
        return await this.mcp.invokeTool('batch_task_add_post', {
          task_id: task.mcpTaskId,
          post: postObj,
        });
      });

      const any = (res as Record<string, unknown>) ?? {};
      const mcpPostId =
        (any['mcpPostId'] as string) ||
        (any['postId'] as string) ||
        (any['id'] as string) ||
        undefined;

      await this.tasks.updateOne(
        { id: task.id, 'posts.id': input.postId },
        {
          $set: {
            'posts.$.mcpPostId': mcpPostId,
            'posts.$.payload': input.payload ?? post.payload,
            'posts.$.status': 'in_progress',
            'posts.$.stage': '文章已完成生成',
            updatedAt: new Date(),
          },
        },
      );

      if (typeof post.todoItemId === 'number') {
        await this.todo.updateItem({
          id: post.todoItemId,
          status: 'in_progress',
          stage: '文章已完成生成',
        });
      }

      return { ok: true, mcpPostId, raw: res };
    } catch (e) {
      if (onError) await onError(e);
      const msg = e instanceof Error ? e.message : String(e);
      await this.updatePostProgress({
        batchTaskId: task.id,
        postId: input.postId,
        status: 'failed',
        stage: '生成失败',
        doneNote: msg,
      });
      return { ok: false, raw: { error: msg } };
    }
  }

  async updateTodoSummary(input: {
    batchTaskId: number;
    title?: string;
    description?: string;
    status?: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  }): Promise<void> {
    const task = await this.tasks.findOne({ id: input.batchTaskId });
    if (!task) throw new Error('BATCH_TASK_NOT_FOUND');
    const todoId = task.todoId;
    if (typeof todoId !== 'number') return;
    await this.todo.update({
      id: todoId,
      title: input.title,
      description: input.description,
      status: input.status,
    });
  }

  /**
   * @description 将批量任务标记为失败，并同步待办总览状态。
   * @param {number} batchTaskId - 本地批量任务ID。
   * @param {string} reason - 失败原因（短码/简述）。
   * @returns {Promise<void>} 无返回值。
   * @keyword-en batch-task, fail, status
   */
  async markFailed(batchTaskId: number, reason: string): Promise<void> {
    await this.tasks.updateOne(
      { id: batchTaskId },
      { $set: { status: 'failed', updatedAt: new Date() } },
    );
    await this.updateTodoSummary({
      batchTaskId,
      status: 'failed',
      description: reason,
    });
  }

  async enqueueGraphJob(batchTaskId: number, input: BatchTaskGraphJobInputXhs) {
    const now = new Date();
    await this.tasks.updateOne(
      { id: batchTaskId },
      {
        $set: {
          graphJob: {
            status: 'queued',
            input,
            attempts: 0,
            enqueuedAt: now,
          },
          updatedAt: now,
        },
      },
    );
  }

  /**
   * @description 原子认领一条 queued 状态的 graph 队列任务，只回传 worker 需要的字段。
   * @param {BatchTaskGraphJobInputXhs['kind']} kind - 队列类型。
   * @returns {Promise<BatchTaskGraphJobClaim | null>} 认领到的精简任务，无队列任务时为 null。
   * @throws {Error} 当MongoDB写入失败时抛出。
   * @keyword-cn 队列认领, 原子更新, 投影
   * @keyword-en claim-graph-job, atomic-claim, projection
   * @since 2026-09-03
   */
  async claimNextGraphJob(
    kind: BatchTaskGraphJobInputXhs['kind'],
  ): Promise<BatchTaskGraphJobClaim | null> {
    const now = new Date();
    const res = await this.tasks.findOneAndUpdate(
      {
        'graphJob.status': 'queued',
        'graphJob.input.kind': kind,
      },
      {
        $set: {
          'graphJob.status': 'running',
          'graphJob.startedAt': now,
          'graphJob.error': undefined,
          updatedAt: now,
        },
        $inc: { 'graphJob.attempts': 1 },
      },
      {
        // 与 graphJob_claim_queued 索引键序一致，避免内存 SORT。
        sort: { 'graphJob.enqueuedAt': 1, updatedAt: 1 },
        returnDocument: 'after',
        includeResultMetadata: true,
        // 绝不回传 posts[]：单条 batch_task 的 posts.result 可达数十 MB，
        // 每秒轮询整文档会把 Node 堆和 WiredTiger cache 一起顶爆。
        projection: {
          _id: 0,
          id: 1,
          userId: 1,
          mcpTaskId: 1,
          'graphJob.status': 1,
          'graphJob.input': 1,
          'graphJob.attempts': 1,
        },
      },
    );
    return (res.value as BatchTaskGraphJobClaim | null) ?? null;
  }

  async markGraphJobDone(batchTaskId: number): Promise<void> {
    const now = new Date();
    await this.tasks.updateOne(
      { id: batchTaskId },
      {
        $set: {
          'graphJob.status': 'done',
          'graphJob.finishedAt': now,
          updatedAt: now,
        },
      },
    );
  }

  async markGraphJobFailed(batchTaskId: number, error: string): Promise<void> {
    const now = new Date();
    await this.tasks.updateOne(
      { id: batchTaskId },
      {
        $set: {
          'graphJob.status': 'failed',
          'graphJob.error': String(error ?? ''),
          'graphJob.finishedAt': now,
          updatedAt: now,
        },
      },
    );
  }

  /**
   * @description 触发 MCP 批量任务运行（异步），并将本地状态标记为 in_progress。
   * @param {number} id - 批量任务ID。
   * @param {BatchTaskRunInput} input - 运行参数（callbackUrl 与 payload）。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<BatchTaskEntity | null>} 更新后的任务实体，不存在时返回 null。
   * @throws {Error} 当任务未打开 MCP 任务时抛出。
   * @keyword batch-task, run, mcp
   * @keyword-en batch-task, run, mcp
   * @since 2026-02-04
   */
  async run(
    id: number,
    input: BatchTaskRunInput,
    tenantId?: string,
  ): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    if (!doc) return null;
    if (!doc.mcpTaskId) throw new Error('BATCH_TASK_MCP_NOT_OPENED');

    const callbackUrl =
      typeof input.callbackUrl === 'string' &&
      input.callbackUrl.trim().length > 0
        ? input.callbackUrl.trim()
        : undefined;
    const toolName = 'batch_task_run';

    const cfg = input.payload ?? {};

    const pickInt = (k1: string, k2?: string) => {
      const v =
        (k1 in cfg ? cfg[k1] : undefined) ??
        (k2 && k2 in cfg ? cfg[k2] : undefined);
      return typeof v === 'number' && Number.isFinite(v)
        ? Math.floor(v)
        : undefined;
    };

    const minDelayMs = pickInt('min_delay_ms', 'minDelayMs');
    const maxDelayMs = pickInt('max_delay_ms', 'maxDelayMs');
    const maxAccounts = pickInt('max_accounts', 'maxAccounts');
    const itemTimeoutMs = pickInt('item_timeout_ms', 'itemTimeoutMs');

    const toolInput: Record<string, unknown> = { task_id: doc.mcpTaskId };
    if (typeof callbackUrl === 'string')
      toolInput['callback_url'] = callbackUrl;
    if (typeof minDelayMs === 'number')
      toolInput['min_delay_ms'] = Math.max(0, minDelayMs);
    if (typeof maxDelayMs === 'number')
      toolInput['max_delay_ms'] = Math.max(0, maxDelayMs);
    if (typeof maxAccounts === 'number')
      toolInput['max_accounts'] = Math.max(1, maxAccounts);
    if (typeof itemTimeoutMs === 'number')
      toolInput['item_timeout_ms'] = Math.max(0, itemTimeoutMs);

    try {
      await this.mcp.invokeTool(toolName, toolInput);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.tasks.updateOne(
        { id },
        { $set: { status: 'failed', updatedAt: new Date() } },
      );
      await this.updateTodoSummary({ batchTaskId: id, status: 'failed' });
      throw new Error(`BATCH_TASK_RUN_FAILED:${msg}`);
    }

    await this.tasks.updateOne(
      { id },
      { $set: { status: 'in_progress', updatedAt: new Date() } },
    );
    await this.updateTodoSummary({ batchTaskId: id, status: 'in_progress' });
    return await this.get(id, tenantId);
  }

  async runSync(
    id: number,
    input: BatchTaskRunInput,
  ): Promise<BatchTaskEntity | null> {
    const doc = await this.tasks.findOne({ id });
    if (!doc) return null;
    if (!doc.mcpTaskId) throw new Error('BATCH_TASK_MCP_NOT_OPENED');

    const callbackUrl =
      typeof input.callbackUrl === 'string' &&
      input.callbackUrl.trim().length > 0
        ? input.callbackUrl.trim()
        : undefined;
    const toolName = 'batch_task_run_sync';

    const cfg = input.payload ?? {};

    const pickInt = (k1: string, k2?: string) => {
      const v =
        (k1 in cfg ? cfg[k1] : undefined) ??
        (k2 && k2 in cfg ? cfg[k2] : undefined);
      return typeof v === 'number' && Number.isFinite(v)
        ? Math.floor(v)
        : undefined;
    };

    const minDelayMs = pickInt('min_delay_ms', 'minDelayMs');
    const maxDelayMs = pickInt('max_delay_ms', 'maxDelayMs');
    const maxAccounts = pickInt('max_accounts', 'maxAccounts');
    const itemTimeoutMs = pickInt('item_timeout_ms', 'itemTimeoutMs');

    const toolInput: Record<string, unknown> = { task_id: doc.mcpTaskId };
    if (typeof callbackUrl === 'string')
      toolInput['callback_url'] = callbackUrl;
    if (typeof minDelayMs === 'number')
      toolInput['min_delay_ms'] = Math.max(0, minDelayMs);
    if (typeof maxDelayMs === 'number')
      toolInput['max_delay_ms'] = Math.max(0, maxDelayMs);
    if (typeof maxAccounts === 'number')
      toolInput['max_accounts'] = Math.max(1, maxAccounts);
    if (typeof itemTimeoutMs === 'number')
      toolInput['item_timeout_ms'] = Math.max(0, itemTimeoutMs);

    await this.tasks.updateOne(
      { id },
      { $set: { status: 'in_progress', updatedAt: new Date() } },
    );
    await this.updateTodoSummary({ batchTaskId: id, status: 'in_progress' });

    try {
      await this.mcp.invokeTool(toolName, toolInput);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.tasks.updateOne(
        { id },
        { $set: { status: 'failed', updatedAt: new Date() } },
      );
      await this.updateTodoSummary({ batchTaskId: id, status: 'failed' });
      throw new Error(`BATCH_TASK_RUN_SYNC_FAILED:${msg}`);
    }

    await this.tasks.updateOne(
      { id },
      { $set: { status: 'done', updatedAt: new Date() } },
    );
    await this.updateTodoSummary({ batchTaskId: id, status: 'done' });
    return await this.get(id);
  }

  /**
   * @description 处理 MCP 回调：更新每条发布状态，并同步到待办清单条目。
   * @param {BatchTaskCallbackInput} input - 回调输入（mcpTaskId/status/posts）。
   * @returns {Promise<{ ok: boolean }>} 处理结果。
   * @throws {Error} 当缺少任务ID或无法匹配到本地任务时抛出。
   * @keyword batch-task, callback, status-sync
   * @since 2026-02-04
   */
  async handleCallback(
    input: BatchTaskCallbackInput,
  ): Promise<{ ok: boolean }> {
    const mcpTaskId =
      input.mcpTaskId ??
      (typeof input.taskId === 'string' ? input.taskId : undefined);
    if (!mcpTaskId) throw new Error('CALLBACK_MISSING_TASK_ID');

    const task = await this.tasks.findOne({ mcpTaskId });
    if (!task) throw new Error('BATCH_TASK_NOT_FOUND');

    const updates = input.posts ?? [];
    for (const u of updates) {
      const status = u.status;
      const stage =
        typeof u.stage === 'string'
          ? u.stage
          : status === 'pending'
            ? '未开始'
            : status === 'done'
              ? '完成'
              : undefined;
      const doneNote = u.doneNote;
      const result = u.result;

      let filter: Record<string, unknown> | null = null;
      if (typeof u.postId === 'number') {
        filter = { id: task.id, 'posts.id': u.postId };
      } else if (typeof u.mcpPostId === 'string') {
        filter = { id: task.id, 'posts.mcpPostId': u.mcpPostId };
      }
      if (!filter) continue;

      const post = task.posts.find((p) => {
        if (typeof u.postId === 'number') return p.id === u.postId;
        if (typeof u.mcpPostId === 'string') return p.mcpPostId === u.mcpPostId;
        return false;
      });
      const todoItemId = post?.todoItemId;

      if (typeof todoItemId === 'number') {
        await this.todo.updateItem({
          id: todoItemId,
          status: status,
          stage: stage,
          doneNote: doneNote,
        });
      }

      const upd: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof status === 'string') upd['posts.$.status'] = status;
      if (typeof stage === 'string') upd['posts.$.stage'] = stage;
      if (typeof doneNote === 'string') upd['posts.$.doneNote'] = doneNote;
      if (typeof result !== 'undefined') upd['posts.$.result'] = result;

      await this.tasks.updateOne(filter, { $set: upd });
    }

    if (typeof input.status === 'string') {
      await this.tasks.updateOne(
        { id: task.id },
        { $set: { status: input.status, updatedAt: new Date() } },
      );
    }

    return { ok: true };
  }

  /**
   * @description 延迟指定毫秒数。
   * @param {number} ms - 延迟毫秒。
   * @returns {Promise<void>} 无返回值。
   * @keyword batch-task, delay, async
   * @since 2026-02-04
   */
  private async delay(ms: number): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  /**
   * @description 对异步操作进行指数退避重试。
   * @template T
   * @param {() => Promise<T>} fn - 待执行的异步函数。
   * @returns {Promise<T>} 成功时返回 fn 的结果。
   * @throws {Error} 当重试次数耗尽仍失败时抛出最后一次错误。
   * @keyword batch-task, retry, backoff
   * @since 2026-02-04
   */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    const max = 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const base = 300;
        const jitter = Math.floor(Math.random() * 200);
        const wait = base * Math.pow(2, attempt) + jitter;
        await this.delay(wait);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * @description 以固定并发执行任务池，收集每项执行结果并可在失败时回调。
   * @template T
   * @template R
   * @param {T[]} items - 待处理的元素列表。
   * @param {number} concurrency - 最大并发数。
   * @param {(item: T) => Promise<R>} worker - 单项处理函数。
   * @param {(item: T, error: unknown) => Promise<void>} [onError] - 单项失败处理回调。
   * @returns {Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>>} 执行结果集合。
   * @keyword batch-task, pool, concurrency
   * @since 2026-02-04
   */
  private async runPool<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
    onError?: (item: T, error: unknown) => Promise<void>,
  ): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
    const out: Array<{ ok: true; value: R } | { ok: false; error: string }> =
      [];
    let idx = 0;
    const runners = new Array(Math.min(concurrency, items.length))
      .fill(0)
      .map(async () => {
        while (idx < items.length) {
          const cur = items[idx++];
          try {
            const r = await worker(cur);
            out.push({ ok: true, value: r });
          } catch (e) {
            if (onError) await onError(cur, e);
            out.push({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      });
    await Promise.all(runners);
    return out;
  }
}
