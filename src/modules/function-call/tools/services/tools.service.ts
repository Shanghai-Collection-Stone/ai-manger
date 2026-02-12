import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { FrontendFunctionCallService } from '../../frontend/services/frontend.service.js';
import { AnalysisFunctionCallService } from '../../analysis/services/analysis.service.js';
import { TitleFunctionCallService } from '../../title/services/title.service.js';
import { SkillThoughtToolsService } from '../../../skill-thought/tools/skill-thought.tools.js';
import { McpFunctionCallService } from '../../mcp/services/mcp.service.js';
import { McpAdaptersService } from '../../mcp/services/mcp-adapter.service.js';
import { TodoFunctionCallService } from '../../todo/services/todo.service.js';
import { GraphWorkflowFunctionCallService } from './graph-workflow.service.js';

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
    private readonly graphWorkflow: GraphWorkflowFunctionCallService,
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
  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const tools: CreateAgentParams['tools'] = [];
    const tFrontend = this.frontend.getHandle() ?? [];
    const tAnalysis = this.analysis.getHandle(streamWriter) ?? [];
    const tTitle = this.title.getHandle() ?? [];
    const tSkillThought = this.skillThought.getHandle() ?? [];
    const tSkillThoughtFiltered = tSkillThought.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return name !== 'search_thought';
    });
    const tMcp = this.mcp.getHandle(streamWriter) ?? [];
    const tMcpAdapters = this.filterMcpAdapterTools(
      this.mcpAdapters.getTools(),
    );
    const tTodo = this.todo.getHandle() ?? [];
    const tGraphWorkflow = this.graphWorkflow.getHandle(streamWriter) ?? [];
    // 所有数据源工具（schema_search, data_source_query, super_party_*, feishu_bitable_*）
    // 仅在 data_analysis 内部使用，不直接暴露给对话层
    // Chat层只能调用 data_analysis，数据分析由 analysis 层统一管理
    const disabled = new Set<string>([]);
    tools.push(
      ...tFrontend,
      ...tAnalysis,
      ...tTitle,
      ...tSkillThoughtFiltered,
      ...tMcp,
      ...tMcpAdapters,
      ...tTodo,
      ...tGraphWorkflow,
    );
    return tools.filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      return !disabled.has(name);
    });
  }
}
