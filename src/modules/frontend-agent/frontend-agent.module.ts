import { Module } from '@nestjs/common';
import { FrontendAgentService } from './services/frontend.service.js';

/**
 * @title 前端页Agent模块 Frontend Page Agent Module
 * @description 生成图表、表格与富Markdown的Agent服务。
 * @keywords-cn 前端, 页面, 图表, 表格, Markdown
 * @keywords-en frontend, page, chart, table, markdown
 */
@Module({
  providers: [FrontendAgentService],
  exports: [FrontendAgentService],
})
export class FrontendAgentModule {}
