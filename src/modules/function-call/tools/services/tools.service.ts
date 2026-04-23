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
import { tool } from 'langchain';
import * as z from 'zod';

export interface FunctionCallScope {
  tenantId?: string;
  userId?: string;
  category?: string;
}

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
      return this.getXhsSpecialistTools(scope);
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
   * @description 构建 canvas_search tool，支持多 tag 关键词匹配或兜底文本搜索
   * @keyword-en build canvas search tool, tag keyword match, text fallback
   */
  private buildCanvasSearchTool(scope?: FunctionCallScope): NonNullable<CreateAgentParams['tools']>[number] {
    return tool(
      async ({ tags, type, limit }: { tags: string[]; type?: string; limit?: number }) => {
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
            .describe('One or more keyword tags to search for (any match counts).'),
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
        const p = String(platform ?? 'xhs').trim().toLowerCase();
        const normalized = /小红书|xhs/.test(p) ? 'xhs' : p;
        if (normalized !== 'xhs') {
          return JSON.stringify({
            ok: false,
            error: 'PLATFORM_NOT_SUPPORTED',
            message: `Platform "${platform}" is not supported. Currently only "xhs" (小红书) accounts are available.`,
          });
        }
        try {
          const accounts = await this.admin.listXhsAccounts(scope?.tenantId, 'xhs');
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
          return JSON.stringify({ ok: false, error: 'ACCOUNT_POOL_ERROR', message: e.message });
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
  private getXhsSpecialistTools(scope?: FunctionCallScope): CreateAgentParams['tools'] {
    const tTodo = this.todo.getHandle(scope) ?? [];
    const todoTools = tTodo.filter((t) =>
      ['todo_create', 'todo_list', 'todo_get'].includes(
        (t as { name?: string }).name ?? '',
      ),
    );
    return [this.buildCanvasSearchTool(scope), ...todoTools, ...this.buildRobotListTools()];
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
    const canvasDetailTool = tGraphAll.find(
      (t) => (t as { name?: string }).name === 'get_canvas_detail',
    );
    const extra = canvasDetailTool ? [canvasDetailTool] : [];
    return [
      ...tTodo,
      this.buildCanvasSearchTool(scope),
      ...this.buildRobotListTools(),
      this.buildAccountPoolTool(scope),
      ...extra,
    ];
  }

  /**
   * @description 生文专家子会话工具集（todo + canvas 搜索 + 生文编排）
   * @keyword-en XHS article expert session tools
   */
  private getXhsArticleExpertSessionTools(
    scope?: FunctionCallScope,
  ): CreateAgentParams['tools'] {
    const tTodo = this.todo.getHandle(scope) ?? [];
    const tGraphWorkflowAll = this.graphWorkflow.getHandle(undefined, scope) ?? [];
    const tTopicAndCanvas = tGraphWorkflowAll.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name === 'topic_orchestrate' || name === 'xhs_get_canvas_detail';
    });
    return [...tTodo, this.buildCanvasSearchTool(scope), ...tTopicAndCanvas];
  }
}
