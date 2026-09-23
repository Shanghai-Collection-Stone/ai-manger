/**
 * @title 回收一次性 Checkpoint Purge Ephemeral LangGraph Checkpoints
 * @description 清理 `runWithMessages` / `stream` 为一次性内部调用生成的随机 thread_id
 *   所留下的 LangGraph 快照。这类 thread_id 形如 `msg_<ts>_<rand>` / `stream_<ts>_<rand>`，
 *   写入后永远不会再被读取，却每次往 `checkpoints`（单文档约 20-30KB 的 binData）与
 *   `checkpoint_writes` upsert 数条记录。
 *
 *   叠加 `MongoDBSaver` 从不建索引这一点，每次写入都要 COLLSCAN 全表：线上出现过
 *   单次 upsert `docsExamined=29547`、`bytesRead=265MB`、`durationMillis=2719` 的慢查询，
 *   磁盘 IO 被打满并拖慢同库所有查询（含 `admin_ai_providers` 这类小表）。
 *
 *   索引已由 `AgentService.ensureCheckpointIndexes()` 在启动时补建，写入放大已由
 *   `AgentConfig.ephemeral` 从源头止住；本脚本负责回收改动之前的存量垃圾。
 *
 *   判定口径：`thread_id` 命中 `msg_` / `stream_` 前缀。真实会话的 thread_id 来自
 *   chat 会话 sid、context sessionId 与 `frontend:<hash>`，不会命中这两个前缀。
 *   `--before-days=N` 可只删 N 天前的（按 `_id` 内嵌时间戳判定），默认全删。
 *
 * 使用方式：
 *   node src/modules/ai-agent/scripts/purge-ephemeral-checkpoints.mjs                    # 只报告，不删（默认）
 *   node src/modules/ai-agent/scripts/purge-ephemeral-checkpoints.mjs --apply            # 实际删除
 *   node src/modules/ai-agent/scripts/purge-ephemeral-checkpoints.mjs --apply --before-days=1
 *   node src/modules/ai-agent/scripts/purge-ephemeral-checkpoints.mjs --apply --db=ai_system
 *
 * @keyword-cn 回收一次性快照, checkpoint膨胀, 慢查询治理
 * @keyword-en purge-ephemeral-checkpoints, checkpoint-bloat, slow-query-cleanup
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

/** @type {RegExp} AgentService 为一次性运行生成的 thread_id 前缀。 */
const EPHEMERAL_THREAD_ID = /^(msg|stream)_\d+_/;
/** @type {string[]} LangGraph MongoDBSaver 使用的两个集合。 */
const CHECKPOINT_COLLECTIONS = ['checkpoints', 'checkpoint_writes'];

/**
 * @description 按 migrate-mongo-config 的顺序载入 .env 及开发态覆盖文件。
 * @keyword-cn 载入环境变量, 开发环境覆盖
 * @keyword-en load-env-files, dev-env-override
 * @returns {void}
 */
export function loadEnvFiles() {
  if (existsSync('.env')) dotenv.config({ path: '.env', override: false });
  const env = String(process.env.NODE_ENV ?? '').toLowerCase();
  if (env !== 'development' && env !== 'dev') return;
  if (existsSync('.env.development')) {
    dotenv.config({ path: '.env.development', override: false });
  }
  if (existsSync('.env.local')) {
    dotenv.config({ path: '.env.local', override: true });
  }
}

/**
 * @description 复刻 `shared/mongo/resolve-mongo-uri` 的解析优先级，脚本不经过 Nest 容器。
 * @keyword-cn 解析数据库连接, 复用连接优先级
 * @keyword-en resolve-mongo-connection, shared-uri-priority
 * @returns {{uri: string, dbName: string}} 连接串与库名。
 */
export function resolveMongoConnection() {
  const pick = (name) =>
    process.env[`MONGODB_${name}`] ?? process.env[`DEV_MONGODB_${name}`];
  const host = pick('HOST');
  const db = pick('DB');
  const user = pick('USER');
  const pass = pick('PASS');
  const port = pick('PORT') ?? '27017';
  const topology = String(pick('TOPOLOGY') ?? '').toLowerCase();
  const authSource = pick('AUTH_SOURCE') ?? db;
  if (host && db && user && pass) {
    const qp = new URLSearchParams();
    if (authSource) qp.set('authSource', authSource);
    if (topology === 'standalone') qp.set('directConnection', 'true');
    const uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/?${qp.toString()}`;
    return { uri, dbName: db };
  }
  return {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
    dbName: db ?? 'ai_system',
  };
}

/**
 * @description 解析 `--flag` 与 `--key=value` 形式的命令行参数。
 * @keyword-cn 解析命令行参数, 脚本选项
 * @keyword-en parse-cli-args, script-options
 * @param {string[]} argv 原始参数数组。
 * @returns {{apply: boolean, dbName?: string, beforeDays?: number}} 选项。
 */
export function parseArgs(argv) {
  const flags = new Set(
    argv.filter((item) => item.startsWith('--') && !item.includes('=')),
  );
  const readValue = (key) => {
    const hit = argv.find((item) => item.startsWith(`--${key}=`));
    return hit ? hit.slice(key.length + 3) : undefined;
  };
  const rawDays = readValue('before-days');
  const beforeDays = rawDays === undefined ? undefined : Number(rawDays);
  return {
    dbName: readValue('db'),
    apply: flags.has('--apply'),
    beforeDays:
      Number.isFinite(beforeDays) && beforeDays > 0 ? beforeDays : undefined,
  };
}

/**
 * @description 构造匹配一次性快照的删除条件，可选按 `_id` 内嵌时间戳限定更早的数据。
 *   `checkpoints` / `checkpoint_writes` 没有任何时间字段，只能借 ObjectId 判定写入时间。
 * @keyword-cn 构造清理条件, ObjectId时间戳
 * @keyword-en build-purge-filter, objectid-timestamp
 * @param {number | undefined} beforeDays 只删这么多天之前的数据，省略表示全删。
 * @returns {Record<string, unknown>} MongoDB 查询条件。
 */
export function buildPurgeFilter(beforeDays) {
  const filter = { thread_id: EPHEMERAL_THREAD_ID };
  if (beforeDays === undefined) return filter;
  const cutoff = new Date(Date.now() - beforeDays * 24 * 60 * 60 * 1000);
  filter._id = { $lt: ObjectId.createFromTime(Math.floor(cutoff / 1000)) };
  return filter;
}

/**
 * @description 统计两个集合里待清理与总量的文档数及占用字节，供 --apply 前确认。
 * @keyword-cn 统计清理规模, 集合占用
 * @keyword-en report-purge-scope, collection-size
 * @param {import('mongodb').Db} db 数据库句柄。
 * @param {Record<string, unknown>} filter 删除条件。
 * @returns {Promise<Array<Record<string, unknown>>>} 每个集合一行的报告。
 */
export async function reportPurgeScope(db, filter) {
  const rows = [];
  for (const name of CHECKPOINT_COLLECTIONS) {
    const collection = db.collection(name);
    const total = await collection.estimatedDocumentCount();
    const matched = await collection.countDocuments(filter);
    let storageMB = '-';
    try {
      const stats = await db.command({ collStats: name });
      storageMB = (Number(stats.size ?? 0) / 1024 / 1024).toFixed(1);
    } catch {
      // collStats 在部分托管实例上不可用，只影响展示
    }
    rows.push({
      collection: name,
      total,
      ephemeral: matched,
      keep: total - matched,
      dataMB: storageMB,
    });
  }
  return rows;
}

/**
 * @description 分批删除命中的一次性快照，避免一次性 deleteMany 长时间持锁。
 * @keyword-cn 分批删除, 避免长事务
 * @keyword-en batched-delete, avoid-long-lock
 * @param {import('mongodb').Db} db 数据库句柄。
 * @param {string} name 集合名。
 * @param {Record<string, unknown>} filter 删除条件。
 * @param {number} batchSize 单批文档数。
 * @returns {Promise<number>} 实际删除数量。
 */
export async function purgeInBatches(db, name, filter, batchSize = 2000) {
  const collection = db.collection(name);
  let removed = 0;
  for (;;) {
    const batch = await collection
      .find(filter, { projection: { _id: 1 } })
      .limit(batchSize)
      .toArray();
    if (batch.length === 0) break;
    const res = await collection.deleteMany({
      _id: { $in: batch.map((doc) => doc._id) },
    });
    removed += res.deletedCount ?? 0;
    process.stdout.write(`  ${name}: 已删除 ${removed}\r`);
  }
  if (removed > 0) process.stdout.write('\n');
  return removed;
}

/**
 * @description 脚本入口：报告规模，--apply 时分批清理并提示 compact 回收磁盘。
 * @keyword-cn 脚本入口, 清理流程
 * @keyword-en script-entry, purge-flow
 * @returns {Promise<void>}
 */
export async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const conn = resolveMongoConnection();
  const dbName = args.dbName ?? conn.dbName;
  const client = new MongoClient(conn.uri);
  await client.connect();
  const db = client.db(dbName);

  const filter = buildPurgeFilter(args.beforeDays);
  console.log(`库: ${dbName}`);
  console.log(
    `条件: thread_id 匹配 ${EPHEMERAL_THREAD_ID}${
      args.beforeDays ? `，且写入于 ${args.beforeDays} 天前` : '（不限时间）'
    }`,
  );
  const rows = await reportPurgeScope(db, filter);
  console.table(rows);

  if (!args.apply) {
    console.log('\n未做任何修改。确认无误后加 --apply 执行。');
    await client.close();
    return;
  }

  console.log('\n开始清理：');
  let removed = 0;
  for (const name of CHECKPOINT_COLLECTIONS) {
    removed += await purgeInBatches(db, name, filter);
  }
  console.log(`\n共删除文档: ${removed}`);
  console.log(
    '提示: WiredTiger 不会自动把空洞还给文件系统。需要真正回收磁盘时，' +
      '在维护窗口对两个集合执行 db.runCommand({ compact: "checkpoints" })。',
  );
  await client.close();
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
