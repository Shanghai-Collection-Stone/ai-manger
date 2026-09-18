import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { PixmaxClientService } from './services/pixmax-client.service.js';

/**
 * @description PixMax OpenAPI 客户端模块，连接信息由调用方从后台提供商配置传入。
 * @keyword-cn PixMax模块, 第三方生成平台
 * @keyword-en pixmax-module, third-party-generation
 */
@Module({
  imports: [DataSourceModule],
  providers: [PixmaxClientService],
  exports: [PixmaxClientService],
})
export class PixmaxModule {}
