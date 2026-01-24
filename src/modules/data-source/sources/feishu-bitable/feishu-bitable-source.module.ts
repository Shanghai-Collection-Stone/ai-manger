import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeishuBitableSourceService } from './feishu-bitable-source.service.js';
import { FeishuBitableSourceToolsService } from './feishu-bitable-source.tools.js';

/**
 * @title 飞书多维表格数据源模块 Feishu Bitable Source Module
 * @description 飞书多维表格数据源的独立模块。
 * @keywords-cn 飞书, 多维表格, 数据源, 模块
 * @keywords-en feishu, bitable, data source, module
 */
@Module({
  imports: [ConfigModule],
  providers: [FeishuBitableSourceService, FeishuBitableSourceToolsService],
  exports: [FeishuBitableSourceService, FeishuBitableSourceToolsService],
})
export class FeishuBitableSourceModule {}
