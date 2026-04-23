import { Module, Provider } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { AdminModule } from '../admin/admin.module';
//
import { RetrievalController } from './controller/retrieval.controller';
//
import { RetrievalService } from './services/retrieval.service';
import { KeywordService } from './services/keyword.service';
import { MongoClient, Db } from 'mongodb';
import { ConfigService } from '@nestjs/config';
import { resolveMongoUri } from '@/shared/mongo/resolve-mongo-uri';

const MONGO_CLIENT = 'MONGO_CLIENT';
const MONGO_DB = 'MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: MONGO_CLIENT,
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
    provide: MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const { dbName } = resolveMongoUri(config);
      return client.db(dbName);
    },
    inject: [MONGO_CLIENT, ConfigService],
  },
];

@Module({
  imports: [AiAgentModule, AdminModule],
  controllers: [RetrievalController],
  providers: [...mongoProviders, KeywordService, RetrievalService],
  exports: [KeywordService, RetrievalService, ...mongoProviders],
})
export class AiContextModule {}
