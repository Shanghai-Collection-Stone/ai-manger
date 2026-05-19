import { Module } from '@nestjs/common';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { AdminModule } from '../../admin/admin.module.js';
import { GalleryModule } from '../gallery.module.js';
import { GalleryZipImportController } from './controller/gallery-zip-import.controller.js';
import { GalleryZipImportService } from './services/gallery-zip-import.service.js';

/**
 * @description Gallery ZIP 导入模块:zip 上传 → 队列化 → 后台解压 → 复用 GalleryService.createMany 入库
 * @keyword-en gallery zip import module
 */
@Module({
  imports: [DataSourceModule, AdminModule, GalleryModule],
  controllers: [GalleryZipImportController],
  providers: [GalleryZipImportService],
  exports: [GalleryZipImportService],
})
export class GalleryZipImportModule {}
