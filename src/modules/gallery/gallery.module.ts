import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { GalleryController } from './controller/gallery.controller.js';
import { GalleryService } from './services/gallery.service.js';
import { GalleryAiImageService } from './services/gallery-ai-image.service.js';
import { GalleryGroupService } from './services/gallery-group.service.js';
import { MaterialStyleService } from './material-styles/services/material-style.service.js';

@Module({
  imports: [DataSourceModule, AdminModule, AiAgentModule],
  controllers: [GalleryController],
  providers: [
    GalleryService,
    GalleryAiImageService,
    GalleryGroupService,
    MaterialStyleService,
  ],
  exports: [
    GalleryService,
    GalleryAiImageService,
    GalleryGroupService,
    MaterialStyleService,
  ],
})
export class GalleryModule {}
