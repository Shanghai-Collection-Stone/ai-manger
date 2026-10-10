import type { ObjectId } from 'mongodb';

/**
 * @description 租户可自行配置清理规则的三类内容：闲置母题、子题草稿文章、文章库已发布文章。
 * @keyword-cn 清理对象, 租户清理设置
 * @keyword-en cleanup-target, tenant-cleanup-settings
 */
export const XHS_CLEANUP_TARGETS = [
  'motherTopic',
  'draftArticle',
  'libraryArticle',
] as const;

/**
 * @description 清理对象标识。
 * @keyword-cn 清理对象, 租户清理设置
 * @keyword-en cleanup-target, tenant-cleanup-settings
 */
export type XhsCleanupTarget = (typeof XHS_CLEANUP_TARGETS)[number];

/**
 * @description 单类内容的清理规则：开关、保留天数与数量上限（`0` 表示不限条数）。
 * @keyword-cn 清理规则, 保留天数, 数量上限
 * @keyword-en cleanup-rule, retention-days, max-count
 */
export interface XhsCleanupRule {
  enabled: boolean;
  retentionDays: number;
  maxCount: number;
}

/**
 * @description 一个租户的完整清理设置，三类内容各一条规则。
 * @keyword-cn 租户清理设置, 清理规则
 * @keyword-en tenant-cleanup-settings, cleanup-rule
 */
export type XhsCleanupSettings = Record<XhsCleanupTarget, XhsCleanupRule>;

/**
 * @description `xhs_topic_cleanup_settings` 集合文档，按 `scopeKey`（租户 ID，平台账号为 `__platform__`）唯一。
 * @keyword-cn 清理设置实体, 租户作用域
 * @keyword-en cleanup-settings-entity, tenant-scope
 */
export interface XhsCleanupSettingsEntity extends XhsCleanupSettings {
  _id?: ObjectId;
  scopeKey: string;
  tenantId: string | null;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
