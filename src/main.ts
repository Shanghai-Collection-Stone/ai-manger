import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { enableProxyFromEnv } from './shared/network/proxy';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { resolveMongoUri } from './shared/mongo/resolve-mongo-uri';
import { MicroserviceOptions } from '@nestjs/microservices';
import { createSuperClawGrpcOptions } from './modules/super-claw/super-claw-grpc.options.js';

/**
 * @description Run pending Mongo migrations before the Nest app starts.
 * @keyword-en app-migrations, startup-migrations
 * @keyword-cn 应用迁移, 启动迁移
 */
async function runMigrations() {
  const configService = new ConfigService();
  const { uri, dbName } = resolveMongoUri(configService);

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

/**
 * @description Bootstrap the Nest app, 50 MB JSON/form parsing, static pages, redirects, CORS, and raw-body capture for webhooks.
 * @keyword-en app-bootstrap, raw-body-webhooks
 * @keyword-cn 应用启动, webhook原始请求体
 */
async function bootstrap() {
  enableProxyFromEnv();

  // Run migrations before starting the app
  await runMigrations();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  if (process.env.SUPER_CLAW_GRPC_ENABLED?.trim().toLowerCase() !== 'false') {
    app.connectMicroservice<MicroserviceOptions>(createSuperClawGrpcOptions(), {
      inheritAppConfig: true,
    });
  }
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });
  app.enableCors();

  const publicPages = join(process.cwd(), 'public', 'pages');
  const distPages = join(process.cwd(), 'dist', 'pages');
  const pagesRoot = existsSync(publicPages)
    ? publicPages
    : existsSync(distPages)
      ? distPages
      : undefined;

  app.use(
    '/',
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.path === '/') {
        res.redirect('/pages/ai-commander.html');
        return;
      }
      if (req.path === '/admin' || req.path === '/admin/') {
        res.redirect('/pages/admin.html');
        return;
      }
      if (req.path === '/login' || req.path === '/login/') {
        res.redirect('/pages/login.html');
        return;
      }
      next();
    },
  );

  if (pagesRoot) {
    app.use('/pages', express.static(pagesRoot));
  }

  app.use('/favicon.ico', (_req: express.Request, res: express.Response) => {
    res.status(204).end();
  });

  app.use('/static', express.static(join(process.cwd(), 'public')));
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3011);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
void bootstrap();
