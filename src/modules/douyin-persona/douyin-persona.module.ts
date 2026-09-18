import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { WorkflowModelModule } from '../workflow-model/workflow-model.module.js';
import { DouyinPersonaController } from './controller/douyin-persona.controller.js';
import { DouyinPersonaGenerationService } from './services/douyin-persona-generation.service.js';
import { DouyinPersonaRepositoryService } from './services/douyin-persona-repository.service.js';

/**
 * @description 装配抖音预设人物能力：人设持久化、AI 人设草稿与三视图形象图生成。
 *   仓储对外导出，供抖音工作台在脚本生成、分镜拆解与出图时读取选中的人物。
 * @keyword-cn 预设人物模块, 人设能力装配
 * @keyword-en douyin-persona-module, persona-capability-wiring
 */
@Module({
  imports: [
    AdminModule,
    AiAgentModule,
    DataSourceModule,
    GalleryModule,
    WorkflowModelModule,
  ],
  controllers: [DouyinPersonaController],
  providers: [DouyinPersonaGenerationService, DouyinPersonaRepositoryService],
  exports: [DouyinPersonaRepositoryService],
})
export class DouyinPersonaModule {}
