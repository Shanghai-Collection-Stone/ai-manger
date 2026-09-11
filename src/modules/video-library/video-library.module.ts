import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { VideoLibraryController } from './controller/video-library.controller.js';
import { VideoLibraryService } from './services/video-library.service.js';
import { VideoGroupService } from './services/video-group.service.js';
import { OssStorageService } from './services/oss-storage.service.js';

/**
 * @description 视频库模块：视频记录与分组的元数据管理，二进制走 OSS 直传。
 *   `DataSourceModule` 提供 `DS_MONGO_DB`，`AdminModule` 提供 token 换用户的鉴权。
 * @keyword-cn 视频库模块
 * @keyword-en video-library-module
 */
@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [VideoLibraryController],
  providers: [VideoLibraryService, VideoGroupService, OssStorageService],
  exports: [VideoLibraryService, VideoGroupService, OssStorageService],
})
export class VideoLibraryModule {}
