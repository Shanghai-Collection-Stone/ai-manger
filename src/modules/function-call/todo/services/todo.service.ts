import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { TodoService } from '../../../todo/services/todo.service.js';

/**
 * @description 待办函数调用工具，提供AI可用的待办CRUD能力
 * @keyword todo, function-call, tools
 * @since 2026-01-27
 */
@Injectable()
export class TodoFunctionCallService {
  constructor(private readonly todo: TodoService) {}

  /**
   * @description 返回待办工具句柄集合
   * @returns {CreateAgentParams['tools']} 工具集合
   * @keyword todo, tools, handle
   * @since 2026-01-27
   */
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const todoCreate = tool(
      async ({
        tenantId,
        userId,
        title,
        description,
        assignee,
        aiConsideration,
        decisionReason,
        aiPlan,
      }) => {
        const doc = await this.todo.create({
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: this.resolveUserId(userId, scope),
          title,
          description,
          assignee: typeof assignee === 'string' ? assignee.trim() : undefined,
          aiConsideration,
          decisionReason,
          aiPlan,
        });
        return JSON.stringify({ todo: { ...doc, _id: undefined } });
      },
      {
        name: 'todo_create',
        description:
          'Create a todo for a specific user with AI consideration, decision reason and AI plan.',
        schema: z.object({
          userId: z.string().describe('Target user id'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
          title: z.string().describe('Todo title'),
          description: z.string().optional().describe('Todo description'),
          assignee: z
            .string()
            .optional()
            .describe('Offline assignee or staff name'),
          aiConsideration: z.string().describe('AI consideration'),
          decisionReason: z.string().describe('Decision reasoning'),
          aiPlan: z.string().describe('AI plan for the user'),
        }),
      },
    );

    const todoUpdate = tool(
      async ({ id, tenantId, userId, ...rest }) => {
        const doc = await this.todo.update({
          id,
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: this.resolveUserId(userId, scope),
          ...rest,
        });
        return JSON.stringify({ todo: doc });
      },
      {
        name: 'todo_update',
        description: 'Update a todo by sequence id.',
        schema: z.object({
          id: z.number().describe('Todo sequence id'),
          userId: z.string().optional().describe('Target user id'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
          title: z.string().optional().describe('Todo title'),
          description: z.string().optional().describe('Todo description'),
          assignee: z
            .string()
            .optional()
            .describe('Offline assignee or staff name'),
          aiConsideration: z.string().optional().describe('AI consideration'),
          decisionReason: z.string().optional().describe('Decision reasoning'),
          aiPlan: z.string().optional().describe('AI plan for the user'),
          status: z
            .enum(['pending', 'in_progress', 'done', 'failed', 'cancelled'])
            .optional()
            .describe('Todo status'),
        }),
      },
    );

    const todoDelete = tool(
      async ({ id, tenantId }) => {
        const ok = await this.todo.delete(
          id,
          this.resolveTenantId(tenantId, scope),
        );
        return JSON.stringify({ ok });
      },
      {
        name: 'todo_delete',
        description: 'Delete a todo by sequence id.',
        schema: z.object({
          id: z.number().describe('Todo sequence id'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
        }),
      },
    );

    const todoGet = tool(
      async ({ id, tenantId }) => {
        const doc = await this.todo.get(
          id,
          this.resolveTenantId(tenantId, scope),
        );
        return JSON.stringify({ todo: doc });
      },
      {
        name: 'todo_get',
        description: 'Get a todo by sequence id.',
        schema: z.object({
          id: z.number().describe('Todo sequence id'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
        }),
      },
    );

    const todoList = tool(
      async ({ userId, tenantId }) => {
        const rows = await this.todo.list(
          this.resolveUserId(userId, scope),
          this.resolveTenantId(tenantId, scope),
        );
        return JSON.stringify({ todos: rows });
      },
      {
        name: 'todo_list',
        description: 'List todos, optionally filtered by user id.',
        schema: z.object({
          userId: z.string().optional().describe('Target user id'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
        }),
      },
    );

    return [todoCreate, todoUpdate, todoDelete, todoGet, todoList];
  }

  /**
   * @description 解析租户ID优先级
   * @keyword-en resolve tenant id
   */
  private resolveTenantId(
    tenantId: string | undefined,
    scope?: { tenantId?: string; userId?: string },
  ): string | undefined {
    const value = tenantId?.trim();
    if (value) return value;
    return scope?.tenantId;
  }

  /**
   * @description 解析用户ID优先级
   * @keyword-en resolve user id
   */
  private resolveUserId(
    userId: string | undefined,
    scope?: { tenantId?: string; userId?: string },
  ): string {
    const value = userId?.trim();
    if (value) return value;
    return scope?.userId || 'default';
  }
}
