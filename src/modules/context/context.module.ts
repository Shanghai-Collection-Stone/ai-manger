import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextController } from './controller/context.controller';
import { ContextService } from './services/context.service';
import { MongoClient, Db } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

const CTX_MONGO_CLIENT = 'CTX_MONGO_CLIENT';
const CTX_MONGO_DB = 'CTX_MONGO_DB';
const CTX_LANGGRAPH_SAVER = 'CTX_LANGGRAPH_SAVER';

const mongoProviders: Provider[] = [
  {
    provide: CTX_MONGO_CLIENT,
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
    provide: CTX_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
      if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
      return client.db(dbName);
    },
    inject: [CTX_MONGO_CLIENT, ConfigService],
  },
  {
    provide: CTX_LANGGRAPH_SAVER,
    useFactory: (client: MongoClient, config: ConfigService): MongoDBSaver => {
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
      if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
      return new MongoDBSaver({ client, dbName });
    },
    inject: [CTX_MONGO_CLIENT, ConfigService],
  },
];

@Module({
  controllers: [ContextController],
  providers: [...mongoProviders, ContextService],
  exports: [ContextService, ...mongoProviders],
})
export class ContextModule {}
