import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import type { XhsTopicEntity } from '../entities/xhs-topic.entity.js';
import {
  resolveRetentionDays,
  XHS_DRAFT_RETENTION_DEFAULT_DAYS,
  XHS_TOPIC_IDLE_DEFAULT_DAYS,
} from '../xhs-topic-retention.constants.js';
import { XhsArticleGenerationService } from './xhs-article-generation.service.js';
import { XhsTopicRepositoryService } from './xhs-topic-repository.service.js';

const CLEANUP_TICK_MS = 60 * 60 * 1000;
const CLEANUP_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type TopicScope = { tenantId?: string; userId: string };

/**
 * @description 小红书母题闲置与文章草稿定时清理服务，启动时先补齐历史数据宽限期，再按日执行幂等清理。
 * @keyword-cn 选题自动清理, 首次上线回填, 幂等清理
 * @keyword-en topic-auto-cleanup, startup-backfill, idempotent-cleanup
 */
@Injectable()
export class XhsTopicCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XhsTopicCleanupService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupBusy = false;
  private lastCleanupAt: Date | null = null;

  constructor(
    private readonly repository: XhsTopicRepositoryService,
    private readonly articleGeneration: XhsArticleGenerationService,
  ) {}

  /**
   * @description 启动时回填历史清理时钟、立即执行一次清理，并启动每小时一次的到期检查；多进程时只在 leader 进程上跑。
   * @keyword-cn 启动清理调度, 历史时间回填
   * @keyword-en start-cleanup-scheduler, historical-timestamp-backfill
   */
  async onModuleInit(): Promise<void> {
    if (this.cleanupTimer || !isLeaderProcess()) return;
    const now = new Date();
    const backfilled = await this.repository.backfillCleanupTimestamps(now);
    this.logger.log(
      `清理时间回填完成：母题 ${backfilled.mothers} 条，草稿 ${backfilled.drafts} 条`,
    );
    await this.runCleanupIfDue(now);
    this.cleanupTimer = setInterval(() => {
      void this.runCleanupIfDue(new Date());
    }, CLEANUP_TICK_MS);
    this.cleanupTimer.unref?.();
  }

  /**
   * @description 模块销毁时释放选题清理定时器。
   * @keyword-cn 停止清理调度, 释放定时器
   * @keyword-en stop-cleanup-scheduler, clear-cleanup-timer
   */
  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  /**
   * @description 删除超过闲置期限、未星标且名下没有任何已入库子题的母题，并级联删除其子题。
   * @keyword-cn 清理闲置母题, 已入库保护, 级联删除
   * @keyword-en cleanup-idle-mothers, stored-article-protection, cascade-delete
   */
  async cleanupIdleMotherTopics(now: Date): Promise<number> {
    const idleDays = resolveRetentionDays(
      process.env.XHS_TOPIC_IDLE_DAYS,
      XHS_TOPIC_IDLE_DEFAULT_DAYS,
    );
    const cutoff = new Date(now.getTime() - idleDays * 24 * 60 * 60 * 1000);
    const expired = await this.repository.listExpiredMotherTopics(cutoff);
    let deleted = 0;
    for (const [scope, mothers] of this.groupByScope(expired)) {
      const groups = await this.repository.listWorkspace(scope, {
        includeStoredArticles: true,
      });
      const childIdsByMother = new Map(
        groups.map((group) => [group.id, group.children.map((child) => child.id)]),
      );
      const allChildIds = mothers.flatMap(
        (mother) => childIdsByMother.get(mother.id) ?? [],
      );
      const storedIds = await this.repository.listStoredArticleTopicIds(
        scope,
        allChildIds,
      );
      for (const mother of mothers) {
        const protectedByStoredArticle = (
          childIdsByMother.get(mother.id) ?? []
        ).some((childId) => storedIds.has(childId));
        if (protectedByStoredArticle) continue;
        const latest = await this.repository.getOwnedTopic(mother.id, scope);
        if (
          !latest ||
          latest.kind !== 'mother' ||
          latest.starred === true ||
          !latest.lastActiveAt ||
          latest.lastActiveAt >= cutoff
        ) {
          continue;
        }
        const deletedDocuments = await this.repository.deleteMany(
          [mother.id],
          scope,
        );
        if (deletedDocuments > 0) deleted += 1;
      }
    }
    this.logger.log(`闲置母题清理完成：删除 ${deleted} 个母题`);
    return deleted;
  }

  /**
   * @description 清空超过保留期、未入文章库且当前没有生成任务运行的子题文章，并把状态恢复为未生成。
   * @keyword-cn 清理过期草稿, 运行任务保护, 已入库保护
   * @keyword-en cleanup-expired-drafts, running-task-protection, stored-article-protection
   */
  async cleanupExpiredDrafts(now: Date): Promise<number> {
    const retentionDays = resolveRetentionDays(
      process.env.XHS_DRAFT_RETENTION_DAYS,
      XHS_DRAFT_RETENTION_DEFAULT_DAYS,
    );
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const expired = await this.repository.listExpiredDraftTopics(cutoff);
    let cleared = 0;
    for (const [scope, drafts] of this.groupByScope(expired)) {
      const topicIds = drafts.map((draft) => draft.id);
      const [storedIds, generationStates] = await Promise.all([
        this.repository.listStoredArticleTopicIds(scope, topicIds),
        this.articleGeneration.listGenerations(scope),
      ]);
      const activeIds = new Set(
        generationStates
          .filter((state) => state.status === 'queued' || state.status === 'running')
          .map((state) => state.topicId),
      );
      for (const draft of drafts) {
        if (storedIds.has(draft.id) || activeIds.has(draft.id)) continue;
        if (
          await this.repository.clearExpiredDraft(
            draft.id,
            cutoff,
            now,
            scope,
          )
        ) {
          cleared += 1;
        }
      }
    }
    this.logger.log(`过期文章草稿清理完成：清空 ${cleared} 条`);
    return cleared;
  }

  /**
   * @description 每小时检查距上次实际清理是否已满二十四小时，并防止本进程内重叠执行。
   * @keyword-cn 每日清理门控, 防止重叠执行
   * @keyword-en daily-cleanup-gate, overlapping-run-guard
   */
  private async runCleanupIfDue(now: Date): Promise<void> {
    if (
      this.cleanupBusy ||
      (this.lastCleanupAt &&
        now.getTime() - this.lastCleanupAt.getTime() < CLEANUP_RUN_INTERVAL_MS)
    ) {
      return;
    }
    this.cleanupBusy = true;
    try {
      await this.cleanupIdleMotherTopics(now);
      await this.cleanupExpiredDrafts(now);
      this.lastCleanupAt = now;
    } catch (error) {
      this.logger.error(
        `选题自动清理失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.cleanupBusy = false;
    }
  }

  /**
   * @description 按租户与用户作用域归组选题，确保文章库保护判断和级联删除沿用原有隔离口径。
   * @keyword-cn 清理作用域分组, 租户隔离
   * @keyword-en cleanup-scope-grouping, tenant-isolation
   */
  private groupByScope(
    entities: XhsTopicEntity[],
  ): Array<[TopicScope, XhsTopicEntity[]]> {
    const grouped = new Map<string, { scope: TopicScope; entities: XhsTopicEntity[] }>();
    for (const entity of entities) {
      const tenantId = String(entity.tenantId ?? '').trim() || undefined;
      const key = `${tenantId ?? ''}\u0000${entity.userId}`;
      const current = grouped.get(key) ?? {
        scope: { tenantId, userId: entity.userId },
        entities: [],
      };
      current.entities.push(entity);
      grouped.set(key, current);
    }
    return [...grouped.values()].map(({ scope, entities: scopedEntities }) => [
      scope,
      scopedEntities,
    ]);
  }
}
