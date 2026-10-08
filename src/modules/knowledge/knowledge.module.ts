import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { KnowledgeController } from './controller/knowledge.controller.js';
import { KnowledgeService } from './services/knowledge.service.js';

/**
 * @description 装配引用知识：租户内共享的知识条目管理接口，并导出给小红书选题与抖音工作台在生成时注入提示词。
 * @keyword-cn 引用知识模块
 * @keyword-en knowledge-module
 */
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
