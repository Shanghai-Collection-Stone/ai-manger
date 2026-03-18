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
import { SkillThoughtService } from '../services/skill-thought.service.js';
import type { SkillThoughtEntity } from '../entities/skill-thought.entity.js';

/**
 * @description 思维链管理控制器
 * @keyword-en skill thought management controller
 */
@Controller('skill-thought')
export class SkillThoughtController {
  constructor(
    private readonly thoughts: SkillThoughtService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 列出思维链
   * @keyword-en list thoughts
   */
  @Get()
  async list(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
  ): Promise<Record<string, unknown>> {
    const scope = await this.resolveAuthScope(req);
    const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 100;
    if (keyword && keyword.trim()) {
      const rows = await this.thoughts.findByKeywords(
        [keyword.trim()],
        false,
        safeLimit,
        scope,
      );
      return { thoughts: rows.map((row) => this.toView(row)) };
    }
    const rows = await this.thoughts.list(scope, safeLimit);
    return { thoughts: rows.map((row) => this.toView(row)) };
  }

  /**
   * @description 获取思维链详情
   * @keyword-en get thought detail
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const scope = await this.resolveAuthScope(req);
    const row = await this.thoughts.getById(id, scope);
    return { thought: row ? this.toView(row) : null };
  }

  /**
   * @description 创建思维链
   * @keyword-en create thought
   */
  @Post()
  async create(
    @Body()
    input: {
      content: string;
      summary?: string;
      keywords?: string[];
      sessionId?: string;
      toolsUsed?: string[];
      category?: string;
    },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const scope = await this.resolveAuthScope(req);
    const content = String(input.content || '').trim();
    const summary =
      String(input.summary || '').trim() ||
      (await this.thoughts.generateSummary(content));
    const keywords =
      Array.isArray(input.keywords) && input.keywords.length > 0
        ? input.keywords
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : await this.thoughts.extractKeywords(content);
    const row = await this.thoughts.create({
      content,
      summary,
      keywords,
      sessionId: input.sessionId,
      toolsUsed: input.toolsUsed,
      category: input.category,
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    return { thought: this.toView(row) };
  }

  /**
   * @description 更新思维链
   * @keyword-en update thought
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    input: {
      content?: string;
      summary?: string;
      keywords?: string[];
      toolsUsed?: string[];
      category?: string;
    },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const scope = await this.resolveAuthScope(req);
    const row = await this.thoughts.update(id, input, scope);
    return { thought: row ? this.toView(row) : null };
  }

  /**
   * @description 删除思维链
   * @keyword-en delete thought
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const scope = await this.resolveAuthScope(req);
    const ok = await this.thoughts.delete(id, scope);
    return { ok };
  }

  /**
   * @description 解析登录范围
   * @keyword-en resolve auth scope
   */
  private async resolveAuthScope(req: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return {};
    const token = auth.slice(7).trim();
    if (!token) return {};
    const user = await this.adminService.getUserByToken(token);
    if (!user) return {};
    return {
      tenantId: user.tenantId,
      userId: user.username,
    };
  }

  /**
   * @description 输出结构转换
   * @keyword-en transform thought view
   */
  private toView(row: SkillThoughtEntity): Record<string, unknown> {
    return {
      id: String(row._id),
      content: row.content,
      summary: row.summary,
      keywords: row.keywords,
      sessionId: row.sessionId,
      toolsUsed: row.toolsUsed,
      category: row.category,
      usageCount: row.usageCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
