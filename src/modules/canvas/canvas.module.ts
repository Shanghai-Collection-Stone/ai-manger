import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { CanvasController } from './controller/canvas.controller.js';
import { CanvasService } from './services/canvas.service.js';

@Module({
  imports: [DataSourceModule],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule {}
