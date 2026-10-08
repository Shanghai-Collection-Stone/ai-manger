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
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { MailConfigService } from '../services/mail-config.service.js';
import { MailService } from '../services/mail.service.js';
import { SaveMailSettingDto, TestMailSettingDto } from './mail.dto.js';

/**
 * @description 平台发信邮箱配置与 SMTP 测试发送接口
 * @keyword-cn 邮箱配置接口, SMTP测试接口
 * @keyword-en mail-setting-controller, smtp-test-endpoint
 */
@Controller('api/mail')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class MailController {
  constructor(
    private readonly config: MailConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * @description 读取平台发信邮箱配置，密码仅返回掩码
   * @keyword-cn 读取邮箱配置接口
   * @keyword-en get-mail-setting-endpoint
   */
  @Get('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'MailSetting')
  async getSettings() {
    return { setting: await this.config.getView() };
  }

  /**
   * @description 保存平台发信邮箱配置
   * @keyword-cn 保存邮箱配置接口
   * @keyword-en save-mail-setting-endpoint
   */
  @Put('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'MailSetting')
  async saveSettings(@Req() req: AdminRequest, @Body() dto: SaveMailSettingDto) {
    const user = this.requireUser(req);
    return { setting: await this.config.save(dto, user._id.toHexString()) };
  }

  /**
   * @description 忽略启用开关并向指定地址真实发送 SMTP 测试邮件
   * @keyword-cn 测试发信接口, 配置自检
   * @keyword-en test-mail-setting-endpoint, config-probe
   */
  @Post('settings/test')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'MailSetting')
  async testSettings(@Body() dto: TestMailSettingDto) {
    return this.mail.testSend(dto.to);
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
