import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { BatchTaskService } from '../services/batch-task.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type {
  BatchTaskAddPostsInput,
  BatchTaskCallbackInput,
  BatchTaskCreateInput,
  BatchTaskRunInput,
} from '../entities/batch-task.entity.js';

@Controller('batch-task')
export class BatchTaskController {
  constructor(
    private readonly batch: BatchTaskService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 从请求中解析认证用户（必须提供有效的认证 token）
   * @param {Request} req - Express 请求对象
   * @returns {Promise<{ tenantId?: string; userId?: string }>} 租户和用户范围
   * @throws {UnauthorizedException} 当没有 token 或 token 无效时抛出
   * @keyword-en resolve auth from request
   */
  private async resolveAuthScope(req: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const user = await this.adminService.getUserByToken(token);
    if (!user) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    return {
      tenantId: user.tenantId,
      userId: user.username,
    };
  }

  /**
   * @description 创建批量任务，并创建对应的待办总览以便追踪。
   * @param {BatchTaskCreateInput} input - 批量任务创建参数。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTask 的响应对象。
   * @keyword batch-task, controller, create
   * @since 2026-02-04
   */
  @Post()
  async create(
    @Body() input: BatchTaskCreateInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.batch.create({
      ...input,
      tenantId: authScope.tenantId,
    });
    return { batchTask: { ...doc, _id: undefined } };
  }

  /**
   * @description 打开/绑定 MCP 侧任务ID。
   * @param {string} id - 路径参数：批量任务ID。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTask 的响应对象。
   * @keyword batch-task, controller, mcp
   * @since 2026-02-04
   */
  @Post(':id/open-mcp')
  async openMcp(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.batch.openMcpTask(Number(id), authScope.tenantId);
    return { batchTask: doc };
  }

  /**
   * @description 向批量任务并行追加发布条目，并建立待办清单条目联动。
   * @param {string} id - 路径参数：批量任务ID。
   * @param {BatchTaskAddPostsInput} input - 发布条目列表与并发参数。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTask 的响应对象。
   * @keyword batch-task, controller, parallel
   * @since 2026-02-04
   */
  @Post(':id/posts')
  async addPosts(
    @Param('id') id: string,
    @Body() input: BatchTaskAddPostsInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.batch.addPostsParallel(
      Number(id),
      input,
      authScope.tenantId,
    );
    return { batchTask: doc };
  }

  /**
   * @description 触发 MCP 批量任务运行。
   * @param {string} id - 路径参数：批量任务ID。
   * @param {BatchTaskRunInput} input - 运行参数。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTask 的响应对象。
   * @keyword batch-task, controller, run
   * @since 2026-02-04
   */
  @Post(':id/run')
  async run(
    @Param('id') id: string,
    @Body() input: BatchTaskRunInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.batch.run(Number(id), input, authScope.tenantId);
    return { batchTask: doc };
  }

  /**
   * @description MCP 回调入口：同步任务与发布条目状态，并写入待办清单。
   * @param {BatchTaskCallbackInput} input - 回调参数。
   * @returns {Promise<Record<string, unknown>>} 处理结果。
   * @keyword batch-task, controller, callback
   * @since 2026-02-04
   */
  @Post('callback')
  async callback(
    @Body() input: BatchTaskCallbackInput,
  ): Promise<Record<string, unknown>> {
    const res = await this.batch.handleCallback(input);
    return res;
  }

  /**
   * @description 获取单个批量任务。
   * @param {string} id - 路径参数：批量任务ID。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTask 的响应对象。
   * @keyword batch-task, controller, get
   * @since 2026-02-04
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.batch.get(Number(id), authScope.tenantId);
    return { batchTask: doc };
  }

  /**
   * @description 列出批量任务，支持按 userId 过滤。
   * @param {string} [userId] - 查询参数：用户ID。
   * @returns {Promise<Record<string, unknown>>} 包含 batchTasks 的响应对象。
   * @keyword batch-task, controller, list
   * @since 2026-02-04
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Req() req?: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = req
      ? await this.resolveAuthScope(req)
      : { tenantId: undefined };
    const rows = await this.batch.list(userId, authScope.tenantId);
    return { batchTasks: rows };
  }
}
