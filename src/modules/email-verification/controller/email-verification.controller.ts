import {
  Body,
  Controller,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmailVerificationService } from '../services/email-verification.service.js';
import { SendEmailCodeDto } from './email-verification.dto.js';

/**
 * @description 邮箱验证码接口：公开发码（注册等未登录场景使用，靠邮箱 / IP 频控防刷）
 * @keyword-cn 邮箱验证码接口, 公开入口
 * @keyword-en email-verification-controller, public-endpoint
 */
@Controller('api/email-verification')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  /**
   * @description 发送邮箱验证码（公开免鉴权入口：注册前用户尚未登录，靠同邮箱 60 秒间隔、单邮箱日限额与单 IP 小时限额防刷）
   * @keyword-cn 发送邮箱验证码接口, 公开入口
   * @keyword-en send-email-code-endpoint, public-endpoint
   */
  @Post('send')
  async send(@Req() req: Request, @Body() dto: SendEmailCodeDto) {
    return this.verification.send({
      email: dto.email,
      scene: dto.scene,
      ip: this.readClientIp(req),
    });
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
}
