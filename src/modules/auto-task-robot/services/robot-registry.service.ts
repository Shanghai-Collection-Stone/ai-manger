import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import { BatchTaskGraphService } from '../../graph/services/batch-task-graph.service.js';

export interface AutoTaskRobotDescriptor {
  code: string;
  name: string;
  description: string;
}

@Injectable()
export class RobotRegistryService {
  constructor(private readonly moduleRef: ModuleRef) {}

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
    if (!m) return undefined;
    return String(m[1] ?? '')
      .trim()
      .toLowerCase();
  }

  async triggerIfRobotAssigned(input: {
    todo: TodoEntity;
  }): Promise<{ triggered: boolean; robotCode?: string; error?: string }> {
    const robotCode = this.parseRobotCode(input.todo.assignee);
    if (!robotCode) return { triggered: false };
    try {
      if (robotCode === 'xhs_publisher') {
        await this.handleXhsPublisher(input.todo);
        return { triggered: true, robotCode };
      }
      return {
        triggered: false,
        robotCode,
        error: 'ROBOT_NOT_FOUND',
      };
    } catch (error) {
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

  private async handleXhsPublisher(todo: TodoEntity): Promise<void> {
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
