import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Request } from 'express';
import type { Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import type { DashboardConfigMappingEntity } from '../entities/dashboard-config.entity.js';

const DEFAULT_DASHBOARD_CODE = 'ai-commander';
const DASHBOARD_CONFIG_BASE_DIR = path.resolve(
  process.cwd(),
  'config',
  'dashboards',
);
const DEFAULT_PLATFORM_CONFIG_PATH =
  'config/dashboards/platform.dashboard.json';

/**
 * @description 解析Header中的API Key（兼容 sass 的 x-request-id / x-api-key / Authorization: ApiKey）
 * @keyword-en parse api key header
 */
function parseApiKey(req: Request): string | null {
  const requestIdValue = req.header('x-request-id');
  if (typeof requestIdValue === 'string' && requestIdValue.trim()) {
    return requestIdValue.trim();
  }
  const directValue = req.header('x-api-key');
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }
  const authorization = req.header('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');
  if ((scheme ?? '').toLowerCase() === 'apikey' && token) {
    return token.trim();
  }
  return null;
}

/**
 * @description 对API Key进行哈希（与 sass 一致）
 * @keyword-en hash api key
 */
function hashApiKey(value: string): string {
  const digest = createHash('sha256').update(value).digest('base64');
  return digest.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * @description 看板配置服务（租户映射 + JSON 文件加载）
 * @keyword-en dashboard config service
 */
@Injectable()
export class DashboardConfigService {
  private readonly mappings: Collection<DashboardConfigMappingEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly adminService: AdminService,
  ) {
    this.mappings = db.collection<DashboardConfigMappingEntity>(
      'dashboard_config_mappings',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 初始化索引
   * @keyword-en ensure indexes
   */
  private async ensureIndexes(): Promise<void> {
    await this.mappings.createIndexes([
      {
        key: { dashboardCode: 1, tenantId: 1 },
        unique: true,
        name: 'uniq_dashboard_tenant',
      },
      { key: { updatedAt: -1 }, name: 'idx_updated_at' },
      { key: { enabled: 1 }, name: 'idx_enabled' },
    ]);
  }

  /**
   * @description 解析请求范围（Bearer 优先，其次 API key）
   * @keyword-en resolve request scope
   */
  async resolveScope(
    req: Request,
  ): Promise<{ tenantId?: string; userId?: string }> {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token) {
        const user = await this.adminService.getUserByToken(token);
        if (user) return { tenantId: user.tenantId, userId: user.username };
      }
    }

    const apiKey = parseApiKey(req);
    if (!apiKey) return {};
    const keyId = hashApiKey(apiKey);
    const doc = await this.db
      .collection<Record<string, unknown>>('sass_api_keys')
      .findOne({ keyId, revokedAt: { $exists: false } });
    if (!doc) return {};
    const expiresAt = doc['expiresAt'];
    if (expiresAt instanceof Date && expiresAt.getTime() < Date.now())
      return {};
    const tenantId = doc['tenantId'];
    if (typeof tenantId !== 'string' || !tenantId.trim()) return {};
    return { tenantId: tenantId.trim() };
  }

  /**
   * @description 读取当前范围的看板 JSON 配置
   * @keyword-en get scoped dashboard config
   */
  async getScopedConfig(input: {
    tenantId?: string;
    dashboardCode?: string;
  }): Promise<{
    dashboardCode: string;
    tenantId?: string;
    filePath: string;
    config: Record<string, unknown>;
  }> {
    const dashboardCode = this.normalizeDashboardCode(input.dashboardCode);
    const tenantId = this.normalizeTenantId(input.tenantId);

    // 1. 租户有值时先查租户专属映射
    // 2. 无租户 / 租户无专属映射时，回退到母平台映射（tenantId = null 或不存在）
    let mapping = tenantId
      ? await this.mappings.findOne({ dashboardCode, tenantId, enabled: true })
      : null;

    if (!mapping) {
      mapping =
        (await this.mappings.findOne({
          dashboardCode,
          tenantId: null,
          enabled: true,
        })) ??
        (await this.mappings.findOne({
          dashboardCode,
          tenantId: { $exists: false },
          enabled: true,
        }));
    }

    const filePath =
      mapping && typeof mapping.filePath === 'string' && mapping.filePath.trim()
        ? mapping.filePath.trim()
        : DEFAULT_PLATFORM_CONFIG_PATH;

    // AI 工具修改过的 customConfig 优先于文件
    const config: Record<string, unknown> =
      mapping?.customConfig && typeof mapping.customConfig === 'object'
        ? mapping.customConfig
        : await this.loadConfigJson(filePath);

    return {
      dashboardCode,
      tenantId: tenantId ?? undefined,
      filePath,
      config,
    };
  }

  /**
   * @description AI 工具：对当前看板配置进行 JSON Merge Patch，结果存入 customConfig
   * @keyword-en patch dashboard config via AI tool
   */
  async patchConfig(input: {
    tenantId?: string;
    dashboardCode?: string;
    patch: Record<string, unknown>;
  }): Promise<void> {
    const current = await this.getScopedConfig({
      tenantId: input.tenantId,
      dashboardCode: input.dashboardCode,
    });
    const merged = this.mergePatch(current.config, input.patch) as Record<
      string,
      unknown
    >;
    const dashboardCode = this.normalizeDashboardCode(input.dashboardCode);
    const tenantId = this.normalizeTenantId(input.tenantId) ?? null;
    await this.mappings.updateOne(
      { dashboardCode, tenantId },
      { $set: { customConfig: merged, updatedAt: new Date() } },
    );
  }

  /**
   * @description AI 工具：清除 customConfig，回退到文件配置
   * @keyword-en reset dashboard config to file
   */
  async resetConfig(input: {
    tenantId?: string;
    dashboardCode?: string;
  }): Promise<void> {
    const dashboardCode = this.normalizeDashboardCode(input.dashboardCode);
    const tenantId = this.normalizeTenantId(input.tenantId) ?? null;
    await this.mappings.updateOne(
      { dashboardCode, tenantId },
      { $unset: { customConfig: '' }, $set: { updatedAt: new Date() } },
    );
  }

  /**
   * @description JSON Merge Patch（RFC 7396）：对象递归合并，数组按意图分两种模式。
   * - 全量模式（patch 数组包含 base 所有 id）：按 patch 顺序排列，支持重排与指定位置插入。
   * - 局部模式（patch 数组为 base 子集）：保留 base 顺序，仅更新匹配项并追加新项。
   * @keyword-en json merge patch rfc7396 array-order-aware full-coverage-replace
   */
  /** 判断合并后的数组 item 是否被标记为删除 */
  private isMarkedRemove(item: unknown): boolean {
    return (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)['_remove'] === true
    );
  }

  private mergePatch(base: unknown, patch: unknown): unknown {
    if (patch === null) return null;

    if (Array.isArray(patch)) {
      // 有 id 字段的对象数组 → 智能合并（支持 _remove:true 删除 item）
      // 先过滤掉 patch 中的 null 项（容错）
      const safePatch = (patch as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
      );

      if (
        Array.isArray(base) &&
        safePatch.length > 0 &&
        safePatch[0]?.id !== undefined &&
        base.length > 0 &&
        typeof base[0] === 'object' &&
        (base[0] as Record<string, unknown>)?.id !== undefined
      ) {
        const baseArr = base as Record<string, unknown>[];
        const patchArr = safePatch;
        const baseIds = new Set(baseArr.map((item) => item.id));
        const patchIds = new Set(patchArr.map((item) => item.id));

        // 全量模式：patch 包含所有 base id → 按 patch 顺序（支持重排 / 插入 / 删除）
        const isFullCoverage = baseArr.every((item) => patchIds.has(item.id));
        if (isFullCoverage) {
          const baseById = new Map(baseArr.map((item) => [item.id, item]));
          return patchArr
            .map((pItem) => {
              const bItem = baseById.get(pItem.id);
              return bItem
                ? (this.mergePatch(bItem, pItem) as Record<string, unknown>)
                : pItem;
            })
            .filter((item) => !this.isMarkedRemove(item));
        }

        // 局部模式：patch 为子集 → 保留 base 顺序，合并匹配项，_remove:true 则删除，追加新 id
        const patchById = new Map(patchArr.map((item) => [item.id, item]));
        const merged: Record<string, unknown>[] = [];
        for (const item of baseArr) {
          const p = patchById.get(item.id);
          if (p) {
            const mergedItem = this.mergePatch(item, p) as Record<
              string,
              unknown
            >;
            if (!this.isMarkedRemove(mergedItem)) merged.push(mergedItem);
          } else {
            merged.push(item);
          }
        }
        for (const item of patchArr) {
          if (!baseIds.has(item.id) && !this.isMarkedRemove(item))
            merged.push(item);
        }
        return merged;
      }

      // 普通数组（无 id 字段）→ 直接替换
      return patch;
    }

    if (typeof patch !== 'object') return patch;

    if (typeof base !== 'object' || base === null || Array.isArray(base)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v !== null) result[k] = v;
      }
      return result;
    }
    const result = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (v === null) {
        delete result[k];
      } else {
        result[k] = this.mergePatch(result[k], v);
      }
    }
    return result;
  }

  /**
   * @description 管理端：列出配置映射
   * @keyword-en list dashboard config mappings
   */
  async listMappings(scope: {
    tenantId?: string;
  }): Promise<DashboardConfigMappingEntity[]> {
    const filter: Record<string, unknown> = {};
    if (scope.tenantId) {
      filter.tenantId = scope.tenantId;
    }
    return this.mappings.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 管理端：写入配置映射（按 dashboardCode+tenantId upsert）
   * @keyword-en upsert dashboard config mapping
   */
  async upsertMapping(input: {
    dashboardCode?: string;
    tenantId?: string | null;
    filePath: string;
    enabled?: boolean;
  }): Promise<DashboardConfigMappingEntity> {
    const dashboardCode = this.normalizeDashboardCode(input.dashboardCode);
    const tenantId =
      this.normalizeTenantId(input.tenantId ?? undefined) ?? null;
    const filePath = this.normalizeFilePath(input.filePath);
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;

    const now = new Date();
    const res = await this.mappings.findOneAndUpdate(
      { dashboardCode, tenantId },
      {
        $set: { filePath, enabled, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );

    if (!res.value) {
      throw new BadRequestException('UPSERT_FAILED');
    }
    return res.value;
  }

  /**
   * @description 管理端：删除配置映射
   * @keyword-en delete dashboard config mapping
   */
  async deleteMapping(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id))
      throw new BadRequestException('INVALID_MAPPING_ID');
    const res = await this.mappings.deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  }

  /**
   * @description 加载并解析 JSON 配置文件（限制在 config/dashboards 下）
   * @keyword-en load dashboard config json
   */
  private async loadConfigJson(
    filePath: string,
  ): Promise<Record<string, unknown>> {
    const abs = this.resolveConfigAbsPath(filePath);
    const raw = await readFile(abs, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('INVALID_DASHBOARD_CONFIG_JSON');
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * @description 限制并解析配置文件绝对路径
   * @keyword-en resolve config absolute path
   */
  private resolveConfigAbsPath(filePath: string): string {
    const raw = String(filePath ?? '').trim();
    if (!raw) throw new BadRequestException('CONFIG_FILE_PATH_REQUIRED');
    const abs = path.resolve(process.cwd(), raw);
    const base = DASHBOARD_CONFIG_BASE_DIR + path.sep;
    if (!abs.startsWith(base)) {
      throw new BadRequestException('CONFIG_FILE_PATH_OUT_OF_SCOPE');
    }
    return abs;
  }

  /**
   * @description 规范化看板code
   * @keyword-en normalize dashboard code
   */
  private normalizeDashboardCode(value?: string): string {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) return DEFAULT_DASHBOARD_CODE;
    if (!/^[a-zA-Z0-9_-]+$/.test(v)) {
      throw new BadRequestException('INVALID_DASHBOARD_CODE');
    }
    return v;
  }

  /**
   * @description 规范化租户id（空/undefined/null 视为母平台）
   * @keyword-en normalize tenant id
   */
  private normalizeTenantId(value?: string | null): string | undefined {
    if (value === null) return undefined;
    const v = typeof value === 'string' ? value.trim() : '';
    return v ? v : undefined;
  }

  /**
   * @description 规范化配置文件路径
   * @keyword-en normalize config file path
   */
  private normalizeFilePath(value: string): string {
    const v = String(value ?? '').trim();
    if (!v) throw new BadRequestException('CONFIG_FILE_PATH_REQUIRED');
    this.resolveConfigAbsPath(v);
    return v;
  }
}
