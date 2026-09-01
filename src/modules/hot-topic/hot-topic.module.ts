import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { HotTopicController } from './controller/hot-topic.controller.js';
import { HotTopicCollectService } from './services/hot-topic-collect.service.js';
import { HotTopicFetcherService } from './services/hot-topic-fetcher.service.js';
import { HotTopicItemService } from './services/hot-topic-item.service.js';
import { HotTopicRecommendService } from './services/hot-topic-recommend.service.js';
import { HotTopicRuleService } from './services/hot-topic-rule.service.js';
import { HotTopicTaggingService } from './services/hot-topic-tagging.service.js';

/**
 * @description 热点采集榜模块，装配后台鉴权、榜单直采、规则仓储、AI 归类与热点推荐服务。
 * @keyword-cn 热点采集模块, 榜单管理
 * @keyword-en hot-topic-module, board-management
 */
@Module({
  imports: [AdminModule, AiAgentModule, DataSourceModule],
  controllers: [HotTopicController],
  providers: [
    HotTopicFetcherService,
    HotTopicRuleService,
    HotTopicItemService,
    HotTopicTaggingService,
    HotTopicCollectService,
    HotTopicRecommendService,
  ],
  exports: [
    HotTopicRuleService,
    HotTopicItemService,
    HotTopicCollectService,
    HotTopicRecommendService,
  ],
})
export class HotTopicModule {}
