import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { MongoQueryController } from './controller/mongo-query.controller.js';
import { MongoQueryService } from './services/mongo-query.service.js';

/**
 * @description Mongo 通用查询模块（JSON Filter + 关联查询 + 租户隔离）
 * @keyword-en mongo query module
 */
@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [MongoQueryController],
  providers: [MongoQueryService],
  exports: [MongoQueryService],
})
export class MongoQueryModule {}
