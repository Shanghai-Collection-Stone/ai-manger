import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ArticleGraphService } from '../services/article-graph.service.js';
import { BatchTaskGraphService } from '../services/batch-task-graph.service.js';

@Controller('graph')
export class GraphController {
  constructor(
    private readonly articles: ArticleGraphService,
    private readonly batch: BatchTaskGraphService,
  ) {}

  @Post('articles/generate')
  async generateArticles(
    @Body()
    body: {
      userId?: string;
      tenantId?: string;
      platform?: string;
      topic?: string;
      outline?: Record<string, unknown>;
      style?: Record<string, unknown>;
      count?: number;
      galleryUserId?: string;
      galleryGroupId?: number;
      minImageScore?: number;
      provider?: 'gemini' | 'deepseek';
      model?: string;
      temperature?: number;
    },
  ): Promise<Record<string, unknown>> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');

    const res = await this.articles.generateToCanvas({
      userId,
      tenantId:
        typeof body?.tenantId === 'string' && body.tenantId.trim().length > 0
          ? body.tenantId.trim()
          : undefined,
      platform:
        typeof body?.platform === 'string' ? body.platform.trim() : undefined,
      topic: typeof body?.topic === 'string' ? body.topic.trim() : undefined,
      count: typeof body?.count === 'number' ? body.count : undefined,
      galleryUserId:
        typeof body?.galleryUserId === 'string' &&
        body.galleryUserId.trim().length > 0
          ? body.galleryUserId.trim()
          : undefined,
      galleryGroupId:
        typeof body?.galleryGroupId === 'number' &&
        Number.isFinite(body.galleryGroupId)
          ? body.galleryGroupId
          : undefined,
      minImageScore:
        typeof body?.minImageScore === 'number' &&
        Number.isFinite(body.minImageScore)
          ? body.minImageScore
          : undefined,
      langchainContext: {
        source: 'http.graph.articles.generate',
        userId,
        tenantId:
          typeof body?.tenantId === 'string' && body.tenantId.trim().length > 0
            ? body.tenantId.trim()
            : undefined,
        platform:
          typeof body?.platform === 'string' ? body.platform.trim() : undefined,
        topic: typeof body?.topic === 'string' ? body.topic.trim() : undefined,
      },
    });
    return res;
  }

  @Post('batch/run')
  async runBatch(
    @Body()
    body: {
      userId?: string;
      canvasId?: number;
      platform?: string;
      galleryUserId?: string;
      galleryGroupId?: number;
      plannedAtStart?: string;
      intervalMinutes?: number;
      concurrency?: number;
      callbackUrl?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const canvasId =
      typeof body?.canvasId === 'number' ? body.canvasId : Number.NaN;
    if (!Number.isFinite(canvasId))
      throw new BadRequestException('canvasId is required');

    const res = await this.batch.runFromCanvas({
      userId,
      canvasId,
      platform:
        typeof body?.platform === 'string' ? body.platform.trim() : undefined,
      galleryUserId:
        typeof body?.galleryUserId === 'string' &&
        body.galleryUserId.trim().length > 0
          ? body.galleryUserId.trim()
          : undefined,
      galleryGroupId:
        typeof body?.galleryGroupId === 'number' &&
        Number.isFinite(body.galleryGroupId)
          ? body.galleryGroupId
          : undefined,
      plannedAtStart:
        typeof body?.plannedAtStart === 'string' &&
        body.plannedAtStart.trim().length > 0
          ? body.plannedAtStart.trim()
          : undefined,
      intervalMinutes:
        typeof body?.intervalMinutes === 'number' &&
        Number.isFinite(body.intervalMinutes)
          ? body.intervalMinutes
          : undefined,
      concurrency:
        typeof body?.concurrency === 'number' &&
        Number.isFinite(body.concurrency)
          ? body.concurrency
          : undefined,
      callbackUrl:
        typeof body?.callbackUrl === 'string' &&
        body.callbackUrl.trim().length > 0
          ? body.callbackUrl.trim()
          : undefined,
      payload:
        body?.payload && typeof body.payload === 'object'
          ? body.payload
          : undefined,
    });
    return res;
  }

  /**
   * @description 直接触发“小红书批发工作流”（等价于工具 xhs_batch_publish），用于绕过对话快速联调发布链路。
   * @param {object} body - 请求体参数。
   * @param {string} body.userId - 用户ID。
   * @param {number} body.canvasId - Canvas ID。
   * @param {number} body.taskCount - 批量任务数量（发布多少篇）。
   * @param {string} [body.platform] - 平台名称（仅支持小红书/xhs）。
   * @param {string} [body.galleryUserId] - 图库用户ID（用于补图）。
   * @param {number} [body.galleryGroupId] - 图库分组ID（用于补图）。
   * @param {number} [body.minImageScore] - 相似度阈值（用于补图）。
   * @param {string} [body.plannedAtStart] - 计划开始时间（ISO）。
   * @param {number} [body.intervalMinutes] - 发布间隔分钟数。
   * @param {string} [body.callbackUrl] - MCP 回调地址。
   * @param {Record<string, unknown>} [body.payload] - 额外 payload（合并到每条任务）。
   * @param {boolean} [body.forceNew] - 强制新建任务。
   * @param {'gemini'|'deepseek'} [body.provider] - 模型提供商。
   * @param {string} [body.model] - 模型名称。
   * @param {number} [body.temperature] - 采样温度。
   * @returns {Promise<Record<string, unknown>>} 工作流启动结果。
   * @keyword-en xhs, batch publish, workflow, http
   */
  @Post('xhs/batch/publish')
  async publishXhsBatch(
    @Body()
    body: {
      userId?: string;
      canvasId?: number;
      taskCount?: number;
      platform?: string;
      galleryUserId?: string;
      galleryGroupId?: number;
      minImageScore?: number;
      plannedAtStart?: string;
      intervalMinutes?: number;
      callbackUrl?: string;
      payload?: Record<string, unknown>;
      forceNew?: boolean;
      provider?: 'gemini' | 'deepseek';
      model?: string;
      temperature?: number;
    },
  ): Promise<Record<string, unknown>> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');

    const canvasId =
      typeof body?.canvasId === 'number' ? body.canvasId : Number.NaN;
    if (!Number.isFinite(canvasId))
      throw new BadRequestException('canvasId is required');

    const taskCount =
      typeof body?.taskCount === 'number' ? body.taskCount : Number.NaN;
    if (!Number.isFinite(taskCount) || taskCount <= 0)
      throw new BadRequestException('taskCount is required');

    const res = await this.batch.openAndStartXhsFromCanvas({
      userId,
      canvasId,
      taskCount,
      platform:
        typeof body?.platform === 'string' ? body.platform.trim() : undefined,
      galleryUserId:
        typeof body?.galleryUserId === 'string' &&
        body.galleryUserId.trim().length > 0
          ? body.galleryUserId.trim()
          : undefined,
      galleryGroupId:
        typeof body?.galleryGroupId === 'number' &&
        Number.isFinite(body.galleryGroupId)
          ? body.galleryGroupId
          : undefined,
      minImageScore:
        typeof body?.minImageScore === 'number' &&
        Number.isFinite(body.minImageScore)
          ? body.minImageScore
          : undefined,
      plannedAtStart:
        typeof body?.plannedAtStart === 'string' &&
        body.plannedAtStart.trim().length > 0
          ? body.plannedAtStart.trim()
          : undefined,
      intervalMinutes:
        typeof body?.intervalMinutes === 'number' &&
        Number.isFinite(body.intervalMinutes)
          ? body.intervalMinutes
          : undefined,
      callbackUrl:
        typeof body?.callbackUrl === 'string' &&
        body.callbackUrl.trim().length > 0
          ? body.callbackUrl.trim()
          : undefined,
      payload:
        body?.payload && typeof body.payload === 'object'
          ? body.payload
          : undefined,
      forceNew: body?.forceNew === true ? true : undefined,
      provider: body?.provider,
      model: body?.model,
      temperature: body?.temperature,
    });
    return res;
  }
}
