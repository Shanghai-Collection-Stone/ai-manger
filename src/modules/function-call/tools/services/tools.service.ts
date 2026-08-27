import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { FrontendFunctionCallService } from '../../frontend/services/frontend.service.js';
import { AnalysisFunctionCallService } from '../../analysis/services/analysis.service.js';
import { TitleFunctionCallService } from '../../title/services/title.service.js';
import { SkillThoughtToolsService } from '../../../skill-thought/tools/skill-thought.tools.js';
import { McpFunctionCallService } from '../../mcp/services/mcp.service.js';
import { McpAdaptersService } from '../../mcp/services/mcp-adapter.service.js';
import { TodoFunctionCallService } from '../../todo/services/todo.service.js';
import { DashboardToolsService } from '../../dashboard/services/dashboard-tools.service.js';
import { GraphWorkflowFunctionCallService } from './graph-workflow.service.js';
import { RobotRegistryService } from '../../../auto-task-robot/services/robot-registry.service.js';
import { MediaAgentService } from '../../../media-agent/services/media-agent.service.js';
import { CanvasService } from '../../../canvas/services/canvas.service.js';
import { AdminService } from '../../../admin/services/admin.service.js';
import { ArticleLibraryService } from '../../../article-library/services/article-library.service.js';
import { ArticleService } from '../../../article-library/services/article.service.js';
import type { ArticleLibraryEntity } from '../../../article-library/entities/article-library.entity.js';
import type { ArticleCreateInput } from '../../../article-library/entities/article.entity.js';
import type { CanvasArticleEntity } from '../../../canvas/entities/canvas.entity.js';
import { tool } from 'langchain';
import * as z from 'zod';

export interface FunctionCallScope {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  category?: string;
  /**
   * 可选:tool 内部在产出 canvas-it 块的瞬间(如 createImageGroupCanvas 完成)
   * 直接把代码块推到前端 SSE,避免等待 subagent/LLM 二次解码。
   * 由 chat.service.ts stream 路径注入。
   */
  earlyEmit?: (text: string) => void;
}

type ArticleLibraryToolSummary = {
  id: number;
  title: string;
  name: string;
  type: string;
  statusFilter: string[];
  pushUrl: string | null;
  stats: {
    total: number;
    publishedCount: number;
    unpublishedCount: number;
    occupiedCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
};

/**
 * @title 工具服务 Tools Service
 * @description 提供工具集合的Function-Call描述。所有数据源工具已集中到 AnalysisFunctionCallService。
 * @keywords-cn 工具服务, 句柄
 * @keywords-en tools service, handle
 */
@Injectable()
export class ToolsService {
  constructor(
    private readonly frontend: FrontendFunctionCallService,
    private readonly analysis: AnalysisFunctionCallService,
    private readonly title: TitleFunctionCallService,
    private readonly skillThought: SkillThoughtToolsService,
    private readonly mcp: McpFunctionCallService,
    private readonly mcpAdapters: McpAdaptersService,
    private readonly todo: TodoFunctionCallService,
    private readonly dashboard: DashboardToolsService,
    private readonly graphWorkflow: GraphWorkflowFunctionCallService,
    private readonly robots: RobotRegistryService,
    private readonly mediaAgent: MediaAgentService,
    private readonly canvas: CanvasService,
    private readonly admin: AdminService,
    private readonly articleLibrary: ArticleLibraryService,
    private readonly article: ArticleService,
  ) {}

  /**
   * @description 过滤 MCP Server 直接暴露到对话层的工具，避免对话层绕开本地编排。
   * @param {CreateAgentParams['tools']} tools - MCP 侧工具列表。
   * @returns {CreateAgentParams['tools']} 过滤后的工具列表。
   * @keyword-en mcp, tools, filter
   */
  private filterMcpAdapterTools(
    tools?: CreateAgentParams['tools'],
  ): NonNullable<CreateAgentParams['tools']> {
    const blockedPrefixes = [
      /^batch_task_/i,
      /^publish_/i,
      /^check_login_/i,
      /^get_login_qrcode$/i,
      /^delete_cookies$/i,
    ];
    return (tools ?? []).filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      if (!name) return true;
      return !blockedPrefixes.some((re) => re.test(name));
    });
  }

  /**
   * @description 返回对话层可用的工具集合（含Graph工作流与必要的基础工具）。
   * @param {(msg: string) => void} [streamWriter] - 可选流式日志输出。
   * @returns {CreateAgentParams['tools']} 工具集合。
   * @keyword-en tools, handle, aggregate
   */
  getHandle(
    streamWriter?: (msg: string) => void,
    scope?: FunctionCallScope,
    options?: {
      mode?:
        | 'default'
        | 'thought'
        | 'gallery-agent'
        | 'xhs-specialist'
        | 'xhs-tracker'
        | 'xhs-publisher'
        | 'xhs-article-expert'
        | 'xhs-image-expert';
    },
  ): CreateAgentParams['tools'] {
    const mode = options?.mode ?? 'default';
    if (mode === 'thought') {
      return this.getThoughtRouteTools(scope);
    }
    if (mode === 'gallery-agent') {
      return this.getGalleryAgentTools(scope);
    }
    if (mode === 'xhs-specialist') {
      return this.getXhsSupervisorTools(scope);
    }
    if (
      mode === 'xhs-tracker' ||
      mode === 'xhs-publisher' ||
      mode === 'xhs-image-expert'
    ) {
      return this.getXhsSubAgentSessionTools(scope);
    }
    if (mode === 'xhs-article-expert') {
      return this.getXhsArticleExpertSessionTools(scope);
    }
    const tools: CreateAgentParams['tools'] = [];
    const tFrontend = this.frontend.getHandle() ?? [];
    const tAnalysis = this.analysis.getHandle() ?? [];
    const tTitle = this.title.getHandle() ?? [];
    const tSkillThought = this.skillThought.getHandle(scope) ?? [];
    const tSkillThoughtFiltered = tSkillThought.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name !== 'search_thought';
    });
    const tMcp = this.mcp.getHandle(streamWriter) ?? [];
    const tMcpAdapters = this.filterMcpAdapterTools(
      this.mcpAdapters.getTools(),
    );
    const tDecision = this.getDecisionTools(scope) ?? [];
    const tGraphWorkflowAll =
      this.graphWorkflow.getHandle(streamWriter, scope) ?? [];
    const tGraphWorkflow = tGraphWorkflowAll.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name === 'topic_orchestrate';
    });
    const tTodo = this.todo.getHandle(scope) ?? [];
    const tDashboard = this.dashboard.getHandle(scope) ?? [];
    const tGallery = this.mediaAgent.getGalleryToolsHandle(scope) ?? [];
    const tRobots = this.buildRobotListTools();
    const tArticleLibrary = this.buildArticleLibraryTools(scope);
    // 所有数据源工具（schema_search, data_source_query, super_party_*, feishu_bitable_*）
    // 仅在 data_analysis 内部使用，不直接暴露给对话层
    // Chat层只能调用 data_analysis，数据分析由 analysis 层统一管理
    // todo/robot 工具用于把决策转为可执行任务与指派自动机器人
    const disabled = new Set<string>([]);
    tools.push(
      ...tFrontend,
      ...tAnalysis,
      ...tTitle,
      ...tSkillThoughtFiltered,
      ...tMcp,
      ...tMcpAdapters,
      ...tDecision,
      ...tGraphWorkflow,
      ...tTodo,
      ...tDashboard,
      ...tGallery,
      ...tRobots,
      ...tArticleLibrary,
    );
    return tools.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return !disabled.has(name);
    });
  }

  /**
   * @description 获取思维链路专用工具集
   * @keyword-en get thought route tools
   */
  private getThoughtRouteTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const raw = this.analysis.getAllDataSourceTools(scope) ?? [];
    const allow = new Set([
      'schema_search',
      'data_source_query',
      'search_thought',
      'generate_thought',
      'get_thought_detail',
    ]);
    return raw.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return allow.has(name);
    });
  }

  /**
   * @description 获取对话层可直接调用的决策工具
   * @keyword-en decision tools
   */
  private getDecisionTools(
    scope?: FunctionCallScope,
  ): NonNullable<CreateAgentParams['tools']> {
    const raw = this.analysis.getAllDataSourceTools(scope) ?? [];
    return raw.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name === 'decision_card_generate';
    });
  }

  /**
   * @description 获取图库Agent专用工具集（以图库工具为主）
   * @keyword-en gallery agent tools
   */
  private getGalleryAgentTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tGallery = this.mediaAgent.getGalleryToolsHandle(scope) ?? [];
    return tGallery;
  }

  /**
   * @description 构建文章库摘要，供 LLM 列表选择时使用。
   * @keyword-en build article library summary for tool response
   */
  private async buildArticleLibrarySummary(
    lib: ArticleLibraryEntity,
  ): Promise<ArticleLibraryToolSummary> {
    const stats = await this.articleLibrary.getStats(lib.id);
    return {
      id: lib.id,
      title: lib.name,
      name: lib.name,
      type: lib.type ?? '',
      statusFilter: lib.pushConfig?.statusFilter ?? ['unpublished'],
      pushUrl: lib.pushConfig?.pushUrl ?? null,
      stats,
      createdAt: lib.createdAt,
      updatedAt: lib.updatedAt,
    };
  }

  private normalizeLibraryTitle(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  /**
   * @description 按 ID 或标题解析文章库，标题多匹配时返回候选而不猜测。
   * @keyword-en resolve article library by id or title
   */
  private async resolveArticleLibraryForTool(
    input: {
      libraryId?: number | string;
      title?: string;
      libraryTitle?: string;
      name?: string;
    },
    scope?: FunctionCallScope,
  ): Promise<{
    library?: ArticleLibraryEntity;
    error?: string;
    message?: string;
    candidates?: ArticleLibraryToolSummary[];
  }> {
    const libraryIdNum =
      typeof input.libraryId === 'number'
        ? input.libraryId
        : typeof input.libraryId === 'string'
          ? Number(input.libraryId)
          : NaN;
    if (Number.isFinite(libraryIdNum)) {
      const lib = await this.articleLibrary.get(libraryIdNum, scope?.tenantId);
      if (!lib) {
        return { error: 'ARTICLE_LIBRARY_NOT_FOUND', message: '文章库不存在' };
      }
      return { library: lib };
    }

    const rawTitle = String(
      input.title ?? input.libraryTitle ?? input.name ?? '',
    ).trim();
    if (!rawTitle) {
      const { items } = await this.articleLibrary.list({
        tenantId: scope?.tenantId,
        limit: 20,
      });
      return {
        error: 'ARTICLE_LIBRARY_REQUIRED',
        message: '请先指定文章库标题或 ID',
        candidates: await Promise.all(
          items.map((lib) => this.buildArticleLibrarySummary(lib)),
        ),
      };
    }

    const target = this.normalizeLibraryTitle(rawTitle);
    const { items } = await this.articleLibrary.list({
      tenantId: scope?.tenantId,
      limit: 200,
    });
    const exact = items.filter(
      (lib) => this.normalizeLibraryTitle(lib.name) === target,
    );
    const matched =
      exact.length > 0
        ? exact
        : items.filter((lib) =>
            this.normalizeLibraryTitle(lib.name).includes(target),
          );

    if (matched.length === 1) return { library: matched[0] };
    if (matched.length > 1) {
      return {
        error: 'ARTICLE_LIBRARY_AMBIGUOUS',
        message: '文章库标题匹配到多个结果，请改用 libraryId 或更完整标题',
        candidates: await Promise.all(
          matched
            .slice(0, 20)
            .map((lib) => this.buildArticleLibrarySummary(lib)),
        ),
      };
    }
    return {
      error: 'ARTICLE_LIBRARY_NOT_FOUND',
      message: `未找到标题为 "${rawTitle}" 的文章库`,
      candidates: await Promise.all(
        items.slice(0, 20).map((lib) => this.buildArticleLibrarySummary(lib)),
      ),
    };
  }

  private extractCanvasArticleText(
    article: CanvasArticleEntity,
  ): string | undefined {
    const content = article.contentJson ?? {};
    const markdown = content['markdown'];
    if (typeof markdown === 'string' && markdown.trim().length > 0) {
      return markdown.trim();
    }
    const text = content['text'];
    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }
    return undefined;
  }

  /**
   * @description 文章库工具：列库、获取二维码、Canvas 入库。
   * @keyword-en article library tools list qr store canvas
   */
  private buildArticleLibraryTools(
    scope?: FunctionCallScope,
  ): NonNullable<CreateAgentParams['tools']> {
    const listLibraries = tool(
      async ({
        titleKeyword,
        type,
        limit,
        offset,
      }: {
        titleKeyword?: string;
        type?: string;
        limit?: number;
        offset?: number;
      }) => {
        const rawLimit = Number(limit ?? 20);
        const safeLimit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(Math.floor(rawLimit), 50))
          : 20;
        const keyword = String(titleKeyword ?? '').trim();
        const { items, total } = await this.articleLibrary.list({
          tenantId: scope?.tenantId,
          type: typeof type === 'string' ? type : undefined,
          limit: keyword ? 200 : safeLimit,
          offset: Number.isFinite(Number(offset)) ? Number(offset) : 0,
        });
        const filtered = keyword
          ? items.filter((lib) =>
              this.normalizeLibraryTitle(lib.name).includes(
                this.normalizeLibraryTitle(keyword),
              ),
            )
          : items;
        const selected = filtered.slice(0, safeLimit);
        return JSON.stringify({
          ok: true,
          total,
          matched: filtered.length,
          returned: selected.length,
          libraries: await Promise.all(
            selected.map((lib) => this.buildArticleLibrarySummary(lib)),
          ),
          hint: '用户要二维码或入库时，优先让用户从列表中确认标题或 id；标题确定后可调用 article_library_get_push_qr 或 canvas_store_to_article_library。',
        });
      },
      {
        name: 'article_library_list',
        description:
          'List article libraries available to the current tenant/user. Use this first when the user wants to store a Canvas into an article library or get a library QR code but did not provide an exact library id/title.',
        schema: z.object({
          titleKeyword: z
            .string()
            .optional()
            .describe(
              'Optional fuzzy title/name keyword for article library search.',
            ),
          type: z
            .string()
            .optional()
            .describe('Optional article library type filter.'),
          limit: z.number().int().min(1).max(50).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
    );

    const getPushQr = tool(
      async ({
        libraryId,
        title,
        libraryTitle,
        name,
      }: {
        libraryId?: number | string;
        title?: string;
        libraryTitle?: string;
        name?: string;
      }) => {
        const resolved = await this.resolveArticleLibraryForTool(
          { libraryId, title, libraryTitle, name },
          scope,
        );
        if (!resolved.library) {
          return JSON.stringify({
            ok: false,
            error: resolved.error,
            message: resolved.message,
            candidates: resolved.candidates,
          });
        }
        const lib = resolved.library;
        const token = await this.articleLibrary.ensureQrToken(
          lib.id,
          scope?.tenantId,
        );
        const latest =
          (await this.articleLibrary.get(lib.id, scope?.tenantId)) ?? lib;
        const qr = await this.articleLibrary.buildPushQrContent({
          token,
          articleLibraryId: lib.id,
        });
        return JSON.stringify({
          ok: true,
          library: await this.buildArticleLibrarySummary(latest),
          pushUrl: latest.pushConfig?.pushUrl ?? null,
          statusFilter: latest.pushConfig?.statusFilter ?? ['unpublished'],
          ...qr,
          hint: 'qrContent 是二维码实际编码内容；前端应使用生产级二维码库渲染它。',
        });
      },
      {
        name: 'article_library_get_push_qr',
        description:
          'Get the push QR payload/content for an article library by libraryId or exact/fuzzy title. If title is ambiguous, returns candidates and asks the user to choose.',
        schema: z.object({
          libraryId: z
            .union([z.number().int().positive(), z.string()])
            .optional()
            .describe('Article library id. Prefer this when known.'),
          title: z
            .string()
            .optional()
            .describe(
              'Article library title/name, fuzzy matched when id is omitted.',
            ),
          libraryTitle: z.string().optional().describe('Alias of title.'),
          name: z.string().optional().describe('Alias of title.'),
        }),
      },
    );

    const storeCanvas = tool(
      async ({
        canvasId,
        libraryId,
        libraryTitle,
        title,
        articleIds,
        returnPushQr,
        allowGenerating,
      }: {
        canvasId?: number | string;
        libraryId?: number | string;
        libraryTitle?: string;
        title?: string;
        articleIds?: Array<number | string>;
        returnPushQr?: boolean;
        allowGenerating?: boolean;
      }) => {
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({
            ok: false,
            error: 'CANVAS_ID_REQUIRED',
            message: 'canvasId 参数必填且必须是数字',
          });
        }
        const canvas = await this.canvas.get(canvasIdNum, scope?.tenantId);
        if (!canvas) {
          return JSON.stringify({ ok: false, error: 'CANVAS_NOT_FOUND' });
        }
        if (scope?.userId && canvas.userId !== scope.userId) {
          return JSON.stringify({ ok: false, error: 'CANVAS_SCOPE_FORBIDDEN' });
        }
        if (canvas.status === 'generating' && allowGenerating !== true) {
          return JSON.stringify({
            ok: false,
            error: 'CANVAS_NOT_READY',
            message:
              'Canvas 仍在生成中，完成后再入库；如用户明确要求保存当前占位内容，可传 allowGenerating=true。',
            canvas: {
              id: canvas.id,
              topic: canvas.topic,
              type: canvas.type ?? 'article',
              status: canvas.status,
              articleCount: (canvas.articles ?? []).length,
            },
          });
        }

        const resolved = await this.resolveArticleLibraryForTool(
          { libraryId, title, libraryTitle },
          scope,
        );
        if (!resolved.library) {
          return JSON.stringify({
            ok: false,
            error: resolved.error,
            message: resolved.message,
            candidates: resolved.candidates,
          });
        }

        const idSet =
          Array.isArray(articleIds) && articleIds.length > 0
            ? new Set(
                articleIds
                  .map((id) => Number(id))
                  .filter((id) => Number.isFinite(id)),
              )
            : null;
        const sourceArticles = (canvas.articles ?? []).filter((article) =>
          idSet ? idSet.has(Number(article.id)) : true,
        );
        if (sourceArticles.length === 0) {
          return JSON.stringify({
            ok: false,
            error: 'CANVAS_ARTICLES_EMPTY',
            message: idSet
              ? '指定 articleIds 未匹配到文章'
              : 'Canvas 中没有可入库文章',
          });
        }

        const lib = resolved.library;
        const userId = scope?.userId ?? canvas.userId ?? 'default';
        const batch: ArticleCreateInput[] = sourceArticles.map((article) => ({
          libraryId: lib.id,
          userId,
          tenantId: scope?.tenantId,
          title: article.title || `文章 #${article.id}`,
          tags: Array.isArray(article.tags) ? article.tags : [],
          contentJson: article.contentJson ?? {},
          text: this.extractCanvasArticleText(article),
          imageUrls: Array.isArray(article.imageUrls) ? article.imageUrls : [],
          imageIds: Array.isArray(article.imageIds) ? article.imageIds : [],
          publishStatus: 'unpublished',
          source: 'canvas',
          sourceRef: {
            canvasId: canvasIdNum,
            canvasArticleId: article.id,
          },
        }));
        const created = await this.article.bulkCreate(batch);
        const latest =
          (await this.articleLibrary.get(lib.id, scope?.tenantId)) ?? lib;
        let qrPayload: { token: string; articleLibraryId: number } | undefined;
        let qrContent: string | undefined;
        let qrContentType: 'json' | 'xhs-miniapp-url' | undefined;
        let qrSourceContent: string | undefined;
        let xhsQrcodeUrl: string | null | undefined;
        if (returnPushQr === true) {
          const token = await this.articleLibrary.ensureQrToken(
            lib.id,
            scope?.tenantId,
          );
          const qr = await this.articleLibrary.buildPushQrContent({
            token,
            articleLibraryId: lib.id,
          });
          qrPayload = qr.qrPayload;
          qrContent = qr.qrContent;
          qrContentType = qr.qrContentType;
          qrSourceContent = qr.qrSourceContent;
          xhsQrcodeUrl = qr.xhsQrcodeUrl;
        }
        return JSON.stringify({
          ok: true,
          canvas: {
            id: canvas.id,
            topic: canvas.topic,
            type: canvas.type ?? 'article',
            sourceArticleCount: sourceArticles.length,
          },
          library: await this.buildArticleLibrarySummary(latest),
          storedCount: created.length,
          sourceArticleIds: sourceArticles.map((article) => article.id),
          articleIds: created.map((article) => article.id),
          qrPayload,
          qrContent,
          qrContentType,
          qrSourceContent,
          xhsQrcodeUrl,
        });
      },
      {
        name: 'canvas_store_to_article_library',
        description:
          'Store all or selected articles from a Canvas into an article library. Resolve the library by libraryId or title. If the library is unknown, call article_library_list first and ask the user to choose. Can optionally return the library QR content.',
        schema: z.object({
          canvasId: z
            .union([z.number().int().positive(), z.string()])
            .optional()
            .describe('Canvas id to store. Required.'),
          libraryId: z
            .union([z.number().int().positive(), z.string()])
            .optional()
            .describe('Target article library id. Prefer this when known.'),
          libraryTitle: z
            .string()
            .optional()
            .describe('Target article library title/name when id is unknown.'),
          title: z.string().optional().describe('Alias of libraryTitle.'),
          articleIds: z
            .array(z.union([z.number().int().positive(), z.string()]))
            .optional()
            .describe(
              'Optional canvas article ids to store. Omit to store the whole canvas.',
            ),
          returnPushQr: z
            .boolean()
            .optional()
            .describe(
              'When true, also return qrPayload and qrContent for the target library.',
            ),
          allowGenerating: z
            .boolean()
            .optional()
            .describe(
              'Default false. Only set true if the user explicitly wants to store a still-generating Canvas.',
            ),
        }),
      },
    );

    return [listLibraries, getPushQr, storeCanvas];
  }

  /**
   * @description 构建 canvas_search tool，支持多 tag 关键词匹配或兜底文本搜索
   * @keyword-en build canvas search tool, tag keyword match, text fallback
   */
  private buildCanvasSearchTool(
    scope?: FunctionCallScope,
  ): NonNullable<CreateAgentParams['tools']>[number] {
    return tool(
      async ({
        tags,
        type,
        limit,
      }: {
        tags: string[];
        type?: string;
        limit?: number;
      }) => {
        const result = await this.canvas.searchByKeywords({
          tags,
          userId: scope?.userId,
          tenantId: scope?.tenantId,
          type: type ?? undefined,
          limit: limit ?? 20,
        });
        const items = result.canvases.map((c) => ({
          id: c.id,
          topic: c.topic,
          type: c.type ?? 'article',
          status: c.status,
          keywords: c.keywords ?? [],
          articleCount: (c.articles ?? []).length,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
        return JSON.stringify({
          matchMode: result.matchMode,
          total: items.length,
          canvases: items,
        });
      },
      {
        name: 'canvas_search',
        description:
          'Search canvases by one or more keyword tags. First tries exact keyword match on canvas keywords field; if no results, falls back to topic and article title text search. Returns canvas id, topic, type, status, article count.',
        schema: z.object({
          tags: z
            .array(z.string())
            .min(1)
            .describe(
              'One or more keyword tags to search for (any match counts).',
            ),
          type: z
            .enum(['article', 'image-group'])
            .optional()
            .describe('Filter by canvas type. Omit to search all types.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe('Max results to return, default 20.'),
        }),
      },
    );
  }

  /**
   * @description 构建 robot_list 工具（仅返回后台 admin 管理的 agents）
   * @keyword-en build robot list tool, admin agents only
   */
  private buildRobotListTools(): NonNullable<CreateAgentParams['tools']> {
    return [
      tool(
        async () => {
          const agentConfigs = await this.robots.listAgentConfigs();
          return JSON.stringify({
            agents: agentConfigs,
            hint: '指派自动机器人时，使用 agents 列表中的 id 字段（格式 agent:<24位hex>）作为 todo assignee。',
          });
        },
        {
          name: 'robot_list',
          description:
            'List admin-configured agents for todo assignment. Use agent id (agent:<id> format) as assignee when assigning tasks.',
          schema: z.object({}),
        },
      ),
    ];
  }

  /**
   * @description 构建账号池查询工具（仅支持 xhs 平台，通过 context 限制类型）
   * @param {FunctionCallScope} [scope] - 租户/用户上下文。
   * @returns {NonNullable<CreateAgentParams['tools']>[number]} 工具实例。
   * @keyword-en build account pool tool, xhs accounts, platform restrict
   */
  private buildAccountPoolTool(
    scope?: FunctionCallScope,
  ): NonNullable<CreateAgentParams['tools']>[number] {
    return tool(
      async ({ platform }: { platform?: string }) => {
        // 软归一化：小红书相关都视为 xhs
        const p = String(platform ?? 'xhs')
          .trim()
          .toLowerCase();
        const normalized = /小红书|xhs/.test(p) ? 'xhs' : p;
        if (normalized !== 'xhs') {
          return JSON.stringify({
            ok: false,
            error: 'PLATFORM_NOT_SUPPORTED',
            message: `Platform "${platform}" is not supported. Currently only "xhs" (小红书) accounts are available.`,
          });
        }
        try {
          const accounts = await this.admin.listXhsAccounts(
            scope?.tenantId,
            'xhs',
          );
          return JSON.stringify({
            ok: true,
            platform: 'xhs',
            total: accounts.length,
            accounts: accounts.map((a) => ({
              id: String(a._id),
              username: a.username,
              adspowerId: a.adspowerId ?? null,
              clawConfigId: a.clawConfigId ?? null,
              clawAgentId: a.clawAgentId ?? null,
              loginStatus: a.loginStatus,
              notes: a.notes ?? null,
            })),
          });
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          return JSON.stringify({
            ok: false,
            error: 'ACCOUNT_POOL_ERROR',
            message: e.message,
          });
        }
      },
      {
        name: 'get_account_pool',
        description:
          'Get social media account pool by platform. CONTEXT: This tool only supports platform="xhs" (小红书); passing any other value returns an error. Returns id, username, adspowerId for each account. Call this FIRST before building the publish todo list.',
        schema: z.object({
          platform: z
            .string()
            .optional()
            .describe(
              'Platform type. Must be "xhs" for 小红书 publishing tasks. Defaults to "xhs" when omitted.',
            ),
        }),
      },
    );
  }

  /**
   * @description 获取小红书专家专用工具集（canvas 搜索 + todo + robot_list）
   * @keyword-en XHS specialist tools with canvas search, todo, robot_list
   */
  private getXhsSpecialistTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tTodo = this.todo.getHandle(scope) ?? [];
    const todoTools = tTodo.filter((t) =>
      ['todo_create', 'todo_list', 'todo_get'].includes(
        (t as { name?: string }).name ?? '',
      ),
    );
    return [
      this.buildCanvasSearchTool(scope),
      ...todoTools,
      ...this.buildRobotListTools(),
      ...this.buildArticleLibraryTools(scope),
    ];
  }

  /**
   * @description 获取小红书主专家自动路由所需的完整工具池。
   * @keyword-cn 小红书专家, 意图路由, 工具池
   * @keyword-en xhs-supervisor-tools, intent-routing
   */
  private getXhsSupervisorTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tGraphWorkflowAll =
      this.graphWorkflow.getHandle(undefined, scope) ?? [];
    const grouped = [
      ...(this.getXhsSpecialistTools(scope) ?? []),
      ...(this.getXhsSubAgentSessionTools(scope) ?? []),
      ...(this.getXhsArticleExpertSessionTools(scope) ?? []),
      ...tGraphWorkflowAll,
      ...(this.mediaAgent.getGalleryToolsHandle(scope) ?? []),
      ...(this.mediaAgent.getXhsToolsHandle(scope) ?? []),
    ];
    return Array.from(
      new Map(
        grouped.map((t) => [(t as { name?: string }).name ?? '', t] as const),
      ).values(),
    ).filter((t) => Boolean((t as { name?: string }).name));
  }

  /**
   * @description 追踪/发布/生图子会话工具集（todo + canvas 搜索 + robot_list + 账号池 + 详情）
   * @keyword-en XHS tracker publisher image session tools: todo + canvas search + robot_list + account pool
   */
  private getXhsSubAgentSessionTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tTodo = this.todo.getHandle(scope) ?? [];
    const tGraphAll = this.graphWorkflow.getHandle(undefined, scope) ?? [];
    const extra = tGraphAll.filter((t) =>
      ['get_canvas_detail', 'xhs_batch_publish', 'batch_publish'].includes(
        (t as { name?: string }).name ?? '',
      ),
    );
    const tXhsAll = this.mediaAgent.getXhsToolsHandle(scope) ?? [];
    const tUnusedImageGroups = tXhsAll.filter(
      (t) => (t as { name?: string }).name === 'xhs_list_unused_image_groups',
    );
    return [
      ...tTodo,
      this.buildCanvasSearchTool(scope),
      ...this.buildRobotListTools(),
      this.buildAccountPoolTool(scope),
      ...extra,
      ...tUnusedImageGroups,
    ];
  }

  /**
   * @description 生文专家子会话工具集（todo + canvas 搜索 + 生文编排 + 单篇图片重生成）
   * @keyword-en XHS article expert session tools
   */
  private getXhsArticleExpertSessionTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tTodo = this.todo.getHandle(scope) ?? [];
    const tGraphWorkflowAll =
      this.graphWorkflow.getHandle(undefined, scope) ?? [];
    const tTopicAndCanvas = tGraphWorkflowAll.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name === 'topic_orchestrate' || name === 'xhs_get_canvas_detail';
    });
    const tXhsAll = this.mediaAgent.getXhsToolsHandle(scope) ?? [];
    const tArticleXhs = tXhsAll.filter((t) =>
      [
        'xhs_regenerate_article_images',
        'xhs_list_unused_image_groups',
      ].includes((t as { name?: string }).name ?? ''),
    );
    return [
      ...tTodo,
      this.buildCanvasSearchTool(scope),
      ...tTopicAndCanvas,
      ...this.buildArticleLibraryTools(scope),
      ...tArticleXhs,
    ];
  }
}
