import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { GalleryController } from './controller/gallery.controller.js';
import { GalleryService } from './services/gallery.service.js';
import { GalleryGroupService } from './services/gallery-group.service.js';

@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [GalleryController],
  providers: [GalleryService, GalleryGroupService],
  exports: [GalleryService, GalleryGroupService],
})
export class GalleryModule {}
