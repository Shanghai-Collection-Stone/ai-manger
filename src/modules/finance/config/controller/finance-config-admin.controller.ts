import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../../admin/types/admin-request.types.js';
import { BitableReaderService } from '../../source/services/bitable-reader.service.js';
import { FinanceBindingService } from '../services/finance-binding.service.js';
import { FinanceTransformService } from '../services/finance-transform.service.js';
import {
  UpsertFinanceBindingDto,
  UpsertFinanceTransformDto,
} from './finance-config.dto.js';

const PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description 财务配置后台控制器(挂载 `/admin/finance`)
 * @keyword-en finance config admin controller, named bindings transforms
 */
@Controller('admin/finance')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class FinanceConfigAdminController {
  constructor(
    private readonly bindingService: FinanceBindingService,
    private readonly transformService: FinanceTransformService,
    private readonly bitableReader: BitableReaderService,
  ) {}

  /**
   * @description 列出所有 binding(按 name 排序)
   * @keyword-en list finance bindings
   */
  @UseGuards(AdminAuthGuard)
  @Get('bindings')
  async listBindings(@Req() req: Request) {
    const bindings = await this.bindingService.list(this.requireUser(req));
    return { bindings };
  }

  /**
   * @description Upsert binding(支持 previousName 改名)
   * @keyword-en upsert finance binding endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('bindings')
  async upsertBinding(
    @Req() req: Request,
    @Body() body: UpsertFinanceBindingDto,
  ) {
    const binding = await this.bindingService.upsert(this.requireUser(req), {
      name: body.name,
      previousName: body.previousName,
      flowDefault: body.flowDefault,
      partyTypeDefault: body.partyTypeDefault,
      sources: body.sources as never,
      remark: body.remark,
    });
    return { binding };
  }

  /**
   * @description 删除 binding
   * @keyword-en delete finance binding endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('bindings/:name')
  async deleteBinding(@Req() req: Request, @Param('name') name: string) {
    if (!name?.trim())
      throw new BadRequestException('FINANCE_BINDING_NAME_REQUIRED');
    const ok = await this.bindingService.delete(
      this.requireUser(req),
      decodeURIComponent(name),
    );
    return { ok };
  }

  /**
   * @description 列出所有 transform
   * @keyword-en list finance transforms
   */
  @UseGuards(AdminAuthGuard)
  @Get('transforms')
  async listTransforms(@Req() req: Request) {
    const transforms = await this.transformService.list(this.requireUser(req));
    return { transforms };
  }

  /**
   * @description Upsert transform DSL(支持 previousName 改名)
   * @keyword-en upsert finance transform endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('transforms')
  async upsertTransform(
    @Req() req: Request,
    @Body() body: UpsertFinanceTransformDto,
  ) {
    const transform = await this.transformService.upsert(
      this.requireUser(req),
      {
        name: body.name,
        previousName: body.previousName,
        dsl: body.dsl,
        explanation: body.explanation,
      },
    );
    return { transform };
  }

  /**
   * @description 删除 transform
   * @keyword-en delete finance transform endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('transforms/:name')
  async deleteTransform(@Req() req: Request, @Param('name') name: string) {
    if (!name?.trim())
      throw new BadRequestException('FINANCE_TRANSFORM_NAME_REQUIRED');
    const ok = await this.transformService.delete(
      this.requireUser(req),
      decodeURIComponent(name),
    );
    return { ok };
  }

  /**
   * @description 列出 appToken 下所有数据表(让前端弹窗批量勾选添加)
   * @keyword-en list bitable tables under app token
   */
  @UseGuards(AdminAuthGuard)
  @Get('bitable-tables')
  async listBitableTables(
    @Req() req: Request,
    @Query('appToken') appToken: string,
  ) {
    const token = String(appToken ?? '').trim();
    if (!token) throw new BadRequestException('APP_TOKEN_REQUIRED');
    const user = this.requireUser(req);
    const scopeId = user.tenantId?.trim() || PLATFORM_SCOPE_ID;
    const tables = await this.bitableReader.listTables(scopeId, token);
    return { tables };
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
