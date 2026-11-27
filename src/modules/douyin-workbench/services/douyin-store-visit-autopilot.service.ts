import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Collection, Db } from 'mongodb';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import type { StartDouyinAutopilotDto } from '../controller/douyin-workbench.dto.js';
import type {
  DouyinAutopilotRepairAction,
  DouyinGenerationJobEntity,
  DouyinOperationEntity,
  DouyinStoreVisitAutopilot,
  DouyinStoreVisitSegment,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { DouyinChildTopicGenerationService } from './douyin-child-topic-generation.service.js';
import { COSYVOICE_PRESET_VOICES } from './douyin-cosyvoice.service.js';
import { DOUYIN_GENERATION_ERROR_MESSAGES } from './douyin-generation-job.service.js';
import {
  isStoreVisitSegmentReady,
  storeVisitStart,
} from './douyin-store-visit-continuity.js';
import { DouyinStoreVisitPipelineService } from './douyin-store-visit-pipeline.service.js';
import {
  DouyinStoreVisitPlannerService,
  pickPersonaPresetVoice,
} from './douyin-store-visit-planner.service.js';
import { storeVisitSegmentHasMaterial } from './douyin-store-visit-rules.js';
import { DouyinStoreVisitSpotService } from './douyin-store-visit-spot.service.js';
import {
  DouyinWorkbenchAgentService,
  personaFaceReference,
} from './douyin-workbench-agent.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type Scope = { tenantId?: string; userId: string };

/** @description Agent 托管巡检间隔，每次只推进一项尚未完成的业务操作。 @keyword-cn 托管巡检间隔, 逐步推进 @keyword-en autopilot-tick-interval, stepwise-advance */
export const DOUYIN_AUTOPILOT_TICK_MS = 3000;
/** @description 认领在无心跳两分钟后失效，允许崩溃进程的任务被重新认领。 @keyword-cn 托管认领租期, 崩溃恢复 @keyword-en autopilot-claim-lease, crash-recovery */
export const DOUYIN_AUTOPILOT_CLAIM_MS = 120000;

/** @description 为当前脚本与人物音色生成自检标识，内容或设定变化后重新检查。 @keyword-cn 托管脚本指纹, 自检去重 @keyword-en autopilot-script-key, review-deduplication */
export function autopilotScriptKey(topic: DouyinTopicEntity): string {
  const setting = topic.storeVisit || {};
  return createHash('sha256')
    .update(
      JSON.stringify([
        setting.script,
        topic.personaId,
        topic.scriptStyle,
        setting.voiceId,
        setting.voicePrompt,
        setting.template,
        setting.storeId,
      ]),
    )
    .digest('hex');
}

/** @description 同一位置自动修复的总上限：不同类错误不占重试次数，这里只防止错误不断变化时无限消耗。 @keyword-cn 单段修复总上限, 防无限修复 @keyword-en max-repairs-per-position, repair-loop-guard */
export const DOUYIN_AUTOPILOT_MAX_REPAIRS_PER_POSITION = 5;

/** @description 生成失败位置标识：配音和出片按分段区分，其余步骤按步骤区分，同一位置的同类错误只自动修复一次。 @keyword-cn 托管失败位置, 单次修复标识 @keyword-en autopilot-repair-key, single-repair-mark */
export function autopilotRepairKey(
  stage: DouyinStoreVisitAutopilot['stage'],
  segmentId?: string | null,
): string {
  return stage === 'voice' || stage === 'make'
    ? `make:${segmentId || ''}`
    : stage;
}

/** @description 列出这一步允许 AI 选的修复动作，出片阶段不能选会清掉已成功分段的整条重写。 @keyword-cn 托管可选修复, 修复范围限制 @keyword-en autopilot-repair-actions, repair-scope-limit */
export function autopilotRepairActions(
  stage: DouyinStoreVisitAutopilot['stage'],
  hasSegment: boolean,
): DouyinAutopilotRepairAction[] {
  if (stage === 'script') return ['retry', 'rewrite-script', 'ask-user'];
  if (stage === 'lines')
    return ['retry', 'regenerate-lines', 'rewrite-script', 'ask-user'];
  if (stage === 'picture') return ['retry', 'replace-picture', 'ask-user'];
  return hasSegment
    ? ['retry', 'rewrite-segment', 'replace-picture', 'ask-user']
    : ['retry', 'ask-user'];
}

/**
 * @description 持久化全流程 Agent 托管，失败时由 AI 判定修复方式并自动修复一次，再失败停下等用户，断点续跑并复用已完成结果与原子认领。
 * @keyword-cn Agent全流程托管, 断点续跑
 * @keyword-en agent-workflow-autopilot, resumable-workflow
 */
@Injectable()
export class DouyinStoreVisitAutopilotService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DouyinStoreVisitAutopilotService.name);
  private readonly topics: Collection<DouyinTopicEntity>;
  private readonly operations: Collection<DouyinOperationEntity>;
  private readonly jobs: Collection<DouyinGenerationJobEntity>;
  private timer?: NodeJS.Timeout;
  private readonly advancing = new Set<number>();

  /** @description 注入持久化集合和现有工作台 AI 编排，生成结果沿用各业务服务保存。 @keyword-cn 初始化Agent托管, 托管依赖 @keyword-en init-agent-autopilot, autopilot-dependencies */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly agent: DouyinWorkbenchAgentService,
    private readonly planner: DouyinStoreVisitPlannerService,
    private readonly scripts: DouyinChildTopicGenerationService,
    private readonly spots: DouyinStoreVisitSpotService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly pipeline: DouyinStoreVisitPipelineService,
  ) {
    this.topics = db.collection<DouyinTopicEntity>('douyin_topics');
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
    this.jobs = db.collection<DouyinGenerationJobEntity>(
      'douyin_generation_jobs',
    );
  }

  /** @description 仅在 leader 启动巡检，已保存的运行任务在服务重启后继续。 @keyword-cn 启动托管巡检, 服务重启续跑 @keyword-en start-autopilot-patrol, resume-autopilot-after-restart */
  onModuleInit(): void {
    if (isLeaderProcess()) {
      this.timer = setInterval(
        () => void this.tickOnce(),
        DOUYIN_AUTOPILOT_TICK_MS,
      );
      this.timer.unref?.();
    }
  }
  /** @description 停止当前进程的托管巡检。 @keyword-cn 停止托管巡检, 托管模块销毁 @keyword-en stop-autopilot-patrol, autopilot-module-destroy */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** @description 启动或继续指定目标的托管，同目标复用进度并防重，切换目标时创建新任务并独立恢复。 @keyword-cn 启动Agent托管, 托管重复保护 @keyword-en start-agent-autopilot, autopilot-duplicate-guard */
  async start(
    topicId: number,
    input: StartDouyinAutopilotDto,
    scope: Scope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireTopic(topicId, scope);
    const previous = topic.storeVisit?.autopilot;
    const previousGoal = previous?.goal ?? 'video';
    const goal =
      input.goal ?? (previous?.state === 'done' ? 'video' : previousGoal);
    const sameGoal = goal === previousGoal;
    // 自动恢复只能认领弹窗对应的失败，其他窗口的暂停或新失败优先。
    if (
      input.recoverFailureId &&
      (!sameGoal ||
        previous?.state !== 'waiting' ||
        previous.failureId !== input.recoverFailureId)
    )
      return topic;
    if (previous?.state === 'running') {
      if (sameGoal) return topic;
      throw new ConflictException('请先暂停当前任务，再切换制作目标');
    }
    if (goal === 'draft' && topic.storeVisit?.pipeline?.state === 'running')
      throw new ConflictException('请先暂停出片，再补齐草稿');
    const resume =
      previous &&
      previous.state !== 'done' &&
      sameGoal &&
      (goal === 'video' || !['voice', 'make'].includes(previous.stage));
    const blocked =
      resume && previous.state === 'paused' ? previous.blocked : undefined;
    const failure =
      resume && previous.state === 'waiting'
        ? {
            reason: previous.message,
            stage: previous.stage,
            segmentId:
              goal === 'video'
                ? topic.storeVisit?.pipeline?.currentSegmentId
                : undefined,
          }
        : blocked
          ? {
              reason: blocked.reason,
              stage: blocked.stage,
              segmentId: blocked.segmentId,
            }
          : undefined;
    const edited =
      Boolean(blocked?.segmentId) &&
      topic.storeVisit?.segments?.find(
        (segment) => segment.id === blocked?.segmentId,
      )?.lines !== blocked?.lines;
    const now = new Date();
    const state: DouyinStoreVisitAutopilot = {
      ...(resume ? previous : {}),
      runId: resume ? previous.runId : randomUUID(),
      state: 'running',
      stage: resume ? previous.stage : 'script',
      message:
        goal === 'draft'
          ? 'AI 正在检查草稿内容'
          : 'Agent 正在检查已有设定与制作进度',
      pictureSource:
        input.pictureSource || (resume && previous.pictureSource) || 'gallery',
      goal,
      voiceAnchor: input.voiceAnchor ?? (resume ? previous.voiceAnchor : false),
      scriptPrompt: input.scriptPrompt || undefined,
      linesPrompt: input.linesPrompt || undefined,
      reviewKey: previous?.reviewKey,
      mergeRequested: false,
      mergeAfter: now,
      resumePipeline:
        goal === 'video' && topic.storeVisit?.pipeline?.state === 'paused',
      recovery:
        failure && !edited
          ? { ...failure, pending: true }
          : resume && !blocked
            ? previous.recovery
            : undefined,
      // 倒计时自动恢复沿用已修记录；用户亲自点继续才给新的一次自动修复
      repairs: input.recoverFailureId ? (previous?.repairs ?? []) : [],
      videoBaseline: resume
        ? previous.videoBaseline
        : topic.generatedVideoId || 0,
      startedAt: resume ? previous.startedAt : now,
      updatedAt: now,
    };
    delete state.blocked;
    await this.topics.updateOne(
      {
        _id: topic._id,
        'storeVisit.autopilot.state': previous?.state || { $exists: false },
        ...(previous?.runId
          ? { 'storeVisit.autopilot.runId': previous.runId }
          : {}),
        ...(input.recoverFailureId
          ? { 'storeVisit.autopilot.failureId': input.recoverFailureId }
          : {}),
      },
      { $set: { 'storeVisit.autopilot': state, updatedAt: now } },
    );
    const latest = await this.requireTopic(topicId, scope);
    if ((latest.storeVisit?.autopilot?.goal ?? 'video') !== goal)
      throw new ConflictException('制作任务已切换，请刷新后重试');
    void this.advance(topicId, scope).catch((error) =>
      this.logger.warn(String(error)),
    );
    return latest;
  }

  /** @description 暂停当前托管，保留已经提交的操作，出片托管同时暂停导演。 @keyword-cn 暂停Agent托管, 保留完成结果 @keyword-en pause-agent-autopilot, preserve-completed-results */
  async pause(topicId: number, scope: Scope): Promise<DouyinTopicEntity> {
    const topic = await this.requireTopic(topicId, scope);
    await this.topics.updateOne(
      {
        _id: topic._id,
        'storeVisit.autopilot.state': { $in: ['running', 'waiting'] },
      },
      {
        $set: {
          'storeVisit.autopilot.state': 'paused',
          'storeVisit.autopilot.message':
            '已暂停，当前操作结束后不会继续下一步',
          'storeVisit.autopilot.updatedAt': new Date(),
        },
      },
    );
    if (
      topic.storeVisit?.autopilot?.goal !== 'draft' &&
      topic.storeVisit?.pipeline?.state === 'running'
    )
      await this.pipeline.pause(topicId, 'user', scope);
    return this.requireTopic(topicId, scope);
  }

  /** @description 巡检运行中的任务，按任务所属租户用户推进，单个慢任务不阻塞其他脚本。 @keyword-cn 巡检Agent任务, 托管用户隔离 @keyword-en patrol-agent-tasks, autopilot-user-isolation */
  async tickOnce(): Promise<void> {
    try {
      const rows = await this.topics
        .find({ kind: 'child', 'storeVisit.autopilot.state': 'running' })
        .toArray();
      for (const topic of rows)
        if (!this.advancing.has(topic.id))
          void this.advance(topic.id, {
            tenantId: topic.tenantId,
            userId: topic.userId,
          }).catch((error) => this.logger.warn(String(error)));
    } catch (error) {
      this.logger.warn(`Agent 巡检失败：${String(error)}`);
    }
  }

  /** @description 原子认领一步并续心跳，成功或失败均释放；跨进程重复认领不执行 AI 调用。 @keyword-cn 原子推进Agent, 托管心跳 @keyword-en advance-agent-atomically, autopilot-heartbeat */
  async advance(topicId: number, scope: Scope): Promise<void> {
    if (this.advancing.has(topicId)) return;
    this.advancing.add(topicId);
    let heartbeat: NodeJS.Timeout | undefined;
    const claimId = randomUUID();
    let claimed: DouyinTopicEntity | null = null;
    try {
      const topic = await this.requireTopic(topicId, scope);
      if (topic.storeVisit?.autopilot?.state !== 'running') return;
      claimed = await this.topics.findOneAndUpdate(
        {
          _id: topic._id,
          'storeVisit.autopilot.state': 'running',
          $or: [
            { 'storeVisit.autopilot.advancingAt': { $exists: false } },
            {
              'storeVisit.autopilot.advancingAt': {
                $lt: new Date(Date.now() - DOUYIN_AUTOPILOT_CLAIM_MS),
              },
            },
          ],
        },
        {
          $set: {
            'storeVisit.autopilot.claimId': claimId,
            'storeVisit.autopilot.advancingAt': new Date(),
          },
        },
        { returnDocument: 'after' },
      );
      if (!claimed) return;
      heartbeat = setInterval(() => {
        void this.topics
          .updateOne(
            { _id: claimed!._id, 'storeVisit.autopilot.claimId': claimId },
            { $set: { 'storeVisit.autopilot.advancingAt': new Date() } },
          )
          .catch((error) => this.logger.warn(String(error)));
      }, 15000);
      heartbeat.unref?.();
      await this.runStep(claimed, scope);
    } catch (error) {
      if (claimed) {
        const message = error instanceof Error ? error.message : String(error);
        await this.patch(claimed, {
          state: 'waiting',
          message:
            DOUYIN_GENERATION_ERROR_MESSAGES[message] ||
            message ||
            '这一步未完成，Agent 会自动重试',
        });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (claimed)
        await this.topics
          .updateOne(
            { _id: claimed._id, 'storeVisit.autopilot.claimId': claimId },
            {
              $unset: {
                'storeVisit.autopilot.claimId': '',
                'storeVisit.autopilot.advancingAt': '',
              },
            },
          )
          .catch((error) => this.logger.warn(String(error)));
      this.advancing.delete(topicId);
    }
  }

  /** @description 校验脚本归属和统一制作流程，所有手动与后台入口共用。 @keyword-cn 校验托管脚本, 托管作用域 @keyword-en require-autopilot-topic, autopilot-scope */
  private async requireTopic(
    topicId: number,
    scope: Scope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('没有这个脚本');
    if (topic.productionMode !== 'store-visit')
      throw new BadRequestException('请先将脚本打开为统一制作流程');
    return topic;
  }

  /** @description 判断这次失败算不算重复：同位置修复达到总上限或原因完全相同直接算，其余交给 AI 判断是否同类。 @keyword-cn 判断重复失败, 同类错误计次 @keyword-en detect-repeated-failure, same-error-count */
  private async isRepeatedFailure(
    topic: DouyinTopicEntity,
    stage: DouyinStoreVisitAutopilot['stage'],
    history: Array<{ key: string; reason: string }>,
    reason: string,
  ): Promise<boolean> {
    if (history.length >= DOUYIN_AUTOPILOT_MAX_REPAIRS_PER_POSITION)
      return true;
    if (history.some((item) => item.reason === reason)) return true;
    return await this.planner.isSameAutopilotFailure(
      topic,
      { stage, previous: history.map((item) => item.reason), current: reason },
      { tenantId: topic.tenantId, userId: topic.userId },
    );
  }

  /** @description 停下托管等用户处理，记录失败位置和台词快照，用户点继续托管才重新开始。 @keyword-cn 托管停下等用户, 记录停止原因 @keyword-en stop-for-user, record-block-reason */
  private async stopForUser(
    topic: DouyinTopicEntity,
    recovery: NonNullable<DouyinStoreVisitAutopilot['recovery']>,
    message: string,
  ): Promise<void> {
    await this.patch(topic, {
      state: 'paused',
      stage: recovery.stage,
      recovery: { ...recovery, pending: false },
      blocked: {
        reason: recovery.reason,
        stage: recovery.stage,
        ...(recovery.segmentId ? { segmentId: recovery.segmentId } : {}),
        ...this.blockedLines(topic, recovery.segmentId),
      },
      message,
    });
  }

  /** @description 只更新本轮仍在运行的任务，暂停或换轮后旧操作不能覆盖状态；同位置的同类错误再失败时改为停下等用户，不同类错误继续自动修复。 @keyword-cn 写入托管状态, 旧任务隔离 @keyword-en patch-autopilot-state, stale-run-isolation */
  private async patch(
    topic: DouyinTopicEntity,
    input: Partial<DouyinStoreVisitAutopilot>,
  ): Promise<void> {
    const fields = { ...input };
    if (input.state === 'waiting') {
      const auto = topic.storeVisit!.autopilot!;
      const stage = input.stage ?? auto.stage;
      const segmentId =
        auto.goal === 'draft'
          ? undefined
          : topic.storeVisit?.pipeline?.currentSegmentId;
      const reason = input.message || auto.message;
      const key = autopilotRepairKey(stage, segmentId);
      const history = (auto.repairs ?? []).filter((item) => item.key === key);
      if (
        history.length &&
        (await this.isRepeatedFailure(topic, stage, history, reason))
      ) {
        fields.state = 'paused';
        fields.blocked = {
          reason,
          stage,
          ...(segmentId ? { segmentId } : {}),
          ...this.blockedLines(topic, segmentId),
        };
        const button = auto.goal === 'draft' ? '补齐台词和素材' : '继续托管';
        fields.message = `这个问题已自动修复过，仍未解决：${reason.replace(/[。！？.!?\s]+$/, '')}。可以调整后点「${button}」。`;
      }
    }
    const set: Record<string, unknown> = {
      'storeVisit.autopilot.updatedAt': new Date(),
      updatedAt: new Date(),
    };
    for (const [key, value] of Object.entries(fields))
      if (value !== undefined) set[`storeVisit.autopilot.${key}`] = value;
    if (fields.state === 'waiting')
      set['storeVisit.autopilot.failureId'] = randomUUID();
    await this.topics.updateOne(
      {
        _id: topic._id,
        'storeVisit.autopilot.runId': topic.storeVisit!.autopilot!.runId,
        'storeVisit.autopilot.state': 'running',
      },
      { $set: set },
    );
  }

  /** @description 取停下时这一段的台词快照，用户继续托管时据此判断是否亲自改过。 @keyword-cn 停止时台词快照, 用户修改判断 @keyword-en blocked-lines-snapshot, user-edit-detection */
  private blockedLines(
    topic: DouyinTopicEntity,
    segmentId?: string,
  ): { lines?: string } {
    const lines = topic.storeVisit?.segments?.find(
      (segment) => segment.id === segmentId,
    )?.lines;
    return lines === undefined ? {} : { lines };
  }

  /** @description 确认这一步仍由当前认领持有且任务在运行，AI 调用期间被暂停或换轮后不再写入。 @keyword-cn 校验托管认领, 修复期间暂停保护 @keyword-en verify-autopilot-claim, pause-during-repair */
  private async ownsRun(
    topic: DouyinTopicEntity,
    scope: Scope,
  ): Promise<boolean> {
    const current = await this.requireTopic(topic.id, scope);
    return (
      current.storeVisit?.autopilot?.state === 'running' &&
      current.storeVisit.autopilot.claimId ===
        topic.storeVisit!.autopilot!.claimId
    );
  }

  /** @description 按 AI 给的修复要求只改失败这一段的台词，基于最新分段保存，其他段不动；AI 改写期间用户改过这段就以用户为准。 @keyword-cn 修复单段台词, AI改写失败段 @keyword-en repair-segment-lines, rewrite-failed-segment */
  private async rewriteSegmentLines(
    topic: DouyinTopicEntity,
    segment: DouyinStoreVisitSegment,
    reason: string,
    instruction: string,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit!;
    const result = await this.scripts.refineScript(
      {
        script: segment.lines,
        title: topic.title,
        voiceId: setting.voiceId,
        instruction: `这段出片失败：${reason.slice(0, 180)}。修复要求：${instruction || '按失败原因调整'}。只修改这段台词，保留店名、价格、项目等事实，不加解释。`,
      },
      scope,
    );
    if (!result.script?.trim() || result.script === segment.lines)
      throw new BadRequestException('AI 没有改出可用的台词');
    if (!(await this.ownsRun(topic, scope))) return;
    const latest = (await this.requireTopic(topic.id, scope)).storeVisit
      ?.segments;
    if (latest?.find((item) => item.id === segment.id)?.lines !== segment.lines)
      return;
    await this.repository.update(
      topic.id,
      {
        storeVisit: {
          segments: latest.map((item) =>
            item.id === segment.id ? { ...item, lines: result.script } : item,
          ),
        },
      },
      scope,
    );
  }

  /** @description 只换失败这一段的画面：从脚本开始时 AI 重新生图，从门店开始时清掉这段素材后按门店已有素材重配。 @keyword-cn 修复单段画面, 更换失败素材 @keyword-en repair-segment-picture, replace-failed-material */
  private async replaceSegmentPicture(
    topic: DouyinTopicEntity,
    segment: DouyinStoreVisitSegment,
    instruction: string,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit!;
    if (storeVisitStart(setting) === 'script') {
      await this.agent.generatePictures(
        topic.id,
        { segmentId: segment.id, prompt: instruction || undefined },
        scope,
      );
      return;
    }
    const latest = await this.requireTopic(topic.id, scope);
    await this.repository.update(
      topic.id,
      {
        storeVisit: {
          segments: (latest.storeVisit?.segments ?? []).map((item) =>
            item.id === segment.id
              ? {
                  ...item,
                  sceneImageId: undefined,
                  sceneImageIds: [],
                  sceneVideoId: undefined,
                }
              : item,
          ),
        },
      },
      scope,
    );
    const fitted = await this.agent.fitSegmentsToMaterials(topic.id, scope);
    if (fitted.missing > 0)
      throw new BadRequestException('门店素材里没有能替换这一段的画面');
  }

  /** @description 由 AI 按失败原因判定重做哪一块并执行一次：重试、改单段台词、换单段画面、重写台词或脚本；判定要用户处理时直接停下，已成功的分段不动。 @keyword-cn 托管错误修复, 失败分段续跑 @keyword-en autopilot-error-repair, resume-failed-segment */
  private async recoverStep(
    topic: DouyinTopicEntity,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit!;
    const auto = setting.autopilot!;
    const recovery = auto.recovery!;
    const reason = recovery.reason.slice(0, 350);
    // 记下这次修的是什么错：修完再失败时，同类才停下，不同类不占重试次数
    auto.repairs = [
      ...(auto.repairs ?? []),
      {
        key: autopilotRepairKey(recovery.stage, recovery.segmentId),
        reason: recovery.reason,
      },
    ];
    await this.patch(topic, {
      repairs: auto.repairs,
      message: `Agent 正在根据失败原因判断怎么修复：${reason}`,
    });
    const segment = setting.segments?.find(
      (item) => item.id === recovery.segmentId,
    );
    const target =
      segment && !isStoreVisitSegmentReady(segment) ? segment : undefined;
    const decision = await this.planner.diagnoseAutopilotFailure(
      topic,
      {
        reason,
        stage: recovery.stage,
        segmentId: target?.id,
        actions: autopilotRepairActions(recovery.stage, Boolean(target)),
      },
      scope,
    );
    if (!(await this.ownsRun(topic, scope))) return;
    if (
      decision.action === 'ask-user' ||
      (decision.action === 'rewrite-script' && setting.manualScript) ||
      (decision.action === 'rewrite-segment' && target?.manualLines) ||
      (decision.action === 'replace-picture' && target?.manualMaterial)
    ) {
      await this.stopForUser(
        topic,
        recovery,
        `这一步需要你处理：${recovery.reason.replace(/[。！？.!?\s]+$/, '')}。调整后可以重试。`,
      );
      return;
    }
    try {
      if (decision.action === 'rewrite-script')
        await this.agent.writeScript(
          topic.id,
          { keepCast: true, issues: [decision.instruction || reason] },
          scope,
        );
      else if (decision.action === 'regenerate-lines')
        await this.repository.update(
          topic.id,
          { storeVisit: { linesScript: '' } },
          scope,
        );
      else if (decision.action === 'rewrite-segment' && target)
        await this.rewriteSegmentLines(
          topic,
          target,
          reason,
          decision.instruction,
          scope,
        );
      else if (decision.action === 'replace-picture') {
        if (target)
          await this.replaceSegmentPicture(
            topic,
            target,
            decision.instruction,
            scope,
          );
        else if (
          recovery.stage === 'picture' &&
          storeVisitStart(setting) === 'script' &&
          auto.pictureSource === 'gallery'
        )
          await this.patch(topic, { pictureSource: 'ai', mustMerge: true });
      }
      if (!(await this.ownsRun(topic, scope))) return;
      // 失效任务、提交失败与网络失败使用最新分段重建调用，成功段不重做。
      if (recovery.stage === 'voice' || recovery.stage === 'make') {
        const current = await this.requireTopic(topic.id, scope);
        if (current.storeVisit?.pipeline?.state === 'paused')
          await this.pipeline.resume(topic.id, scope);
      }
    } catch (error) {
      // 修复动作本身没做成，这次重试已用掉，不再换个说法继续重试
      const message = error instanceof Error ? error.message : String(error);
      await this.stopForUser(
        topic,
        recovery,
        `自动修复没有完成：${(DOUYIN_GENERATION_ERROR_MESSAGES[message] || message).replace(/[。！？.!?\s]+$/, '')}。调整后可以重试。`,
      );
      return;
    }
    await this.patch(topic, {
      recovery: {
        ...recovery,
        pending: false,
        ...(decision.instruction ? { instruction: decision.instruction } : {}),
      },
      resumePipeline: false,
    });
  }

  /** @description 保留用户已选人物音色，仅为缺失项请求 AI 推荐，音色库未配置时保存明确的声音描述；要出镜却没有带形象图的人物时改为不露脸解说继续。 @keyword-cn 托管补齐人物音色, 保留用户设定 @keyword-en autopilot-fill-cast, preserve-user-cast */
  private async prepareCast(
    topic: DouyinTopicEntity,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit || {};
    const opening = setting.template === 'opening';
    const recommendation = await this.planner.recommend(
      topic.id,
      { presenter: opening },
      scope,
    );
    let persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    if (opening && !setting.faceImage) {
      if (!persona && recommendation.persona?.personaId)
        persona = await this.personas.get(
          recommendation.persona.personaId,
          scope,
        );
      const face = persona ? personaFaceReference(persona) : null;
      if (!face || !persona) {
        // 没有带形象图的人物时不停下来等客户，直接改成不露脸解说继续
        await this.agent.setCast(topic.id, { template: 'voiceover' }, scope);
        await this.patch(topic, {
          stage: 'script',
          message: '没有可用的出镜人物，已改为不露脸解说继续制作',
        });
        return;
      }
      await this.repository.update(
        topic.id,
        { personaId: persona.id, storeVisit: { faceImage: face } },
        scope,
      );
    }
    if (!setting.voiceId && !setting.voicePrompt?.trim()) {
      const voice = persona
        ? pickPersonaPresetVoice(persona, COSYVOICE_PRESET_VOICES)
        : recommendation.voice;
      const nodes = await this.agent.videoOptions();
      if (nodes.storeVisit.voiceClone.configured && voice.voiceId)
        await this.agent.setCast(topic.id, { voiceId: voice.voiceId }, scope);
      else
        await this.repository.update(
          topic.id,
          {
            storeVisit: {
              voicePrompt:
                'trait' in voice
                  ? `${voice.gender === 'male' ? '男声' : '女声'}，${voice.trait}，自然口语，语速利落`
                  : recommendation.voice.voicePrompt,
            },
          },
          scope,
        );
    }
    await this.patch(topic, {
      stage: 'script',
      message: '已补齐出片所需的人物和音色',
    });
  }

  /** @description 按最新业务数据只执行一个缺失步骤，已完成脚本、台词和画面不会盲目重做；配不上素材的段以已有素材为准改写台词，自检剩余提示不拦截，尽量不需要客户介入。 @keyword-cn 托管执行下一步, 已有结果复用 @keyword-en autopilot-next-step, reuse-existing-output */
  private async runStep(topic: DouyinTopicEntity, scope: Scope): Promise<void> {
    const setting = topic.storeVisit || {};
    const auto = setting.autopilot!;
    const draft = auto.goal === 'draft';
    const recovery = auto.recovery;
    if (
      recovery?.pending &&
      (!draft || !['voice', 'make'].includes(recovery.stage))
    ) {
      await this.recoverStep(topic, scope);
      return;
    }
    if (auto.goal !== 'draft' && setting.pipeline?.state === 'running') {
      await this.finishVideo(topic, scope);
      return;
    }
    if (storeVisitStart(setting) !== 'script' && !setting.storeId) {
      // 带上客户写的需求描述与托管要求，脚本或需求里已经确定门店时直接设定，不再问客户
      const brief = await this.loadCustomerBrief(topic);
      const result = await this.planner.writeScript(
        topic.id,
        {
          keepCast: true,
          prompt:
            [auto.scriptPrompt, brief].filter(Boolean).join('\n') || undefined,
        },
        scope,
      );
      const question =
        'needsStore' in result && result.needsStore
          ? result.storeQuestion
          : undefined;
      if (await this.settleStore(topic, question, scope)) return;
      await this.patch(topic, {
        state: draft ? 'paused' : 'waiting',
        stage: 'script',
        message: question?.question || '请先在准备页确认拍摄门店，然后重试',
      });
      return;
    }
    if (storeVisitStart(setting) !== 'script')
      await this.spots.requireStore(setting.storeId!, scope);
    if (!setting.template) {
      await this.repository.update(
        topic.id,
        { storeVisit: { template: 'voiceover' } },
        scope,
      );
      return;
    }
    if (
      auto.goal !== 'draft' &&
      ((!setting.voiceId && !setting.voicePrompt?.trim()) ||
        (setting.template === 'opening' && !setting.faceImage))
    ) {
      await this.patch(topic, {
        stage: 'script',
        message: 'AI 正在补齐人物和音色设定',
      });
      await this.prepareCast(topic, scope);
      return;
    }
    const script = setting.script?.trim() || '';
    if (script.length < 20) {
      await this.patch(topic, {
        stage: 'script',
        message: 'AI 正在结合引用知识写创作脚本',
        mustMerge: true,
      });
      const result = await this.agent.writeScript(
        topic.id,
        { keepCast: true, prompt: auto.scriptPrompt },
        scope,
      );
      if ('needsStore' in result && result.needsStore) {
        if (await this.settleStore(topic, result.storeQuestion, scope)) return;
        await this.patch(topic, {
          state: draft ? 'paused' : 'waiting',
          stage: 'script',
          message:
            result.storeQuestion?.question ||
            '门店尚未确认，请在准备页补充后重试',
        });
      }
      return;
    }
    if (setting.scriptNeedsRefine) {
      await this.patch(topic, {
        stage: 'script',
        message: 'AI 正在按当前人物和音色微调脚本',
        mustMerge: true,
      });
      const result = await this.scripts.refineScript(
        {
          script,
          title: topic.title,
          personaId: topic.personaId,
          scriptStyle: topic.scriptStyle,
          productionMode: 'store-visit',
          voiceId: setting.voiceId,
          voicePrompt: setting.voicePrompt?.slice(0, 500),
          instruction:
            '按当前人物和音色微调叙事视角、语气与节奏，保留原主题、事实、价格和画面安排，不生成逐段台词。',
        },
        scope,
      );
      await this.repository.update(
        topic.id,
        {
          storeVisit: {
            script: result.script,
            scriptNeedsRefine: false,
            linesScript: '',
          },
        },
        scope,
      );
      return;
    }
    if (auto.reviewKey !== autopilotScriptKey(topic)) {
      await this.patch(topic, {
        stage: 'script',
        message: 'AI 正在对照引用知识检查脚本',
      });
      const review = await this.planner.reviewScript(topic.id, scope);
      if (
        !review.passed &&
        review.issues.length &&
        !setting.manualScript &&
        !setting.segments?.some(
          (segment) => segment.manualLines || segment.manualMaterial,
        )
      ) {
        const rewritten = await this.agent.writeScript(
          topic.id,
          { keepCast: true, issues: review.issues },
          scope,
        );
        const next = await this.requireTopic(topic.id, scope);
        await this.patch(topic, {
          reviewKey: autopilotScriptKey(next),
          mustMerge: true,
        });
        const checked = rewritten as {
          review?: { passed: boolean; issues: string[] };
        };
        // 已按自检意见重写过一次，剩下的提示不再拦住托管，交给后面的台词与出片继续
        await this.patch(topic, {
          message:
            checked.review && !checked.review.passed
              ? `脚本已按自检意见修改，剩余提示不影响制作：${checked.review.issues.join('；').slice(0, 300)}`
              : '脚本已按自检意见修改，准备生成台词',
        });
      } else
        await this.patch(topic, {
          reviewKey: autopilotScriptKey(topic),
          message: '脚本已检查，准备生成台词',
        });
      return;
    }
    const segments = setting.segments || [];
    if (
      !segments.length ||
      setting.linesScript !== script ||
      segments.some((segment) => !segment.lines.trim())
    ) {
      await this.patch(topic, {
        stage: 'lines',
        message:
          storeVisitStart(setting) === 'script' && auto.pictureSource !== 'ai'
            ? 'AI 正按脚本方向匹配图库素材，并按素材设计每段台词和画面'
            : 'AI 正在按脚本拆分台词并安排每段念法',
        mustMerge: true,
      });
      const options = await this.agent.videoOptions();
      const limits = [
        ...(options.storeVisit.video.durations || [15]),
        ...(setting.template === 'opening'
          ? options.storeVisit.avatar.durations || [15]
          : []),
      ]
        .map(Number)
        .filter((value) => value > 0);
      await this.agent.generateLines(
        topic.id,
        `${auto.linesPrompt || ''} ${auto.recovery?.stage === 'lines' ? `上次失败原因：${auto.recovery.reason.slice(0, 350)}，请针对该问题调整。${auto.recovery.instruction ? `修复要求：${auto.recovery.instruction}。` : ''}` : ''} 每段台词控制在 ${Math.max(5, Math.floor(Math.min(...limits, 15) * 4))} 字以内，完整保留脚本事实。`,
        scope,
        // 从脚本开始时先按脚本方向匹配素材再写台词；托管选了 AI 画面时不匹配
        { useMaterials: auto.pictureSource !== 'ai' },
      );
      return;
    }
    const missing = segments.filter(
      (segment) => !storeVisitSegmentHasMaterial(setting, segment),
    );
    if (missing.length) {
      await this.patch(topic, {
        stage: 'picture',
        message: `AI 正在准备画面，已完成 ${segments.length - missing.length}/${segments.length} 段`,
        mustMerge: true,
      });
      if (storeVisitStart(setting) !== 'script') {
        const store = await this.spots.requireStore(setting.storeId!, scope);
        if (
          !store.spots.some((spot) => spot.images.length || spot.videos?.length)
        ) {
          const ids = (setting.sceneImages || [])
            .map((image) => Number(image.id))
            .filter((id) => id > 0)
            .slice(0, 16);
          if (ids.length) {
            const classified = await this.agent.classifyStorePhotos(
              store.id,
              ids,
              scope,
            );
            if (classified.assigned > 0) return;
          }
          throw new BadRequestException(
            '门店还没有可用素材，请先上传并整理门店场景图库，然后重试',
          );
        }
        await this.agent.matchScenes(topic.id, scope, { onlyMissing: true });
        const next = await this.requireTopic(topic.id, scope);
        if (
          next.storeVisit?.segments?.some(
            (segment) =>
              !storeVisitSegmentHasMaterial(next.storeVisit!, segment),
          )
        ) {
          // 以已有素材为准：配不上的段换成门店有的画面并改写这几段台词，不要求客户补素材或改台词
          await this.patch(topic, {
            message: '有几段在门店素材里配不上画面，AI 正按已有素材改写这几段',
          });
          const fitted = await this.agent.fitSegmentsToMaterials(
            topic.id,
            scope,
          );
          if (fitted.missing > 0) {
            const latest = await this.requireTopic(topic.id, scope);
            const left = (latest.storeVisit?.segments || []).filter(
              (segment) =>
                !storeVisitSegmentHasMaterial(latest.storeVisit!, segment),
            );
            const protectedShot = left.find(
              (segment) => segment.manualLines || segment.manualMaterial,
            );
            if (protectedShot) {
              const index = (latest.storeVisit?.segments || []).findIndex(
                (segment) => segment.id === protectedShot.id,
              );
              await this.stopForUser(
                topic,
                {
                  reason: '手动镜头需要选择素材',
                  stage: 'picture',
                  segmentId: protectedShot.id,
                  pending: false,
                },
                `第 ${index + 1} 段需要你选素材或调整台词，处理后可以重试。`,
              );
              return;
            }
            // 剩下的只有人物出镜段：门店没有能给人物用的照片，改成不露脸解说
            if (
              left.length &&
              left.every((segment) => segment.shot === 'presenter') &&
              latest.storeVisit?.template === 'opening'
            ) {
              await this.agent.setCast(
                topic.id,
                { template: 'voiceover' },
                scope,
              );
              await this.patch(topic, {
                message: '门店没有能给出镜人物用的照片，已改为不露脸解说',
              });
              return;
            }
            throw new BadRequestException(
              '还有几段没配上画面，Agent 会按已有素材再调整一次',
            );
          }
          await this.patch(topic, {
            message: fitted.rewritten
              ? `已按门店已有素材改写 ${fitted.rewritten} 段台词，画面已配齐`
              : '已按门店已有素材配齐画面',
          });
        }
      } else if (auto.pictureSource === 'ai') {
        await this.agent.generatePictures(
          topic.id,
          { segmentId: missing[0].id },
          scope,
        );
        const next = await this.requireTopic(topic.id, scope);
        const generated = next.storeVisit?.segments?.find(
          (segment) => segment.id === missing[0].id,
        );
        if (
          !generated ||
          !storeVisitSegmentHasMaterial(next.storeVisit!, generated)
        )
          throw new BadRequestException(
            'AI 这一段的画面没保存成功，Agent 会自动重试',
          );
      } else {
        try {
          await this.agent.pickPictures(topic.id, scope, { onlyMissing: true });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes('图库里还没有能用的图片')
          )
            throw error;
        }
        const next = await this.requireTopic(topic.id, scope);
        if (
          next.storeVisit?.segments?.some(
            (segment) =>
              !storeVisitSegmentHasMaterial(next.storeVisit!, segment),
          )
        )
          await this.patch(topic, {
            pictureSource: 'ai',
            message: '图库未能配齐画面，接下来用 AI 逐段补图',
          });
      }
      return;
    }
    if (auto.goal === 'draft') {
      await this.patch(topic, {
        state: 'done',
        stage: 'picture',
        message: '镜头草稿已配齐，可以逐段检查并调整',
      });
      return;
    }
    if (auto.stage !== 'voice' && auto.stage !== 'make') {
      await this.patch(topic, {
        stage: 'voice',
        message: '已沿用人物音色并确认各段念法，准备出片',
      });
      return;
    }
    await this.finishVideo(topic, scope);
  }

  /** @description 读取这条脚本生成时客户写的需求描述（生成候选脚本那一轮的要求），找不到时为空。 @keyword-cn 读取客户需求描述, 候选生成要求 @keyword-en load-customer-brief, draft-generation-prompt */
  private async loadCustomerBrief(topic: DouyinTopicEntity): Promise<string> {
    try {
      const job = await this.jobs.findOne(
        {
          'result.createdTopicIds': topic.id,
          userId: topic.userId,
          ...(topic.tenantId ? { tenantId: topic.tenantId } : {}),
        },
        { projection: { prompt: 1 } },
      );
      return String(job?.prompt ?? '')
        .trim()
        .slice(0, 800);
    } catch (error) {
      this.logger.warn(
        `[loadCustomerBrief] topic=${topic.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  /** @description 脚本或客户需求里已经确定门店时直接设定：已有门店直接选用，还没有的按店名新建（同名复用）后选用；没确定返回 false 交回询问。 @keyword-cn 托管直接设定门店, 确定门店免询问 @keyword-en autopilot-settle-store, skip-store-question */
  private async settleStore(
    topic: DouyinTopicEntity,
    question:
      | {
          storeId: number | null;
          name: string;
          description: string;
          confident?: boolean;
        }
      | undefined,
    scope: Scope,
  ): Promise<boolean> {
    if (!question?.confident) return false;
    let storeId = Number(question.storeId) || 0;
    const created = !storeId;
    if (created) {
      const name = question.name.trim();
      if (!name) return false;
      const result = await this.agent.createStore(
        {
          name,
          ...(question.description
            ? { description: question.description }
            : {}),
        },
        scope,
      );
      storeId = Number(result.store.id);
    }
    await this.agent.setStore(topic.id, storeId, scope);
    await this.patch(topic, {
      stage: 'script',
      message: created
        ? `脚本和需求里写明了门店「${question.name}」，已新建并设定，继续制作`
        : `已从脚本和需求里确定门店「${question.name}」，继续制作`,
    });
    return true;
  }

  /** @description 交接现有导演逐段出片，失败暂停，等待桌面端拼接出新成片后完成；不触发公开发布。 @keyword-cn 托管完成出片, 等待成片拼接 @keyword-en autopilot-finish-video, await-final-merge */
  private async finishVideo(
    topic: DouyinTopicEntity,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit!;
    const auto = setting.autopilot!;
    const allReady = Boolean(
      setting.segments?.length &&
      setting.segments.every(isStoreVisitSegmentReady),
    );
    if (
      allReady &&
      topic.generatedVideoId &&
      (!auto.mustMerge || topic.generatedVideoId !== auto.videoBaseline)
    ) {
      await this.patch(topic, {
        state: 'done',
        stage: 'make',
        message: 'Agent 托管已完成，成片已生成，可以预览并保存到发布库',
      });
      return;
    }
    if (setting.pipeline?.state === 'paused' && !auto.resumePipeline) {
      await this.patch(topic, {
        state: ['user', 'editing'].includes(setting.pipeline.pauseReason || '')
          ? 'paused'
          : 'waiting',
        stage: 'make',
        message: setting.pipeline.error || '出片已暂停，检查后可继续托管',
      });
      return;
    }
    await this.patch(topic, {
      stage: 'make',
      message: allReady
        ? '各段已出片，等待客户端自动拼接，请保持客户端打开'
        : 'AI 导演正在逐段出片，请保持客户端打开',
    });
    if (allReady) {
      const latest = await this.operations.findOne(
        {
          topicId: topic.id,
          userId: scope.userId,
          mode: 'concat',
          createdAt: { $gte: auto.mergeAfter || auto.startedAt },
        },
        { sort: { createdAt: -1 } },
      );
      if (latest?.status === 'failed') {
        await this.patch(topic, {
          state: 'waiting',
          message: latest.error || '成片拼接失败，Agent 会重新请求拼接',
        });
        return;
      }
      if (!auto.mergeRequested) {
        if (
          !topic.autoConcatShots &&
          ![
            'pending',
            'accepted',
            'queued',
            'submitted',
            'processing',
            'running',
            'saving',
          ].includes(latest?.status || '')
        )
          await this.agent.requestMerge(topic.id, scope);
        await this.patch(topic, { mergeRequested: true });
      }
    } else if (setting.pipeline?.state !== 'running') {
      await this.agent.generateStoreVisit(
        topic.id,
        { unifiedVoice: auto.voiceAnchor },
        scope,
      );
      await this.patch(topic, { resumePipeline: false });
    }
  }
}
