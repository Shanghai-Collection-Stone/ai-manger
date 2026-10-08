import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { DouyinPublishModule } from '../douyin-publish/douyin-publish.module.js';
import { TikhubModule } from '../tikhub/tikhub.module.js';
import { DouyinDataController } from './controller/douyin-data.controller.js';
import { DouyinDataCrawlService } from './services/douyin-data-crawl.service.js';
import { DouyinDataService } from './services/douyin-data.service.js';

/**
 * @description 装配抖音作品数据监控：发布库已发布作品的监控开关、TikHub 定时 / 手动抓取与区间指标。
 * @keyword-cn 抖音数据监控模块, 作品数据抓取
 * @keyword-en douyin-data-module, work-data-crawl
 */
@Module({
  imports: [AdminModule, DataSourceModule, DouyinPublishModule, TikhubModule],
  controllers: [DouyinDataController],
  providers: [DouyinDataService, DouyinDataCrawlService],
})
export class DouyinDataModule {}
