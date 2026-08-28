import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AutoTaskRobotModule } from '../auto-task-robot/auto-task-robot.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { XhsTopicModule } from '../xhs-topic/xhs-topic.module.js';
import { ArticleLibraryModule } from '../article-library/article-library.module.js';
import { ContextModule } from '../context/context.module.js';
import { TikhubModule } from '../tikhub/tikhub.module.js';
import { XhsTopicDataController } from './controller/xhs-topic-data.controller.js';
import { XhsTopicCrawlService } from './services/xhs-topic-crawl.service.js';
import { XhsTopicDataService } from './services/xhs-topic-data.service.js';
import { XhsTopicOpinionService } from './services/xhs-topic-opinion.service.js';

/**
 * @description 小红书子选题数据看板模块，装配抓取调度、数据聚合与舆论分析服务。
 * @keyword-cn 数据看板模块, 抓取调度
 * @keyword-en topic-data-module, crawl-scheduler
 */
@Module({
  imports: [
    AdminModule,
    ArticleLibraryModule,
    AiAgentModule,
    AutoTaskRobotModule,
    DataSourceModule,
    ContextModule,
    TikhubModule,
    TodoModule,
    XhsTopicModule,
  ],
  controllers: [XhsTopicDataController],
  providers: [
    XhsTopicCrawlService,
    // 字符串令牌别名：抓取数据的回写入口在 TodoModule 的 task-api 控制器里，那边不能反向 import
    // 本模块（会成环），只能用 ModuleRef 按令牌取；类本身作为令牌需要 import，所以留一个字符串别名。
    { provide: 'XhsTopicCrawlService', useExisting: XhsTopicCrawlService },
    XhsTopicDataService,
    XhsTopicOpinionService,
  ],
  exports: [XhsTopicCrawlService, XhsTopicDataService, XhsTopicOpinionService],
})
export class XhsTopicDataModule {}
