import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../admin/services/admin.service.js';
import { SkillThoughtToolsService } from '../skill-thought/tools/skill-thought.tools.js';

@Controller('skill-thought-test')
export class SkillThoughtTestController {
  constructor(
    private readonly thoughtTools: SkillThoughtToolsService,
    private readonly adminService: AdminService,
  ) {}

  @Post('search-thought')
  async searchThought(
    @Body()
    input: {
      query: string;
      limit?: number;
      minScore?: number;
      tenantId?: string;
      userId?: string;
    },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const query = String(input.query ?? '').trim();
    if (!query) {
      return { success: false, error: 'Query is required' };
    }
    const scope = await this.resolveAuthScope(req, input);
    const limit = Number.isFinite(Number(input.limit))
      ? Number(input.limit)
      : 5;
    const minScore = Number.isFinite(Number(input.minScore))
      ? Number(input.minScore)
      : 0.5;

    return this.invokeTool('search_thought', { query, limit, minScore }, scope);
  }

  @Post('generate-thought')
  async generateThought(
    @Body()
    input: {
      content: string;
      sessionId?: string;
      toolsUsed?: string[];
      category?: string;
      allowGenerate?: boolean;
      tenantId?: string;
      userId?: string;
    },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const content = String(input.content ?? '').trim();
    if (!content) {
      return { success: false, error: 'Content is required' };
    }
    const scope = await this.resolveAuthScope(req, input);
    return this.invokeTool(
      'generate_thought',
      {
        content,
        sessionId: input.sessionId,
        toolsUsed: input.toolsUsed,
        category: input.category,
        allowGenerate: input.allowGenerate,
      },
      scope,
    );
  }

  @Post('get-thought-detail')
  async getThoughtDetail(
    @Body()
    input: { thoughtId: string; tenantId?: string; userId?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const thoughtId = String(input.thoughtId ?? '').trim();
    if (!thoughtId) {
      return { success: false, error: 'Thought ID is required' };
    }
    const scope = await this.resolveAuthScope(req, input);
    return this.invokeTool('get_thought_detail', { thoughtId }, scope);
  }

  private normalizeScope(input?: { tenantId?: string; userId?: string }): {
    tenantId?: string;
    userId?: string;
  } {
    const tenantId = input?.tenantId?.trim();
    const userId = input?.userId?.trim();
    return {
      ...(tenantId ? { tenantId } : {}),
      ...(userId ? { userId } : {}),
    };
  }

  private async resolveAuthScope(
    req: Request,
    fallback?: { tenantId?: string; userId?: string },
  ): Promise<{ tenantId?: string; userId?: string }> {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token) {
        const user = await this.adminService.getUserByToken(token);
        if (user) {
          return {
            tenantId: user.tenantId,
            userId: user.username,
          };
        }
      }
    }
    return this.normalizeScope(fallback);
  }

  private async invokeTool(
    toolName: string,
    input: Record<string, unknown>,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<Record<string, unknown>> {
    const tools = this.thoughtTools.getHandle(scope) ?? [];
    const tool = tools.find((t) => (t as { name?: string }).name === toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    const anyTool = tool as {
      invoke?: (i: unknown) => Promise<unknown>;
      call?: (i: unknown) => Promise<unknown>;
      _call?: (i: unknown) => Promise<unknown>;
    };

    let raw: unknown;
    if (typeof anyTool.invoke === 'function') {
      raw = await anyTool.invoke(input);
    } else if (typeof anyTool.call === 'function') {
      raw = await anyTool.call(input);
    } else if (typeof anyTool._call === 'function') {
      raw = await anyTool._call(input);
    } else {
      return { success: false, error: `Tool not invokable: ${toolName}` };
    }

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return parsed;
      } catch {
        return { success: true, raw };
      }
    }

    if (raw && typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }

    return { success: true, raw };
  }
}
