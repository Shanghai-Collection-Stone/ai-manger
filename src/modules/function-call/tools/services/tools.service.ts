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
import { tool } from 'langchain';
import * as z from 'zod';

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
    const blockedPrefixes = [/^batch_task_/i];
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
    scope?: { tenantId?: string; userId?: string },
    options?: { mode?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' },
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
    const tGraphWorkflowAll = this.graphWorkflow.getHandle(streamWriter, scope) ?? [];
    const tGraphWorkflow = tGraphWorkflowAll.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name === 'topic_orchestrate';
    });
    const tTodo = this.todo.getHandle(scope) ?? [];
    const tDashboard = this.dashboard.getHandle(scope) ?? [];
    const tGallery = this.mediaAgent.getGalleryToolsHandle(scope) ?? [];
    const tRobots: CreateAgentParams['tools'] = [
      tool(
        () => {
          return JSON.stringify({ robots: this.robots.listRobots() });
        },
        {
          name: 'robot_list',
          description:
            'List all available auto-task robots that can be assigned via Todo assignee=robot:<code>.',
          schema: z.object({}),
        },
      ),
    ];
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
  private getThoughtRouteTools(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
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
  private getDecisionTools(scope?: {
    tenantId?: string;
    userId?: string;
  }): NonNullable<CreateAgentParams['tools']> {
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
  private getGalleryAgentTools(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const tGallery = this.mediaAgent.getGalleryToolsHandle(scope) ?? [];
    return tGallery;
  }

  /**
   * @description 获取小红书专家专用工具集（以XHS工具为主）
   * @keyword-en XHS specialist tools
   */
  private getXhsSpecialistTools(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const tXhs = this.mediaAgent.getXhsToolsHandle(scope) ?? [];
    return tXhs;
  }
}
