import { Module, forwardRef } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { MediaAgentService } from './services/media-agent.service.js';
import { GalleryToolsService } from './services/gallery-tools.service.js';
import { XhsToolsService } from './services/xhs-tools.service.js';

/**
 * @title Media Agent 模块
 * @description 提供图库和小红书相关的 LangChain Agent 能力
 * @keywords-cn media-agent, gallery, xhs, langchain
 * @keywords-en media-agent, gallery, xhs, langchain
 */
@Module({
  imports: [forwardRef(() => AiAgentModule), GalleryModule],
  providers: [MediaAgentService, GalleryToolsService, XhsToolsService],
  exports: [MediaAgentService],
})
export class MediaAgentModule {}
