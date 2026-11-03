import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { ModelConcurrencyAdminController } from './controller/model-concurrency-admin.controller.js';
import { ModelConcurrencyService } from './services/model-concurrency.service.js';

/**
 * @description 装配按「提供商 + 模型」的全平台并发上限与持久化排队，导出 `ModelConcurrencyService` 供视频等业务提交前申请名额。
 * @keyword-cn 模型并发模块, 超出排队
 * @keyword-en model-concurrency-module, queue-when-full
 */
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [ModelConcurrencyAdminController],
  providers: [ModelConcurrencyService],
  exports: [ModelConcurrencyService],
})
export class ModelConcurrencyModule {}
