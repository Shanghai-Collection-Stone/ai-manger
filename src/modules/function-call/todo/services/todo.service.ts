import { Injectable, Logger } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { TodoService } from '../../../todo/services/todo.service.js';
import { RobotRegistryService } from '../../../auto-task-robot/services/robot-registry.service.js';
import { FunctionCallScope } from '../../tools/services/tools.service.js';

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
  getHandle(scope?: FunctionCallScope): CreateAgentParams['tools'] {
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
        deadline,
        callbacks,
      }) => {
        const finalUserId = this.resolveUserId(userId, scope, 'todo_create');
        const finalAssigneeRaw =
          typeof assignee === 'string' ? assignee.trim() : '';
        const finalAssignee = finalAssigneeRaw || undefined;
        let finalType = this.normalizeToolTodoTypeInput(type);
        if (!finalType) {
          finalType = 'other';
        }
        const finalDescription = this.buildTodoDescription({
          title,
          description,
          resource,
          aiConsideration,
          decisionReason,
          aiPlan,
        });

        // 解析 resource 为 JSON 并写入 associatedResources
        let associatedResources:
          | { type: string; resourceId: string | number }[]
          | undefined;
        if (typeof resource === 'string' && resource.trim()) {
          try {
            const parsed = JSON.parse(resource);
            if (!Array.isArray(parsed)) {
              return JSON.stringify({
                ok: false,
                error: 'RESOURCE_FORMAT_ERROR',
                message:
                  'resource 必须是 JSON 数组格式，例如：[{"type":"canvas","resourceId":123},{"type":"file","resourceId":"文档.md"}]',
                hint: '请将 resource 字段修改为符合格式的 JSON 数组后重试。每个元素需包含 type（资源类型）和 resourceId（资源ID或文件名）',
              });
            }
            for (let i = 0; i < parsed.length; i++) {
              const item = parsed[i];
              if (
                !item ||
                typeof item.type !== 'string' ||
                item.resourceId === undefined
              ) {
                return JSON.stringify({
                  ok: false,
                  error: 'RESOURCE_ITEM_ERROR',
                  message: `resource[${i}] 格式错误：每个元素必须包含 type（string）和 resourceId（string|number）`,
                  received: JSON.stringify(item),
                  hint: `请确保 resource[${i}] 包含有效的 type 和 resourceId 字段后重试`,
                });
              }
            }
            associatedResources = parsed;
          } catch {
            return JSON.stringify({
              ok: false,
              error: 'RESOURCE_JSON_PARSE_ERROR',
              message: `resource 不是合法的 JSON 字符串，请检查 JSON 格式是否正确`,
              received: resource,
              hint: '示例格式：[{"type":"canvas","resourceId":123},{"type":"file","resourceId":"任务说明.md"}]',
            });
          }
        }
        const finalAiPlan = this.injectLongTaskCronPrompt(
          finalType,
          this.injectXhsTrackerDataCollectPrompt(finalAssignee, aiPlan),
          typeof deadline === 'string' ? deadline : undefined,
        );
        const deadlineDate =
          typeof deadline === 'string' && deadline
            ? new Date(deadline)
            : undefined;
        // 小红书相关任务自动从上下文继承 category
        const finalCategory = scope?.category;
        const doc = await this.todo.create({
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: finalUserId,
          title,
          description: finalDescription,
          resource: typeof resource === 'string' ? resource.trim() : undefined,
          associatedResources,
          assignee: finalAssignee,
          type: finalType,
          category: finalCategory,
          aiConsideration,
          decisionReason,
          aiPlan: finalAiPlan,
          deadline: deadlineDate,
          callbacks: (() => {
            if (Array.isArray(callbacks)) return callbacks;
            if (typeof callbacks === 'string' && callbacks.trim()) {
              try { return JSON.parse(callbacks); } catch { /* ignore */ }
            }
            return undefined;
          })(),
        });
        const robotTrigger = this.triggerRobotAssignedDeferred(doc);
        return JSON.stringify({
          todo: { ...doc, _id: undefined },
          robotTrigger,
        });
      },
      {
        name: 'todo_create',
        description:
          'Create a todo for a specific user with AI consideration, decision reason and AI plan. Use robot_list tool first to get available agent IDs for assignee field.',
        schema: z.object({
          userId: z
            .string()
            .optional()
            .describe(
              'Target user id（有会话上下文时将被忽略，强制使用上下文 userId）',
            ),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
          title: z.string().describe('Todo title'),
          description: z.string().optional().describe('Todo description'),
          resource: z
            .string()
            .optional()
            .describe(
              '关联资源，必须是 JSON 数组格式，示例：[{"type":"canvas","resourceId":123},{"type":"file","resourceId":"任务说明.md"}]，type 支持 canvas/file 等类型',
            ),
          assignee: z
            .string()
            .optional()
            .describe(
              '指派接单人。优先使用 robot_list 返回的 agents[].id（格式 agent:<24位hex>）进行精准指派；也可使用旧格式 robot:<code>（如 robot:xhs_publisher）或线下人员中文名。',
            ),
          type: z
            .string()
            .optional()
            .describe(
              '任务类型（推荐：auto_execute/offline_execute/long_task/other；兼容历史值如 xhs_publish、cleaning 等）',
            ),
          aiConsideration: z.string().describe('AI consideration'),
          decisionReason: z.string().describe('Decision reasoning'),
          aiPlan: z.string().describe('AI plan for the user'),
          deadline: z
            .string()
            .optional()
            .describe(
              '长时任务截止时间（ISO 日期字符串，仅 long_task 类型使用）',
            ),
          callbacks: z
            .union([
              z.array(
                z.object({
                  event: z.string().describe('回调事件类型，如 update_process_task'),
                  params: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe(
                      '事件参数。update_process_task: { targetTodoId: number, assignee?: string, action?: string }',
                    ),
                }),
              ),
              z.string(),
            ])
            .optional()
            .describe(
              '任务完成/失败后触发的回调事件列表（JSON 数组或 JSON 字符串均可）。常用于发文+数据收集双任务联动：发文任务完成后通过 update_process_task 自动指派并启动数据收集任务。',
            ),
        }),
      },
    );

    const todoUpdate = tool(
      async ({ id, tenantId, userId, deadline, ...rest }) => {
        // 解析 resource 为 JSON 并提取 associatedResources
        let associatedResources:
          | { type: string; resourceId: string | number }[]
          | undefined;
        if (typeof rest.resource === 'string' && rest.resource.trim()) {
          try {
            const parsed = JSON.parse(rest.resource);
            if (!Array.isArray(parsed)) {
              return JSON.stringify({
                ok: false,
                error: 'RESOURCE_FORMAT_ERROR',
                message: 'resource 必须是 JSON 数组格式',
                hint: '示例：[{"type":"canvas","resourceId":123},{"type":"file","resourceId":"文档.md"}]',
              });
            }
            for (let i = 0; i < parsed.length; i++) {
              const item = parsed[i];
              if (
                !item ||
                typeof item.type !== 'string' ||
                item.resourceId === undefined
              ) {
                return JSON.stringify({
                  ok: false,
                  error: 'RESOURCE_ITEM_ERROR',
                  message: `resource[${i}] 格式错误：必须包含 type 和 resourceId`,
                  received: JSON.stringify(item),
                  hint: `请修正 resource[${i}] 后重试`,
                });
              }
            }
            associatedResources = parsed;
          } catch {
            return JSON.stringify({
              ok: false,
              error: 'RESOURCE_JSON_PARSE_ERROR',
              message: 'resource 不是合法的 JSON 字符串',
              hint: '示例：[{"type":"canvas","resourceId":123}]',
            });
          }
        }

        const normalizedType = this.normalizeToolTodoTypeInput(rest.type);
        const deadlineDate =
          typeof deadline === 'string' && deadline
            ? new Date(deadline)
            : undefined;
        const doc = await this.todo.update({
          id,
          tenantId: this.resolveTenantId(tenantId, scope),
          userId: this.resolveUserId(userId, scope),
          ...rest,
          type: normalizedType,
          deadline: deadlineDate,
          associatedResources,
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
            .describe(
              '关联资源，必须是 JSON 数组格式，示例：[{“type”:”canvas”,”resourceId”:123},{“type”:”file”,”resourceId”:”任务说明.md”}]，type 支持 canvas/file 等类型',
            ),
          assignee: z
            .string()
            .optional()
            .describe(
              '指派接单人。优先使用 robot_list 返回的 agents[].id（格式 agent:<24位hex>）进行精准指派；也可使用旧格式 robot:<code>（如 robot:xhs_publisher）或线下人员中文名。',
            ),
          type: z
            .string()
            .optional()
            .describe(
              '任务类型（推荐：auto_execute/offline_execute/long_task/other；兼容历史值如 xhs_publish、cleaning 等）',
            ),
          aiConsideration: z.string().optional().describe('AI consideration'),
          decisionReason: z.string().optional().describe('Decision reasoning'),
          aiPlan: z.string().optional().describe('AI plan for the user'),
          deadline: z
            .string()
            .optional()
            .describe(
              '长时任务截止时间（ISO 日期字符串，仅 long_task 类型使用）',
            ),
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

    /**
     * @description 在指定 Todo 内创建子节点（todo item）。
     * 必须在为父 Todo 设置 assignee 之前调用，否则机器人提前触发会忽略后续节点。
     * @keyword-en todo item create, sub task node
     */
    const todoItemCreate = tool(
      async ({ todoId, title, description, status, stage, tenantId }) => {
        try {
          const doc = await this.todo.createItem({
            todoId,
            tenantId: this.resolveTenantId(tenantId, scope),
            title,
            description,
            status: (status as 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled') ?? 'pending',
            stage,
          });
          return JSON.stringify({ ok: true, item: { ...doc, _id: undefined } });
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          return JSON.stringify({ ok: false, error: e.message });
        }
      },
      {
        name: 'todo_item_create',
        description:
          'Create a sub-item (node) inside an existing todo. IMPORTANT: Call this for EACH article/account assignment BEFORE calling todo_update to set assignee on the parent todo, otherwise the robot triggers before seeing the list.',
        schema: z.object({
          todoId: z.number().describe('Parent todo sequence id'),
          title: z
            .string()
            .describe('Node title, e.g. "账号 username 发送第 1 篇：文章标题"'),
          description: z
            .string()
            .optional()
            .describe('Node description with account and execution details'),
          status: z
            .enum(['pending', 'in_progress', 'done', 'failed', 'cancelled'])
            .optional()
            .describe('Initial status, default: pending'),
          stage: z
            .string()
            .optional()
            .describe('Stage label, e.g. "发布节点 1/3"'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
        }),
      },
    );

    return [todoCreate, todoUpdate, todoDelete, todoGet, todoList, todoItemCreate];
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
  private normalizeToolTodoTypeInput(
    input: unknown,
  ): 'auto_execute' | 'offline_execute' | 'long_task' | 'other' | undefined {
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
    if (['long_task', '长时任务', 'long-task', 'longtask'].includes(t))
      return 'long_task';
    if (['other', '其他'].includes(t)) return 'other';
    return 'other';
  }

  /**
   * @description 当接单人为 robot:xhs_tracker 时，向 aiPlan 注入数据回写规范。
   * Claw 收到任务后需按此规范采集数据并通过专项接口回写。
   * @param {string | undefined} assignee - 归一化后的接单人标识。
   * @param {string} aiPlan - 原始 AI 计划。
   * @returns {string} 注入后的 aiPlan。
   * @keyword-en inject xhs tracker data collection write-back prompt
   */
  private injectXhsTrackerDataCollectPrompt(
    assignee: string | undefined,
    aiPlan: string,
  ): string {
    if (assignee !== 'robot:xhs_tracker') return aiPlan;
    const instructions = [
      '[小红书数据采集-回写规范]',
      '此任务由 xhs_tracker 机器人执行，数据采集完成后必须通过专项接口回写结果。',
      '',
      '【数据回写步骤】',
      '1. 采集帖子数据后，调用批量回写接口：',
      '   POST /task-api/{todoId}/xhs-stats/bulk',
      '   Authorization: Bearer {taskToken}',
      '   Content-Type: application/json',
      '   Body: {',
      '     "items": [',
      '       {',
      '         "postTitle": "帖子标题",',
      '         "postUrl": "https://xiaohongshu.com/...",',
      '         "authorUrl": "https://xiaohongshu.com/user/...",',
      '         "likeCount": 1200,',
      '         "commentCount": 80,',
      '         "collectCount": 450,',
      '         "tag": "分类标签（可选）",',
      '         "dataAt": "2026-04-13T00:00:00.000Z",',
      '         "topComments": [',
      '           { "content": "评论内容", "likeCount": 50, "replyCount": 3 }',
      '         ]',
      '       }',
      '     ]',
      '   }',
      '2. 所有帖子数据回写完成后，将采集摘要（markdown 格式）写入任务成果：',
      '   PATCH /task-api/{todoId}',
      '   Authorization: Bearer {taskToken}',
      '   Body: {',
      '     "taskResult": "## 数据采集摘要\\n- 共采集 N 条帖子\\n- 最高点赞: xxx\\n- ...",',
      '     "status": "done"',
      '   }',
      '3. taskToken 从任务详情中获取（首次执行先调用 GET /task-api/{todoId} 读取）。',
    ].join('\n');
    return [aiPlan, instructions].filter(Boolean).join('\n\n');
  }

  /**
   * @description 当任务类型为 long_task 时，自动在 aiPlan 中注入 Cron job 追踪提示词。
   * @param {string | undefined} type - 归一化后的任务类型。
   * @param {string} aiPlan - 原始 AI 计划。
   * @param {string | undefined} deadline - 截止时间字符串（ISO）。
   * @returns {string} 注入后的 aiPlan。
   * @keyword-en inject long task cron job prompt
   */
  private injectLongTaskCronPrompt(
    type: string | undefined,
    aiPlan: string,
    deadline?: string,
  ): string {
    if (type !== 'long_task') return aiPlan;
    const deadlinePart = deadline
      ? `截止时间：${deadline}。`
      : '该任务无截止时间。';
    const cronInstructions = [
      '[长时任务-Cron 追踪要求]',
      `此任务类型为 long_task（长时任务）。${deadlinePart}`,
      '执行规则：',
      '1. 必须使用 Cron job 定期和追踪本任务状态。',
      '2. 每次 Cron job 执行前，必须先调用 todo_get 查询当前任务状态。',
      '3. 若任务状态为 done/failed/cancelled，必须立即删除 Cron job，停止持续执行。',
      deadline
        ? '4. 若当前时间已超过截止时间，必须删除 Cron job，并将任务状态设置为 cancelled。'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    return [aiPlan, cronInstructions].filter(Boolean).join('\n\n');
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

  /**
   * @description 异步触发机器人处理，避免机器人链路异常影响工具主流程。
   * @param {import('../../../todo/entities/todo.entity.js').TodoEntity} todo - 待办实体。
   * @returns {{ triggered: boolean; deferred: boolean; robotCode?: string; error?: string }} 触发状态。
   * @keyword-en deferred robot trigger
   */
  private triggerRobotAssignedDeferred(
    todo: import('../../../todo/entities/todo.entity.js').TodoEntity,
  ): {
    triggered: boolean;
    deferred: boolean;
    robotCode?: string;
    error?: string;
  } {
    const robotCode = this.robots.parseRobotCode(todo.assignee);
    const agentId = this.robots.parseAgentId(todo.assignee);
    // 既不是 robot:xxx 也不是 agent:xxx，直接跳过
    if (!robotCode && !agentId) {
      return { triggered: false, deferred: false };
    }

    const identifier = robotCode ?? agentId ?? 'unknown';
    void this.robots
      .triggerIfRobotAssigned({ todo })
      .then((ret) => {
        if (ret?.error) {
          this.logger.warn(
            `[todo-robot] todoId=${todo.id} assignee=${todo.assignee} identifier=${identifier} async_failed=${ret.error}`,
          );
          return;
        }
        this.logger.debug(
          `[todo-robot] todoId=${todo.id} assignee=${todo.assignee} identifier=${identifier} async_completed=true`,
        );
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[todo-robot] todoId=${todo.id} assignee=${todo.assignee} identifier=${identifier} async_throw=${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return { triggered: true, deferred: true, robotCode: identifier };
  }
}
