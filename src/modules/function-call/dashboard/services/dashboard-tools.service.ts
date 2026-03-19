import { Injectable, Inject } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { Db } from 'mongodb';
import { DashboardConfigService } from '../../../dashboard-config/services/dashboard-config.service.js';

/**
 * @description 看板数据工具服务，为 AI 指挥官提供租户隔离的表结构查询、数据查询、看板配置读写能力
 * @keyword-en dashboard tools service, tenant-isolated, ai tool
 */
@Injectable()
export class DashboardToolsService {
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly dashboardConfig: DashboardConfigService,
  ) {}

  /**
   * @description 构建租户集合前缀（与 sass.service 逻辑保持一致）
   * @param {string} tenantId - 租户ID（MongoDB ObjectId hex字符串）
   * @returns {string} 四位前缀，如 "69a9"
   * @keyword-en build tenant prefix
   */
  private buildTenantPrefix(tenantId: string): string {
    const raw = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const safe = raw.length > 0 ? raw : 'tn';
    return (safe + '0000').slice(0, 4);
  }

  /**
   * @description 返回看板 AI 工具句柄，所有工具在 scope 的 tenantId 下运行，天然租户隔离
   * @param {{ tenantId?: string }} [scope] - 当前会话 scope，含租户ID
   * @returns {CreateAgentParams['tools']} 工具集合
   * @keyword-en dashboard tools handle tenant scope
   */
  getHandle(scope?: { tenantId?: string; userId?: string }): CreateAgentParams['tools'] {
    const tenantId = scope?.tenantId;

    /**
     * 工具1: 列出当前租户所有数据表结构
     * keyword: tenant_tables
     */
    const tenantTables = tool(
      async () => {
        const schemas = await this.db
          .collection('sass_schema')
          .find({})
          .project({ _id: 0, table: 1, tableDesc: 1, tableField: 1 })
          .toArray();
        return JSON.stringify(
          schemas.map((s) => ({
            table: s.table,
            desc: s.tableDesc,
            fields: s.tableField,
          })),
        );
      },
      {
        name: 'tenant_tables',
        description:
          'List all available tenant data table schemas with field definitions. Use this to understand what data is available before querying.',
        schema: z.object({}),
      },
    );

    /**
     * 工具2: 查询租户物理表数据（自动按 tenantId 前缀路由）
     * keyword: tenant_query
     */
    const tenantQuery = tool(
      async ({ table, mode, where, limit, sort, pipeline }) => {
        if (!tenantId) return JSON.stringify({ error: 'NO_TENANT_SCOPE' });
        const prefix = this.buildTenantPrefix(tenantId);
        const collection = `${prefix}_${table}`;
        const filter: Record<string, unknown> =
          where && typeof where === 'object' ? (where as Record<string, unknown>) : {};
        const col = this.db.collection(collection);
        if (mode === 'count') {
          const count = await col.countDocuments(filter);
          return JSON.stringify({ count });
        }
        if (mode === 'aggregate') {
          // pipeline 优先；未提供时自动构建简单 match+count pipeline
          const agg = Array.isArray(pipeline)
            ? (pipeline as Record<string, unknown>[])
            : ([{ $match: filter }, { $count: 'total' }] as Record<string, unknown>[]);
          const rows = await col.aggregate(agg).toArray();
          return JSON.stringify({ rows });
        }
        const safeLimit = Math.min(limit ?? 50, 100);
        const rows = await col
          .find(filter)
          .sort((sort as Record<string, 1 | -1>) ?? { _id: -1 })
          .limit(safeLimit)
          .toArray();
        return JSON.stringify({ rows });
      },
      {
        name: 'tenant_query',
        description:
          'Query data from a logical tenant table by table name (without prefix). ' +
          'Use tenant_tables first to understand available tables and fields. ' +
          'Modes: count=count matching docs; list=fetch rows; aggregate=run aggregation pipeline. ' +
          'For aggregate mode, provide a "pipeline" array of MongoDB aggregation stages. ' +
          'Table name is the logical name (e.g. "order_usages") — prefix is added automatically.',
        schema: z.object({
          table: z
            .string()
            .describe('Logical table name, e.g. "orders", "order_usages" (no prefix)'),
          mode: z
            .enum(['count', 'list', 'aggregate'])
            .default('count')
            .describe('count=total docs; list=fetch rows; aggregate=run aggregation pipeline'),
          where: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('MongoDB filter for count/list mode, e.g. {"channelName": "抖音"}'),
          pipeline: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe(
              'Aggregation pipeline stages for aggregate mode, e.g. [{"$match": {...}}, {"$group": {...}}]',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Max rows to return (list mode only, max 100)'),
          sort: z
            .record(z.string(), z.union([z.literal(1), z.literal(-1)]))
            .optional()
            .describe('Sort spec, e.g. {"orderTime": -1}'),
        }),
      },
    );

    /**
     * 工具3: 查看当前看板 JSON 配置
     * keyword: dashboard_config_view
     */
    const dashboardConfigView = tool(
      async ({ dashboardCode }) => {
        const result = await this.dashboardConfig.getScopedConfig({
          tenantId,
          dashboardCode,
        });
        return JSON.stringify(result.config);
      },
      {
        name: 'dashboard_config_view',
        description:
          'View the current dashboard JSON configuration (tabs, blocks, queries). Use this before patching to understand the current structure.',
        schema: z.object({
          dashboardCode: z
            .string()
            .optional()
            .describe('Dashboard code, defaults to platform default'),
        }),
      },
    );

    /**
     * 工具4: 对看板 JSON 配置执行 JSON Merge Patch（RFC 7396）
     * keyword: dashboard_config_patch
     */
    const dashboardConfigPatch = tool(
      async ({ dashboardCode, patch }) => {
        await this.dashboardConfig.patchConfig({
          tenantId,
          dashboardCode,
          patch: patch as Record<string, unknown>,
        });
        return JSON.stringify({ ok: true });
      },
      {
        name: 'dashboard_config_patch',
        description:
          'Patch the dashboard JSON configuration using an order-aware merge strategy. ' +
          'ARRAY RULES: If your patch array contains ALL existing item ids → items are reordered/inserted exactly as you specify (full-coverage mode, supports position control). ' +
          'If your patch array contains only SOME item ids → only those items are updated, others stay in place (partial mode). ' +
          'Always call dashboard_config_view first to get current ids. To insert a block at a specific position, include ALL block ids in the desired order. ' +
          'TO REMOVE a block/tab: add "_remove": true to that item (e.g. {"id": "refund_rate", "_remove": true}). Works in both modes. ' +
          'NEVER set an array item to null — this breaks the frontend. ' +
          'Objects are recursively merged. Setting an object field to null deletes ONLY that field (not the whole block).',
        schema: z.object({
          dashboardCode: z
            .string()
            .optional()
            .describe('Dashboard code to patch'),
          patch: z
            .record(z.string(), z.unknown())
            .describe(
              'JSON merge patch object. To remove a block/tab: include it with {"id": "...", "_remove": true}. To delete an object field: set it to null. Never set an array item itself to null.',
            ),
        }),
      },
    );

    return [tenantTables, tenantQuery, dashboardConfigView, dashboardConfigPatch];
  }
}
