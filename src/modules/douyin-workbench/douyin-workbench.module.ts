import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AiBillingModule } from '../ai-billing/ai-billing.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { DouyinWorkbenchController } from './controller/douyin-workbench.controller.js';
import { DouyinOperationService } from './services/douyin-operation.service.js';
import { DouyinChildTopicGenerationService } from './services/douyin-child-topic-generation.service.js';
import { DouyinGenerationJobService } from './services/douyin-generation-job.service.js';
import { DouyinStoryboardGenerationService } from './services/douyin-storyboard-generation.service.js';
import { DouyinStoryboardImageService } from './services/douyin-storyboard-image.service.js';
import { DouyinWorkbenchRepositoryService } from './services/douyin-workbench-repository.service.js';

/**
 * @description 装配抖音母子选题、分镜、视频生成、发布与抓取真实业务能力。
 * @keyword-cn 抖音工作台模块, 视频业务编排
 * @keyword-en douyin-workbench-module, video-business-orchestration
 */
@Module({
  imports: [
    AdminModule,
    AiAgentModule,
    AiBillingModule,
    DataSourceModule,
    GalleryModule,
  ],
  controllers: [DouyinWorkbenchController],
  providers: [
    DouyinChildTopicGenerationService,
    DouyinGenerationJobService,
    DouyinOperationService,
    DouyinStoryboardGenerationService,
    DouyinStoryboardImageService,
    DouyinWorkbenchRepositoryService,
  ],
  exports: [DouyinWorkbenchRepositoryService],
})
export class DouyinWorkbenchModule {}
