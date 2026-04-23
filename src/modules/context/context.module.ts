import { Module, Provider, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module.js';
import { ContextController } from './controller/context.controller';
import { ContextService } from './services/context.service';
import { MongoClient, Db } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { resolveMongoUri } from '@/shared/mongo/resolve-mongo-uri';

const CTX_MONGO_CLIENT = 'CTX_MONGO_CLIENT';
const CTX_MONGO_DB = 'CTX_MONGO_DB';
const CTX_LANGGRAPH_SAVER = 'CTX_LANGGRAPH_SAVER';

const mongoProviders: Provider[] = [
  {
    provide: CTX_MONGO_CLIENT,
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
    provide: CTX_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const { dbName } = resolveMongoUri(config);
      return client.db(dbName);
    },
    inject: [CTX_MONGO_CLIENT, ConfigService],
  },
  {
    provide: CTX_LANGGRAPH_SAVER,
    useFactory: (client: MongoClient, config: ConfigService): MongoDBSaver => {
      const { dbName } = resolveMongoUri(config);
      return new MongoDBSaver({ client, dbName });
    },
    inject: [CTX_MONGO_CLIENT, ConfigService],
  },
];

@Module({
  imports: [forwardRef(() => AdminModule)],
  controllers: [ContextController],
  providers: [...mongoProviders, ContextService],
  exports: [ContextService, ...mongoProviders],
})
export class ContextModule {}
