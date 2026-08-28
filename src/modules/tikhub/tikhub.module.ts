import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TikhubClientService } from './services/tikhub-client.service.js';
import { TikhubConfigService } from './services/tikhub-config.service.js';
import { TikhubCryptoService } from './services/tikhub-crypto.service.js';
import { TikhubXhsService } from './services/tikhub-xhs.service.js';

/**
 * @description TikHub 平台接入模块：保存平台 API Key 与域名，并提供小红书按 NoteId 的直采能力。
 *   本模块只出服务不出控制器——配置入口挂在小红书数据看板的采集设置里，保持「一个页面一组接口」。
 * @keyword-cn TikHub模块, 平台接入
 * @keyword-en tikhub-module, platform-integration
 */
@Module({
  imports: [DataSourceModule],
  providers: [
    TikhubCryptoService,
    TikhubConfigService,
    TikhubClientService,
    TikhubXhsService,
  ],
  exports: [TikhubConfigService, TikhubXhsService],
})
export class TikhubModule {}
