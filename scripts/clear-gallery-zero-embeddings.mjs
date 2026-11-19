/**
 * @title Clear Gallery Zero Embeddings
 * @description 旧数据兼容：向量服务不可用时，历史图片与分组都存了 768 个 0 的向量（与谁算相似度都是 0，却占图片文档约 89% 体积）。
 *   本脚本把全 0 向量改成空数组，有效向量原样保留；字段本身保留，以后配置向量服务后用重建向量接口补齐即可。
 *   按 _id 分批处理，可重复执行，中断后直接重跑。
 *
 * 使用方式（在应用容器内执行，连接参数与应用相同）：
 *   node scripts/clear-gallery-zero-embeddings.mjs --dry-run      # 只统计不写入
 *   node scripts/clear-gallery-zero-embeddings.mjs                # 正式清理
 *   node scripts/clear-gallery-zero-embeddings.mjs --batch=500 --sleep-ms=200
 *
 * @keyword-cn 清理零向量, 旧数据兼容
 * @keyword-en clear-zero-embeddings, legacy-data-compat
 */

import { MongoClient } from 'mongodb';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 全 0 向量：至少有一个分量，且没有任何非 0 分量 */
const ZERO_VECTOR_FILTER = {
  'embedding.0': { $exists: true },
  embedding: { $not: { $elemMatch: { $ne: 0 } } },
};

/**
 * @description 本地开发时从 .env.development 补环境变量（不覆盖已有值）；容器里直接用容器环境变量。
 * @keyword-cn 加载开发环境变量, 不覆盖已有值
 * @keyword-en load-dev-env, keep-existing-env
 */
function loadEnv() {
  const envPath = join(projectRoot, '.env.development');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

/**
 * @description 读取命令行参数：`--name` 为开关，`--name=value` 为数值。
 * @keyword-cn 解析命令行参数, 脚本开关
 * @keyword-en parse-cli-args, script-flags
 */
function readArgs(argv) {
  const num = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    const value = hit ? Number(hit.split('=')[1]) : NaN;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    batch: Math.max(1, Math.min(5000, num('batch', 1000))),
    sleepMs: num('sleep-ms', 100),
  };
}

/**
 * @description 与应用 resolveMongoUri 相同的连接口径：优先 MONGODB_HOST/DB/USER/PASS（含 DEV_ 前缀兼容），否则 MONGODB_URI。
 * @keyword-cn 解析数据库连接, 与应用同口径
 * @keyword-en resolve-mongo-connection, same-as-app
 */
function resolveMongo(env) {
  const pick = (name) => env[name] ?? env[`DEV_${name}`];
  const host = pick('MONGODB_HOST');
  const db = pick('MONGODB_DB');
  const user = pick('MONGODB_USER');
  const pass = pick('MONGODB_PASS');
  const topo = String(pick('MONGODB_TOPOLOGY') ?? '').toLowerCase();
  const authSource = pick('MONGODB_AUTH_SOURCE') ?? db;
  const port = pick('MONGODB_PORT') ?? '27017';
  if (host && db && user && pass) {
    const qp = new URLSearchParams();
    if (authSource) qp.set('authSource', authSource);
    if (topo === 'standalone') qp.set('directConnection', 'true');
    return {
      uri: `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/?${qp.toString()}`,
      dbName: db,
    };
  }
  return {
    uri: env.MONGODB_URI ?? 'mongodb://localhost:27017',
    dbName: db ?? 'ai_system',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @description 统计一个集合的向量现状：总数、全 0、有效、空数组或缺失。
 * @keyword-cn 统计向量现状, 零向量计数
 * @keyword-en count-embedding-state, zero-vector-count
 */
async function countState(col) {
  const [total, zero, valid] = await Promise.all([
    col.estimatedDocumentCount(),
    col.countDocuments(ZERO_VECTOR_FILTER),
    col.countDocuments({ embedding: { $elemMatch: { $ne: 0 } } }),
  ]);
  return { total, zero, valid, empty: total - zero - valid };
}

/**
 * @description 按 _id 分批把一个集合里的全 0 向量改成空数组，有效向量不动。
 * @keyword-cn 分批清理零向量, 保留有效向量
 * @keyword-en batch-clear-zero-vectors, keep-valid-vectors
 */
async function clearCollection(col, args) {
  let lastId = null;
  let cleared = 0;
  for (;;) {
    const filter = lastId
      ? { ...ZERO_VECTOR_FILTER, _id: { $gt: lastId } }
      : ZERO_VECTOR_FILTER;
    const rows = await col
      .find(filter, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(args.batch)
      .toArray();
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]._id;
    if (!args.dryRun) {
      const res = await col.updateMany(
        { _id: { $in: rows.map((row) => row._id) }, ...ZERO_VECTOR_FILTER },
        { $set: { embedding: [] } },
      );
      cleared += res.modifiedCount ?? 0;
    } else {
      cleared += rows.length;
    }
    console.log(`  ${col.collectionName}: 已处理 ${cleared}`);
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }
  return cleared;
}

/**
 * @description 脚本入口：统计 gallery_images 与 gallery_groups 的向量现状，清理全 0 向量后再统计一次。
 * @keyword-cn 零向量清理入口, 前后对比
 * @keyword-en zero-vector-cleanup-entry, before-after-stats
 */
async function main() {
  loadEnv();
  const args = readArgs(process.argv.slice(2));
  const { uri, dbName } = resolveMongo(process.env);
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    console.log(`数据库: ${dbName}${args.dryRun ? '（dry-run，不写入）' : ''}`);
    for (const name of ['gallery_images', 'gallery_groups']) {
      const col = db.collection(name);
      const before = await countState(col);
      const sizeBefore = (await db.command({ collStats: name })).size;
      console.log(
        `${name}: 共 ${before.total}，全 0 向量 ${before.zero}，有效向量 ${before.valid}，空/无 ${before.empty}，数据量 ${(sizeBefore / 1048576).toFixed(1)}MB`,
      );
      const cleared = await clearCollection(col, args);
      if (args.dryRun) {
        console.log(`${name}: 将清理 ${cleared} 条`);
        continue;
      }
      const after = await countState(col);
      const sizeAfter = (await db.command({ collStats: name })).size;
      console.log(
        `${name}: 清理 ${cleared} 条 → 全 0 ${after.zero}，有效 ${after.valid}，空 ${after.empty}，数据量 ${(sizeAfter / 1048576).toFixed(1)}MB`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('清理失败:', error);
  process.exit(1);
});
