import {
  BadRequestException,
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
  DouyinGenerationJobEntity,
  DouyinOperationEntity,
  DouyinStoreVisitAutopilot,
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

/**
 * @description 持久化全流程 Agent 托管，按失败原因调整并断点续跑，复用已完成结果与原子认领。
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

  /** @description 启动或继续托管，重复点击运行中任务只返回状态，不重置进度或重新生成。 @keyword-cn 启动Agent托管, 托管重复保护 @keyword-en start-agent-autopilot, autopilot-duplicate-guard */
  async start(
    topicId: number,
    input: StartDouyinAutopilotDto,
    scope: Scope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireTopic(topicId, scope);
    const previous = topic.storeVisit?.autopilot;
    if (previous?.state === 'running') return topic;
    // 自动恢复只能认领弹窗对应的失败，其他窗口的暂停或新失败优先。
    if (
      input.recoverFailureId &&
      (previous?.state !== 'waiting' ||
        previous.failureId !== input.recoverFailureId)
    )
      return topic;
    const resume = previous && previous.state !== 'done';
    const now = new Date();
    const state: DouyinStoreVisitAutopilot = {
      ...(resume ? previous : {}),
      runId: resume ? previous.runId : randomUUID(),
      state: 'running',
      stage: resume ? previous.stage : 'script',
      message: 'Agent 正在检查已有设定与制作进度',
      pictureSource:
        input.pictureSource || (resume && previous.pictureSource) || 'gallery',
      voiceAnchor: input.voiceAnchor ?? (resume ? previous.voiceAnchor : false),
      scriptPrompt: input.scriptPrompt || undefined,
      linesPrompt: input.linesPrompt || undefined,
      reviewKey: previous?.reviewKey,
      mergeRequested: false,
      mergeAfter: now,
      resumePipeline: topic.storeVisit?.pipeline?.state === 'paused',
      recovery:
        previous?.state === 'waiting'
          ? {
              reason: previous.message,
              stage: previous.stage,
              segmentId: topic.storeVisit?.pipeline?.currentSegmentId,
              pending: true,
            }
          : resume
            ? previous.recovery
            : undefined,
      videoBaseline: resume
        ? previous.videoBaseline
        : topic.generatedVideoId || 0,
      startedAt: resume ? previous.startedAt : now,
      updatedAt: now,
    };
    await this.topics.updateOne(
      {
        _id: topic._id,
        'storeVisit.autopilot.state': previous?.state || { $exists: false },
        ...(input.recoverFailureId
          ? { 'storeVisit.autopilot.failureId': input.recoverFailureId }
          : {}),
      },
      { $set: { 'storeVisit.autopilot': state, updatedAt: now } },
    );
    void this.advance(topicId, scope).catch((error) =>
      this.logger.warn(String(error)),
    );
    return this.requireTopic(topicId, scope);
  }

  /** @description 暂停后不再启动下一步，已经提交的 AI 操作允许完成，出片导演同时暂停。 @keyword-cn 暂停Agent托管, 保留完成结果 @keyword-en pause-agent-autopilot, preserve-completed-results */
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
    if (topic.storeVisit?.pipeline?.state === 'running')
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

  /** @description 只更新本轮仍在运行的任务，暂停或换轮后旧操作不能覆盖状态。 @keyword-cn 写入托管状态, 旧任务隔离 @keyword-en patch-autopilot-state, stale-run-isolation */
  private async patch(
    topic: DouyinTopicEntity,
    fields: Partial<DouyinStoreVisitAutopilot>,
  ): Promise<void> {
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

  /** @description 按失败事项调整脚本、配图或过长台词，服务任务失效时清理失败调用后仅续跑未完成分段。 @keyword-cn 托管错误修复, 失败分段续跑 @keyword-en autopilot-error-repair, resume-failed-segment */
  private async recoverStep(
    topic: DouyinTopicEntity,
    scope: Scope,
  ): Promise<void> {
    const setting = topic.storeVisit!;
    const recovery = setting.autopilot!.recovery!;
    const reason = recovery.reason.slice(0, 350);
    await this.patch(topic, {
      message: `Agent 正在根据失败原因调整：${reason}`,
    });
    if (
      recovery.stage === 'script' &&
      /自检|事实|脚本.*(不符|问题)/.test(reason)
    ) {
      await this.agent.writeScript(
        topic.id,
        { keepCast: true, issues: [reason] },
        scope,
      );
    } else if (
      recovery.stage === 'picture' &&
      storeVisitStart(setting) === 'script' &&
      setting.autopilot!.pictureSource === 'gallery'
    ) {
      await this.patch(topic, { pictureSource: 'ai', mustMerge: true });
    } else if (recovery.stage === 'make') {
      const segment = setting.segments?.find(
        (item) => item.id === recovery.segmentId,
      );
      if (
        segment &&
        !isStoreVisitSegmentReady(segment) &&
        /台词|口播|配音/.test(reason) &&
        /太长|超长|超过|超出|长于/.test(reason)
      ) {
        const maxChars = Math.max(20, Math.floor(segment.lines.length * 0.7));
        const result = await this.scripts.refineScript(
          {
            script: segment.lines,
            title: topic.title,
            voiceId: setting.voiceId,
            instruction: `这段生成失败：${reason}。只修改这段台词，压缩至 ${maxChars} 字以内以适配时长，保留店名、价格、项目等事实，不加解释。`,
          },
          scope,
        );
        if (result.script.length > maxChars || result.script === segment.lines)
          throw new BadRequestException(
            '台词调整未达到时长要求，Agent 将继续调整',
          );
        const current = await this.requireTopic(topic.id, scope);
        if (
          current.storeVisit?.autopilot?.state !== 'running' ||
          current.storeVisit.autopilot.claimId !== setting.autopilot!.claimId
        )
          return;
        await this.repository.update(
          topic.id,
          {
            storeVisit: {
              segments: setting.segments!.map((item) =>
                item.id === segment.id
                  ? { ...item, lines: result.script }
                  : item,
              ),
            },
          },
          scope,
        );
      }
      // 失效任务、提交失败与网络失败使用最新分段重建调用，成功段不重做。
      const current = await this.requireTopic(topic.id, scope);
      if (
        current.storeVisit?.autopilot?.state !== 'running' ||
        current.storeVisit.autopilot.claimId !== setting.autopilot!.claimId
      )
        return;
      if (current.storeVisit.pipeline?.state === 'paused')
        await this.pipeline.resume(topic.id, scope);
    }
    await this.patch(topic, {
      recovery: { ...recovery, pending: false },
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
    if (setting.script?.trim())
      await this.repository.update(
        topic.id,
        { storeVisit: { scriptNeedsRefine: true, linesScript: '' } },
        scope,
      );
    await this.patch(topic, {
      stage: 'script',
      mustMerge: true,
      message: '已补齐人物与音色，接着调整创作脚本',
    });
  }

  /** @description 按最新业务数据只执行一个缺失步骤，已完成脚本、台词和画面不会盲目重做；配不上素材的段以已有素材为准改写台词，自检剩余提示不拦截，尽量不需要客户介入。 @keyword-cn 托管执行下一步, 已有结果复用 @keyword-en autopilot-next-step, reuse-existing-output */
  private async runStep(topic: DouyinTopicEntity, scope: Scope): Promise<void> {
    const setting = topic.storeVisit || {};
    const auto = setting.autopilot!;
    if (auto.recovery?.pending) {
      await this.recoverStep(topic, scope);
      return;
    }
    if (setting.pipeline?.state === 'running') {
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
        state: 'waiting',
        stage: 'script',
        message: question?.question || '请先在脚本页确认拍摄门店，再继续托管',
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
      (!setting.voiceId && !setting.voicePrompt?.trim()) ||
      (setting.template === 'opening' && !setting.faceImage)
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
          state: 'waiting',
          message:
            result.storeQuestion?.question ||
            '门店尚未确认，请在脚本页补充后继续托管',
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
      if (!review.passed && review.issues.length) {
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
    if (!segments.length || setting.linesScript !== script) {
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
        `${auto.linesPrompt || ''} ${auto.recovery?.stage === 'lines' ? `上次失败原因：${auto.recovery.reason.slice(0, 350)}，请针对该问题调整。` : ''} 每段台词控制在 ${Math.max(5, Math.floor(Math.min(...limits, 15) * 4))} 字以内，完整保留脚本事实。`,
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
        if (!store.spots.some((spot) => spot.images.length)) {
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
            '门店还没有可用素材，请先上传并整理门店场景图库，再继续托管',
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
