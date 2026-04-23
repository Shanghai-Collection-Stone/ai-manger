import { Module, Provider } from '@nestjs/common';
import { SchemaController } from './controller/schema.controller.js';
import { SchemaService } from './services/schema.service.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { FormatModule } from '../format/format.module.js';
import { MongoClient, Db } from 'mongodb';
import { ConfigService } from '@nestjs/config';
import { resolveMongoUri } from '@/shared/mongo/resolve-mongo-uri';

const SCHEMA_MONGO_CLIENT = 'SCHEMA_MONGO_CLIENT';
const SCHEMA_MONGO_DB = 'SCHEMA_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: SCHEMA_MONGO_CLIENT,
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
    provide: SCHEMA_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const { dbName } = resolveMongoUri(config);
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
