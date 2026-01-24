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

const DS_MONGO_CLIENT = 'DS_MONGO_CLIENT';
const DS_MONGO_DB = 'DS_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: DS_MONGO_CLIENT,
    useFactory: async (config: ConfigService): Promise<MongoClient> => {
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let uri =
        config.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017';
      if (isDev) {
        const host = config.get<string>('DEV_MONGODB_HOST');
        const db = config.get<string>('DEV_MONGODB_DB');
        const user = config.get<string>('DEV_MONGODB_USER');
        const pass = config.get<string>('DEV_MONGODB_PASS');
        const topo = (
          config.get<string>('DEV_MONGODB_TOPOLOGY') ?? ''
        ).toLowerCase();
        if (host && db && user && pass) {
          const qp = new URLSearchParams();
          const authSource =
            config.get<string>('DEV_MONGODB_AUTH_SOURCE') ?? db;
          qp.set('authSource', authSource);
          if (topo === 'standalone') qp.set('directConnection', 'true');
          uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:27017/?${qp.toString()}`;
        }
      }
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
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
      if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
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
    AiAgentModule,
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
