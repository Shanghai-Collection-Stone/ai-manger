import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { CanvasModule } from '../canvas/canvas.module.js';
import { McpFunctionCallModule } from '../function-call/mcp/mcp.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { XhsTopicController } from './controller/xhs-topic.controller.js';
import { XhsTopicService } from './services/xhs-topic.service.js';
import { XhsTopicRepositoryService } from './services/xhs-topic-repository.service.js';
import { XhsArticleGenerationService } from './services/xhs-article-generation.service.js';

/**
 * @description 小红书 AI 选题模块，编排 Agent 候选、MCP 搜索、Todo、真实图库与 MongoDB 真实选题。
 * @keyword-cn 小红书选题模块, 选题生成
 * @keyword-en xhs-topic-module, topic-generation
 */
@Module({
  imports: [
    AdminModule,
    AiAgentModule,
    CanvasModule,
    DataSourceModule,
    GalleryModule,
    McpFunctionCallModule,
    TodoModule,
  ],
  controllers: [XhsTopicController],
  providers: [
    XhsArticleGenerationService,
    XhsTopicRepositoryService,
    XhsTopicService,
  ],
  exports: [
    XhsArticleGenerationService,
    XhsTopicRepositoryService,
    XhsTopicService,
  ],
})
export class XhsTopicModule {}
