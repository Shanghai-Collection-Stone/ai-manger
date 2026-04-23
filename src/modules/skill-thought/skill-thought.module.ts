import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { SkillThoughtService } from './services/skill-thought.service.js';
import { SkillThoughtToolsService } from './tools/skill-thought.tools.js';
import { EmbeddingModule } from '../shared/embedding/embedding.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { SkillThoughtController } from './controller/skill-thought.controller.js';
import { resolveMongoUri } from '@/shared/mongo/resolve-mongo-uri';

const ST_MONGO_CLIENT = 'ST_MONGO_CLIENT';
const ST_MONGO_DB = 'ST_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: ST_MONGO_CLIENT,
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
    provide: ST_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const { dbName } = resolveMongoUri(config);
      return client.db(dbName);
    },
    inject: [ST_MONGO_CLIENT, ConfigService],
  },
];

/**
 * @title 思维链模块 Skill Thought Module
 * @description 管理思维链的存储、检索和智能合并。
 * @keywords-cn 思维链模块, 存储, 检索
 * @keywords-en skill thought module, storage, retrieval
 */
@Module({
  imports: [EmbeddingModule, AiAgentModule, AdminModule],
  controllers: [SkillThoughtController],
  providers: [...mongoProviders, SkillThoughtService, SkillThoughtToolsService],
  exports: [SkillThoughtService, SkillThoughtToolsService, ...mongoProviders],
})
export class SkillThoughtModule {}
