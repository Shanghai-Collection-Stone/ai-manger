import { Module } from '@nestjs/common';
import { MongoSourceService } from './mongo-source.service.js';
import { MongoSourceToolsService } from './mongo-source.tools.js';
import { DataSourceModule } from '../../data-source.module.js';

/**
 * @title Mongo 数据源模块 Mongo Source Module
 * @description MongoDB 数据源的独立模块，使用主数据库连接（DS_MONGO_DB）。
 * @keywords-cn Mongo模块, 数据源
 * @keywords-en mongo module, data source
 */
@Module({
  imports: [DataSourceModule],
  providers: [MongoSourceService, MongoSourceToolsService],
  exports: [MongoSourceService, MongoSourceToolsService],
})
export class MongoSourceModule {}
