import { Module, Provider } from '@nestjs/common';
import { SchemaController } from './controller/schema.controller.js';
import { SchemaService } from './services/schema.service.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { FormatModule } from '../format/format.module.js';
import { MongoClient, Db } from 'mongodb';
import { ConfigService } from '@nestjs/config';

const SCHEMA_MONGO_CLIENT = 'SCHEMA_MONGO_CLIENT';
const SCHEMA_MONGO_DB = 'SCHEMA_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: SCHEMA_MONGO_CLIENT,
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
    provide: SCHEMA_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
      if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
      return client.db(dbName);
    },
    inject: [SCHEMA_MONGO_CLIENT, ConfigService],
  },
];

@Module({
  imports: [AiAgentModule, FormatModule],
  controllers: [SchemaController],
  providers: [...mongoProviders, SchemaService],
  exports: [SchemaService, ...mongoProviders],
})
export class SchemaModule {}
