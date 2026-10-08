import { Module } from '@nestjs/common';
import { GenerationQueueService } from './services/generation-queue.service.js';

/**
 * @description 装配 AI 生成排队服务，供小红书文章与抖音生成等业务按各自通道限制并发。
 * @keyword-cn AI生成排队模块, 并发控制
 * @keyword-en generation-queue-module, concurrency-control
 */
@Module({
  providers: [GenerationQueueService],
  exports: [GenerationQueueService],
})
export class GenerationQueueModule {}
