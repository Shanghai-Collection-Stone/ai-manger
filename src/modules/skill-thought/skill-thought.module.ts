import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { SkillThoughtService } from './services/skill-thought.service.js';
import { SkillThoughtToolsService } from './tools/skill-thought.tools.js';
import { EmbeddingModule } from '../shared/embedding/embedding.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';

const ST_MONGO_CLIENT = 'ST_MONGO_CLIENT';
const ST_MONGO_DB = 'ST_MONGO_DB';

const mongoProviders: Provider[] = [
  {
    provide: ST_MONGO_CLIENT,
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
    provide: ST_MONGO_DB,
    useFactory: (client: MongoClient, config: ConfigService): Db => {
      const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
      const isDev = env === 'development' || env === 'dev';
      let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
      if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
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
  imports: [EmbeddingModule, AiAgentModule],
  providers: [...mongoProviders, SkillThoughtService, SkillThoughtToolsService],
  exports: [SkillThoughtService, SkillThoughtToolsService, ...mongoProviders],
})
export class SkillThoughtModule {}
