import { Injectable, Logger } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { TodoService } from '../../../todo/services/todo.service.js';
import { RobotRegistryService } from '../../../auto-task-robot/services/robot-registry.service.js';

/**
 * @description 待办函数调用工具，提供AI可用的待办CRUD能力
 * @keyword todo, function-call, tools
 * @since 2026-01-27
 */
@Injectable()
export class TodoFunctionCallService {
  private readonly logger = new Logger(TodoFunctionCallService.name);

  constructor(
    private readonly todo: TodoService,
    private readonly robots: RobotRegistryService,
  ) {}

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
        resource,
        assignee,
        type,
        aiConsideration,
        decisionReason,
        aiPlan,
      }) => {
        const autoXhsPublish = this.shouldAutoAssignXhsRobot({
          title,
          description,
          type,
          aiPlan,
          decisionReason,
        });
        const finalUserId = this.resolveUserId(userId, scope, 'todo_create');
        const finalAssigneeRaw =
          typeof assignee === 'string' ? assignee.trim() : '';
        const finalAssignee =
          finalAssigneeRaw || (autoXhsPublish ? 'robot:xhs_publisher' : undefined);
        const normalizedType = this.normalizeToolTodoTypeInput(type);
        const finalType = autoXhsPublish ? 'auto_execute' : normalizedType;
        const finalDescription = this.buildTodoDescription({
          title,
          description,
          resource,
          aiConsideration,
          decisionReason,
          aiPlan,
        });
        const doc = await this.todo.create({
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: finalUserId,
          title,
          description: finalDescription,
          resource: typeof resource === 'string' ? resource.trim() : undefined,
          assignee: finalAssignee,
          type: finalType,
          aiConsideration,
          decisionReason,
          aiPlan,
        });
        const robotTrigger = this.triggerRobotAssignedDeferred(doc);
        return JSON.stringify({ todo: { ...doc, _id: undefined }, robotTrigger });
      },
      {
        name: 'todo_create',
        description:
          'Create a todo for a specific user with AI consideration, decision reason and AI plan.',
        schema: z.object({
          userId: z
            .string()
            .optional()
            .describe('Target user id（有会话上下文时将被忽略，强制使用上下文 userId）'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
          title: z.string().describe('Todo title'),
          description: z.string().optional().describe('Todo description'),
          resource: z
            .string()
            .optional()
            .describe('关联资源（如 Canvas#384、URL 或资源摘要）'),
          assignee: z
            .string()
            .optional()
            .describe('接单人中文名称（如“小红书发布机”或线下人员名）'),
          type: z
            .string()
            .optional()
            .describe(
              '任务类型（推荐：auto_execute/offline_execute/other；兼容历史值如 xhs_publish、cleaning 等）',
            ),
          aiConsideration: z.string().describe('AI consideration'),
          decisionReason: z.string().describe('Decision reasoning'),
          aiPlan: z.string().describe('AI plan for the user'),
        }),
      },
    );

    const todoUpdate = tool(
      async ({ id, tenantId, userId, ...rest }) => {
        const normalizedType = this.normalizeToolTodoTypeInput(rest.type);
        const doc = await this.todo.update({
          id,
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: this.resolveUserId(userId, scope),
          ...rest,
          type: normalizedType,
        });
        const robotTrigger = doc
          ? this.triggerRobotAssignedDeferred(doc)
          : { triggered: false };
        return JSON.stringify({ todo: doc, robotTrigger });
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
          resource: z
            .string()
            .optional()
            .describe('关联资源（如 Canvas#384、URL 或资源摘要）'),
          assignee: z
            .string()
            .optional()
            .describe('接单人中文名称（如“小红书发布机”或线下人员名）'),
          type: z
            .string()
            .optional()
            .describe(
              '任务类型（推荐：auto_execute/offline_execute/other；兼容历史值如 xhs_publish、cleaning 等）',
            ),
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
    const scoped = scope?.tenantId?.trim();
    const requested = tenantId?.trim();
    if (scoped) {
      if (requested && requested !== scoped) {
        throw new Error('TENANT_SCOPE_MISMATCH');
      }
      return scoped;
    }
    return requested;
  }

  /**
   * @description 解析用户ID优先级
   * @keyword-en resolve user id
   */
  private resolveUserId(
    userId: string | undefined,
    scope?: { tenantId?: string; userId?: string },
    action: string = 'todo_tool',
  ): string {
    const scoped = scope?.userId?.trim();
    const requested = userId?.trim();
    if (scoped) {
      if (requested && requested !== scoped) {
        this.logger.warn(
          `[${action}] USER_SCOPE_OVERRIDE requested=${requested} scoped=${scoped}`,
        );
      }
      return scoped;
    }
    if (requested) return requested;
    return 'default';
  }

  /**
   * @description 归一化工具入参中的任务类型，兼容历史/别名值。
   * @param {unknown} input - 工具原始类型输入。
   * @returns {unknown} 归一化后的类型或原值。
   * @keyword-en normalize tool todo type input
   */
  private normalizeToolTodoTypeInput(input: unknown):
    | 'auto_execute'
    | 'offline_execute'
    | 'other'
    | undefined {
    if (typeof input !== 'string') return undefined;
    const t = input.trim().toLowerCase();
    if (!t) return undefined;
    if (
      [
        'auto_execute',
        'auto',
        'xhs_publish',
        'xhs_publisher',
        'publish',
        '发布',
        '自动执行',
      ].includes(t)
    ) {
      return 'auto_execute';
    }
    if (
      [
        'offline_execute',
        'offline',
        'cleaning',
        'security',
        'repair',
        'inspection',
        '线下执行',
      ].includes(t)
    ) {
      return 'offline_execute';
    }
    if (['other', '其他'].includes(t)) return 'other';
    return 'other';
  }

  /**
   * @description 构建待办描述：优先使用传入描述，缺失时从上下文摘要自动补全。
   * @param {{
   *   title?: string;
   *   description?: string;
   *   resource?: string;
   *   aiConsideration?: string;
   *   decisionReason?: string;
   *   aiPlan?: string;
   * }} input - 待办上下文信息。
   * @returns {string} 最终描述。
   * @keyword-en build todo description fallback
   */
  private buildTodoDescription(input: {
    title?: string;
    description?: string;
    resource?: string;
    aiConsideration?: string;
    decisionReason?: string;
    aiPlan?: string;
  }): string {
    const rawDescription = String(input.description ?? '').trim();
    if (rawDescription) return rawDescription;

    const lines: string[] = [];
    const title = String(input.title ?? '').trim();
    const resource = String(input.resource ?? '').trim();
    const consideration = String(input.aiConsideration ?? '').trim();
    const reason = String(input.decisionReason ?? '').trim();
    const plan = String(input.aiPlan ?? '').trim();

    if (title) lines.push(`任务背景：${title}`);
    if (consideration) lines.push(`上下文说明：${consideration}`);
    if (reason) lines.push(`发起原因：${reason}`);
    if (resource) lines.push(`关联资源：${resource}`);
    if (plan) lines.push(`执行计划：${plan}`);

    if (lines.length === 0) return '由对话上下文自动创建的发布任务';
    return lines.join('\n');
  }

  private shouldAutoAssignXhsRobot(input: {
    title?: string;
    description?: string;
    type?: string;
    aiPlan?: string;
    decisionReason?: string;
  }): boolean {
    const text = [
      input.title,
      input.description,
      input.type,
      input.aiPlan,
      input.decisionReason,
    ]
      .filter(Boolean)
      .join('\n');
    return /小红书|xhs|发文|发布|batch publish/i.test(text);
  }

  /**
   * @description 异步触发机器人处理，避免机器人链路异常影响工具主流程。
   * @param {import('../../../todo/entities/todo.entity.js').TodoEntity} todo - 待办实体。
   * @returns {{ triggered: boolean; deferred: boolean; robotCode?: string; error?: string }} 触发状态。
   * @keyword-en deferred robot trigger
   */
  private triggerRobotAssignedDeferred(todo: import('../../../todo/entities/todo.entity.js').TodoEntity): {
    triggered: boolean;
    deferred: boolean;
    robotCode?: string;
    error?: string;
  } {
    const robotCode = this.robots.parseRobotCode(todo.assignee);
    if (!robotCode) {
      return { triggered: false, deferred: false };
    }

    void this.robots
      .triggerIfRobotAssigned({ todo })
      .then((ret) => {
        if (ret?.error) {
          this.logger.warn(
            `[todo-robot] todoId=${todo.id} robotCode=${robotCode} async_failed=${ret.error}`,
          );
          return;
        }
        this.logger.debug(
          `[todo-robot] todoId=${todo.id} robotCode=${robotCode} async_completed=true`,
        );
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[todo-robot] todoId=${todo.id} robotCode=${robotCode} async_throw=${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return { triggered: true, deferred: true, robotCode };
  }
}
