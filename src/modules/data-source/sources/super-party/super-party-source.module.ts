import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { SuperPartySourceService } from './super-party-source.service.js';
import { SuperPartySourceToolsService } from './super-party-source.tools.js';

const SP_MONGO_CLIENT = 'SP_MONGO_CLIENT';
const SP_MONGO_DB = 'SP_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: SP_MONGO_CLIENT,
    useFactory: async (config: ConfigService): Promise<MongoClient> => {
      const host =
        config.get<string>('SUPER_PARTY_MONGODB_HOST') ?? '211.149.248.140';
      const port = config.get<string>('SUPER_PARTY_MONGODB_PORT') ?? '27017';
      const db = config.get<string>('SUPER_PARTY_MONGODB_DB') ?? 'super_party';
      const user =
        config.get<string>('SUPER_PARTY_MONGODB_USER') ?? 'super_party';
      const pass = config.get<string>('SUPER_PARTY_MONGODB_PASS') ?? '';
      const authSource =
        config.get<string>('SUPER_PARTY_MONGODB_AUTH_SOURCE') ?? db;

      const uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/?authSource=${authSource}`;

      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      await client.connect();
      console.log('[SuperPartySourceModule] Connected to super_party database');
      return client;
    },
    inject: [ConfigService],
  },
  {
    provide: SP_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const dbName =
        config.get<string>('SUPER_PARTY_MONGODB_DB') ?? 'super_party';
      return client.db(dbName);
    },
    inject: [SP_MONGO_CLIENT, ConfigService],
  },
];

/**
 * @title 超级派对数据源模块 Super Party Source Module
 * @description 超级派对 MongoDB 数据源的独立模块。
 * @keywords-cn 超级派对, 数据源, 小程序
 * @keywords-en super party, data source, mini program
 */
@Module({
  providers: [
    ...mongoProviders,
    SuperPartySourceService,
    SuperPartySourceToolsService,
  ],
  exports: [SuperPartySourceService, SuperPartySourceToolsService, SP_MONGO_DB],
})
export class SuperPartySourceModule {}
