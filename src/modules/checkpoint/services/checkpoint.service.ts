import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointListOptions,
  CheckpointMetadata,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import { MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

@Injectable()
export class MongoCheckpointService {
  private readonly saver: MongoDBSaver;

  constructor(
    @Inject('CTX_MONGO_CLIENT') client: MongoClient,
    config: ConfigService,
  ) {
    const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
    const isDev = env === 'development' || env === 'dev';
    let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
    if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
    this.saver = new MongoDBSaver({ client, dbName });
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    return await this.saver.getTuple(config);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const gen = this.saver.list(config, options);
    for await (const item of gen) yield item;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    return await this.saver.put(config, checkpoint, metadata);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    await this.saver.putWrites(config, writes, taskId);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.saver.deleteThread(threadId);
  }
}
