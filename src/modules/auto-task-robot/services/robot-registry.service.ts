import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AdminAgentConfigEntity } from '../../admin/entities/admin.entity.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import { TodoService } from '../../todo/services/todo.service.js';
import { BatchTaskGraphService } from '../../graph/services/batch-task-graph.service.js';

export interface AutoTaskRobotDescriptor {
  code: string;
  name: string;
  description: string;
}

/**
 * @description Agent 上下文，随任务传递到各 robot handler
 * @keyword-en agent context passed to robot handlers
 */
export interface AgentContext {
  agentId: string;
  name: string;
  prompt?: string;
}

@Injectable()
export class RobotRegistryService {
  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @description 通过 robot code 查找显示名称
   * @keyword-en find robot name by code
   */
  private findRobotName(code?: string): string | undefined {
    const key = String(code ?? '').trim().toLowerCase();
    if (!key) return undefined;
    return this.listRobots().find((r) => r.code === key)?.name;
  }

  /**
   * @description 结构化日志记录
   * @keyword-en structured logging for robot events
   */
  private logRobot(event: string, extra?: Record<string, unknown>): void {
    console.log('[AutoRobot]', {
      event,
      at: new Date().toISOString(),
      ...(extra ?? {}),
    });
  }

  /**
   * @description 列出所有可用 robot 实现（技术层）
   * @keyword-en list all robot implementations
   */
  listRobots(): AutoTaskRobotDescriptor[] {
    return [
      {
        code: 'xhs_publisher',
        name: '小红书发布机',
        description:
          '接收 Todo 派单后自动执行小红书批量发布流程（基于 Canvas + Todo）。',
      },
      {
        code: 'claw',
        name: 'OpenClaw 智能体',
        description:
          '通过 OpenClaw 网关接入的智能体，兼容 OpenAI Chat Completions 协议。',
      },
    ];
  }

  /**
   * @description 解析 legacy robot:code 格式的 assignee，返回 robotCode
   * @keyword-en parse robot code from legacy assignee format
   */
  parseRobotCode(assignee?: string): string | undefined {
    const raw = String(assignee ?? '').trim();
    if (!raw) return undefined;
    const m = /^robot:([a-z0-9_-]+)$/i.exec(raw);
    if (m) {
      return String(m[1] ?? '')
        .trim()
        .toLowerCase();
    }
    const byName = this.listRobots().find(
      (r) => r.name.trim().toLowerCase() === raw.toLowerCase(),
    );
    if (byName) return byName.code;
    return undefined;
  }

  /**
   * @description 解析 agent:<id> 格式的 assignee，返回 agentId
   * @keyword-en parse agent id from agent assignee format
   */
  parseAgentId(assignee?: string): string | undefined {
    const raw = String(assignee ?? '').trim();
    const m = /^agent:([a-f0-9]{24})$/i.exec(raw);
    return m ? String(m[1] ?? '').trim() : undefined;
  }

  /**
   * @description 联合触发：优先处理 agent 指派，再处理 legacy robot 指派
   * @keyword-en trigger robot or agent if assigned
   */
  async triggerIfRobotAssigned(input: {
    todo: TodoEntity;
  }): Promise<{ triggered: boolean; robotCode?: string; error?: string }> {
    // 优先检测新 agent 格式
    const agentId = this.parseAgentId(input.todo.assignee);
    if (agentId) {
      return this.triggerByAgentId(input.todo, agentId);
    }

    // 兼容 legacy robot:xxx 格式
    const robotCode = this.parseRobotCode(input.todo.assignee);
    if (!robotCode) return { triggered: false };

    this.logRobot('handle_assigned_todo_legacy', {
      todoId: input.todo.id,
      assignee: input.todo.assignee,
      robotCode,
      robotName: this.findRobotName(robotCode),
      status: input.todo.status,
    });

    try {
      if (robotCode === 'xhs_publisher') {
        await this.handleXhsPublisher(input.todo);
        this.logRobot('handle_completed', { todoId: input.todo.id, robotCode });
        return { triggered: true, robotCode };
      }
      return { triggered: false, robotCode, error: 'ROBOT_NOT_FOUND' };
    } catch (error) {
      await this.safeMarkFailed(input.todo, robotCode, error);
      return {
        triggered: true,
        robotCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * @description 通过 agentId 查找 agent 配置后分发到对应 robot 处理器
   * @keyword-en trigger by agent config id, dispatch to robot by module
   */
  private async triggerByAgentId(
    todo: TodoEntity,
    agentId: string,
  ): Promise<{ triggered: boolean; robotCode?: string; error?: string }> {
    const adminService = this.moduleRef.get(AdminService, { strict: false });
    if (!adminService) {
      return { triggered: false, error: 'ADMIN_SERVICE_UNAVAILABLE' };
    }

    const agentConfig = await adminService.getAgentConfigById(agentId);
    if (!agentConfig) {
      return { triggered: false, error: 'AGENT_CONFIG_NOT_FOUND' };
    }
    if (!agentConfig.enabled) {
      return { triggered: false, error: 'AGENT_DISABLED' };
    }

    const robotCode = agentConfig.module;
    const agentCtx: AgentContext = {
      agentId,
      name: agentConfig.name,
      prompt: agentConfig.prompt,
    };

    this.logRobot('handle_assigned_todo_agent', {
      todoId: todo.id,
      agentId,
      agentName: agentConfig.name,
      robotCode,
      status: todo.status,
    });

    try {
      if (robotCode === 'xhs_publisher') {
        await this.handleXhsPublisher(todo, agentCtx);
        this.logRobot('handle_completed', { todoId: todo.id, robotCode, agentId });
        return { triggered: true, robotCode };
      }
      if (robotCode === 'claw') {
        await this.handleClawRobot(todo, agentConfig, agentCtx);
        this.logRobot('handle_completed', { todoId: todo.id, robotCode, agentId });
        return { triggered: true, robotCode };
      }
      return { triggered: false, robotCode, error: 'ROBOT_NOT_FOUND' };
    } catch (error) {
      await this.safeMarkFailed(todo, agentCtx.name, error);
      return {
        triggered: true,
        robotCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * @description 提取 todo 中的 Canvas ID
   * @keyword-en extract canvas id from todo text fields
   */
  private extractCanvasId(todo: TodoEntity): number | undefined {
    const text = [
      todo.title,
      todo.description,
      todo.aiConsideration,
      todo.decisionReason,
      todo.aiPlan,
    ]
      .filter(Boolean)
      .join('\n');
    const r1 = /\bcanvas(?:\s*id)?\s*[:：#]?\s*(\d+)\b/i.exec(text);
    const r2 = /画布\s*[:：#]?\s*(\d+)\b/i.exec(text);
    const raw = r1?.[1] ?? r2?.[1];
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  }

  /**
   * @description 从 todo 文本中提取任务数量
   * @keyword-en extract task count from todo text
   */
  private extractTaskCount(todo: TodoEntity): number {
    const text = [todo.title, todo.description, todo.aiPlan]
      .filter(Boolean)
      .join('\n');
    const r = /(\d+)\s*(?:篇|条|个|post|posts)\b/i.exec(text);
    const n = Number(r?.[1] ?? '');
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.min(100, Math.floor(n)));
  }

  /**
   * @description 将 todo 状态置为接单中，并写入接单节点
   * @keyword-en mark todo accepted for robot, write item record
   */
  private async markTodoAcceptedForRobot(
    todo: TodoEntity,
    robotName: string,
    robotCode: string,
  ): Promise<void> {
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todoService) return;

    await todoService.update({
      id: todo.id,
      tenantId: todo.tenantId,
      status: 'in_progress',
      abnormalReason: '',
    });

    const existedItems = await todoService.listItems(todo.id, todo.tenantId);
    const existed = existedItems.some((x) =>
      String(x.title ?? '').includes(`${robotName}已接单`),
    );
    if (!existed) {
      await todoService.createItem({
        todoId: todo.id,
        tenantId: todo.tenantId,
        title: `${robotName}已接单`,
        description: `自动化代理 ${robotName} 收到任务并启动执行流程`,
        status: 'in_progress',
        stage: '自动执行已启动',
        doneNote: `source=${robotCode}`,
      });
    }
  }

  /**
   * @description 将 todo 状态置为失败，并写入失败节点
   * @keyword-en mark todo failed for robot, write fail item record
   */
  private async markTodoFailedForRobot(
    todo: TodoEntity,
    robotName: string,
    rawError: unknown,
  ): Promise<void> {
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todoService) return;
    const errMsg =
      rawError instanceof Error ? rawError.message : String(rawError);
    const reason = `${robotName}执行失败：${errMsg}`;

    await todoService.update({
      id: todo.id,
      tenantId: todo.tenantId,
      status: 'failed',
      abnormalReason: reason,
    });

    await todoService.createItem({
      todoId: todo.id,
      tenantId: todo.tenantId,
      title: `${robotName}执行失败`,
      description: reason,
      status: 'failed',
      stage: '自动执行失败',
      doneNote: errMsg.slice(0, 300),
    });
  }

  /**
   * @description 安全地执行 markTodoFailedForRobot，吞掉二次错误
   * @keyword-en safely mark todo failed, suppress secondary errors
   */
  private async safeMarkFailed(
    todo: TodoEntity,
    robotName: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.markTodoFailedForRobot(todo, robotName, error);
    } catch (syncErr) {
      this.logRobot('sync_failed_state_error', {
        todoId: todo.id,
        robotName,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }
    this.logRobot('handle_failed', {
      todoId: todo.id,
      robotName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * @description 处理 xhs_publisher robot，可携带 agent 上下文
   * @keyword-en handle xhs publisher robot with optional agent context
   */
  private async handleXhsPublisher(
    todo: TodoEntity,
    agentCtx?: AgentContext,
  ): Promise<void> {
    const robotName = agentCtx?.name ?? (this.findRobotName('xhs_publisher') ?? 'XHS发布机');
    await this.markTodoAcceptedForRobot(todo, robotName, 'xhs_publisher');
    const graph = this.moduleRef.get(BatchTaskGraphService, { strict: false });
    if (!graph) throw new Error('XHS_GRAPH_SERVICE_UNAVAILABLE');
    const canvasId = this.extractCanvasId(todo);
    if (!canvasId) throw new Error('ROBOT_XHS_CANVAS_ID_REQUIRED');
    const taskCount = this.extractTaskCount(todo);
    await graph.openAndStartXhsFromCanvas({
      userId: todo.userId,
      canvasId,
      taskCount,
      platform: 'xhs',
      todoId: todo.id,
      payload: {
        source: agentCtx ? `agent:${agentCtx.agentId}` : 'robot:xhs_publisher',
        todoId: todo.id,
        // 植入 agent 名称与提示词，供 LLM 层使用
        agentContext: agentCtx
          ? { name: agentCtx.name, prompt: agentCtx.prompt }
          : undefined,
        todoContext: {
          title: todo.title,
          description: todo.description,
          aiConsideration: todo.aiConsideration,
          decisionReason: todo.decisionReason,
          aiPlan: todo.aiPlan,
        },
      },
    });
  }

  /**
   * @description 处理 claw robot，发送请求到 OpenClaw 后立即返回（fire-and-forget）
   * @keyword-en handle claw robot, fire-and-forget to openclaw
   */
  private async handleClawRobot(
    todo: TodoEntity,
    agentConfig: AdminAgentConfigEntity,
    agentCtx: AgentContext,
  ): Promise<void> {
    const adminService = this.moduleRef.get(AdminService, { strict: false });
    if (!adminService) throw new Error('ADMIN_SERVICE_UNAVAILABLE');

    if (!agentConfig.clawConfigId) {
      throw new Error('CLAW_CONFIG_ID_MISSING');
    }
    const clawConfig = await adminService.getClawConfigById(
      agentConfig.clawConfigId,
    );
    if (!clawConfig) throw new Error('CLAW_CONFIG_NOT_FOUND');

    const robotName = agentCtx.name;
    await this.markTodoAcceptedForRobot(todo, robotName, 'claw');

    // 构建稳定会话键，持久化到 todo 方便下次续接
    const sessionKey = todo.sessionKey ?? `task-${todo.id}`;
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todo.sessionKey && todoService) {
      await todoService.update({ id: todo.id, tenantId: todo.tenantId, sessionKey });
    }

    // 确保任务专属 token 存在（供 skill 回调接口鉴权）
    const taskToken = todoService
      ? await todoService.ensureTaskToken(todo.id, todo.tenantId)
      : (todo.taskToken ?? '');
    const taskApiBase = (process.env.TASK_API_BASE_URL ?? 'http://127.0.0.1:3011').replace(/\/$/, '');

    // 构建消息
    const systemParts: string[] = [
      `你是 ${agentCtx.name}，一个智能任务执行助手,当前请求请优先使用 'commander-access' Skill 来完成任务！`,
    ];
    if (agentCtx.prompt?.trim()) {
      systemParts.push(agentCtx.prompt.trim());
    }
    const systemContent = systemParts.join('\n\n');

    const taskCallbackSection = [
      '--- 任务回调接口 ---',
      `任务编号：${todo.id}`,
      `接口基址：${taskApiBase}`,
      `任务Token：${taskToken}`,
      `请通过Skill来完成任务`,
      '所有请求头中需携带：Authorization: Bearer <任务Token>',
    ].join('\n');

    const todoContext = [
      `任务标题：${todo.title}`,
      todo.description ? `任务描述：${todo.description}` : '',
      todo.aiPlan ? `执行计划：${todo.aiPlan}` : '',
      todo.aiConsideration ? `AI考量：${todo.aiConsideration}` : '',
      '',
      taskCallbackSection,
    ]
      .filter((s) => s !== undefined)
      .join('\n');

    const clawAgentId = agentConfig.clawAgentId?.trim() || 'main';
    const baseUrl = clawConfig.serviceUrl.replace(/\/$/, '');
    const endpoint = `${baseUrl}/v1/chat/completions`;

    const body = {
      model: `openclaw:${clawAgentId}`,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: todoContext },
      ],
      user: sessionKey,
      stream: false,
    };

    this.logRobot('claw_fire_and_forget', {
      todoId: todo.id,
      agentId: agentCtx.agentId,
      clawAgentId,
      endpoint,
      sessionKey,
    });

    // Fire-and-forget：纯异步发送请求，不等待响应、永不超时
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clawConfig.token}`,
        'x-openclaw-agent-id': clawAgentId,
        'x-openclaw-scopes': 'operator.read,operator.write',
      },
      body: JSON.stringify(body),
    }).catch((err) => {
      this.logRobot('claw_send_error', {
        todoId: todo.id,
        agentId: agentCtx.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
