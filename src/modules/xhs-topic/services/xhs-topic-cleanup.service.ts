import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ArticleService } from '../../article-library/services/article.service.js';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import type {
  XhsCleanupRule,
  XhsCleanupSettings,
} from '../entities/xhs-topic-cleanup-settings.entity.js';
import type { XhsTopicWorkspaceGroup } from '../entities/xhs-topic.entity.js';
import {
  selectCapacityOverflow,
  xhsCleanupScopeKey,
} from '../xhs-topic-retention.constants.js';
import { XhsArticleGenerationService } from './xhs-article-generation.service.js';
import { XhsTopicCleanupSettingsService } from './xhs-topic-cleanup-settings.service.js';
import { XhsTopicRepositoryService } from './xhs-topic-repository.service.js';

const CLEANUP_TICK_MS = 60 * 60 * 1000;
const CLEANUP_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @description 小红书内容定时清理服务：启动时先补齐历史数据宽限期，再每日按各租户自己的设置
 *   幂等清理文章库已发布文章、子题草稿与闲置母题。
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
    private readonly cleanupSettings: XhsTopicCleanupSettingsService,
    private readonly articles: ArticleService,
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
   * @description 遍历有选题或已发布文章的全部租户，按各自设置依次清理文章库、草稿与母题；单个租户失败不影响其他租户。
   *   顺序固定为文章库 → 草稿 → 母题：文章库清理会解除子题的入库保护，随后的母题判断才能看到最新状态。
   * @keyword-cn 按租户清理, 租户清理设置
   * @keyword-en per-tenant-cleanup, tenant-cleanup-settings
   */
  async runCleanup(now: Date): Promise<void> {
    const [stored, topicTenants, articleTenants] = await Promise.all([
      this.cleanupSettings.loadAll(),
      this.repository.listTopicTenantIds(),
      this.articles.listPublishedTenantIds(),
    ]);
    const defaults = this.cleanupSettings.defaults();
    const tenants = new Map<string, string | undefined>();
    for (const tenantId of [...topicTenants, ...articleTenants]) {
      tenants.set(xhsCleanupScopeKey(tenantId), tenantId);
    }
    const totals = { library: 0, drafts: 0, mothers: 0 };
    for (const [scopeKey, tenantId] of tenants) {
      const rules: XhsCleanupSettings = stored.get(scopeKey) ?? defaults;
      try {
        if (rules.libraryArticle.enabled) {
          totals.library += await this.cleanupLibraryArticles(
            tenantId,
            rules.libraryArticle,
            now,
          );
        }
        if (rules.draftArticle.enabled) {
          totals.drafts += await this.cleanupExpiredDrafts(
            tenantId,
            rules.draftArticle,
            now,
          );
        }
        if (rules.motherTopic.enabled) {
          totals.mothers += await this.cleanupIdleMotherTopics(
            tenantId,
            rules.motherTopic,
            now,
          );
        }
      } catch (error) {
        this.logger.error(
          `租户 ${scopeKey} 自动清理失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(
      `自动清理完成：文章库删除 ${totals.library} 篇，草稿清空 ${totals.drafts} 条，母题删除 ${totals.mothers} 个`,
    );
  }

  /**
   * @description 删除租户内超过保留期或超出数量上限的已发布文章（未发布与租约中的不删），
   *   来源是选题的同时清空子题文章，避免它以草稿形式回到选题页。
   * @keyword-cn 清理文章库文章, 只清已发布, 文章库清理联动
   * @keyword-en cleanup-library-articles, published-only, library-cleanup-cascade
   */
  async cleanupLibraryArticles(
    tenantId: string | undefined,
    rule: XhsCleanupRule,
    now: Date,
  ): Promise<number> {
    const cutoff = now.getTime() - rule.retentionDays * DAY_MS;
    const [published, total] = await Promise.all([
      this.articles.listPublishedForCleanup(tenantId),
      rule.maxCount > 0
        ? this.articles.countByTenant(tenantId)
        : Promise.resolve(0),
    ]);
    type PublishedArticle = (typeof published)[number];
    const publishedAtOf = (article: PublishedArticle) =>
      (article.publishedAt ?? article.updatedAt).getTime();
    const evictable = (article: PublishedArticle) =>
      !(article.lockExpireAt && article.lockExpireAt.getTime() > now.getTime());
    const expired = new Set(
      published.filter(
        (article) => evictable(article) && publishedAtOf(article) < cutoff,
      ),
    );
    const overflow = selectCapacityOverflow({
      candidates: published,
      total,
      maxCount: rule.maxCount,
      excluded: expired,
      isEvictable: evictable,
      timeOf: publishedAtOf,
    });
    let deleted = 0;
    for (const article of [...expired, ...overflow]) {
      if (!(await this.articles.delete(article.id, tenantId))) continue;
      deleted += 1;
      const topicId = Number(article.meta?.xhsTopicId);
      if (
        article.source !== 'xhs-topic' ||
        !Number.isInteger(topicId) ||
        topicId <= 0
      ) {
        continue;
      }
      // 同一子题可能又存进了别的库，那篇还在就不能清子题文章
      const stillStored = await this.repository.listStoredArticleTopicIds(
        { tenantId, userId: '' },
        [topicId],
      );
      if (!stillStored.has(topicId)) {
        await this.repository.clearArticleAfterLibraryCleanup(
          topicId,
          tenantId,
          now,
        );
      }
    }
    return deleted;
  }

  /**
   * @description 清空租户内各成员超过保留期或超出数量上限的子题草稿（已入库与生成中的不清），子题恢复未生成并保留标题。
   * @keyword-cn 清理过期草稿, 运行任务保护, 已入库保护
   * @keyword-en cleanup-expired-drafts, running-task-protection, stored-article-protection
   */
  async cleanupExpiredDrafts(
    tenantId: string | undefined,
    rule: XhsCleanupRule,
    now: Date,
  ): Promise<number> {
    const cutoff = now.getTime() - rule.retentionDays * DAY_MS;
    const userIds = await this.repository.listDraftCleanupUserIds(
      tenantId,
      rule.maxCount > 0 ? undefined : new Date(cutoff),
    );
    let cleared = 0;
    for (const userId of userIds) {
      const scope = { tenantId, userId };
      const [drafts, generationStates] = await Promise.all([
        this.repository.listDraftTopics(scope),
        this.articleGeneration.listGenerations(scope),
      ]);
      const storedIds = await this.repository.listStoredArticleTopicIds(
        scope,
        drafts.map((draft) => draft.id),
      );
      const activeIds = new Set(
        generationStates
          .filter(
            (state) => state.status === 'queued' || state.status === 'running',
          )
          .map((state) => state.topicId),
      );
      // 已入库的文章算文章库内容，不占草稿名额
      const pending = drafts.filter(
        (draft) => draft.article?.draftAt && !storedIds.has(draft.id),
      );
      type Draft = (typeof pending)[number];
      const draftAtOf = (draft: Draft) => draft.article!.draftAt!.getTime();
      const evictable = (draft: Draft) => !activeIds.has(draft.id);
      const expired = new Set(
        pending.filter(
          (draft) => evictable(draft) && draftAtOf(draft) < cutoff,
        ),
      );
      const overflow = selectCapacityOverflow({
        candidates: pending,
        total: pending.length,
        maxCount: rule.maxCount,
        excluded: expired,
        isEvictable: evictable,
        timeOf: draftAtOf,
      });
      for (const draft of [...expired, ...overflow]) {
        // 截止时间取观察到的草稿时钟 +1ms：期间被编辑刷新过的草稿不会被误清
        if (
          await this.repository.clearExpiredDraft(
            draft.id,
            new Date(draftAtOf(draft) + 1),
            now,
            scope,
          )
        ) {
          cleared += 1;
        }
      }
    }
    return cleared;
  }

  /**
   * @description 删除租户内各成员超过闲置期限或超出数量上限的母题并级联子题；星标母题与名下有已入库子题的母题计数但不删。
   * @keyword-cn 清理闲置母题, 已入库保护, 级联删除
   * @keyword-en cleanup-idle-mothers, stored-article-protection, cascade-delete
   */
  async cleanupIdleMotherTopics(
    tenantId: string | undefined,
    rule: XhsCleanupRule,
    now: Date,
  ): Promise<number> {
    const cutoff = now.getTime() - rule.retentionDays * DAY_MS;
    const userIds = await this.repository.listMotherCleanupUserIds(
      tenantId,
      rule.maxCount > 0 ? undefined : new Date(cutoff),
    );
    let deleted = 0;
    for (const userId of userIds) {
      const scope = { tenantId, userId };
      const groups = await this.repository.listWorkspace(scope, {
        includeStoredArticles: true,
      });
      const storedIds = await this.repository.listStoredArticleTopicIds(
        scope,
        groups.flatMap((group) => group.children.map((child) => child.id)),
      );
      const activeAtOf = (group: XhsTopicWorkspaceGroup) =>
        Date.parse(group.lastActiveAt);
      const evictable = (group: XhsTopicWorkspaceGroup) =>
        !group.starred &&
        !group.children.some((child) => storedIds.has(child.id));
      const expired = new Set(
        groups.filter(
          (group) => evictable(group) && activeAtOf(group) < cutoff,
        ),
      );
      const overflow = selectCapacityOverflow({
        candidates: groups,
        total: groups.length,
        maxCount: rule.maxCount,
        excluded: expired,
        isEvictable: evictable,
        timeOf: activeAtOf,
      });
      for (const group of [...expired, ...overflow]) {
        const latest = await this.repository.getOwnedTopic(group.id, scope);
        // 读列表后被星标或刷新过活动时间的母题跳过
        if (
          !latest ||
          latest.kind !== 'mother' ||
          latest.starred === true ||
          !latest.lastActiveAt ||
          latest.lastActiveAt.getTime() > activeAtOf(group)
        ) {
          continue;
        }
        if ((await this.repository.deleteMany([group.id], scope)) > 0)
          deleted += 1;
      }
    }
    return deleted;
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
      await this.runCleanup(now);
      this.lastCleanupAt = now;
    } catch (error) {
      this.logger.error(
        `选题自动清理失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.cleanupBusy = false;
    }
  }
}
