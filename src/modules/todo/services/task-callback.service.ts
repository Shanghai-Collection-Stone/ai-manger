import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { TodoCallback, TodoEntity } from '../entities/todo.entity.js';

/**
 * @description 任务回调事件处理服务，在任务状态变更（done/failed）后异步处理回调事件链。
 * 支持内置事件：
 * - `update_process_task`: 更新目标任务的 assignee 并触发机器人执行
 * @keyword-en task callback event processor service
 */
@Injectable()
export class TaskCallbackService {
  private readonly logger = new Logger(TaskCallbackService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @description 异步处理 todo 的所有回调事件（非阻塞，失败不影响主流程）。
   * @param {TodoEntity} todo - 已完成状态的 todo 实体。
   * @keyword-en process all callbacks for a completed todo
   */
  processCallbacks(todo: TodoEntity): void {
    const callbacks = todo.callbacks;
    if (!callbacks || callbacks.length === 0) return;
    void this.runCallbacks(todo, callbacks).catch((err: unknown) => {
      this.logger.error(
        `[TaskCallback] runCallbacks error todoId=${todo.id}`,
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  /**
   * @description 顺序执行回调列表。
   * @param {TodoEntity} todo - 源任务实体。
   * @param {TodoCallback[]} callbacks - 回调事件列表。
   * @keyword-en run callbacks sequentially
   */
  private async runCallbacks(
    todo: TodoEntity,
    callbacks: TodoCallback[],
  ): Promise<void> {
    for (const cb of callbacks) {
      try {
        await this.dispatchCallback(todo, cb);
      } catch (err) {
        this.logger.error(
          `[TaskCallback] event=${cb.event} todoId=${todo.id} failed`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * @description 分发单个回调事件。
   * @param {TodoEntity} todo - 源任务实体。
   * @param {TodoCallback} cb - 回调事件。
   * @keyword-en dispatch single callback event
   */
  private async dispatchCallback(
    todo: TodoEntity,
    cb: TodoCallback,
  ): Promise<void> {
    this.logger.log(
      `[TaskCallback] dispatch event=${cb.event} sourceTodoId=${todo.id}`,
    );

    if (cb.event === 'update_process_task') {
      await this.handleUpdateProcessTask(todo, cb);
      return;
    }

    this.logger.warn(`[TaskCallback] unknown event=${cb.event}, skipped`);
  }

  /**
   * @description 处理 update_process_task 事件：
   * 1. 获取目标任务
   * 2. 更新 assignee（若有）
   * 3. 触发机器人执行
   * @param {TodoEntity} sourceTodo - 源任务实体（已完成）。
   * @param {TodoCallback} cb - 回调事件（含 targetTodoId/assignee/action）。
   * @keyword-en handle update_process_task event, assign agent and trigger robot
   */
  private async handleUpdateProcessTask(
    sourceTodo: TodoEntity,
    cb: TodoCallback,
  ): Promise<void> {
    const targetTodoId = cb.params?.targetTodoId;
    if (!targetTodoId || typeof targetTodoId !== 'number') {
      this.logger.warn(
        `[TaskCallback] update_process_task missing targetTodoId, sourceTodoId=${sourceTodo.id}`,
      );
      return;
    }

    // 懒加载 TodoService（避免循环依赖）
    const { TodoService } = await import('./todo.service.js');
    const todoService = this.moduleRef.get(TodoService, { strict: false });
    if (!todoService) {
      this.logger.error('[TaskCallback] TodoService unavailable');
      return;
    }

    const target = await todoService.get(targetTodoId, sourceTodo.tenantId);
    if (!target) {
      this.logger.warn(
        `[TaskCallback] targetTodoId=${targetTodoId} not found, sourceTodoId=${sourceTodo.id}`,
      );
      return;
    }

    const newAssignee = cb.params?.assignee;
    if (newAssignee && typeof newAssignee === 'string') {
      await todoService.update({
        id: targetTodoId,
        tenantId: sourceTodo.tenantId,
        assignee: newAssignee,
      });
      this.logger.log(
        `[TaskCallback] updated targetTodoId=${targetTodoId} assignee=${newAssignee}`,
      );
    }

    // 获取最新的 target（含新 assignee）
    const updatedTarget = await todoService.get(
      targetTodoId,
      sourceTodo.tenantId,
    );
    if (!updatedTarget) return;

    // 触发机器人执行
    const { RobotRegistryService } = await import(
      '../../auto-task-robot/services/robot-registry.service.js'
    );
    const robotService = this.moduleRef.get(RobotRegistryService, {
      strict: false,
    });
    if (!robotService) {
      this.logger.warn('[TaskCallback] RobotRegistryService unavailable');
      return;
    }

    const result = await robotService.triggerIfRobotAssigned({
      todo: updatedTarget,
    });
    this.logger.log(
      `[TaskCallback] triggerIfRobotAssigned targetTodoId=${targetTodoId} triggered=${String(result.triggered)} robotCode=${result.robotCode ?? '-'}`,
    );
  }
}
