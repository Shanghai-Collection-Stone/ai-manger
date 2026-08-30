/**
 * @title 回收孤儿文章库工作区 Purge Orphan Article-Library Workspaces
 * @description 清理「文章库已删除、专属工作区还留着」的历史数据。
 *   2026-08-30 之前的 `ArticleLibraryService.delete` 只删库和文章，不删随库创建的专属工作区，
 *   工作区继续占着 SuperClaw 节点的 `allocatedCapacity` 槽位；服务重启时
 *   `reconcileAllocatedCapacity` 又按现存 `workspaces` 汇总，孤儿记录被重新计入，
 *   槽位只增不减，最终建库时报 `SUPER_CLAW_CAPACITY_EXCEEDED`。
 *
 *   判定口径：名称形如 `文章库 · xxx`（建库时固定生成的命名）且 `_id` 不被任何
 *   `article_libraries.workspaceId` 引用。默认跳过有网盘用量或仍有未结束 Todo 的工作区，
 *   要连这些一起删加 `--force`。
 *
 *   删除后按剩余 `workspaces` 重算每个节点的 `allocatedCapacity`，不需要重启服务。
 *
 * 使用方式：
 *   node src/modules/article-library/scripts/purge-orphan-library-workspaces.mjs            # 只报告，不删（默认）
 *   node src/modules/article-library/scripts/purge-orphan-library-workspaces.mjs --apply    # 实际删除并重算槽位
 *   node src/modules/article-library/scripts/purge-orphan-library-workspaces.mjs --apply --force
 *   node src/modules/article-library/scripts/purge-orphan-library-workspaces.mjs --db=ai_system
 *
 * @keyword-cn 回收孤儿工作区, 释放节点槽位, 容量校准
 * @keyword-en purge-orphan-workspaces, release-node-slots, capacity-reconciliation
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

/** @type {RegExp} 建库时固定生成的工作区名称前缀。 */
const LIBRARY_WORKSPACE_NAME = /^文章库 · /;
/** @type {string[]} 视为「仍在跑」的 Todo 状态，命中则默认不删对应工作区。 */
const ACTIVE_TODO_STATUS = ['pending', 'in_progress', 'waiting_user'];

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
 * @returns {{apply: boolean, force: boolean, dbName?: string}} 选项。
 */
export function parseArgs(argv) {
  const flags = new Set(
    argv.filter((item) => item.startsWith('--') && !item.includes('=')),
  );
  const readValue = (key) => {
    const hit = argv.find((item) => item.startsWith(`--${key}=`));
    return hit ? hit.slice(key.length + 3) : undefined;
  };
  return {
    dbName: readValue('db'),
    apply: flags.has('--apply'),
    force: flags.has('--force'),
  };
}

/**
 * @description 找出名字像文章库工作区、却没有任何文章库引用的孤儿工作区，并标注是否可安全删除。
 * @keyword-cn 查找孤儿工作区, 安全性标注
 * @keyword-en find-orphan-workspaces, safety-annotation
 * @param {import('mongodb').Db} db 数据库句柄。
 * @returns {Promise<Array<Record<string, unknown>>>} 候选列表。
 */
export async function findOrphanWorkspaces(db) {
  const libraries = await db
    .collection('article_libraries')
    .find({}, { projection: { workspaceId: 1 } })
    .toArray();
  const referenced = new Set(
    libraries.map((item) => String(item.workspaceId ?? '')).filter(Boolean),
  );
  const workspaces = await db
    .collection('workspaces')
    .find({ name: LIBRARY_WORKSPACE_NAME })
    .toArray();
  const rows = [];
  for (const ws of workspaces) {
    const id = String(ws._id);
    if (referenced.has(id)) continue;
    const activeTodos = await db.collection('todos').countDocuments({
      workspaceId: id,
      status: { $in: ACTIVE_TODO_STATUS },
    });
    const usedBytes = Number(ws.usedBytes ?? 0);
    rows.push({
      workspaceId: id,
      name: String(ws.name ?? ''),
      tenantId: String(ws.tenantId ?? '-'),
      superClawId: String(ws.superClawId ?? '-'),
      usedBytes,
      activeTodos,
      blocked: usedBytes > 0 || activeTodos > 0,
    });
  }
  return rows;
}

/**
 * @description 按现存 workspaces 重算每个 SuperClaw 节点的已占槽位，等价于服务启动时的容量校准。
 * @keyword-cn 重算节点槽位, 容量校准
 * @keyword-en recompute-node-slots, capacity-reconciliation
 * @param {import('mongodb').Db} db 数据库句柄。
 * @returns {Promise<Array<{node: string, capacity: number, before: number, after: number}>>} 每个节点的槽位变化。
 */
export async function recomputeAllocatedCapacity(db) {
  const nodes = await db.collection('super_claws').find({}).toArray();
  const grouped = await db
    .collection('workspaces')
    .aggregate([
      { $match: { superClawId: { $type: 'string' } } },
      { $group: { _id: '$superClawId', capacity: { $sum: 1 } } },
    ])
    .toArray();
  const counts = new Map(
    grouped.map((item) => [String(item._id), item.capacity]),
  );
  const report = [];
  for (const node of nodes) {
    const id = String(node._id);
    const after = counts.get(id) ?? 0;
    const before = Number(node.allocatedCapacity ?? 0);
    if (before !== after) {
      await db
        .collection('super_claws')
        .updateOne(
          { _id: node._id },
          { $set: { allocatedCapacity: after, updatedAt: new Date() } },
        );
    }
    report.push({
      node: `${node.name ?? '-'} (${id})`,
      capacity: Number(node.capacity ?? 0),
      before,
      after,
    });
  }
  return report;
}

/**
 * @description 脚本入口：列出孤儿工作区，`--apply` 时删除成员与工作区并重算节点槽位。
 * @keyword-cn 回收孤儿工作区入口, 脚本主流程
 * @keyword-en purge-orphan-entry, script-main
 * @returns {Promise<void>}
 */
export async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const conn = resolveMongoConnection();
  const dbName = args.dbName ?? conn.dbName;
  const client = await MongoClient.connect(conn.uri);
  const db = client.db(dbName);
  console.log(`数据库: ${dbName} @ ${conn.uri.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`模式: ${args.apply ? '实际删除' : '仅报告（加 --apply 才会删）'}`);

  const rows = await findOrphanWorkspaces(db);
  if (!rows.length) {
    console.log('\n没有发现孤儿文章库工作区。');
    if (args.apply) console.table(await recomputeAllocatedCapacity(db));
    await client.close();
    return;
  }
  console.table(rows);

  const deletable = args.force ? rows : rows.filter((row) => !row.blocked);
  console.log('\n=== Summary ===');
  console.log(`  孤儿工作区: ${rows.length}`);
  console.log(`  可回收: ${deletable.length}`);
  console.log(
    `  跳过（有网盘用量或未结束 Todo，用 --force 强删）: ${rows.length - deletable.length}`,
  );

  if (!args.apply) {
    console.log('\n未做任何修改。确认无误后加 --apply 执行。');
    await client.close();
    return;
  }

  let removed = 0;
  for (const row of deletable) {
    await db
      .collection('workspace_members')
      .deleteMany({ workspaceId: row.workspaceId });
    const res = await db
      .collection('workspaces')
      .deleteOne({ _id: new ObjectId(row.workspaceId) });
    if (res.deletedCount === 1) removed += 1;
  }
  console.log(`\n已删除工作区: ${removed}`);
  console.log('重算节点槽位：');
  console.table(await recomputeAllocatedCapacity(db));
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
