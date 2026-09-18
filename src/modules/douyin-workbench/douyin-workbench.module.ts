import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AiBillingModule } from '../ai-billing/ai-billing.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { DouyinPersonaModule } from '../douyin-persona/douyin-persona.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { WorkflowModelModule } from '../workflow-model/workflow-model.module.js';
import { PixmaxModule } from '../pixmax/pixmax.module.js';
import { VideoLibraryModule } from '../video-library/video-library.module.js';
import { DouyinWorkbenchController } from './controller/douyin-workbench.controller.js';
import { DouyinOperationService } from './services/douyin-operation.service.js';
import { DouyinPixmaxVideoService } from './services/douyin-pixmax-video.service.js';
import { DouyinChildTopicGenerationService } from './services/douyin-child-topic-generation.service.js';
import { DouyinGenerationJobService } from './services/douyin-generation-job.service.js';
import { DouyinShotImageService } from './services/douyin-shot-image.service.js';
import { DouyinStoryboardGenerationService } from './services/douyin-storyboard-generation.service.js';
import { DouyinStoryboardImageService } from './services/douyin-storyboard-image.service.js';
import { DouyinWorkbenchRepositoryService } from './services/douyin-workbench-repository.service.js';

/**
 * @description 装配抖音母子选题、分镜、视频生成、发布与抓取真实业务能力（含预设人物能力，用于脚本、分镜与出图的人物一致性）。
 * @keyword-cn 抖音工作台模块, 视频业务编排
 * @keyword-en douyin-workbench-module, video-business-orchestration
 */
@Module({
  imports: [
    AdminModule,
    AiAgentModule,
    AiBillingModule,
    DataSourceModule,
    DouyinPersonaModule,
    GalleryModule,
    WorkflowModelModule,
    PixmaxModule,
    VideoLibraryModule,
  ],
  controllers: [DouyinWorkbenchController],
  providers: [
    DouyinChildTopicGenerationService,
    DouyinGenerationJobService,
    DouyinOperationService,
    DouyinPixmaxVideoService,
    DouyinShotImageService,
    DouyinStoryboardGenerationService,
    DouyinStoryboardImageService,
    DouyinWorkbenchRepositoryService,
  ],
  exports: [DouyinWorkbenchRepositoryService],
})
export class DouyinWorkbenchModule {}
