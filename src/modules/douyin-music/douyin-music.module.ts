import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { VideoLibraryModule } from '../video-library/video-library.module.js';
import { DouyinMusicController } from './controller/douyin-music.controller.js';
import { DouyinMusicRepositoryService } from './services/douyin-music-repository.service.js';
import { DouyinMusicService } from './services/douyin-music.service.js';

/**
 * @description 装配抖音背景音乐能力：后台曲库、租户内共享的成员上传音乐与对象存储；仓储对外导出，供工作台合成时解析选中的音乐。
 * @keyword-cn 背景音乐模块, 曲库能力装配
 * @keyword-en douyin-music-module, music-library-wiring
 */
@Module({
  imports: [AdminModule, DataSourceModule, VideoLibraryModule],
  controllers: [DouyinMusicController],
  providers: [DouyinMusicRepositoryService, DouyinMusicService],
  exports: [DouyinMusicRepositoryService],
})
export class DouyinMusicModule {}
