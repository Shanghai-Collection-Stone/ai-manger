import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import type {
  XhsCleanupSettings,
  XhsCleanupSettingsEntity,
} from '../entities/xhs-topic-cleanup-settings.entity.js';
import {
  normalizeCleanupSettings,
  resolveDefaultCleanupSettings,
  xhsCleanupScopeKey,
} from '../xhs-topic-retention.constants.js';

/**
 * @description 租户自己维护的选题、草稿与文章库清理设置，未保存过时回落平台默认值。
 * @keyword-cn 租户清理设置, 平台默认清理设置
 * @keyword-en tenant-cleanup-settings, default-cleanup-settings
 */
@Injectable()
export class XhsTopicCleanupSettingsService {
  private readonly settings: Collection<XhsCleanupSettingsEntity>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.settings = db.collection<XhsCleanupSettingsEntity>(
      'xhs_topic_cleanup_settings',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 按租户作用域建立唯一索引，保证一个租户只有一份清理设置。
   * @keyword-cn 清理设置索引, 租户唯一
   * @keyword-en cleanup-settings-index, unique-tenant-scope
   */
  async ensureIndexes(): Promise<void> {
    await this.settings.createIndex({ scopeKey: 1 }, { unique: true });
  }

  /**
   * @description 返回平台默认清理设置，供接口展示与未配置租户回落。
   * @keyword-cn 平台默认清理设置, 环境变量默认值
   * @keyword-en default-cleanup-settings, env-default-retention
   */
  defaults(): XhsCleanupSettings {
    return resolveDefaultCleanupSettings();
  }

  /**
   * @description 读取当前租户的清理设置，缺失字段按平台默认值补齐。
   * @keyword-cn 读取清理设置, 租户作用域
   * @keyword-en get-cleanup-settings, tenant-scope
   */
  async get(tenantId?: string | null): Promise<XhsCleanupSettings> {
    const stored = await this.settings.findOne({
      scopeKey: xhsCleanupScopeKey(tenantId),
    });
    return normalizeCleanupSettings(stored, this.defaults());
  }

  /**
   * @description 合并保存租户清理设置，只覆盖本次传入的清理对象，返回保存后的完整设置。
   * @keyword-cn 保存清理设置, 部分更新
   * @keyword-en save-cleanup-settings, partial-update
   */
  async save(
    tenantId: string | null | undefined,
    input: Partial<XhsCleanupSettings>,
    updatedBy: string,
  ): Promise<XhsCleanupSettings> {
    const current = await this.get(tenantId);
    const next = normalizeCleanupSettings({ ...current, ...input }, current);
    const now = new Date();
    await this.settings.updateOne(
      { scopeKey: xhsCleanupScopeKey(tenantId) },
      {
        $set: {
          ...next,
          tenantId: String(tenantId ?? '').trim() || null,
          updatedBy,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    return next;
  }

  /**
   * @description 一次读出全部租户的清理设置，供每日清理按租户取规则，避免逐个租户查库。
   * @keyword-cn 批量读取清理设置, 每日清理
   * @keyword-en load-all-cleanup-settings, daily-cleanup
   */
  async loadAll(): Promise<Map<string, XhsCleanupSettings>> {
    const defaults = this.defaults();
    const rows = await this.settings.find({}).toArray();
    return new Map(
      rows.map((row) => [
        row.scopeKey,
        normalizeCleanupSettings(row, defaults),
      ]),
    );
  }
}
