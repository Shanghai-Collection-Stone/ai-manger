import {
  Body,
  Controller,
  Get,
  Post,
  Put,
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
import { SmsConfigService } from '../services/sms-config.service.js';
import { SmsVerificationService } from '../services/sms-verification.service.js';
import {
  SaveSmsSettingDto,
  SendSmsCodeDto,
  TestSmsSettingDto,
} from './sms-verification.dto.js';

/**
 * @description 短信验证码接口：公开发码，以及超管维护阿里云配置与测试发送。
 * @keyword-cn 短信验证码接口, 短信配置接口
 * @keyword-en sms-verification-controller, sms-setting-endpoint
 */
@Controller('api/sms-verification')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SmsVerificationController {
  constructor(
    private readonly verification: SmsVerificationService,
    private readonly config: SmsConfigService,
  ) {}

  /**
   * @description 发送验证码（公开免鉴权入口：注册等未登录场景使用，靠手机号/IP 频控防刷）
   * @keyword-cn 发送验证码接口, 公开入口
   * @keyword-en send-sms-code-endpoint, public-endpoint
   */
  @Post('send')
  async send(@Req() req: Request, @Body() dto: SendSmsCodeDto) {
    return this.verification.send({
      phone: dto.phone,
      scene: dto.scene,
      ip: this.readClientIp(req),
    });
  }

  /**
   * @description 读取平台短信配置（Secret 仅掩码）
   * @keyword-cn 读取短信配置接口
   * @keyword-en get-sms-setting-endpoint
   */
  @Get('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'SmsSetting')
  async getSettings() {
    return { setting: await this.config.getView() };
  }

  /**
   * @description 保存平台短信配置
   * @keyword-cn 保存短信配置接口
   * @keyword-en save-sms-setting-endpoint
   */
  @Put('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'SmsSetting')
  async saveSettings(@Req() req: AdminRequest, @Body() dto: SaveSmsSettingDto) {
    const user = this.requireUser(req);
    return { setting: await this.config.save(dto, user._id.toHexString()) };
  }

  /**
   * @description 用当前配置向指定手机号真实发送一条测试验证码
   * @keyword-cn 测试发送接口, 配置自检
   * @keyword-en test-sms-setting-endpoint, config-probe
   */
  @Post('settings/test')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'SmsSetting')
  async testSettings(@Body() dto: TestSmsSettingDto) {
    return this.verification.testSend(dto.phone);
  }

  /**
   * @description 读取客户端 IP：X-Forwarded-For 首段优先，回落 req.ip
   * @keyword-cn 读取客户端IP, 代理转发
   * @keyword-en read-client-ip, forwarded-for
   * @param req 请求。
   * @returns {string} 客户端 IP。
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
   * @param req 鉴权请求。
   * @returns {AdminUserEntity} 当前用户。
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
