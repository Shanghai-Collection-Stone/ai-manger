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
import cluster from 'node:cluster';
import {
  exitWhenPrimaryGone,
  runClusterPrimary,
} from './modules/cluster-runtime/services/cluster-primary.js';
import {
  isClusterWorker,
  isLeaderProcess,
  readClusterWorkerCount,
} from './modules/cluster-runtime/services/cluster-role.js';
import { createGenerationQueuePrimaryHandler } from './modules/generation-queue/services/generation-queue-primary.js';
import {
  applySharpMemoryLimits,
  createMemoryWatchHandler,
  raiseOwnOomScore,
  resolveMemoryPlan,
  startMemoryReporting,
} from './modules/cluster-runtime/services/cluster-memory.js';

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
 *   多进程时每个 worker 各跑一份：迁移已由主进程跑过，SuperClaw gRPC 只在 leader 进程上监听；
 *   worker 调高自身 OOM 分值并上报内存。两种模式都限制 sharp 的线程与缓存。
 * @keyword-en app-bootstrap, raw-body-webhooks
 * @keyword-cn 应用启动, webhook原始请求体
 */
async function bootstrap() {
  enableProxyFromEnv();

  if (isClusterWorker()) {
    exitWhenPrimaryGone();
    // 内存耗尽时让内核优先杀 worker（主进程会重拉），并定时向主进程上报内存
    raiseOwnOomScore();
    startMemoryReporting();
  } else {
    // Run migrations before starting the app
    await runMigrations();
  }
  await applySharpMemoryLimits();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  if (
    isLeaderProcess() &&
    process.env.SUPER_CLAW_GRPC_ENABLED?.trim().toLowerCase() !== 'false'
  ) {
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

/**
 * @description 进程入口：`CLUSTER_WORKERS` 大于 1 时作为主进程先跑一次迁移，再派生 worker（共享 HTTP 端口），
 *   主进程持有生成排队登记簿；否则按单进程直接启动应用。
 * @keyword-en cluster-entry, multi-process-bootstrap
 * @keyword-cn 多进程入口, 进程启动分流
 */
function main() {
  const workers = readClusterWorkerCount();
  if (workers > 1 && cluster.isPrimary) {
    enableProxyFromEnv();
    // 按内存预算给每个 worker 定堆上限，预算不够时少开几个 worker
    const plan = resolveMemoryPlan(workers);
    console.log(
      `[cluster-memory] 预算 ${plan.budgetMb}MB（来源 ${plan.source}），worker ${plan.workers}/${plan.requestedWorkers} 个，每个堆上限 ${plan.heapMbPerWorker}MB`,
    );
    if (plan.workers < plan.requestedWorkers) {
      console.warn(
        `[cluster-memory] 内存预算不够开 ${plan.requestedWorkers} 个 worker，已减到 ${plan.workers} 个；可调大 CLUSTER_MEMORY_BUDGET_MB 或给容器加内存`,
      );
    }
    void runClusterPrimary({
      workers: plan.workers,
      workerExecArgv: [`--max-old-space-size=${plan.heapMbPerWorker}`],
      beforeFork: runMigrations,
      handlers: [
        createGenerationQueuePrimaryHandler(),
        createMemoryWatchHandler(plan),
      ],
    });
    return;
  }
  void bootstrap();
}
main();
