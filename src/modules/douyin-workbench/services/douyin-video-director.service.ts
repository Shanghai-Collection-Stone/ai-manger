import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import {
  toWorkflowLlmConfig,
  WorkflowModelService,
} from '../../workflow-model/services/workflow-model.service.js';
import type {
  DouyinEditPlan,
  DouyinTopicEntity,
  DouyinVideoTemplate,
} from '../entities/douyin-workbench.entity.js';
import { DouyinShotConcatService } from './douyin-shot-concat.service.js';
import {
  isStoreVisitVisualStart,
  storeVisitStart,
} from './douyin-store-visit-continuity.js';
import {
  buildDirectorBrief,
  directionFingerprint,
  DOUYIN_DIRECTOR_SYSTEM,
  listDirectorFrames,
  parseDirectorPlan,
} from './douyin-video-director.js';
import {
  buildEditClipBrief,
  DOUYIN_EDIT_PLAN_SYSTEM,
  parseEditPlan,
  type DouyinEditClipContext,
  type DouyinEditClipInput,
} from './douyin-video-edit.js';
import type { DouyinTemplatePlan } from './douyin-video-template.js';
import { DouyinVideoTemplateService } from './douyin-video-template.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };
type VisionContent = Array<{ type: string; [key: string]: unknown }>;

/** 画面改动后等几秒再规划，连续改图只规划一次 */
const DIRECTOR_DEBOUNCE_MS = 3000;
/** 「规划中」超过这么久还没结束（服务重启丢了定时器）就当作卡住，下次触发时重做 */
const DIRECTOR_STALE_MS = 5 * 60 * 1000;
/** 剪辑规划一次最多带几张抽帧 */
const EDIT_FRAME_BUDGET = 32;

/**
 * @description AI 导演：出片前在配图 / 配场景完成后自动看各段首帧，决定要不要套版式模板（要套时用「生图」节点出模板图）和每段的运镜与画面动态；
 *   出片后看桌面端交来的抽帧与人声区间，定掐头去尾、段间转场、字幕位置大小与封面帧。读图都用「思考」节点，不新增工作流节点。
 * @keyword-cn AI导演, 出片前规划, 出片后剪辑
 * @keyword-en ai-video-director, pre-production-plan, post-production-edit
 */
@Injectable()
export class DouyinVideoDirectorService implements OnModuleDestroy {
  private readonly logger = new Logger(DouyinVideoDirectorService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly running = new Set<number>();

  constructor(
    private readonly agentService: AgentService,
    private readonly workflowModels: WorkflowModelService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly templates: DouyinVideoTemplateService,
    private readonly shotConcat: DouyinShotConcatService,
  ) {}

  /**
   * @description 服务关闭时清掉还没触发的规划定时器。
   * @keyword-cn 清理规划定时器, 服务关闭
   * @keyword-en clear-director-timers, module-destroy
   */
  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * @description 画面可能变了时调用（配图、换图、配场景之后）：首帧指纹没变就什么都不做；变了先把规划标成「规划中」（接口返回时前端就能看到），
   *   防抖 3 秒后在后台规划。同一组画面规划失败不自动重试（用户可手动重新规划）；卡在「规划中」超过 5 分钟的会重做。出错只记日志，不影响调用方。
   * @keyword-cn 触发导演规划, 画面变更规划
   * @keyword-en schedule-video-direction, replan-on-frame-change
   * @param topicId 子选题（脚本）ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<void>}
   */
  async schedule(topicId: number, scope: DouyinScope): Promise<void> {
    try {
      const topic = await this.repository.get(topicId, scope);
      if (!topic || topic.kind !== 'child') return;
      const frames = listDirectorFrames(topic);
      if (!frames.length) return;
      const fingerprint = directionFingerprint(frames);
      const current = topic.videoDirection;
      if (current?.fingerprint === fingerprint) {
        if (current.status !== 'planning') return;
        const age = Date.now() - new Date(current.updatedAt).getTime();
        if (
          this.timers.has(topicId) ||
          this.running.has(topicId) ||
          age < DIRECTOR_STALE_MS
        )
          return;
      }
      await this.repository.setVideoDirection(
        topicId,
        {
          status: 'planning',
          fingerprint,
          shots: current?.shots ?? {},
          note: current?.note,
          updatedAt: new Date(),
        },
        scope,
      );
      clearTimeout(this.timers.get(topicId));
      const timer = setTimeout(() => {
        this.timers.delete(topicId);
        void this.run(topicId, scope, {}).catch(() => undefined);
      }, DIRECTOR_DEBOUNCE_MS);
      timer.unref?.();
      this.timers.set(topicId, timer);
    } catch (error) {
      this.logger.warn(
        `[schedule] topic=${topicId} 触发导演规划失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * @description 用户手动「AI 重新规划」：立刻按当前画面重新规划（不管指纹），等规划与模板出图完成后返回；失败时报错。
   * @keyword-cn 手动重新规划, 强制导演规划
   * @keyword-en replan-video-direction, force-direction
   * @param topicId 子选题（脚本）ID。
   * @param prompt 用户补充要求（选填）。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   */
  async plan(
    topicId: number,
    prompt: string | undefined,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    clearTimeout(this.timers.get(topicId));
    this.timers.delete(topicId);
    const topic = await this.run(topicId, scope, { prompt, force: true });
    if (!topic) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }

  /**
   * @description 做一次导演规划：带各段首帧缩略图（每张前面标明是第几段）调「思考」节点，解析出模板与各段运动设计，写回规划后按模板方案出图或停用模板。
   *   后台规划时同一选题正在规划就 10 秒后再排一次；失败写 `status=failed` 与原因，手动规划时再抛出。
   * @keyword-cn 执行导演规划, 读图出方案
   * @keyword-en run-video-direction, vision-planning
   * @param topicId 子选题（脚本）ID。
   * @param scope 租户用户作用域。
   * @param options 补充要求与是否手动触发。
   * @returns 更新后的选题；后台规划被推迟时为 null。
   */
  private async run(
    topicId: number,
    scope: DouyinScope,
    options: { prompt?: string; force?: boolean },
  ): Promise<DouyinTopicEntity | null> {
    if (this.running.has(topicId) && !options.force) {
      const timer = setTimeout(() => {
        this.timers.delete(topicId);
        void this.run(topicId, scope, {}).catch(() => undefined);
      }, 10 * 1000);
      timer.unref?.();
      this.timers.set(topicId, timer);
      return null;
    }
    this.running.add(topicId);
    let fingerprint = '';
    try {
      const topic = await this.requireChild(topicId, scope);
      const frames = listDirectorFrames(topic);
      fingerprint = directionFingerprint(frames);
      const images = await Promise.all(
        frames.map((frame) => this.templates.toVisionImage(frame.url)),
      );
      const storeVisit = topic.productionMode === 'store-visit';
      // 从脚本开始的脚本画面不是门店实拍，按分镜的创意视频规划，运镜不收进原图
      const fromStore =
        storeVisit && storeVisitStart(topic.storeVisit) === 'store';
      const content: VisionContent = [
        {
          type: 'text',
          text: buildDirectorBrief({
            mode: fromStore ? 'store-visit' : 'storyboard',
            title: topic.title,
            script: storeVisit
              ? topic.storeVisit?.script || topic.storeVisit?.lines
              : topic.script,
            storeName: storeVisit ? topic.storeVisit?.storeName : undefined,
            prompt: String(options.prompt ?? '').trim() || undefined,
            frames,
          }),
        },
      ];
      images.forEach((url, index) => {
        if (!url) return;
        content.push(
          {
            type: 'text',
            text: `第 ${index + 1} 张（第 ${index + 1} 段首帧）`,
          },
          { type: 'image_url', image_url: { url } },
        );
      });
      const plan = parseDirectorPlan(
        await this.ask(
          scope,
          'douyin-workbench.video-direction',
          DOUYIN_DIRECTOR_SYSTEM,
          content,
        ),
        frames,
        fromStore,
      );
      const written = await this.repository.setVideoDirection(
        topicId,
        {
          status: 'ready',
          fingerprint,
          shots: plan.shots,
          note: plan.note || undefined,
          updatedAt: new Date(),
        },
        scope,
      );
      if (!written) return null;
      return (
        (await this.applyTemplatePlan(written, plan.template, scope)) ?? written
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[run] topic=${topicId} 导演规划失败: ${detail}`);
      const current = await this.repository
        .get(topicId, scope)
        .catch(() => null);
      if (current?.kind === 'child') {
        await this.repository
          .setVideoDirection(
            topicId,
            {
              status: 'failed',
              fingerprint,
              shots: current.videoDirection?.shots ?? {},
              note: current.videoDirection?.note,
              error: 'AI 导演规划失败，可以点「AI 重新规划」再试',
              updatedAt: new Date(),
            },
            scope,
          )
          .catch(() => undefined);
      }
      if (options.force) throw error;
      return null;
    } finally {
      this.running.delete(topicId);
    }
  }

  /**
   * @description 按规划处理版式模板：用户改过（`source=user`）的不动；不套时停用现有模板或只记下理由；要套且文案、比例与现有 AI 模板一致时只更新理由并启用，
   *   否则用「生图」节点在实拍图上编辑出新模板图，出图失败时保存规划好的模板（没有模板图，界面上可以再点生成）；
   *   没有实拍图或「生图」模型不能改图时模板记为停用，理由写拒绝原因。
   * @keyword-cn 按规划处理模板, 自动起模板
   * @keyword-en apply-template-plan, auto-template
   * @param topic 已写入规划的子选题。
   * @param plan 模板规划。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题；没改模板时为 null。
   */
  private async applyTemplatePlan(
    topic: DouyinTopicEntity,
    plan: DouyinTemplatePlan,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity | null> {
    const current = topic.videoTemplate;
    if (current?.source === 'user') return null;
    const now = new Date();
    if (!plan.useTemplate) {
      const declined: DouyinVideoTemplate = current
        ? {
            ...current,
            enabled: false,
            reason: plan.reason || current.reason,
            source: 'ai',
            updatedAt: now,
          }
        : {
            enabled: false,
            window: plan.window,
            aspectRatio: plan.aspectRatio,
            title: plan.title,
            sellingPoints: plan.sellingPoints,
            style: plan.style,
            reason: plan.reason || undefined,
            source: 'ai',
            updatedAt: now,
          };
      return await this.repository.setVideoTemplate(topic.id, declined, scope);
    }
    const planned: DouyinVideoTemplate = {
      enabled: true,
      window: plan.window,
      aspectRatio: plan.aspectRatio,
      title: plan.title,
      subtitle: plan.subtitle || undefined,
      sellingPoints: plan.sellingPoints,
      cta: plan.cta || undefined,
      style: plan.style,
      reason: plan.reason || undefined,
      source: 'ai',
      updatedAt: now,
    };
    const unchanged =
      current?.imageUrl &&
      current.title === planned.title &&
      (current.subtitle || '') === (planned.subtitle || '') &&
      (current.cta || '') === (planned.cta || '') &&
      current.aspectRatio === planned.aspectRatio &&
      current.sellingPoints.join('|') === planned.sellingPoints.join('|');
    if (unchanged)
      return await this.repository.setVideoTemplate(
        topic.id,
        {
          ...current,
          enabled: true,
          reason: planned.reason,
          source: 'ai',
          updatedAt: now,
        },
        scope,
      );
    try {
      return await this.templates.applyTemplate(topic, planned, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[applyTemplatePlan] topic=${topic.id} 模板图生成失败: ${message}`,
      );
      // 没有实拍图、模型不能改图是主动拒绝，记成停用并写明原因，不保留「已启用但没图」的模板
      return await this.repository.setVideoTemplate(
        topic.id,
        error instanceof BadRequestException
          ? { ...planned, enabled: false, reason: message }
          : planned,
        scope,
      );
    }
  }

  /**
   * @description 出片后的剪辑规划：按桌面端交来的每段时长、人声区间与抽帧（总数压到 32 张以内），配上台词、是否接续上一段尾帧、分镜转场提示，
   *   调「思考」节点定掐头去尾、段间转场、字幕位置大小与封面帧，夹到安全范围后记到合成记录上并返回。
   * @keyword-cn AI剪辑规划, 看片定剪辑点
   * @keyword-en plan-video-edit, review-clips-for-edit
   * @param topicId 子选题（脚本）ID。
   * @param input 合成调用记录 ID 与按成片顺序的各段分析。
   * @param scope 租户用户作用域。
   * @returns 剪辑方案。
   */
  async planEdit(
    topicId: number,
    input: { operationId: string; clips: DouyinEditClipInput[] },
    scope: DouyinScope,
  ): Promise<DouyinEditPlan> {
    const topic = await this.requireChild(topicId, scope);
    if (!input.clips.length)
      throw new BadRequestException('DOUYIN_EDIT_CLIPS_REQUIRED');
    const segments = topic.storeVisit?.segments ?? [];
    const contextOf = (shotId: string): DouyinEditClipContext => {
      if (topic.productionMode === 'store-visit') {
        const index = segments.findIndex((segment) => segment.id === shotId);
        return {
          lines: String(segments[index]?.lines ?? '').trim(),
          continued: index > 0 && !isStoreVisitVisualStart(segments, index),
          transitionHint: '',
        };
      }
      const shot = (topic.storyboard ?? []).find((item) => item.id === shotId);
      return {
        lines: String(shot?.narration ?? '').trim(),
        continued: false,
        transitionHint: String(shot?.transition ?? '').trim(),
      };
    };
    // 抽帧总数压到预算内：每段至少 2 张，均匀挑
    const perClip = Math.max(
      2,
      Math.floor(EDIT_FRAME_BUDGET / input.clips.length),
    );
    const clips = input.clips.map((clip) => {
      if (clip.frames.length <= perClip) return clip;
      const step = (clip.frames.length - 1) / (perClip - 1);
      return {
        ...clip,
        frames: Array.from(
          { length: perClip },
          (_, index) => clip.frames[Math.round(index * step)],
        ),
      };
    });
    const template =
      topic.videoTemplate?.enabled && topic.videoTemplate.imageUrl
        ? `成片套了版式模板，视频在 ${topic.videoTemplate.aspectRatio} 窗口里，字幕烧在窗口内。`
        : '成片是满屏竖屏 9:16。';
    const content: VisionContent = [
      {
        type: 'text',
        text: `视频：${topic.title}；共 ${clips.length} 段，按顺序拼成一条成片。${template}`,
      },
    ];
    clips.forEach((clip, index) => {
      content.push({
        type: 'text',
        text: buildEditClipBrief(clip, contextOf(clip.shotId), index),
      });
      for (const frame of clip.frames) {
        if (!/^data:image\/(jpeg|png|webp);base64,/i.test(frame.image))
          continue;
        content.push({ type: 'image_url', image_url: { url: frame.image } });
      }
    });
    const plan = parseEditPlan(
      await this.ask(
        scope,
        'douyin-workbench.video-edit-plan',
        DOUYIN_EDIT_PLAN_SYSTEM,
        content,
      ),
      clips,
    );
    await this.shotConcat.attachEditPlan(
      input.operationId,
      topicId,
      plan,
      scope,
    );
    return plan;
  }

  /**
   * @description 用「思考」节点做一次看图问答（两分钟超时、不流式、不走后置钩子、按节点计费），返回模型文字。
   * @keyword-cn 导演看图问答, 思考节点调用
   * @keyword-en director-vision-ask, think-node-call
   * @param scope 租户用户作用域。
   * @param source 计费来源。
   * @param system 系统提示。
   * @param content 用户消息（文字与图片交替）。
   * @returns 模型输出的文字。
   */
  private async ask(
    scope: DouyinScope,
    source: string,
    system: string,
    content: VisionContent,
  ): Promise<string> {
    const node = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.think,
    );
    const result = await this.agentService.runWithMessages({
      callOption: { signal: AbortSignal.timeout(2 * 60 * 1000) },
      config: {
        ...toWorkflowLlmConfig(node),
        tenantId: scope.tenantId,
        temperature: 0.3,
        nonStreaming: true,
        noPostHook: true,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          platformScope: !scope.tenantId,
          source,
        },
        system,
      },
      messages: [{ role: 'user', content }],
    });
    return typeof result.content === 'string'
      ? result.content
      : result.content
          .map((part) =>
            typeof part === 'object' && 'text' in part ? String(part.text) : '',
          )
          .join('');
  }

  /**
   * @description 读取子选题，不存在或不是子选题时报错。
   * @keyword-cn 读取子选题, 选题校验
   * @keyword-en require-child-topic, topic-check
   * @param topicId 子选题 ID。
   * @param scope 租户用户作用域。
   * @returns 子选题。
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
