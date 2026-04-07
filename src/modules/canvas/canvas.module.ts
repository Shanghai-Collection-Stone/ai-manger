import { Module, forwardRef } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { CanvasController } from './controller/canvas.controller.js';
import { CanvasService } from './services/canvas.service.js';
import { CanvasImageGroupService } from './services/canvas-image-group.service.js';

@Module({
  imports: [DataSourceModule, AdminModule, GalleryModule, forwardRef(() => AiAgentModule)],
  controllers: [CanvasController],
  providers: [CanvasService, CanvasImageGroupService],
  exports: [CanvasService],
})
export class CanvasModule {}
