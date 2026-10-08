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
