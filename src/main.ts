import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { enableProxyFromEnv } from './shared/network/proxy';
import { ConfigService } from '@nestjs/config';

async function runMigrations() {
  const configService = new ConfigService();
  const env = (configService.get<string>('NODE_ENV') ?? '').toLowerCase();
  const isDev = env === 'development' || env === 'dev';

  let uri =
    configService.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017';
  let dbName = configService.get<string>('MONGODB_DB') ?? 'ai_system';

  if (isDev) {
    const host = configService.get<string>('DEV_MONGODB_HOST');
    const db = configService.get<string>('DEV_MONGODB_DB');
    const user = configService.get<string>('DEV_MONGODB_USER');
    const pass = configService.get<string>('DEV_MONGODB_PASS');
    const topo = (
      configService.get<string>('DEV_MONGODB_TOPOLOGY') ?? ''
    ).toLowerCase();

    if (host && db && user && pass) {
      const qp = new URLSearchParams();
      const authSource =
        configService.get<string>('DEV_MONGODB_AUTH_SOURCE') ?? db;
      qp.set('authSource', authSource);
      if (topo === 'standalone') qp.set('directConnection', 'true');
      uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:27017/?${qp.toString()}`;
      dbName = db;
    }
  }

  try {
    // 动态导入 migrate-mongo（ESM 兼容）
    const { database, up, config } = await import('migrate-mongo');

    // 设置配置
    config.set({
      mongodb: {
        url: uri,
        databaseName: dbName,
      },
      migrationsDir: join(process.cwd(), 'migrations'),
      changelogCollectionName: 'changelog',
      migrationFileExtension: '.js',
    });

    // 连接数据库
    const { db, client } = await database.connect();

    // 执行迁移
    const migrated = await up(db, client);

    if (migrated.length > 0) {
      console.log('[Migration] Executed migrations:', migrated);
    } else {
      console.log('[Migration] No pending migrations');
    }

    // 关闭连接
    await client.close();
  } catch (error) {
    console.error('[Migration] Failed to run migrations:', error);
    // 迁移失败不阻止应用启动
  }
}

async function bootstrap() {
  enableProxyFromEnv();

  // Run migrations before starting the app
  await runMigrations();

  const app = await NestFactory.create(AppModule);
  app.use('/static', express.static(join(process.cwd(), 'public')));
  await app.listen(process.env.PORT ?? 3011);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
void bootstrap();
