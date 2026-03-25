import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import { BatchTaskGraphService } from '../../graph/services/batch-task-graph.service.js';
import { TodoService } from '../../todo/services/todo.service.js';

export interface AutoTaskRobotDescriptor {
  code: string;
  name: string;
  description: string;
}

@Injectable()
export class RobotRegistryService {
  constructor(private readonly moduleRef: ModuleRef) {}

  private findRobotName(code?: string): string | undefined {
    const key = String(code ?? '').trim().toLowerCase();
    if (!key) return undefined;
    return this.listRobots().find((r) => r.code === key)?.name;
  }

  private logRobot(event: string, extra?: Record<string, unknown>): void {
    console.log('[AutoRobot]', {
      event,
      at: new Date().toISOString(),
      ...(extra ?? {}),
    });
  }

  listRobots(): AutoTaskRobotDescriptor[] {
    return [
      {
        code: 'xhs_publisher',
        name: '小红书发布机',
        description:
          '接收 Todo 派单后自动执行小红书批量发布流程（基于 Canvas + Todo）。',
      },
    ];
  }

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

  async triggerIfRobotAssigned(input: {
    todo: TodoEntity;
  }): Promise<{ triggered: boolean; robotCode?: string; error?: string }> {
    const robotCode = this.parseRobotCode(input.todo.assignee);
    if (!robotCode) return { triggered: false };
    this.logRobot('handle_assigned_todo', {
      todoId: input.todo.id,
      assignee: input.todo.assignee,
      robotCode,
      robotName: this.findRobotName(robotCode),
      status: input.todo.status,
    });
    try {
      if (robotCode === 'xhs_publisher') {
        await this.handleXhsPublisher(input.todo);
        this.logRobot('handle_completed', {
          todoId: input.todo.id,
          robotCode,
        });
        return { triggered: true, robotCode };
      }
      return {
        triggered: false,
        robotCode,
        error: 'ROBOT_NOT_FOUND',
      };
    } catch (error) {
      try {
        await this.markTodoFailedForRobot(input.todo, robotCode, error);
      } catch (syncErr) {
        this.logRobot('sync_failed_state_error', {
          todoId: input.todo.id,
          robotCode,
          error:
            syncErr instanceof Error ? syncErr.message : String(syncErr),
        });
      }
      this.logRobot('handle_failed', {
        todoId: input.todo.id,
        robotCode,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        triggered: true,
        robotCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

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

  private extractTaskCount(todo: TodoEntity): number {
    const text = [todo.title, todo.description, todo.aiPlan]
      .filter(Boolean)
      .join('\n');
    const r = /(\d+)\s*(?:篇|条|个|post|posts)\b/i.exec(text);
    const n = Number(r?.[1] ?? '');
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.min(100, Math.floor(n)));
  }

  private async markTodoAcceptedForRobot(
    todo: TodoEntity,
    robotCode: string,
  ): Promise<void> {
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todoService) return;
    const robotName = this.findRobotName(robotCode) ?? `自动化代理(${robotCode})`;

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
        doneNote: `source=robot:${robotCode}`,
      });
    }
  }

  private async markTodoFailedForRobot(
    todo: TodoEntity,
    robotCode: string,
    rawError: unknown,
  ): Promise<void> {
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todoService) return;
    const robotName = this.findRobotName(robotCode) ?? `自动化代理(${robotCode})`;
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

  private async handleXhsPublisher(todo: TodoEntity): Promise<void> {
    await this.markTodoAcceptedForRobot(todo, 'xhs_publisher');
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
        source: 'robot:xhs_publisher',
        todoId: todo.id,
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
}
