/**
 * @title Migrate Gallery Tags To Links
 * @description 旧数据兼容：把 gallery_images 上残留的 tags 数组迁到 gallery_tags（标签字典）+ gallery_image_tags（图片标签关联），
 *   每批先写关联、再把该批图片上的 tags 数组移走；可重复执行，跑过的图片不会再处理，中断后直接重跑即可续上。
 *   标签规整口径与 GalleryService.normalizeTags 一致（去空白、去开头井号、去重），作用域与 resolveGalleryTagScopeKey 一致。
 *
 * 使用方式（在应用容器内执行，连接参数与应用相同）：
 *   node scripts/migrate-gallery-tags-to-links.mjs --dry-run          # 只统计不写入
 *   node scripts/migrate-gallery-tags-to-links.mjs                    # 正式迁移
 *   node scripts/migrate-gallery-tags-to-links.mjs --batch=300 --sleep-ms=200 --limit=1000
 *   node scripts/migrate-gallery-tags-to-links.mjs --verify           # 核对迁移结果
 *   node scripts/migrate-gallery-tags-to-links.mjs --verify --prune-orphans   # 顺带删除图片已不存在的关联
 *   node scripts/migrate-gallery-tags-to-links.mjs --restore=storage/gallery-tags-backup-xxx.jsonl  # 回滚旧代码前把数组写回
 *
 * 正式迁移默认先把每批图片的旧 tags 数组追加备份到 `storage/gallery-tags-backup-<时间>.jsonl`（`--backup=<路径>` 指定，`--no-backup` 关闭）；
 * 容器里 `/app/storage` 是持久化卷，容器重建后备份仍在。
 *
 * @keyword-cn 图库标签迁移, 旧数据兼容
 * @keyword-en migrate-gallery-tags, legacy-data-compat
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

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
 * @description 读取命令行参数：`--name` 为开关，`--name=value` 为取值。
 * @keyword-cn 解析命令行参数, 脚本开关
 * @keyword-en parse-cli-args, script-flags
 */
function readArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const num = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    const value = hit ? Number(hit.split('=')[1]) : NaN;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  };
  const str = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3).trim() || undefined : undefined;
  };
  return {
    dryRun: flag('dry-run'),
    verify: flag('verify'),
    pruneOrphans: flag('prune-orphans'),
    noBackup: flag('no-backup'),
    backup: str('backup'),
    restore: str('restore'),
    batch: Math.max(1, Math.min(2000, num('batch', 500))),
    sleepMs: num('sleep-ms', 100),
    limit: num('limit', 0),
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

/**
 * @description 与 GalleryService.normalizeTags 相同的标签规整：数组或逗号/空白分隔字符串，去空白、去开头井号、去重、去空。
 * @keyword-cn 标签规整, 标签去重
 * @keyword-en tag-normalization, tag-deduplication
 */
function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(/[,\t\n\r\s]+/g)
      : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const t = String(raw ?? '')
      .trim()
      .replace(/^#+/, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * @description 与 resolveGalleryTagScopeKey 相同的作用域键：有租户为 `tenant:<id>`，无租户为 `platform`。
 * @keyword-cn 标签作用域键, 租户隔离
 * @keyword-en resolve-tag-scope-key, tenant-isolation
 */
function scopeKeyOf(tenantId) {
  const tid = String(tenantId ?? '').trim();
  return tid ? `tenant:${tid}` : 'platform';
}

/**
 * @description 判断批量写错误是否全部是唯一索引冲突（重复执行或并发写入时出现，可忽略）。
 * @keyword-cn 唯一冲突判断, 重复执行
 * @keyword-en duplicate-key-check, rerun-safe
 */
function isDuplicateKeyOnly(error) {
  const list = Array.isArray(error?.writeErrors)
    ? error.writeErrors
    : error?.writeErrors
      ? [error.writeErrors]
      : [];
  if (list.length > 0) return list.every((item) => item?.code === 11000);
  return error?.code === 11000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @description 建立与 GalleryTagLinkService.ensureIndexes 相同的索引，唯一索引保证脚本可重复执行。
 * @keyword-cn 建立关联索引, 可重复执行
 * @keyword-en ensure-link-indexes, rerun-safe
 */
async function ensureIndexes(tagsCol, linksCol) {
  await tagsCol.createIndex({ scopeKey: 1, name: 1 }, { unique: true });
  await linksCol.createIndex({ imageId: 1, tagId: 1 }, { unique: true });
  await linksCol.createIndex({ scopeKey: 1, tagId: 1, imageId: 1 });
}

/**
 * @description 确保作用域内标签都在字典里并返回 ID（带进程内缓存）；dry-run 只统计将新建的标签，不写库。
 * @keyword-cn 确保标签存在, 标签ID缓存
 * @keyword-en ensure-tag-ids, tag-id-cache
 */
async function ensureTagIds(tagsCol, scopeKey, names, cache, stats, dryRun) {
  const key = (name) => `${scopeKey}\u0000${name}`;
  const missing = names.filter((name) => !cache.has(key(name)));
  if (missing.length === 0) return;
  const found = await tagsCol
    .find(
      { scopeKey, name: { $in: missing } },
      { projection: { _id: 1, name: 1 } },
    )
    .toArray();
  for (const row of found) cache.set(key(row.name), row._id);
  const toCreate = missing.filter((name) => !cache.has(key(name)));
  if (toCreate.length === 0) return;
  stats.tagsCreated += toCreate.length;
  if (dryRun) {
    for (const name of toCreate) cache.set(key(name), new ObjectId());
    return;
  }
  const now = new Date();
  try {
    await tagsCol.bulkWrite(
      toCreate.map((name) => ({
        updateOne: {
          filter: { scopeKey, name },
          update: { $setOnInsert: { createdAt: now, updatedAt: now } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    if (!isDuplicateKeyOnly(error)) throw error;
  }
  const created = await tagsCol
    .find(
      { scopeKey, name: { $in: toCreate } },
      { projection: { _id: 1, name: 1 } },
    )
    .toArray();
  for (const row of created) cache.set(key(row.name), row._id);
}

/**
 * @description 处理一批仍带 tags 数组的图片：先备份旧数组，再把关联整体同步为数组内容（补缺、删多、更新顺序），成功后移走这批图片的数组。
 * @keyword-cn 迁移一批图片, 先写关联后移数组
 * @keyword-en migrate-image-batch, links-before-unset
 */
async function migrateBatch(cols, docs, cache, stats, dryRun, backupPath) {
  const { images, tags, links } = cols;
  const valid = docs.filter((doc) => Number.isFinite(Number(doc.id)));
  stats.skippedNoId += docs.length - valid.length;
  const plans = valid.map((doc) => ({
    _id: doc._id,
    imageId: Number(doc.id),
    scopeKey: scopeKeyOf(doc.tenantId),
    names: normalizeTags(doc.tags),
  }));
  const namesByScope = new Map();
  for (const plan of plans) {
    const set = namesByScope.get(plan.scopeKey) ?? new Set();
    plan.names.forEach((name) => set.add(name));
    namesByScope.set(plan.scopeKey, set);
  }
  for (const [scopeKey, names] of namesByScope) {
    await ensureTagIds(tags, scopeKey, Array.from(names), cache, stats, dryRun);
  }
  const existing = await links
    .find(
      { imageId: { $in: plans.map((plan) => plan.imageId) } },
      { projection: { _id: 0, imageId: 1, tagId: 1, order: 1, scopeKey: 1 } },
    )
    .toArray();
  const existingByImage = new Map();
  for (const row of existing) {
    existingByImage.set(row.imageId, [
      ...(existingByImage.get(row.imageId) ?? []),
      row,
    ]);
  }
  const now = new Date();
  const ops = [];
  for (const plan of plans) {
    const desired = plan.names.map((name, order) => ({
      tagId: cache.get(`${plan.scopeKey}\u0000${name}`),
      order,
    }));
    const desiredKeys = new Set(desired.map((d) => d.tagId.toHexString()));
    const current = existingByImage.get(plan.imageId) ?? [];
    const currentByKey = new Map(
      current.map((row) => [row.tagId.toHexString(), row]),
    );
    stats.linksExpected += desired.length;
    for (const item of desired) {
      const row = currentByKey.get(item.tagId.toHexString());
      if (row && row.order === item.order && row.scopeKey === plan.scopeKey)
        continue;
      stats.linksUpserted += 1;
      ops.push({
        updateOne: {
          filter: { imageId: plan.imageId, tagId: item.tagId },
          update: {
            $set: { order: item.order, scopeKey: plan.scopeKey },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }
    const stale = current
      .filter((row) => !desiredKeys.has(row.tagId.toHexString()))
      .map((row) => row.tagId);
    if (stale.length > 0) {
      stats.linksRemoved += stale.length;
      ops.push({
        deleteMany: {
          filter: { imageId: plan.imageId, tagId: { $in: stale } },
        },
      });
    }
    const scope = stats.byScope.get(plan.scopeKey) ?? { images: 0, links: 0 };
    scope.images += 1;
    scope.links += desired.length;
    stats.byScope.set(plan.scopeKey, scope);
  }
  if (dryRun) return;
  if (backupPath && valid.length > 0) {
    appendFileSync(
      backupPath,
      valid
        .map((doc) =>
          JSON.stringify({
            id: doc.id,
            tenantId: doc.tenantId ?? null,
            tags: doc.tags,
          }),
        )
        .join('\n') + '\n',
    );
  }
  if (ops.length > 0) {
    try {
      await links.bulkWrite(ops, { ordered: false });
    } catch (error) {
      if (!isDuplicateKeyOnly(error)) throw error;
    }
  }
  const res = await images.updateMany(
    { _id: { $in: plans.map((plan) => plan._id) }, tags: { $exists: true } },
    { $unset: { tags: '' } },
  );
  stats.arraysRemoved += res.modifiedCount ?? 0;
}

/**
 * @description 核对迁移结果：剩余旧数组数、字典与关联行数、各作用域关联数，以及图片已删除的孤立关联（可选删除）。
 * @keyword-cn 核对迁移结果, 孤立关联清理
 * @keyword-en verify-tag-migration, prune-orphan-links
 */
async function verify(cols, pruneOrphans) {
  const { images, tags, links } = cols;
  const legacy = await images.countDocuments({ tags: { $exists: true } });
  const [tagCount, linkCount] = await Promise.all([
    tags.estimatedDocumentCount(),
    links.estimatedDocumentCount(),
  ]);
  console.log(
    `仍带 tags 数组的图片: ${legacy}${legacy === 0 ? '（已全部迁完）' : '（还需再跑一次迁移）'}`,
  );
  console.log(
    `标签字典 gallery_tags: ${tagCount} 行；关联 gallery_image_tags: ${linkCount} 行`,
  );
  const perScope = await links
    .aggregate([
      {
        $group: {
          _id: '$scopeKey',
          links: { $sum: 1 },
          images: { $addToSet: '$imageId' },
        },
      },
      { $project: { links: 1, images: { $size: '$images' } } },
      { $sort: { links: -1 } },
    ])
    .toArray();
  console.log('各作用域（关联行数 / 有标签的图片数）:');
  for (const row of perScope)
    console.log(`  ${row._id}: ${row.links} / ${row.images}`);
  const linkedIds = (await links.distinct('imageId')).map(Number);
  const orphanIds = [];
  for (let i = 0; i < linkedIds.length; i += 5000) {
    const chunk = linkedIds.slice(i, i + 5000);
    const alive = new Set(
      (
        await images
          .find({ id: { $in: chunk } }, { projection: { _id: 0, id: 1 } })
          .toArray()
      ).map((row) => Number(row.id)),
    );
    for (const id of chunk) if (!alive.has(id)) orphanIds.push(id);
  }
  console.log(`图片已不存在的孤立关联涉及图片: ${orphanIds.length}`);
  if (pruneOrphans && orphanIds.length > 0) {
    const res = await links.deleteMany({ imageId: { $in: orphanIds } });
    console.log(`已删除孤立关联: ${res.deletedCount} 行`);
  }
}

/**
 * @description 回滚用：从迁移备份文件把旧 tags 数组按图片 id 写回 gallery_images（关联表不动，新代码迁移过渡期会优先读数组）。
 * @keyword-cn 回写旧标签数组, 迁移回滚
 * @keyword-en restore-legacy-tags, migration-rollback
 */
async function restore(cols, file) {
  if (!existsSync(file)) throw new Error(`备份文件不存在: ${file}`);
  const rows = readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((row) => Number.isFinite(Number(row.id)));
  let restored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await cols.images.bulkWrite(
      chunk.map((row) => ({
        updateOne: {
          filter: { id: Number(row.id) },
          update: { $set: { tags: row.tags } },
        },
      })),
      { ordered: false },
    );
    restored += res.modifiedCount ?? 0;
  }
  console.log(`备份 ${rows.length} 条，写回 tags 数组 ${restored} 张图片`);
}

/**
 * @description 脚本入口：连接数据库、建索引，按 _id 顺序分批迁移仍带 tags 数组的图片，或执行核对、回滚写回。
 * @keyword-cn 迁移脚本入口, 分批迁移
 * @keyword-en migration-entry, batched-migration
 */
async function main() {
  loadEnv();
  const args = readArgs(process.argv.slice(2));
  const { uri, dbName } = resolveMongo(process.env);
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const cols = {
      images: db.collection('gallery_images'),
      tags: db.collection('gallery_tags'),
      links: db.collection('gallery_image_tags'),
    };
    console.log(`数据库: ${dbName}${args.dryRun ? '（dry-run，不写入）' : ''}`);
    if (args.restore) {
      await restore(cols, resolve(process.cwd(), args.restore));
      return;
    }
    if (!args.dryRun) await ensureIndexes(cols.tags, cols.links);
    if (args.verify) {
      await verify(cols, args.pruneOrphans);
      return;
    }
    const pending = await cols.images.countDocuments({
      tags: { $exists: true },
    });
    console.log(`待迁移（仍带 tags 数组）的图片: ${pending}`);
    let backupPath = null;
    if (!args.dryRun && !args.noBackup && pending > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = resolve(
        process.cwd(),
        args.backup ?? join('storage', `gallery-tags-backup-${stamp}.jsonl`),
      );
      mkdirSync(dirname(backupPath), { recursive: true });
      console.log(`旧 tags 数组备份到: ${backupPath}`);
    }
    const stats = {
      processed: 0,
      skippedNoId: 0,
      tagsCreated: 0,
      linksExpected: 0,
      linksUpserted: 0,
      linksRemoved: 0,
      arraysRemoved: 0,
      byScope: new Map(),
    };
    const cache = new Map();
    let lastId = null;
    const startedAt = Date.now();
    for (;;) {
      const filter = { tags: { $exists: true } };
      if (lastId) filter._id = { $gt: lastId };
      const docs = await cols.images
        .find(filter, { projection: { _id: 1, id: 1, tenantId: 1, tags: 1 } })
        .sort({ _id: 1 })
        .limit(args.batch)
        .toArray();
      if (docs.length === 0) break;
      await migrateBatch(cols, docs, cache, stats, args.dryRun, backupPath);
      stats.processed += docs.length;
      lastId = docs[docs.length - 1]._id;
      console.log(`  已处理 ${stats.processed}/${pending}`);
      if (args.limit && stats.processed >= args.limit) break;
      if (args.sleepMs > 0) await sleep(args.sleepMs);
    }
    console.log('---- 汇总 ----');
    console.log(
      `处理图片: ${stats.processed}（缺少 id 跳过: ${stats.skippedNoId}）`,
    );
    console.log(`新建标签: ${stats.tagsCreated}`);
    console.log(
      `应有关联: ${stats.linksExpected}，写入/更新: ${stats.linksUpserted}，删除多余: ${stats.linksRemoved}`,
    );
    if (!args.dryRun) console.log(`移走 tags 数组: ${stats.arraysRemoved}`);
    for (const [scopeKey, row] of stats.byScope) {
      console.log(`  ${scopeKey}: 图片 ${row.images}，关联 ${row.links}`);
    }
    console.log(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    if (!args.dryRun) {
      const left = await cols.images.countDocuments({
        tags: { $exists: true },
      });
      console.log(
        left === 0
          ? '旧 tags 数组已全部迁完。'
          : `还有 ${left} 张图片带 tags 数组（--limit 截断或有缺 id 的数据），可再跑一次。`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('迁移失败:', error);
  process.exit(1);
});
