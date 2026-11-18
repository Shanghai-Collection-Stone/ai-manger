import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { TenantCreditService } from '../services/tenant-credit.service.js';
import {
  AdjustPersonalCreditDto,
  AllocateMemberCreditDto,
  CreditLedgerQueryDto,
  RechargePersonalCreditDto,
  SwitchTenantCreditModeDto,
  TenantCreditOverviewQueryDto,
  UpdateTenantCreditSettingsDto,
} from './tenant-credit.dto.js';

/**
 * @description 租户 Credit 分配接口：当前成员额度、成员额度总览与分配、新成员赠送设置、旧余额迁移和个人额度充值；全部挂 AdminAuthGuard + AdminPoliciesGuard。
 * @keyword-cn 租户额度接口, 入口鉴权
 * @keyword-en tenant-credit-controller, endpoint-authorization
 */
@Controller('admin')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class TenantCreditController {
  /**
   * @description 注入租户额度服务。
   * @keyword-cn 额度接口初始化, 服务注入
   * @keyword-en tenant-credit-controller-init, service-injection
   */
  constructor(private readonly credits: TenantCreditService) {}

  /**
   * @description 当前登录成员的合计可用额度、拆分与倒序流水（桌面端账户中心，路径沿用旧接口）。
   * @keyword-cn 当前Credit账户, 自身流水
   * @keyword-en current-credit-account, own-transaction-list
   */
  @Get('auth/credit-account')
  @RequirePermission('read', 'User')
  async getCurrentCreditAccount(
    @Req() req: AdminRequest,
    @Query() query: CreditLedgerQueryDto,
  ) {
    return this.credits.getCurrentAccount(this.requireUser(req), {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });
  }

  /**
   * @description 租户额度总览与成员额度列表，租户管理员只看本租户，超管需指定租户。
   * @keyword-cn 成员额度总览接口, 待分配额度
   * @keyword-en member-credit-overview-endpoint, pool-credit
   */
  @Get('tenant-credits')
  @RequirePermission('read', 'User')
  async getOverview(
    @Req() req: AdminRequest,
    @Query() query: TenantCreditOverviewQueryDto,
  ) {
    return this.credits.getOverview(this.requireUser(req), query.tenantId);
  }

  /**
   * @description 设置新成员加入时赠送的 Credit。
   * @keyword-cn 新成员赠送设置接口, 租户额度设置
   * @keyword-en update-credit-settings-endpoint, new-member-grant
   */
  @Patch('tenant-credits/:tenantId/settings')
  @RequirePermission('update', 'User')
  async updateSettings(
    @Req() req: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantCreditSettingsDto,
  ) {
    return {
      tenant: await this.credits.updateSettings(
        this.requireUser(req),
        tenantId,
        dto,
      ),
    };
  }

  /**
   * @description 超管把旧共用租户切到分配模式，可选把原余额给每个成员各一份全额。
   * @keyword-cn 切换分配模式接口, 旧余额迁移
   * @keyword-en switch-credit-mode-endpoint, legacy-credit-migration
   */
  @Post('tenant-credits/:tenantId/mode')
  @RequirePermission('update', 'User')
  async switchMode(
    @Req() req: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: SwitchTenantCreditModeDto,
  ) {
    return this.credits.switchMode(this.requireUser(req), tenantId, dto);
  }

  /**
   * @description 给成员分配或回收本租户额度。
   * @keyword-cn 分配成员额度接口, 回收额度
   * @keyword-en allocate-member-credit-endpoint, reclaim-credit
   */
  @Post('tenant-credits/:tenantId/members/:memberId/allocate')
  @RequirePermission('update', 'User')
  async allocate(
    @Req() req: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Param('memberId') memberId: string,
    @Body() dto: AllocateMemberCreditDto,
  ) {
    return this.credits.allocate(
      this.requireUser(req),
      tenantId,
      memberId,
      dto,
    );
  }

  /**
   * @description 成员本租户额度的倒序流水。
   * @keyword-cn 成员额度流水接口, 租户边界
   * @keyword-en member-credit-ledger-endpoint, tenant-boundary
   */
  @Get('tenant-credits/:tenantId/members/:memberId/transactions')
  @RequirePermission('read', 'User')
  async listMemberTransactions(
    @Req() req: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Param('memberId') memberId: string,
    @Query() query: CreditLedgerQueryDto,
  ) {
    return this.credits.listMemberTransactions(
      this.requireUser(req),
      tenantId,
      memberId,
      {
        limit: query.limit,
        before: query.before ? new Date(query.before) : undefined,
      },
    );
  }

  /**
   * @description 超管查询手机号账号的个人额度与流水。
   * @keyword-cn 个人额度查询接口, 个人流水
   * @keyword-en personal-credit-query-endpoint, personal-ledger
   */
  @Get('credit-accounts/:accountId')
  @RequirePermission('read', 'User')
  async getPersonalAccount(
    @Req() req: AdminRequest,
    @Param('accountId') accountId: string,
    @Query() query: CreditLedgerQueryDto,
  ) {
    return this.credits.getPersonalAccount(this.requireUser(req), accountId, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });
  }

  /**
   * @description 超管给个人额度正数充值。
   * @keyword-cn 个人充值接口, 跨租户通用
   * @keyword-en personal-recharge-endpoint, cross-tenant-credit
   */
  @Post('credit-accounts/:accountId/recharge')
  @RequirePermission('update', 'User')
  async rechargePersonal(
    @Req() req: AdminRequest,
    @Param('accountId') accountId: string,
    @Body() dto: RechargePersonalCreditDto,
  ) {
    return this.credits.changePersonalCredit(
      this.requireUser(req),
      accountId,
      'recharge',
      dto,
    );
  }

  /**
   * @description 超管给个人额度正负人工调账。
   * @keyword-cn 个人调账接口, 余额增减
   * @keyword-en personal-adjustment-endpoint, balance-change
   */
  @Post('credit-accounts/:accountId/adjust')
  @RequirePermission('update', 'User')
  async adjustPersonal(
    @Req() req: AdminRequest,
    @Param('accountId') accountId: string,
    @Body() dto: AdjustPersonalCreditDto,
  ) {
    return this.credits.changePersonalCredit(
      this.requireUser(req),
      accountId,
      'manual_adjustment',
      dto,
    );
  }

  /**
   * @description 从请求读取已鉴权的后台用户。
   * @keyword-cn 读取后台用户, 鉴权上下文
   * @keyword-en read-admin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }
}
