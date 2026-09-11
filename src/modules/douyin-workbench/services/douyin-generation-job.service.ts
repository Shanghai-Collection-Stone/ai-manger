import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  DouyinGenerationJobEntity,
  DouyinGenerationJobKind,
  DouyinGenerationJobProgress,
  DouyinGenerationJobView,
} from '../entities/douyin-workbench.entity.js';
import { DouyinChildTopicGenerationService } from './douyin-child-topic-generation.service.js';
import { DouyinStoryboardGenerationService } from './douyin-storyboard-generation.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 运行中的任务超过这么久没有任何进度写入、且不在当前进程执行集合里，就判定服务中断。
 *   LLM 每写一段分镜或一个子选题都会刷新进度，正常任务不会出现这么长的静默。
 * @keyword-cn 任务中断判定, 静默超时
 * @keyword-en job-interrupted-threshold, silent-timeout
 */
export const DOUYIN_GENERATION_STALE_MS = 10 * 60 * 1000;

/**
 * @description 后台生成失败码与界面可读中文原因的对照表，未知码回退为原始码。
 * @keyword-cn 生成失败原因, 错误码翻译
 * @keyword-en generation-failure-reason, error-code-translate
 */
export const DOUYIN_GENERATION_ERROR_MESSAGES: Record<string, string> = {
  DOUYIN_STORYBOARD_INCOMPLETE: 'AI 没有写够 4 段分镜，请补充要求后重新生成。',
  DOUYIN_CHILD_TOPIC_COUNT_NOT_PLANNED:
    'AI 没有规划子选题数量，本次生成已中止，请重试。',
  DOUYIN_CHILD_TOPIC_NOT_FOUND: '子选题不存在或已被删除。',
  DOUYIN_PARENT_NOT_FOUND: '母选题不存在或已被删除。',
  DOUYIN_CHILD_TOPICS_DUPLICATED: 'AI 生成的子选题有重复，请重试。',
  DOUYIN_GENERATION_INTERRUPTED: '服务端生成任务已中断，请重新生成。',
  CREDIT_EXHAUSTED: 'Credit 点数不足，请充值后再生成。',
};

/**
 * @description 抖音工作台的后台 LLM 生成任务：接口立即返回任务，分镜与子选题在后台生成，
 *   进度（已写入段数 / 子选题数）持久化到 `douyin_generation_jobs` 供前端轮询。
 * @keyword-cn 后台生成任务, 异步生成
 * @keyword-en background-generation-job, async-generation
 */
@Injectable()
export class DouyinGenerationJobService {
  private readonly logger = new Logger(DouyinGenerationJobService.name);
  private readonly jobs: Collection<DouyinGenerationJobEntity>;
  /** 当前进程正在执行的任务 ID，用于识别服务重启遗留的僵尸任务 */
  private readonly activeJobIds = new Set<string>();

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly storyboard: DouyinStoryboardGenerationService,
    private readonly childTopics: DouyinChildTopicGenerationService,
  ) {
    this.jobs = db.collection<DouyinGenerationJobEntity>(
      'douyin_generation_jobs',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 创建任务 ID、作用域时间线与同选题运行态查询索引。
   * @keyword-cn 生成任务索引, 运行态查询
   * @keyword-en generation-job-indexes, running-state-query
   */
  async ensureIndexes(): Promise<void> {
    await this.jobs.createIndex({ id: 1 }, { unique: true });
    await this.jobs.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.jobs.createIndex({ kind: 1, topicId: 1, status: 1 });
  }

  /**
   * @description 校验选题归属与类型，拒绝同一选题重复启动，写入运行中任务后立即返回，生成在后台继续。
   * @keyword-cn 启动后台生成, 重复任务拦截
   * @keyword-en start-background-generation, duplicate-job-guard
   * @param kind 分镜（子选题）或子选题（母选题）。
   * @param topicId 分镜任务传子选题 ID，子选题任务传母选题 ID。
   * @param prompt 可选补充要求。
   * @param scope 当前租户用户作用域。
   * @returns {Promise<DouyinGenerationJobView>} 运行中的任务。
   * @throws {NotFoundException} 选题不存在或类型不对。
   * @throws {ConflictException} DOUYIN_GENERATION_ALREADY_RUNNING。
   */
  async start(
    kind: DouyinGenerationJobKind,
    topicId: number,
    prompt: string | undefined,
    scope: DouyinScope,
  ): Promise<DouyinGenerationJobView> {
    const topic = await this.repository.get(topicId, scope);
    if (kind === 'storyboard' && topic?.kind !== 'child') {
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    }
    if (kind === 'children' && topic?.kind !== 'mother') {
      throw new NotFoundException('DOUYIN_PARENT_NOT_FOUND');
    }
    await this.settleStaleJobs(scope);
    const running = await this.jobs.findOne({
      ...this.scopeFilter(scope),
      kind,
      topicId,
      status: 'running',
    });
    if (running) {
      throw new ConflictException('DOUYIN_GENERATION_ALREADY_RUNNING');
    }
    const now = new Date();
    const job: DouyinGenerationJobEntity = {
      _id: new ObjectId(),
      id: randomUUID(),
      tenantId: scope.tenantId,
      userId: scope.userId,
      kind,
      topicId,
      prompt:
        String(prompt ?? '')
          .trim()
          .slice(0, 1000) || undefined,
      status: 'running',
      progress: { stage: 'preparing', current: 0 },
      startedAt: now,
      updatedAt: now,
    };
    await this.jobs.insertOne(job);
    this.activeJobIds.add(job.id);
    void this.run(job, scope);
    return this.toView(job);
  }

  /**
   * @description 读取当前用户运行中与最近 24 小时结束的生成任务，读取前先收敛服务中断遗留的运行态。
   * @keyword-cn 查询生成任务, 进度轮询
   * @keyword-en list-generation-jobs, progress-polling
   * @param scope 当前租户用户作用域。
   * @returns {Promise<DouyinGenerationJobView[]>} 按开始时间倒序的任务。
   */
  async list(scope: DouyinScope): Promise<DouyinGenerationJobView[]> {
    await this.settleStaleJobs(scope);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.jobs
      .find({
        ...this.scopeFilter(scope),
        $or: [{ status: 'running' }, { updatedAt: { $gte: since } }],
      })
      .sort({ startedAt: -1 })
      .limit(100)
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 在后台执行分镜或子选题生成，进度实时写库；成功写结果，失败写失败码与中文原因。
   * @keyword-cn 执行后台生成, 进度写库
   * @keyword-en run-background-generation, persist-progress
   */
  private async run(
    job: DouyinGenerationJobEntity,
    scope: DouyinScope,
  ): Promise<void> {
    const report = (progress: DouyinGenerationJobProgress) => {
      void this.jobs
        .updateOne(
          { id: job.id, status: 'running' },
          { $set: { progress, updatedAt: new Date() } },
        )
        .catch((error) =>
          this.logger.warn(
            `[run] 写入进度失败 job=${job.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    };
    try {
      let result: DouyinGenerationJobView['result'];
      let progress: DouyinGenerationJobProgress;
      if (job.kind === 'storyboard') {
        const output = await this.storyboard.generate(
          job.topicId,
          job.prompt,
          scope,
          report,
        );
        result = { shotCount: output.storyboard.length };
        progress = { stage: 'saving', current: output.storyboard.length };
      } else {
        const output = await this.childTopics.generate(
          job.topicId,
          { prompt: job.prompt },
          scope,
          report,
        );
        result = {
          decidedCount: output.decidedCount,
          createdTopicIds: output.topics.map((topic) => topic.id),
        };
        progress = {
          stage: 'saving',
          current: output.topics.length,
          total: output.decidedCount,
        };
      }
      const now = new Date();
      await this.jobs.updateOne(
        { id: job.id },
        {
          $set: {
            status: 'done',
            result,
            progress,
            updatedAt: now,
            finishedAt: now,
          },
        },
      );
    } catch (error) {
      const code = (error instanceof Error ? error.message : String(error))
        .trim()
        .slice(0, 300);
      this.logger.warn(
        `[run] 生成失败 job=${job.id} kind=${job.kind}: ${code}`,
      );
      const now = new Date();
      await this.jobs
        .updateOne(
          { id: job.id },
          {
            $set: {
              status: 'failed',
              error: code,
              errorMessage: this.describeError(code),
              updatedAt: now,
              finishedAt: now,
            },
          },
        )
        .catch(() => undefined);
    } finally {
      this.activeJobIds.delete(job.id);
    }
  }

  /**
   * @description 把运行中但不在当前进程、且长时间没有进度写入的任务收进失败终态，避免服务重启后永远显示生成中。
   * @keyword-cn 收敛中断任务, 僵尸任务
   * @keyword-en settle-stale-jobs, zombie-job
   */
  private async settleStaleJobs(scope: DouyinScope): Promise<void> {
    const now = new Date();
    await this.jobs.updateMany(
      {
        ...this.scopeFilter(scope),
        status: 'running',
        id: { $nin: [...this.activeJobIds] },
        updatedAt: {
          $lt: new Date(now.getTime() - DOUYIN_GENERATION_STALE_MS),
        },
      },
      {
        $set: {
          status: 'failed',
          error: 'DOUYIN_GENERATION_INTERRUPTED',
          errorMessage: this.describeError('DOUYIN_GENERATION_INTERRUPTED'),
          updatedAt: now,
          finishedAt: now,
        },
      },
    );
  }

  /**
   * @description 把失败码翻译成中文原因；子选题数量不足的动态码单独处理，未知码回退为原始码。
   * @keyword-cn 生成失败原因, 错误码翻译
   * @keyword-en generation-failure-reason, error-code-translate
   */
  private describeError(code: string): string {
    const incomplete =
      /^DOUYIN_CHILD_TOPIC_GENERATION_INCOMPLETE_(\d+)_OF_(\d+)$/.exec(code);
    if (incomplete) {
      return `AI 规划了 ${incomplete[2]} 个子选题，只写出 ${incomplete[1]} 个，本次未保存，请重试。`;
    }
    return DOUYIN_GENERATION_ERROR_MESSAGES[code] ?? `生成失败：${code}`;
  }

  /**
   * @description 构造与仓储一致的租户用户过滤，母平台只看无 tenantId 的任务。
   * @keyword-cn 任务作用域过滤, 用户隔离
   * @keyword-en job-scope-filter, user-isolation
   */
  private scopeFilter(scope: DouyinScope): Record<string, unknown> {
    return scope.tenantId
      ? { userId: scope.userId, tenantId: scope.tenantId }
      : {
          userId: scope.userId,
          $and: [
            {
              $or: [
                { tenantId: { $exists: false } },
                { tenantId: null },
                { tenantId: '' },
              ],
            },
          ],
        };
  }

  /**
   * @description 去掉数据库字段与原始提示词，生成前端安全的任务视图。
   * @keyword-cn 生成任务视图, 隐藏内部字段
   * @keyword-en generation-job-view, hide-internal-fields
   */
  private toView(row: DouyinGenerationJobEntity): DouyinGenerationJobView {
    return {
      id: row.id,
      kind: row.kind,
      topicId: row.topicId,
      status: row.status,
      progress: row.progress,
      error: row.error,
      errorMessage: row.errorMessage,
      result: row.result,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt,
    };
  }
}
