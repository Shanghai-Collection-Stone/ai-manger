import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AliyunConfigController } from './controller/aliyun-config.controller.js';
import { AliyunConfigCryptoService } from './services/aliyun-config-crypto.service.js';
import { AliyunConfigService } from './services/aliyun-config.service.js';

/**
 * @description 阿里云配置模块：OSS 设置与 OSS 专用 AccessKey，导出给对象存储（视频库）使用。
 * @keyword-cn 阿里云配置模块, OSS访问密钥
 * @keyword-en aliyun-config-module, oss-access-key
 */
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [AliyunConfigController],
  providers: [AliyunConfigCryptoService, AliyunConfigService],
  exports: [AliyunConfigService],
})
export class AliyunConfigModule {}
