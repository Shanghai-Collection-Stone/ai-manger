import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequireDouyinPublishWebhookAccess } from '../guards/douyin-publish-webhook.guard.js';
import { DouyinPublishWebhookService } from '../services/douyin-publish-webhook.service.js';

/** 接收抖音平台地址验证及拍抖音任务通知。
 * @keyword-cn 发布回调, 平台通知
 * @keyword-en publish-webhook, platform-notification
 */
@Controller('api/douyin-publish/webhook')
export class DouyinPublishWebhookController {
  /** 注入已签名通知的业务处理服务。
   * @keyword-cn 发布回调, 平台通知
   * @keyword-en publish-webhook, platform-notification
   */
  constructor(private readonly webhook: DouyinPublishWebhookService) {}

  /** 返回平台要求的文本 JSON challenge；业务事件落库成功后才确认接收。
   * @keyword-cn 发布回调, 平台通知
   * @keyword-en publish-webhook, platform-notification
   */
  @Post()
  @RequireDouyinPublishWebhookAccess('update', 'DouyinWorkbench')
  async receive(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.webhook.receive(
      body,
      String(req.headers['msg-id'] ?? '').slice(0, 256),
    );
    res.status(200).type('text/plain').send(JSON.stringify(result));
  }
}
