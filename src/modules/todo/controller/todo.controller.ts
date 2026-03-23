import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../../admin/services/admin.service.js';
import { RobotRegistryService } from '../../auto-task-robot/services/robot-registry.service.js';
import { TodoService } from '../services/todo.service.js';
import type {
  TodoCreateInput,
  TodoEntity,
  TodoUpdateInput,
} from '../entities/todo.entity.js';
import type {
  TodoItemCreateInput,
  TodoItemUpdateInput,
} from '../entities/todo-item.entity.js';

/**
 * @description 待办控制器，提供REST接口
 * @keyword todo, controller, rest
 * @since 2026-01-27
 */
@Controller('todo')
export class TodoController {
  constructor(
    private readonly todo: TodoService,
    private readonly adminService: AdminService,
    private readonly robots: RobotRegistryService,
  ) {}

  @Post(':todoId/items')
  async createItem(
    @Param('todoId') todoId: string,
    @Body() input: Omit<TodoItemCreateInput, 'todoId'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.createItem({
      ...input,
      todoId: Number(todoId),
      tenantId: authUser?.tenantId,
    });
    return { item: { ...doc, _id: undefined } };
  }

  @Get(':todoId/items')
  async listItems(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const rows = await this.todo.listItems(Number(todoId), authUser?.tenantId);
    return { items: rows };
  }

  @Get('items/:id')
  async getItem(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.getItem(Number(id), authUser?.tenantId);
    return { item: doc };
  }

  @Patch('items/:id')
  async updateItem(
    @Param('id') id: string,
    @Body() input: Omit<TodoItemUpdateInput, 'id'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.updateItem({
      ...input,
      id: Number(id),
      tenantId: authUser?.tenantId,
    });
    return { item: doc };
  }

  @Delete('items/:id')
  async removeItem(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const ok = await this.todo.deleteItem(Number(id), authUser?.tenantId);
    return { ok };
  }

  /**
   * @description 创建待办
   * @param {TodoCreateInput} input - 创建输入
   * @returns {Promise<Record<string, unknown>>} 创建结果
   * @keyword todo, create
   * @since 2026-01-27
   */
  @Post()
  async create(
    @Body() input: TodoCreateInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.create({
      ...input,
      tenantId: authUser?.tenantId,
    });
    const robotTrigger = await this.triggerRobotIfNeeded(doc);
    return { todo: { ...doc, _id: undefined }, robotTrigger };
  }

  /**
   * @description 列出待办，支持按用户和指派人过滤
   */
  @Get()
  async list(
    @Req() req: Request,
    @Query('userId') userId?: string,
    @Query('assignee') assignee?: string,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const canViewAll = this.canViewAllTasks(authUser?.role);
    // 如果指定了 assignee，优先使用指定的 assignee 进行过滤
    const filterAssignee = assignee ?? (canViewAll ? undefined : authUser?.displayName);
    const rows = await this.todo.listByScope({
      canViewAll,
      tenantId: authUser?.tenantId,
      userId: canViewAll ? userId : authUser?.username,
      assignee: filterAssignee,
    });
    return { todos: rows };
  }

  /**
   * @description 获取历史接单人名称列表
   */
  @Get('assignees')
  async listAssignees(@Req() req: Request): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const assignees = await this.todo.listAssignees(authUser?.tenantId);
    return { assignees };
  }

  @Get('assignee-targets')
  async listAssigneeTargets(
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const users = authUser ? await this.adminService.listUsers(authUser) : [];
    const userTargets = users
      .map((u) => {
        const displayName = String(u.displayName ?? '').trim();
        const username = String(u.username ?? '').trim();
        const label = displayName || username;
        if (!label) return null;
        return {
          value: label,
          label,
          type: 'user',
          username,
          role: String(u.role ?? ''),
        };
      })
      .filter((x) => !!x);
    const robots = this.robots.listRobots().map((r) => ({
      value: `robot:${r.code}`,
      label: r.name,
      type: 'robot',
      code: r.code,
      description: r.description,
    }));
    return {
      targets: [...userTargets, ...robots],
    };
  }

  /**
   * @description 接单
   */
  @Post(':id/accept')
  async accept(
    @Param('id') id: string,
    @Body() body: { assignee: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.acceptTask(
      Number(id),
      body.assignee,
      authUser?.tenantId,
    );
    const robotTrigger = await this.triggerRobotIfNeeded(doc);
    return { todo: doc ? { ...doc, _id: undefined } : null, robotTrigger };
  }

  /**
   * @description 获取待办
   * @param {string} id - 序号ID
   * @returns {Promise<Record<string, unknown>>} 单条
   * @keyword todo, get
   * @since 2026-01-27
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.get(Number(id), authUser?.tenantId);
    return { todo: doc };
  }

  /**
   * @description 更新待办
   * @param {string} id - 序号ID
   * @param {TodoUpdateInput} input - 更新输入
   * @returns {Promise<Record<string, unknown>>} 更新结果
   * @keyword todo, update
   * @since 2026-01-27
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() input: TodoUpdateInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const doc = await this.todo.update({
      ...input,
      id: Number(id),
      tenantId: authUser?.tenantId,
    });
    const robotTrigger = await this.triggerRobotIfNeeded(doc);
    return { todo: doc, robotTrigger };
  }

  /**
   * @description 删除待办
   * @param {string} id - 序号ID
   * @returns {Promise<Record<string, unknown>>} 删除结果
   * @keyword todo, delete
   * @since 2026-01-27
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authUser = await this.resolveAuthUser(req);
    const ok = await this.todo.delete(Number(id), authUser?.tenantId);
    return { ok };
  }

  /**
   * @description 解析请求中的后台登录用户
   * @keyword-en resolve admin user from authorization
   */
  private async resolveAuthUser(req: Request) {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return null;
    }
    const token = auth.slice(7).trim();
    if (!token) return null;
    return this.adminService.getUserByToken(token);
  }

  /**
   * @description 判断是否拥有查看全部任务权限
   * @keyword-en check task full visibility role
   */
  private canViewAllTasks(role?: string): boolean {
    return role === 'super_admin' || role === 'tenant_admin';
  }

  private async triggerRobotIfNeeded(
    todo: TodoEntity | null,
  ): Promise<Record<string, unknown>> {
    if (!todo) return { triggered: false };
    const res = await this.robots.triggerIfRobotAssigned({ todo });
    return res;
  }
}
