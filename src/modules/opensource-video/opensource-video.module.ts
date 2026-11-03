import { Module } from '@nestjs/common';
import { OpensourceVideoClientService } from './services/opensource-video-client.service.js';

/**
 * @description 自建 MiniMax-H3 视频服务客户端模块，连接信息由调用方从后台提供商配置传入。
 * @keyword-cn 自建视频模块, 自建生成服务
 * @keyword-en opensource-video-module, self-hosted-generation
 */
@Module({
  providers: [OpensourceVideoClientService],
  exports: [OpensourceVideoClientService],
})
export class OpensourceVideoModule {}
