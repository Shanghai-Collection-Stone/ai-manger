import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { DouyinWorkbenchModule } from '../douyin-workbench/douyin-workbench.module.js';
import { DouyinPublishController } from './controller/douyin-publish.controller.js';
import { DouyinPublishTaskController } from './controller/douyin-publish-task.controller.js';
import { DouyinPublishTokenGuard } from './guards/douyin-publish-token.guard.js';
import { DouyinPublishLibraryService } from './services/douyin-publish-library.service.js';
import { DouyinPublishWorkService } from './services/douyin-publish-work.service.js';

/**
 * @description 装配抖音视频发布库管理端与小程序扫码发布能力。
 * @keyword-cn 抖音发布模块, 扫码发布
 * @keyword-en douyin-publish-module, qr-publishing
 */
@Module({
  imports: [AdminModule, DataSourceModule, DouyinWorkbenchModule],
  controllers: [DouyinPublishController, DouyinPublishTaskController],
  providers: [
    DouyinPublishLibraryService,
    DouyinPublishWorkService,
    DouyinPublishTokenGuard,
  ],
  exports: [DouyinPublishLibraryService, DouyinPublishWorkService],
})
export class DouyinPublishModule {}
