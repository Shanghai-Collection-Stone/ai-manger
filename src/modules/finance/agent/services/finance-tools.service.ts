import { Injectable } from '@nestjs/common';
import { CreateAgentParams, tool } from 'langchain';
import * as z from 'zod';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import { FinanceBindingService } from '../../config/services/finance-binding.service.js';
import { FinanceTransformService } from '../../config/services/finance-transform.service.js';
import type { FinanceSourceItem } from '../../config/entities/finance-binding.entity.js';
import { ApprovalReaderService } from '../../source/services/approval-reader.service.js';
import { BitableReaderService } from '../../source/services/bitable-reader.service.js';
import type { FinanceFetchResult } from '../../source/types/finance-source.types.js';
import { FinanceExternalService } from '../../push/services/finance-external.service.js';
import { TransformEngineService } from '../../transform/services/transform-engine.service.js';
import { TransformValidatorService } from '../../transform/services/transform-validator.service.js';

/**
 * @description Agent 工具作用域(admin user + binding name)
 * @keyword-en finance-tools-scope, tool-scope
 */
export interface FinanceToolsScope {
  adminUser: AdminUserEntity;
  name: string;
}

/**
 * @description 财务 Agent 工具集(按 admin user + binding name 维度构建,closure 校验租户)
 * @keyword-en finance-agent-tools, langchain-tools
 */
@Injectable()
export class FinanceToolsService {
  constructor(
    private readonly bindingService: FinanceBindingService,
    private readonly transformService: FinanceTransformService,
    private readonly bitableReader: BitableReaderService,
    private readonly approvalReader: ApprovalReaderService,
    private readonly transformEngine: TransformEngineService,
    private readonly transformValidator: TransformValidatorService,
    private readonly externalService: FinanceExternalService,
  ) {}

  /**
   * @description 获取财务工具句柄
   * @keyword-en finance-tools-handle, tool-scope
   */
  getHandle(scope: FinanceToolsScope): CreateAgentParams['tools'] {
    return [
      this.createGetBindingTool(scope),
      this.createReadSourceSampleTool(scope),
      this.createGetTransformTool(scope),
      this.createPatchTransformTool(scope),
      this.createDryRunTransformTool(scope),
      this.createListExternalStoresTool(scope),
      this.createListExternalCompaniesTool(scope),
    ];
  }

  /**
   * @description 取当前 binding(让 agent 知道有哪些源 + 默认 flow/partyType)
   * @keyword-en binding-tool, tool-read
   */
  private createGetBindingTool(scope: FinanceToolsScope) {
    return tool(
      async () => {
        try {
          const tenantId = this.resolveScopeId(scope.adminUser);
          const binding = await this.bindingService.getByName(
            tenantId,
            scope.name,
          );
          return JSON.stringify({
            name: scope.name,
            flowDefault: binding?.flowDefault,
            partyTypeDefault: binding?.partyTypeDefault,
            sources: binding?.sources ?? [],
            remark: binding?.remark,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'finance_get_binding',
        description:
          'Get the configured finance source binding for the current name (sources list, flowDefault, partyTypeDefault, remark). Note: storeId/companyId is NOT bound at source level — same source can carry multiple stores; use compute:lookup with a row field (e.g. 门店列、商户号、备注) to map per-row.',
        schema: z.object({}),
      },
    );
  }

  /**
   * @description 拉源数据样本(给 agent 推断字段使用)
   * @keyword-en source-sample-tool, alias-injection
   */
  private createReadSourceSampleTool(scope: FinanceToolsScope) {
    return tool(
      async (input: { sourceIndex?: number; sampleSize?: number }) => {
        try {
          const tenantId = this.resolveScopeId(scope.adminUser);
          const binding = await this.bindingService.getByName(
            tenantId,
            scope.name,
          );
          if (!binding?.sources?.length) {
            return JSON.stringify({ error: 'NO_BINDING_SOURCES' });
          }
          const idx = Math.max(
            0,
            Math.min(binding.sources.length - 1, input.sourceIndex ?? 0),
          );
          const source = binding.sources[idx];
          const sampleSize = Math.max(1, Math.min(20, input.sampleSize ?? 5));
          const result = await this.fetchSample(tenantId, source, sampleSize);
          const rows = this.injectSourceAlias(
            result.rows.slice(0, sampleSize),
            source.alias,
          );
          return JSON.stringify({
            sourceIndex: idx,
            source,
            columns: result.columns,
            sampleRows: rows.map((r) => ({ id: r.id, fields: r.fields })),
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'finance_read_source_sample',
        description:
          'Fetch a small sample (default 5 rows) from one of the bound sources. Use this to discover field names before designing transform DSL.',
        schema: z.object({
          sourceIndex: z
            .number()
            .optional()
            .describe('Index in binding.sources array, default 0'),
          sampleSize: z
            .number()
            .optional()
            .describe('How many rows to sample, default 5, max 20'),
        }),
      },
    );
  }

  /**
   * @description 取已保存的 transform DSL(供 agent 解读)
   * @keyword-en transform-get-tool, dsl-read
   */
  private createGetTransformTool(scope: FinanceToolsScope) {
    return tool(
      async () => {
        try {
          const tenantId = this.resolveScopeId(scope.adminUser);
          const transform = await this.transformService.getByName(
            tenantId,
            scope.name,
          );
          return JSON.stringify({
            name: scope.name,
            dsl: transform?.dsl ?? null,
            explanation: transform?.explanation,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'finance_get_transform',
        description:
          'Get the currently saved transform DSL for this binding name. Returns null if not set yet.',
        schema: z.object({}),
      },
    );
  }

  /**
   * @description 局部修改或首次创建 transform DSL(基于 JSON Pointer 路径的 patch 操作,避免全量传输)
   * @keyword-en transform-patch-tool, dsl-patch, json-pointer
   */
  private createPatchTransformTool(scope: FinanceToolsScope) {
    return tool(
      async (input: {
        ops: Array<{
          op: 'replace' | 'add' | 'remove';
          path: string;
          value?: unknown;
        }>;
        base?: unknown;
        explanation?: string;
      }) => {
        try {
          const tenantId = this.resolveScopeId(scope.adminUser);
          const existing = await this.transformService.getByName(
            tenantId,
            scope.name,
          );

          const baseDoc = existing?.dsl ?? input.base;
          if (!baseDoc) {
            return JSON.stringify({
              ok: false,
              error: 'NO_EXISTING_DSL: pass a `base` DSL object to create one from scratch',
            });
          }

          const patched = this.applyJsonPatch(baseDoc, input.ops);
          const transform = await this.transformService.upsert(
            scope.adminUser,
            {
              name: scope.name,
              dsl: patched,
              explanation: input.explanation ?? existing?.explanation,
            },
          );
          return JSON.stringify({ ok: true, name: transform.name, dsl: transform.dsl });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      {
        name: 'finance_patch_transform',
        description:
          'Create or patch the transform DSL using JSON-Pointer operations. Works for both first-time creation and incremental edits — never requires sending the full DSL. ' +
          'If a DSL already exists in the database it is used as the base automatically; pass `base` only when creating from scratch (no saved DSL yet). ' +
          'ops is an array of { op, path, value } where path follows RFC 6901 (e.g. "/fields/2", "/fields/-", "/filter/0/op"). ' +
          'Supported ops: replace (overwrite node), add (insert into array at index or "-" to append, or set object key), remove (delete node). ' +
          'DSL schema: { version:1, filter?:[{field,op,value,conditions?}], fields:[{to, from?, type?, format?, default?, merge?, compute?, fields?, sep?, when?, then?, else?, value?, map?}] }. ' +
          'Returns { ok:true, dsl } on success or { ok:false, error } on failure.',
        schema: z.object({
          ops: z
            .array(
              z.object({
                op: z.enum(['replace', 'add', 'remove']),
                path: z
                  .string()
                  .describe(
                    'RFC 6901 JSON Pointer, e.g. "/fields/2", "/fields/-", "/filter/0/op"',
                  ),
                value: z
                  .any()
                  .optional()
                  .describe('New value (required for replace/add, omit for remove)'),
              }),
            )
            .describe('Patch operations to apply in order'),
          base: z
            .any()
            .optional()
            .describe(
              'Starting DSL object — provide ONLY when no DSL has been saved yet (first-time creation). Ignored when an existing DSL is found in the database.',
            ),
          explanation: z
            .string()
            .optional()
            .describe('Human-readable explanation (optional, keeps existing if omitted)'),
        }),
      },
    );
  }

  /**
   * @description 按 RFC 6901 JSON Pointer 路径对文档做 replace/add/remove 操作
   * @keyword-en json-pointer, dsl-patch, json-patch
   */
  private applyJsonPatch(
    doc: unknown,
    ops: Array<{ op: 'replace' | 'add' | 'remove'; path: string; value?: unknown }>,
  ): unknown {
    let result: unknown = JSON.parse(JSON.stringify(doc));
    for (const op of ops) {
      const segments = op.path
        .split('/')
        .filter(Boolean)
        .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

      if (segments.length === 0) {
        if (op.op === 'remove') throw new Error('Cannot remove root document');
        result = op.value;
        continue;
      }

      let parent: unknown = result;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        parent = Array.isArray(parent)
          ? (parent as unknown[])[parseInt(seg, 10)]
          : (parent as Record<string, unknown>)[seg];
        if (parent === null || parent === undefined) {
          throw new Error(`Patch path not found at segment "${seg}" in "${op.path}"`);
        }
      }

      const last = segments[segments.length - 1];
      if (op.op === 'replace') {
        if (Array.isArray(parent))
          (parent as unknown[])[parseInt(last, 10)] = op.value;
        else (parent as Record<string, unknown>)[last] = op.value;
      } else if (op.op === 'add') {
        if (Array.isArray(parent)) {
          if (last === '-') (parent as unknown[]).push(op.value);
          else (parent as unknown[]).splice(parseInt(last, 10), 0, op.value);
        } else {
          (parent as Record<string, unknown>)[last] = op.value;
        }
      } else {
        if (Array.isArray(parent))
          (parent as unknown[]).splice(parseInt(last, 10), 1);
        else delete (parent as Record<string, unknown>)[last];
      }
    }
    return result;
  }

  /**
   * @description 试运行 transform(传 DSL + 拉部分样本,返回转换结果,不落库)
   * @keyword-en transform-dry-run-tool, dsl-validate
   */
  private createDryRunTransformTool(scope: FinanceToolsScope) {
    return tool(
      async (input: {
        dsl: unknown;
        sourceIndex?: number;
        sampleSize?: number;
      }) => {
        try {
          const tenantId = this.resolveScopeId(scope.adminUser);
          const dsl = this.transformValidator.validate(input.dsl);
          const binding = await this.bindingService.getByName(
            tenantId,
            scope.name,
          );
          if (!binding?.sources?.length) {
            return JSON.stringify({ error: 'NO_BINDING_SOURCES' });
          }
          const idx = Math.max(
            0,
            Math.min(binding.sources.length - 1, input.sourceIndex ?? 0),
          );
          const source = binding.sources[idx];
          const sampleSize = Math.max(1, Math.min(50, input.sampleSize ?? 10));
          const sample = await this.fetchSample(tenantId, source, sampleSize);
          const rows = this.injectSourceAlias(sample.rows, source.alias);
          const result = this.transformEngine.run(rows, dsl);
          return JSON.stringify({
            sourceCount: result.sourceCount,
            filteredCount: result.filteredCount,
            outputCount: result.rows.length,
            errorCount: result.errors.length,
            errors: result.errors.slice(0, 5),
            preview: result.rows.slice(0, 5),
          });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      {
        name: 'finance_dry_run_transform',
        description:
          'Validate a transform DSL and dry-run it against a sample from a bound source. Supports nested compute, computed-field references, duplicate-field merge, or/and, and between. Pass `dsl` as a JSON OBJECT. Returns counts, error preview, output preview, or { error:"<code>:<detail>" } on schema failure. Does NOT persist.',
        schema: z.object({
          dsl: z
            .any()
            .describe('DSL as a JSON object (OBJECT, not stringified)'),
          sourceIndex: z
            .number()
            .optional()
            .describe('Source index, default 0'),
          sampleSize: z
            .number()
            .optional()
            .describe('Sample size, default 10, max 50'),
        }),
      },
    );
  }

  /**
   * @description 列外部 stores(让 agent 写 compute:lookup 的 map 时知道目标系统有哪些 storeId)
   * @keyword-en external-stores-tool, lookup-source
   */
  private createListExternalStoresTool(scope: FinanceToolsScope) {
    return tool(
      async () => {
        try {
          const stores = await this.externalService.listStores(scope.adminUser);
          return JSON.stringify({
            stores: stores.map((s) => ({
              id: s.id,
              name: s.name,
              code: s.code,
            })),
          });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      {
        name: 'finance_list_external_stores',
        description:
          'List all stores in the external finance system (id + name + code). Use this when designing a compute:lookup rule that maps a row field (e.g. 门店名/商户号) to storeId.',
        schema: z.object({}),
      },
    );
  }

  /**
   * @description 列外部 companies
   * @keyword-en external-companies-tool, lookup-source
   */
  private createListExternalCompaniesTool(scope: FinanceToolsScope) {
    return tool(
      async () => {
        try {
          const companies = await this.externalService.listCompanies(
            scope.adminUser,
          );
          return JSON.stringify({
            companies: companies.map((c) => ({
              id: c.id,
              name: c.name,
              code: c.code,
            })),
          });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      {
        name: 'finance_list_external_companies',
        description:
          'List all companies in the external finance system (id + name + code). Use when mapping a row field to companyId via compute:lookup.',
        schema: z.object({}),
      },
    );
  }

  /**
   * @description 通用样本拉取(按源类型分发)
   * @keyword-en source-sample-fetch, source-dispatch
   */
  private async fetchSample(
    tenantId: string,
    source: FinanceSourceItem,
    sampleSize: number,
  ): Promise<FinanceFetchResult> {
    if (source.type === 'bitable') {
      return this.bitableReader.fetch({
        tenantId,
        appToken: source.appToken,
        tableId: source.tableId,
        pageSize: sampleSize,
      });
    }
    return this.approvalReader.fetchAll({
      tenantId,
      approvalCode: source.approvalCode,
      pageSize: sampleSize,
      maxInstances: sampleSize,
    });
  }

  /**
   * @description 把 source.alias 作为 source_alias 字段注入到每行 fields(与 record_id 同风格;用户列里若已有同名字段则保留)
   * @keyword-en source-alias-inject, virtual-field
   */
  private injectSourceAlias(
    rows: ReadonlyArray<{
      id: string;
      fields: Record<string, unknown>;
      sourceType: 'bitable' | 'approval';
      createdAt?: number;
      updatedAt?: number;
    }>,
    alias: string | undefined,
  ) {
    if (!alias) return rows.map((r) => ({ ...r }));
    return rows.map((r) => {
      if ('source_alias' in (r.fields ?? {})) return { ...r };
      return {
        ...r,
        fields: { ...(r.fields ?? {}), source_alias: alias },
      };
    });
  }

  /**
   * @description 解析当前 admin 用户的作用域 ID
   * @keyword-en scope-id-resolve, tenant-scope
   */
  private resolveScopeId(adminUser: AdminUserEntity): string {
    const tenantId = String(adminUser.tenantId ?? '').trim();
    return tenantId || '__platform__';
  }
}
