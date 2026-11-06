import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AiBillingModule } from '../ai-billing/ai-billing.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { DouyinPersonaModule } from '../douyin-persona/douyin-persona.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { GenerationQueueModule } from '../generation-queue/generation-queue.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ModelConcurrencyModule } from '../model-concurrency/model-concurrency.module.js';
import { WorkflowModelModule } from '../workflow-model/workflow-model.module.js';
import { PixmaxModule } from '../pixmax/pixmax.module.js';
import { OpensourceVideoModule } from '../opensource-video/opensource-video.module.js';
import { VideoLibraryModule } from '../video-library/video-library.module.js';
import { DouyinWorkbenchController } from './controller/douyin-workbench.controller.js';
import { DouyinOperationService } from './services/douyin-operation.service.js';
import { DouyinPixmaxVideoService } from './services/douyin-pixmax-video.service.js';
import { DouyinShuyanVideoService } from './services/douyin-shuyan-video.service.js';
import { DouyinOpensourceVideoService } from './services/douyin-opensource-video.service.js';
import { DouyinCosyVoiceService } from './services/douyin-cosyvoice.service.js';
import { DouyinChildTopicGenerationService } from './services/douyin-child-topic-generation.service.js';
import { DouyinGenerationJobService } from './services/douyin-generation-job.service.js';
import { DouyinShotConcatService } from './services/douyin-shot-concat.service.js';
import { DouyinShotImageService } from './services/douyin-shot-image.service.js';
import { DouyinVideoDirectorService } from './services/douyin-video-director.service.js';
import { DouyinVideoTemplateService } from './services/douyin-video-template.service.js';
import { DouyinVideoQueueService } from './services/douyin-video-queue.service.js';
import { DouyinStoreVisitService } from './services/douyin-store-visit.service.js';
import { DouyinStoreVisitPipelineService } from './services/douyin-store-visit-pipeline.service.js';
import { DouyinStoreVisitPlannerService } from './services/douyin-store-visit-planner.service.js';
import { DouyinStoreVisitSpotService } from './services/douyin-store-visit-spot.service.js';
import { DouyinStoryboardGenerationService } from './services/douyin-storyboard-generation.service.js';
import { DouyinStoryboardImageService } from './services/douyin-storyboard-image.service.js';
import { DouyinVideoStorageService } from './services/douyin-video-storage.service.js';
import { DouyinWorkbenchRepositoryService } from './services/douyin-workbench-repository.service.js';
import { DouyinWorkbenchAgentService } from './services/douyin-workbench-agent.service.js';

/**
 * @description 装配抖音母子选题、分镜、视频生成（整片 / 分镜 / 分镜合成 / 探店画外音）、发布与抓取真实业务能力（含预设人物能力，用于脚本、分镜与出图的人物一致性）。
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
    GenerationQueueModule,
    KnowledgeModule,
    ModelConcurrencyModule,
    WorkflowModelModule,
    PixmaxModule,
    OpensourceVideoModule,
    VideoLibraryModule,
  ],
  controllers: [DouyinWorkbenchController],
  providers: [
    DouyinChildTopicGenerationService,
    DouyinCosyVoiceService,
    DouyinGenerationJobService,
    DouyinOperationService,
    DouyinPixmaxVideoService,
    DouyinShuyanVideoService,
    DouyinOpensourceVideoService,
    DouyinShotConcatService,
    DouyinShotImageService,
    DouyinStoreVisitService,
    DouyinStoreVisitPipelineService,
    DouyinStoreVisitPlannerService,
    DouyinStoreVisitSpotService,
    DouyinStoryboardGenerationService,
    DouyinStoryboardImageService,
    DouyinVideoDirectorService,
    DouyinVideoQueueService,
    DouyinVideoStorageService,
    DouyinVideoTemplateService,
    DouyinWorkbenchRepositoryService,
    DouyinWorkbenchAgentService,
  ],
  exports: [DouyinWorkbenchRepositoryService, DouyinWorkbenchAgentService],
})
export class DouyinWorkbenchModule {}
