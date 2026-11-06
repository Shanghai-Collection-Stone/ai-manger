import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import {
  type DouyinOperationEntity,
  type DouyinStoreVisitPipeline,
  type DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import {
  isStoreVisitSegmentReady,
  isStoreVisitVisualStart,
} from './douyin-store-visit-continuity.js';
import {
  DouyinStoreVisitService,
  matchesStoreVisitRequest,
} from './douyin-store-visit.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description AI 导演流水线巡检间隔：段出完后最多这么久接着提交下一段。
 * @keyword-cn 导演巡检间隔, 流水线轮询
 * @keyword-en director-pipeline-tick, pipeline-poll-interval
 */
export const DOUYIN_STORE_VISIT_PIPELINE_TICK_MS = 10_000;

/**
 * @description 推进认领的租期：认领超过这么久还没释放（进程崩溃等）就允许别人重新认领。
 * @keyword-cn 推进认领租期, 防重复提交
 * @keyword-en advance-claim-lease, duplicate-submit-guard
 */
export const DOUYIN_STORE_VISIT_PIPELINE_CLAIM_MS = 5 * 60_000;

/**
 * @description AI 导演规划最多等这么久；规划卡住超过这个时长就不再等，按现有运镜出片。
 * @keyword-cn 等待导演规划, 规划超时
 * @keyword-en wait-director-planning, planning-timeout
 */
export const DOUYIN_STORE_VISIT_PIPELINE_PLANNING_WAIT_MS = 5 * 60_000;

/**
 * @description 探店 AI 导演流水线：严格一段一段地出片，同一时间只提交一段，轮到哪段才读哪段的最新内容（编辑过的内容天然生效）；
 *   暂停 = 不再提交下一段（在跑的那段跑完为止）；某段失败或编辑时暂停，必须手动继续。同镜头续段、统一音色与自动拼接仍由桌面端完成。
 * @keyword-cn 探店导演流水线, 逐段出片
 * @keyword-en store-visit-director-pipeline, segment-by-segment-generation
 */
@Injectable()
export class DouyinStoreVisitPipelineService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DouyinStoreVisitPipelineService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  /**
   * @description 注入调用集合、选题仓库与探店分段提交服务。
   * @keyword-cn 初始化导演流水线, 流水线依赖
   * @keyword-en init-director-pipeline, pipeline-dependencies
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly storeVisit: DouyinStoreVisitService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动流水线后台巡检，服务重启后在跑的流水线接着推进；多进程时只在 leader 进程上巡检。
   * @keyword-cn 启动导演巡检, 重启续跑
   * @keyword-en start-pipeline-tick, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(
      () => void this.tickOnce(),
      DOUYIN_STORE_VISIT_PIPELINE_TICK_MS,
    );
    this.timer.unref?.();
  }

  /**
   * @description 停止流水线后台巡检。
   * @keyword-cn 停止导演巡检, 模块销毁
   * @keyword-en stop-pipeline-tick, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 开始（或接着）一段一段地出片：`restart` 时先清掉各段出片结果（全部重新生成，要求没有分段在跑）；
   *   各段都已出片且不重来时直接置为完成并打开自动拼接，否则置为生成中并立刻推进一次。
   * @keyword-cn 开始导演出片, 全部重新生成
   * @keyword-en start-director-pipeline, restart-all-segments
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {{voiceAnchor?: boolean, restart?: boolean}} [options] `voiceAnchor` 为真（桌面端能取音频）时以第 1 段的声音统一音色；`restart` 为真时全部重新生成。
   * @returns {Promise<DouyinTopicEntity>} 推进后的脚本（含流水线状态）。
   * @throws {BadRequestException} 还没分段。
   * @throws {ConflictException} 全部重新生成时还有分段在跑。
   */
  async start(
    topicId: number,
    scope: DouyinScope,
    options: { voiceAnchor?: boolean; restart?: boolean } = {},
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    const segments = topic.storeVisit?.segments ?? [];
    if (!segments.length)
      throw new BadRequestException('先在「台词」步骤把台词按场景分好段');
    if (options.restart) {
      if (await this.busyOperation(topicId, scope))
        throw new ConflictException('还有分段在生成，等它跑完再全部重新生成');
      for (const segment of segments)
        await this.repository.updateStoreVisitSegment(
          topicId,
          segment.id,
          null,
          scope,
        );
    } else if (segments.every(isStoreVisitSegmentReady)) {
      await this.finish(topicId, { voiceAnchor: options.voiceAnchor }, scope);
      return await this.requireChild(topicId, scope);
    }
    await this.repository.setStoreVisitPipeline(
      topicId,
      {
        state: 'running',
        pauseReason: undefined,
        error: undefined,
        voiceAnchor: options.voiceAnchor === true,
        currentSegmentId: undefined,
        currentOperationId: undefined,
      },
      scope,
    );
    return await this.advance(topicId, scope);
  }

  /**
   * @description 暂停流水线：只在生成中时生效，不再提交下一段，在跑的那段跑完为止；`editing` 表示用户打开了某段编辑。
   * @keyword-cn 暂停导演出片, 编辑时暂停
   * @keyword-en pause-director-pipeline, pause-while-editing
   * @param {number} topicId 子选题（脚本）ID。
   * @param {'user'|'editing'} reason 暂停原因。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 最新脚本。
   */
  async pause(
    topicId: number,
    reason: 'user' | 'editing',
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    await this.requireChild(topicId, scope);
    await this.repository.setStoreVisitPipeline(
      topicId,
      { state: 'paused', pauseReason: reason, error: undefined },
      scope,
      { 'storeVisit.pipeline.state': 'running' },
    );
    return await this.requireChild(topicId, scope);
  }

  /**
   * @description 手动继续：暂停或已完成（之后又改过段）的流水线回到生成中并立刻推进；清掉失败原因，
   *   当前段的调用已结束时一并忘掉它，免得旧的失败让流水线又停下（这段没出片会按最新内容重新提交）。
   * @keyword-cn 继续导演出片, 失败后重试
   * @keyword-en resume-director-pipeline, retry-after-failure
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 推进后的脚本。
   * @throws {BadRequestException} 流水线还没开始过。
   */
  async resume(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    const pipeline = topic.storeVisit?.pipeline;
    if (!pipeline || pipeline.state === 'idle')
      throw new BadRequestException('导演还没开始生成，请点「开始生成」');
    const current = pipeline.currentOperationId
      ? await this.operations.findOne(
          { id: pipeline.currentOperationId },
          { projection: { status: 1 } },
        )
      : null;
    const finished =
      !current || current.status === 'failed' || current.status === 'completed';
    await this.repository.setStoreVisitPipeline(
      topicId,
      {
        state: 'running',
        pauseReason: undefined,
        error: undefined,
        ...(finished
          ? { currentSegmentId: undefined, currentOperationId: undefined }
          : {}),
      },
      scope,
    );
    return await this.advance(topicId, scope);
  }

  /**
   * @description 重做某段：清掉这段及接它尾帧的同镜头续段的出片结果，变回待生成，由导演按顺序重做（按段扣费）；
   *   流水线已完成时自动回到生成中，生成中时照常推进，暂停时等用户继续。
   * @keyword-cn 导演重做分段, 排进重做
   * @keyword-en redo-pipeline-segment, queue-segment-redo
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} segmentId 分段 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 最新脚本。
   * @throws {BadRequestException} 这一段不存在。
   * @throws {ConflictException} 这段或它的续段还在生成。
   */
  async redo(
    topicId: number,
    segmentId: string,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    const segments = topic.storeVisit?.segments ?? [];
    const start = segments.findIndex((item) => item.id === segmentId);
    if (start < 0)
      throw new BadRequestException('这一段还没保存或已被删除，请先保存台词');
    const picked = [segments[start].id];
    for (
      let index = start + 1;
      index < segments.length && !isStoreVisitVisualStart(segments, index);
      index += 1
    )
      picked.push(segments[index].id);
    if (await this.busyOperation(topicId, scope, picked))
      throw new ConflictException('这段还在生成，等它跑完再重做');
    for (const id of picked)
      await this.repository.updateStoreVisitSegment(topicId, id, null, scope);
    const state = topic.storeVisit?.pipeline?.state;
    if (state === 'done') {
      await this.repository.setStoreVisitPipeline(
        topicId,
        {
          state: 'running',
          pauseReason: undefined,
          error: undefined,
          currentSegmentId: undefined,
          currentOperationId: undefined,
        },
        scope,
      );
    }
    if (state === 'done' || state === 'running')
      return await this.advance(topicId, scope);
    return await this.requireChild(topicId, scope);
  }

  /**
   * @description 推进一步（一次最多提交一段）：原子认领后执行 `step`，结束时释放认领；别人正在推进时直接返回最新脚本。
   * @keyword-cn 推进导演流水线, 原子认领
   * @keyword-en advance-director-pipeline, atomic-claim
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 推进后的脚本。
   */
  async advance(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const claimedAt = new Date();
    const claimed = await this.repository.setStoreVisitPipeline(
      topicId,
      { advancingAt: claimedAt },
      scope,
      {
        'storeVisit.pipeline.state': 'running',
        $or: [
          { 'storeVisit.pipeline.advancingAt': { $exists: false } },
          {
            'storeVisit.pipeline.advancingAt': {
              $lt: new Date(
                claimedAt.getTime() - DOUYIN_STORE_VISIT_PIPELINE_CLAIM_MS,
              ),
            },
          },
        ],
      },
    );
    if (claimed) {
      try {
        await this.step(claimed, scope);
      } finally {
        await this.repository.setStoreVisitPipeline(
          topicId,
          { advancingAt: undefined },
          scope,
          { 'storeVisit.pipeline.advancingAt': claimedAt },
        );
      }
    }
    return await this.requireChild(topicId, scope);
  }

  /**
   * @description 巡检一轮所有生成中的流水线并逐个推进，同一进程内不重入；单条出错只记日志。
   * @keyword-cn 巡检导演流水线, 防重入
   * @keyword-en tick-director-pipelines, reentry-guard
   */
  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const topics = await this.repository.listRunningStoreVisitPipelines();
      for (const topic of topics) {
        await this.advance(topic.id, {
          tenantId: topic.tenantId,
          userId: topic.userId,
        }).catch((error) =>
          this.logger.warn(
            `[tickOnce] 导演流水线推进失败 topic=${topic.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * @description 流水线的一步：不是生成中不动；导演还在规划、或有分段在排队 / 等续段 / 生成 / 保存时等；
   *   当前段按原内容生成失败（或出片了却没绑定上）→ 暂停并记下原因；否则提交第一个没出片的段，全部出完 → 完成并打开自动拼接。
   *   当前段在生成期间被改过而作废的不算失败，按最新内容重新提交。
   * @keyword-cn 导演推进一步, 失败转暂停
   * @keyword-en pipeline-step, pause-on-failure
   * @param {DouyinTopicEntity} topic 已认领的脚本。
   * @param {DouyinScope} scope 租户用户作用域。
   */
  private async step(
    topic: DouyinTopicEntity,
    scope: DouyinScope,
  ): Promise<void> {
    const pipeline = topic.storeVisit?.pipeline;
    if (pipeline?.state !== 'running') return;
    const direction = topic.videoDirection;
    if (
      direction?.status === 'planning' &&
      Date.now() - new Date(direction.updatedAt).getTime() <
        DOUYIN_STORE_VISIT_PIPELINE_PLANNING_WAIT_MS
    )
      return;
    if (await this.busyOperation(topic.id, scope)) return;
    const segments = topic.storeVisit?.segments ?? [];
    if (pipeline.currentOperationId) {
      const current = await this.operations.findOne({
        id: pipeline.currentOperationId,
      });
      const segment = segments.find((item) => item.id === current?.segmentId);
      const sameContent =
        Boolean(current && segment) &&
        matchesStoreVisitRequest(topic, segment, current?.request ?? {});
      if (
        sameContent &&
        (current?.status === 'failed' ||
          (current?.status === 'completed' &&
            !isStoreVisitSegmentReady(segment)))
      ) {
        await this.repository.setStoreVisitPipeline(
          topic.id,
          {
            state: 'paused',
            pauseReason: 'failed',
            error:
              current?.error ||
              (current?.status === 'failed'
                ? '这段生成失败'
                : '这段出片了但没绑定到分段'),
          },
          scope,
        );
        return;
      }
    }
    const next = segments.find((segment) => !isStoreVisitSegmentReady(segment));
    if (!next) {
      await this.finish(topic.id, {}, scope);
      return;
    }
    try {
      const view = await this.storeVisit.startSingle(topic.id, next.id, scope, {
        voiceAnchor: pipeline.voiceAnchor,
      });
      await this.repository.setStoreVisitPipeline(
        topic.id,
        { currentSegmentId: next.id, currentOperationId: view.id },
        scope,
      );
    } catch (error) {
      await this.repository.setStoreVisitPipeline(
        topic.id,
        {
          state: 'paused',
          pauseReason: 'failed',
          error: error instanceof Error ? error.message : String(error),
          currentSegmentId: next.id,
          currentOperationId: undefined,
        },
        scope,
      );
    }
  }

  /**
   * @description 各段都已出片：流水线置为完成并打开自动拼接（桌面端拼成片）。
   * @keyword-cn 导演出片完成, 自动拼接
   * @keyword-en finish-director-pipeline, auto-concat
   * @param {number} topicId 子选题（脚本）ID。
   * @param {Partial<DouyinStoreVisitPipeline>} patch 额外要写的流水线字段。
   * @param {DouyinScope} scope 租户用户作用域。
   */
  private async finish(
    topicId: number,
    patch: Partial<DouyinStoreVisitPipeline>,
    scope: DouyinScope,
  ): Promise<void> {
    await this.repository.setStoreVisitPipeline(
      topicId,
      {
        ...patch,
        state: 'done',
        pauseReason: undefined,
        error: undefined,
        currentSegmentId: undefined,
        currentOperationId: undefined,
      },
      scope,
    );
    await this.repository.update(topicId, { autoConcatShots: true }, scope);
  }

  /**
   * @description 查这条脚本当前用户有没有在排队、等续段、生成或保存中的探店分段调用；给了 `segmentIds` 时只看这些段。
   * @keyword-cn 在跑分段检查, 流水线等待
   * @keyword-en busy-segment-check, pipeline-wait
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {string[]} [segmentIds] 只看这些分段。
   * @returns {Promise<boolean>} 有在跑的调用时为真。
   */
  private async busyOperation(
    topicId: number,
    scope: DouyinScope,
    segmentIds?: string[],
  ): Promise<boolean> {
    const row = await this.operations.findOne(
      {
        topicId,
        provider: { $in: ['shuyan', 'opensource-video'] },
        mode: 'store-visit',
        status: { $in: ['queued', 'running', 'saving'] },
        userId: scope.userId,
        ...(segmentIds ? { segmentId: { $in: segmentIds } } : {}),
      },
      { projection: { id: 1 } },
    );
    return Boolean(row);
  }

  /**
   * @description 读子选题，不存在或不是子选题时报错。
   * @keyword-cn 读取探店脚本, 子选题校验
   * @keyword-en require-child-topic, child-topic-check
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 脚本。
   * @throws {BadRequestException} 选题不存在。
   */
  private async requireChild(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }
}
