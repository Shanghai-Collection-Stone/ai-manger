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
      platform:
        typeof body?.platform === 'string' ? body.platform.trim() : undefined,
      topic: typeof body?.topic === 'string' ? body.topic.trim() : undefined,
      outline:
        body?.outline && typeof body.outline === 'object'
          ? body.outline
          : undefined,
      style:
        body?.style && typeof body.style === 'object' ? body.style : undefined,
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
      provider: body?.provider,
      model: body?.model,
      temperature: body?.temperature,
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
}
