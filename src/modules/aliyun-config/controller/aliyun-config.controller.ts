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
import { AliyunConfigService } from '../services/aliyun-config.service.js';
import { SaveAliyunSettingDto } from './aliyun-config.dto.js';

/**
 * @description 阿里云配置接口（仅超管）：读写 OSS 设置与 OSS 专用 AccessKey，并测试 OSS 是否可写。
 * @keyword-cn 阿里云配置接口, 超管配置
 * @keyword-en aliyun-config-controller, super-admin-setting
 */
@Controller('api/aliyun-config')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class AliyunConfigController {
  constructor(private readonly config: AliyunConfigService) {}

  /**
   * @description 读取阿里云配置（Secret 仅掩码）。
   * @keyword-cn 读取阿里云配置接口
   * @keyword-en get-aliyun-setting-endpoint
   */
  @Get('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'AliyunSetting')
  async getSettings() {
    return { setting: await this.config.getView() };
  }

  /**
   * @description 保存 OSS 设置与 OSS 专用 AccessKey。
   * @keyword-cn 保存阿里云配置接口
   * @keyword-en save-aliyun-setting-endpoint
   */
  @Put('settings')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'AliyunSetting')
  async saveSettings(
    @Req() req: AdminRequest,
    @Body() dto: SaveAliyunSettingDto,
  ) {
    const user = this.requireUser(req);
    return { setting: await this.config.save(dto, user._id.toHexString()) };
  }

  /**
   * @description 用当前生效的 OSS 配置写入并删除一个小对象，检查密钥、bucket 与地域是否可用。
   * @keyword-cn 测试OSS接口, 写入测试
   * @keyword-en test-oss-endpoint, write-test
   */
  @Post('oss/test')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'AliyunSetting')
  async testOss() {
    return this.config.probeOss();
  }

  /**
   * @description 从鉴权请求读取当前后台用户。
   * @keyword-cn 读取后台用户, 鉴权上下文
   * @keyword-en read-admin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
