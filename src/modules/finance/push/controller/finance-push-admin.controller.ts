import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminAuthGuard } from '../../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../../admin/types/admin-request.types.js';
import { FinanceExternalService } from '../services/finance-external.service.js';
import { FinancePushConfigService } from '../services/finance-push-config.service.js';
import { FinancePushRunnerService } from '../services/finance-push-runner.service.js';
import {
  RunFinancePushDto,
  UpsertFinancePushConfigDto,
} from './finance-push.dto.js';

/**
 * @description 财务推送后台控制器(挂载 `/admin/finance/push`)
 * @keyword-en finance push admin controller, scoped config, run by name, external proxy
 */
@Controller('admin/finance/push')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class FinancePushAdminController {
  constructor(
    private readonly configService: FinancePushConfigService,
    private readonly runnerService: FinancePushRunnerService,
    private readonly externalService: FinanceExternalService,
  ) {}

  /**
   * @description 取当前作用域的推送配置(每作用域一份)
   * @keyword-en get finance push config
   */
  @UseGuards(AdminAuthGuard)
  @Get('config')
  async getConfig(@Req() req: Request) {
    const user = this.requireUser(req);
    const scopeId = this.configService.resolveScopeId(user);
    const config = await this.configService.get(scopeId);
    return { config };
  }

  /**
   * @description Upsert 推送配置
   * @keyword-en upsert finance push config endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('config')
  async upsertConfig(
    @Req() req: Request,
    @Body() body: UpsertFinancePushConfigDto,
  ) {
    const config = await this.configService.upsert(this.requireUser(req), body);
    return { config };
  }

  /**
   * @description 删除推送配置
   * @keyword-en delete finance push config endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('config')
  async deleteConfig(@Req() req: Request) {
    const ok = await this.configService.delete(this.requireUser(req));
    return { ok };
  }

  /**
   * @description 测试推送 key 有效性(GET /api/v1/me)
   * @keyword-en test finance push connectivity endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('test')
  async test(@Req() req: Request) {
    const result = await this.runnerService.test(this.requireUser(req));
    return { result };
  }

  /**
   * @description 立即执行一次推送(按 binding name);SSE 流式:每一步 log 实时下发,结束时发 result/error/end
   * @keyword-en run finance push by name as SSE stream
   */
  @UseGuards(AdminAuthGuard)
  @Post('run/:name')
  async run(
    @Req() req: Request,
    @Res() res: Response,
    @Param('name') name: string,
    @Body() body: RunFinancePushDto,
  ): Promise<void> {
    if (!name?.trim()) {
      throw new BadRequestException('FINANCE_BINDING_NAME_REQUIRED');
    }
    const user = this.requireUser(req);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx 反代关闭缓冲,确保每条 log 实时刷出
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 客户端断开:让 runner 后续的 onLog 静默丢弃(主流程仍跑完,持久化 lastPush 状态)
    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      const result = await this.runnerService.run(
        user,
        decodeURIComponent(name),
        {
          startDate: body?.startDate,
          endDate: body?.endDate,
          onLog: (entry) => {
            if (aborted) return;
            write('log', entry);
          },
        },
      );
      write('result', result);
      write('end', { ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? 'UNKNOWN_ERROR');
      write('error', { message });
      write('end', { ok: false });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * @description 透传外部财务系统的门店列表(供前端选 storeId)
   * @keyword-en list external stores for binding picker
   */
  @UseGuards(AdminAuthGuard)
  @Get('external/stores')
  async listExternalStores(@Req() req: Request) {
    const stores = await this.externalService.listStores(this.requireUser(req));
    return { stores };
  }

  /**
   * @description 透传外部财务系统的公司列表(供前端选 companyId)
   * @keyword-en list external companies for binding picker
   */
  @UseGuards(AdminAuthGuard)
  @Get('external/companies')
  async listExternalCompanies(@Req() req: Request) {
    const companies = await this.externalService.listCompanies(
      this.requireUser(req),
    );
    return { companies };
  }

  /**
   * @description 取登录用户
   * @keyword-en require admin user
   */
  private requireUser(req: Request) {
    const user = (req as AdminRequest).adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
