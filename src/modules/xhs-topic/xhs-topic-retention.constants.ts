import {
  XHS_CLEANUP_TARGETS,
  type XhsCleanupRule,
  type XhsCleanupSettings,
} from './entities/xhs-topic-cleanup-settings.entity.js';

/**
 * @description 母题无活动且未受文章库保护时的默认保留天数。
 * @keyword-cn 母题闲置期限, 默认保留天数
 * @keyword-en topic-idle-retention, default-retention-days
 */
export const XHS_TOPIC_IDLE_DEFAULT_DAYS = 30;

/**
 * @description 未存入文章库的子题草稿文章默认保留天数。
 * @keyword-cn 草稿保留期限, 默认保留天数
 * @keyword-en draft-retention, default-retention-days
 */
export const XHS_DRAFT_RETENTION_DEFAULT_DAYS = 7;

/**
 * @description 文章库已发布文章的默认保留天数；该类清理默认关闭，租户开启时才生效。
 * @keyword-cn 文章库保留期限, 默认保留天数
 * @keyword-en library-article-retention, default-retention-days
 */
export const XHS_LIBRARY_RETENTION_DEFAULT_DAYS = 90;

/**
 * @description 租户可设置的最长保留天数。
 * @keyword-cn 保留天数上限, 清理设置校验
 * @keyword-en retention-days-limit, cleanup-settings-validation
 */
export const XHS_CLEANUP_RETENTION_MAX_DAYS = 3650;

/**
 * @description 租户可设置的最大数量上限值。
 * @keyword-cn 数量上限取值, 清理设置校验
 * @keyword-en max-count-limit, cleanup-settings-validation
 */
export const XHS_CLEANUP_MAX_COUNT_LIMIT = 100000;

/**
 * @description 无租户账号（平台作用域）的清理设置键。
 * @keyword-cn 平台作用域, 清理设置键
 * @keyword-en platform-scope, cleanup-scope-key
 */
export const XHS_CLEANUP_PLATFORM_SCOPE_KEY = '__platform__';

/**
 * @description 读取正整数天数配置，非法、空值或非整数配置回落到默认值。
 * @keyword-cn 保留天数配置, 非法值回落
 * @keyword-en retention-days-config, invalid-value-fallback
 */
export function resolveRetentionDays(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @description 将基准时间加上指定保留天数，生成接口展示与清理判断共用的到期时间。
 * @keyword-cn 清理到期时间, 保留期限计算
 * @keyword-en cleanup-deadline, retention-deadline
 */
export function addRetentionDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * @description 租户没保存过设置时使用的平台默认值：母题与草稿开启并读取环境变量天数，文章库关闭，数量均不限。
 * @keyword-cn 平台默认清理设置, 环境变量默认值
 * @keyword-en default-cleanup-settings, env-default-retention
 */
export function resolveDefaultCleanupSettings(
  env: NodeJS.ProcessEnv = process.env,
): XhsCleanupSettings {
  return {
    motherTopic: {
      enabled: true,
      retentionDays: resolveRetentionDays(
        env.XHS_TOPIC_IDLE_DAYS,
        XHS_TOPIC_IDLE_DEFAULT_DAYS,
      ),
      maxCount: 0,
    },
    draftArticle: {
      enabled: true,
      retentionDays: resolveRetentionDays(
        env.XHS_DRAFT_RETENTION_DAYS,
        XHS_DRAFT_RETENTION_DEFAULT_DAYS,
      ),
      maxCount: 0,
    },
    libraryArticle: {
      enabled: false,
      retentionDays: XHS_LIBRARY_RETENTION_DEFAULT_DAYS,
      maxCount: 0,
    },
  };
}

/**
 * @description 逐项校验清理设置，缺失或越界的字段沿用回退值，保证三类规则始终完整。
 * @keyword-cn 清理设置归一化, 非法值回落
 * @keyword-en normalize-cleanup-settings, invalid-value-fallback
 */
export function normalizeCleanupSettings(
  input: unknown,
  fallback: XhsCleanupSettings,
): XhsCleanupSettings {
  const source =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const settings = {} as XhsCleanupSettings;
  for (const target of XHS_CLEANUP_TARGETS) {
    settings[target] = normalizeCleanupRule(source[target], fallback[target]);
  }
  return settings;
}

/**
 * @description 校验单条清理规则：天数为 1 至上限的整数，数量为 0 至上限的整数，开关必须是布尔值。
 * @keyword-cn 清理规则校验, 非法值回落
 * @keyword-en normalize-cleanup-rule, invalid-value-fallback
 */
function normalizeCleanupRule(
  input: unknown,
  fallback: XhsCleanupRule,
): XhsCleanupRule {
  const source =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const days = Number(source.retentionDays);
  const count = Number(source.maxCount);
  return {
    enabled:
      typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    retentionDays:
      Number.isInteger(days) &&
      days >= 1 &&
      days <= XHS_CLEANUP_RETENTION_MAX_DAYS
        ? days
        : fallback.retentionDays,
    maxCount:
      Number.isInteger(count) &&
      count >= 0 &&
      count <= XHS_CLEANUP_MAX_COUNT_LIMIT
        ? count
        : fallback.maxCount,
  };
}

/**
 * @description 把租户 ID 转成清理设置键，无租户账号统一归到平台作用域。
 * @keyword-cn 清理设置键, 平台作用域
 * @keyword-en cleanup-scope-key, platform-scope
 */
export function xhsCleanupScopeKey(tenantId?: string | null): string {
  return String(tenantId ?? '').trim() || XHS_CLEANUP_PLATFORM_SCOPE_KEY;
}

/**
 * @description 计算超出数量上限时要腾出的条目：总数扣掉已按天数选中的条目后仍超出上限的部分，
 *   从可清理条目里按时间最早优先挑选；受保护条目照样计数但不会被选中，因此可能腾不满。
 * @keyword-cn 超出数量上限, 最早优先清理
 * @keyword-en select-capacity-overflow, oldest-first-eviction
 */
export function selectCapacityOverflow<T>(input: {
  candidates: readonly T[];
  total: number;
  maxCount: number;
  excluded: ReadonlySet<T>;
  isEvictable: (item: T) => boolean;
  timeOf: (item: T) => number;
}): T[] {
  if (!(input.maxCount > 0)) return [];
  const overflow = input.total - input.excluded.size - input.maxCount;
  if (overflow <= 0) return [];
  return input.candidates
    .filter((item) => !input.excluded.has(item) && input.isEvictable(item))
    .sort((left, right) => input.timeOf(left) - input.timeOf(right))
    .slice(0, overflow);
}
