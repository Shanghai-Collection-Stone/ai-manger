import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { CanvasController } from './controller/canvas.controller.js';
import { CanvasService } from './services/canvas.service.js';

@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule {}
