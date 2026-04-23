import { Module, Provider, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { DataSourceService } from './services/data-source.service.js';
import { DataSourceSchemaService } from './services/data-source-schema.service.js';
import { DataSourceController } from './controller/data-source.controller.js';
import { DataSourceSearchToolsService } from './tools/data-source-search.tools.js';
import { EmbeddingModule } from '../shared/embedding/embedding.module.js';
import { SuperPartySourceModule } from './sources/super-party/super-party-source.module.js';
import { FeishuBitableSourceModule } from './sources/feishu-bitable/feishu-bitable-source.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { FormatModule } from '../format/format.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { resolveMongoUri } from '@/shared/mongo/resolve-mongo-uri';

const DS_MONGO_CLIENT = 'DS_MONGO_CLIENT';
const DS_MONGO_DB = 'DS_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: DS_MONGO_CLIENT,
    useFactory: async (config: ConfigService): Promise<MongoClient> => {
      const { uri } = resolveMongoUri(config);
      const client: MongoClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      await client.connect();
      return client;
    },
    inject: [ConfigService],
  },
  {
    provide: DS_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const { dbName } = resolveMongoUri(config);
      return client.db(dbName);
    },
    inject: [DS_MONGO_CLIENT, ConfigService],
  },
];

/**
 * @title 数据源模块 Data Source Module
 * @description 管理系统中的数据源注册与检索。
 * @keywords-cn 数据源模块, 注册, 检索
 * @keywords-en data source module, registration, retrieval
 */
@Module({
  imports: [
    EmbeddingModule,
    forwardRef(() => AiAgentModule),
    forwardRef(() => AdminModule),
    FormatModule,
    forwardRef(() => SuperPartySourceModule),
    forwardRef(() => FeishuBitableSourceModule),
  ],
  controllers: [DataSourceController],
  providers: [
    ...mongoProviders,
    DataSourceService,
    DataSourceSchemaService,
    DataSourceSearchToolsService,
  ],
  exports: [
    DataSourceService,
    DataSourceSchemaService,
    DataSourceSearchToolsService,
    ...mongoProviders,
  ],
})
export class DataSourceModule {}
