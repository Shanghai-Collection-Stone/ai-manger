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
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { RequireSmsCode } from '../../sms-verification/decorators/require-sms-code.decorator.js';
import type { SmsVerifiedRequest } from '../../sms-verification/entities/sms-verification.entity.js';
import { RequireEmailCode } from '../../email-verification/decorators/require-email-code.decorator.js';
import type { EmailVerifiedRequest } from '../../email-verification/entities/email-verification.entity.js';
import { TenantJoinApplicationService } from '../services/tenant-join-application.service.js';
import { TenantInviteService } from '../services/tenant-invite.service.js';
import {
  AcceptInviteDto,
  ApplicationListQueryDto,
  CompanySearchQueryDto,
  CreateInviteDto,
  InviteListQueryDto,
  RegisterPrecheckDto,
  RejectApplicationDto,
  TenantJoinRegisterDto,
} from './tenant-join.dto.js';

/**
 * @description 租户入驻接口，提供公开注册邀请与受权限保护的申请审批、邀请管理
 * @keyword-cn 租户入驻接口, 入口鉴权
 * @keyword-en tenant-join-controller, endpoint-authorization
 */
@Controller('api/tenant-join')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class TenantJoinController {
  constructor(
    private readonly applications: TenantJoinApplicationService,
    private readonly invites: TenantInviteService,
  ) {}

  /**
   * @description 公开免鉴权预览邀请码及实时有效状态，依靠 128 位随机高熵邀请码防枚举
   * @keyword-cn 邀请预览接口, 公开免鉴权
   * @keyword-en invite-preview-endpoint, public-no-auth
   */
  @Get('invites/:code')
  async previewInvite(@Param('code') code: string) {
    return { invite: await this.invites.preview(code) };
  }

  /**
   * @description 公开免鉴权的注册第 1 步预检：校验验证码（不作废）并检查手机号 / 邮箱是否已注册，让已注册在选公司之前就提示；不带本人有效验证码查不到注册状态，验证码尝试次数与发送频控防刷
   * @keyword-cn 注册预检接口, 公开免鉴权
   * @keyword-en register-precheck-endpoint, public-no-auth
   */
  @Post('register/precheck')
  async precheckRegister(@Body() dto: RegisterPrecheckDto) {
    return this.applications.precheckRegistration(dto);
  }

  /**
   * @description 公开免鉴权的注册页公司名称模糊搜索：至少 2 个字才搜，只返回租户 ID 与名称、最多 10 条，按 IP 每分钟 30 次限流防遍历
   * @keyword-cn 公司搜索接口, 公开免鉴权
   * @keyword-en company-search-endpoint, public-no-auth
   */
  @Get('companies')
  async searchCompanies(
    @Req() req: Request,
    @Query() query: CompanySearchQueryDto,
  ) {
    return {
      companies: await this.applications.searchCompanies(
        this.readClientIp(req),
        query.keyword,
      ),
    };
  }

  /**
   * @description 公开免鉴权注册入口：手机号或邮箱只填一个并用验证码验证（两个都验证也可以），只保存验证过的联系方式，按随便逛逛 / 邀请码 / 公司名称执行注册
   * @keyword-cn 租户注册接口, 短信验证码, 邮箱验证码, 二选一验证
   * @keyword-en tenant-register-endpoint, sms-verification, email-verification, either-verification
   */
  @Post('register')
  @RequireSmsCode('register', { optional: true })
  @RequireEmailCode('register', { optional: true })
  async register(
    @Req() req: SmsVerifiedRequest & EmailVerifiedRequest,
    @Body() dto: TenantJoinRegisterDto,
  ) {
    const verifiedPhone = req.smsVerification?.phone;
    const verifiedEmail = req.emailVerification?.email;
    if (!verifiedPhone && !verifiedEmail) {
      throw new BadRequestException('VERIFICATION_CODE_REQUIRED');
    }
    // 未验证的手机号 / 邮箱一律不保存，避免拿别人的号码或邮箱抢注
    const { smsPhone, email, ...rest } = dto;
    void smsPhone;
    void email;
    return this.applications.register({
      ...rest,
      phone: verifiedPhone,
      email: verifiedEmail,
    });
  }

  /**
   * @description 公开免鉴权接受邀请入口，按 IP 与账号进行进程内限流以防暴力尝试
   * @keyword-cn 接受邀请接口, 防暴力尝试
   * @keyword-en accept-invite-endpoint, brute-force-throttle
   */
  @Post('invites/:code/accept')
  async acceptInvite(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() dto: AcceptInviteDto,
  ) {
    return this.invites.accept({
      code,
      account: dto.account,
      password: dto.password,
      ip: this.readClientIp(req),
    });
  }

  /**
   * @description 分页读取当前可见租户范围内的入驻申请
   * @keyword-cn 申请列表接口, 租户范围
   * @keyword-en application-list-endpoint, tenant-scope
   */
  @Get('applications')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'TenantJoin')
  async listApplications(
    @Req() req: AdminRequest,
    @Query() query: ApplicationListQueryDto,
  ) {
    return this.applications.list(this.requireUser(req), query);
  }

  /**
   * @description 审批通过一条本租户入驻申请
   * @keyword-cn 通过申请接口, 更新入驻权限
   * @keyword-en approve-application-endpoint, update-tenant-join
   */
  @Post('applications/:id/approve')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'TenantJoin')
  async approveApplication(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return {
      application: await this.applications.approve(this.requireUser(req), id),
    };
  }

  /**
   * @description 拒绝一条本租户入驻申请并可记录原因
   * @keyword-cn 拒绝申请接口, 更新入驻权限
   * @keyword-en reject-application-endpoint, update-tenant-join
   */
  @Post('applications/:id/reject')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'TenantJoin')
  async rejectApplication(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return {
      application: await this.applications.reject(
        this.requireUser(req),
        id,
        dto.reason,
      ),
    };
  }

  /**
   * @description 列出当前租户或超管指定租户的邀请
   * @keyword-cn 邀请列表接口, 读取入驻权限
   * @keyword-en invite-list-endpoint, read-tenant-join
   */
  @Get('invites')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'TenantJoin')
  async listInvites(
    @Req() req: AdminRequest,
    @Query() query: InviteListQueryDto,
  ) {
    return {
      items: await this.invites.list(this.requireUser(req), query.tenantId),
    };
  }

  /**
   * @description 为当前租户或超管指定租户创建邀请
   * @keyword-cn 创建邀请接口, 创建入驻权限
   * @keyword-en create-invite-endpoint, create-tenant-join
   */
  @Post('invites')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('create', 'TenantJoin')
  async createInvite(
    @Req() req: AdminRequest,
    @Body() dto: CreateInviteDto,
  ) {
    return {
      invite: await this.invites.create(this.requireUser(req), dto),
    };
  }

  /**
   * @description 撤销一条当前租户范围内的邀请
   * @keyword-cn 撤销邀请接口, 删除入驻权限
   * @keyword-en revoke-invite-endpoint, delete-tenant-join
   */
  @Delete('invites/:id')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('delete', 'TenantJoin')
  async revokeInvite(@Req() req: AdminRequest, @Param('id') id: string) {
    await this.invites.revoke(this.requireUser(req), id);
    return { ok: true };
  }

  /**
   * @description 读取客户端 IP，优先使用 X-Forwarded-For 首段
   * @keyword-cn 读取客户端IP, 代理转发
   * @keyword-en read-client-ip, forwarded-for
   */
  private readClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(',')[0]
      ?.trim();
    return first || req.ip || req.socket?.remoteAddress || '';
  }

  /**
   * @description 从鉴权请求读取当前后台用户
   * @keyword-cn 读取后台用户, 鉴权上下文
   * @keyword-en read-admin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
