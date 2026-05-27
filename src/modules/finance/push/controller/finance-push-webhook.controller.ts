import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FinancePushWebhookService } from '../services/finance-push-webhook.service.js';

/**
 * @description Public receiver for finance required-push webhooks.
 * @keyword-en finance-push-webhook-controller, webhook-receiver
 * @keyword-cn 财务推送webhook控制器, webhook接收点
 */
@Controller('finance/push/webhooks')
export class FinancePushWebhookController {
  constructor(private readonly webhookService: FinancePushWebhookService) {}

  /**
   * @description Report webhook receiver health for browser checks and provider endpoint validation.
   * @keyword-en finance-push-webhook-health, webhook-health
   */
  @Get('required-push')
  health(@Req() req: Request) {
    return this.webhookService.probe(req);
  }

  /**
   * @description Receive webhooks.requiredPush and accept it for background execution.
   * @keyword-en receive-required-push-webhook, webhook-trigger
   * @keyword-cn 接收必要推送webhook, webhook触发
   */
  @Post('required-push')
  @HttpCode(200)
  async receiveRequiredPush(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.webhookService.accept(req, body);
  }
}
