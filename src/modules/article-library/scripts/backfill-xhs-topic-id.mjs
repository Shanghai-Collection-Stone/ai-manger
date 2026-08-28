/**
 * @title 回填文章来源子选题 ID Backfill Article xhsTopicId
 * @description 修复被小红书发布回调整体覆盖 `meta` 而丢失 `meta.xhsTopicId` 的历史文章。
 *   2026-08-27 之前的 `updatePublishStatus` 直接用回调 payload 覆盖 `meta`，
 *   导致 `source: 'xhs-topic'` 的文章一旦发布成功就丢掉选题关联，
 *   进而 `/api/xhs-topic-data/topics` 查不到子选题、数据监控页无法开启监控、
 *   `notifyCrawlSchedule` 也建不出调度行。
 *
 *   恢复顺序（命中即停）：
 *     1. `xhs_topic_crawl_schedules.articleId` → `topicId`（确定性映射）
 *     2. 同库兄弟文章的 `meta.xhsParentTopicId` 缩小候选集后按标题精确匹配
 *     3. 同候选集内按正文前缀匹配（标题被改过时兜底）
 *   只 `$set` 选题相关字段，回调写入的 `NoteId` / `MiniAppSessionInfo` 原样保留。
 *   回填完成后清空 `counters` 里的 `xhs_topic_crawl_schedule_backfill` 标记，
 *   服务下次启动会用自身逻辑把这些文章补进抓取调度表。
 *
 * 使用方式：
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs --dry-run
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs --library=22
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs --article=49
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs --keep-marker
 *   node src/modules/article-library/scripts/backfill-xhs-topic-id.mjs --db=ai_system   # 容器里只有 MONGODB_URI 时指定库名
 *
 * @keyword-cn 回填选题关联, 修复被覆盖的meta, 抓取调度补建
 * @keyword-en backfill-xhs-topic-id, repair-overwritten-meta, crawl-schedule-recovery
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

/** @type {number} 正文比对使用的归一化前缀长度。 */
const BODY_MATCH_PREFIX = 120;
/** @type {number} 允许参与正文比对的最短归一化长度，太短容易误判。 */
const BODY_MATCH_MIN_LENGTH = 40;
/** @type {number} 标题包含式兜底比对要求的最短归一化长度。 */
const TITLE_CONTAIN_MIN_LENGTH = 8;
/** @type {string} 抓取调度表一次性回填标记，在 counters 集合里。 */
const SCHEDULE_BACKFILL_MARKER = 'xhs_topic_crawl_schedule_backfill';

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
  const pick = (name) => process.env[`MONGODB_${name}`] ?? process.env[`DEV_MONGODB_${name}`];
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
 * @returns {{dryRun: boolean, keepMarker: boolean, verbose: boolean, limit: number, libraryId?: number, articleId?: number, dbName?: string}} 选项。
 */
export function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith('--') && !item.includes('=')));
  const readValue = (key) => {
    const hit = argv.find((item) => item.startsWith(`--${key}=`));
    return hit ? hit.slice(key.length + 3) : undefined;
  };
  const readNumber = (key) => {
    const raw = readValue(key);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    dbName: readValue('db'),
    dryRun: flags.has('--dry-run'),
    keepMarker: flags.has('--keep-marker'),
    verbose: flags.has('--verbose'),
    limit: readNumber('limit') ?? 0,
    libraryId: readNumber('library'),
    articleId: readNumber('article'),
  };
}

/**
 * @description 归一化标题或正文：去掉空白、emoji、变体选择符与常见标点后转小写，用于跨端比对。
 * @keyword-cn 文本归一化, 标题比对
 * @keyword-en normalize-text, title-comparison
 * @param {unknown} value 原始文本。
 * @returns {string} 归一化后的字符串。
 */
export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[︎️‍]/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

/**
 * @description 读取 meta 里可用的来源子选题 ID，与服务端 `readArticleTopicId` 判定一致。
 * @keyword-cn 读取选题ID, 判定有效关联
 * @keyword-en read-topic-id, valid-link-check
 * @param {Record<string, unknown> | undefined} meta 文章 meta。
 * @returns {number | undefined} 合法的子选题 ID。
 */
export function readTopicId(meta) {
  const topicId = Number(meta?.xhsTopicId);
  return Number.isInteger(topicId) && topicId > 0 ? topicId : undefined;
}

/**
 * @description 判断文章与子选题是否属于同一租户，跨租户绝不匹配。
 *   两个集合的 `userId` 不同源（文章存登录名、选题存用户 ObjectId），
 *   后端 `listStoredArticleTopicIds` 同样只按 tenantId 关联，这里保持一致。
 * @keyword-cn 租户归属校验, 跨租户防护
 * @keyword-en tenant-scope-check, cross-tenant-guard
 * @param {object} article 文章文档。
 * @param {object} topic 子选题文档。
 * @returns {boolean} 是否同属一个租户。
 */
export function isSameScope(article, topic) {
  const tenantOf = (doc) => {
    const tenantId = String(doc?.tenantId ?? '').trim();
    return tenantId ? tenantId : null;
  };
  return tenantOf(article) === tenantOf(topic);
}

/**
 * @description 用调度表里的 `articleId → topicId` 做确定性恢复，命中即无需猜测。
 * @keyword-cn 调度表恢复, 确定性映射
 * @keyword-en schedule-table-recovery, deterministic-mapping
 * @param {import('mongodb').Db} db 数据库句柄。
 * @param {object} article 文章文档。
 * @returns {Promise<number | undefined>} 恢复出的子选题 ID。
 */
export async function resolveTopicIdBySchedule(db, article) {
  const row = await db
    .collection('xhs_topic_crawl_schedules')
    .findOne({ articleId: article.id }, { projection: { topicId: 1 } });
  const topicId = Number(row?.topicId);
  return Number.isInteger(topicId) && topicId > 0 ? topicId : undefined;
}

/**
 * @description 在候选子选题里按标题精确、正文前缀、标题包含依次匹配，多命中视为歧义不回填。
 * @keyword-cn 标题匹配, 正文匹配, 歧义拒绝
 * @keyword-en title-match, body-match, ambiguity-guard
 * @param {object} article 文章文档。
 * @param {object[]} candidates 候选子选题。
 * @returns {{topic?: object, reason: 'title' | 'body' | 'title-contains' | 'ambiguous' | 'none'}} 匹配结果。
 */
export function matchTopicByContent(article, candidates) {
  const articleTitle = normalizeText(article.title);
  const byTitle = articleTitle
    ? candidates.filter(
        (topic) =>
          normalizeText(topic.article?.title) === articleTitle ||
          normalizeText(topic.title) === articleTitle,
      )
    : [];
  if (byTitle.length === 1) return { topic: byTitle[0], reason: 'title' };
  if (byTitle.length > 1) return { reason: 'ambiguous' };

  const articleBody = normalizeText(article.text).slice(0, BODY_MATCH_PREFIX);
  if (articleBody.length < BODY_MATCH_MIN_LENGTH) return { reason: 'none' };
  const byBody = candidates.filter(
    (topic) => normalizeText(topic.article?.body).slice(0, BODY_MATCH_PREFIX) === articleBody,
  );
  if (byBody.length === 1) return { topic: byBody[0], reason: 'body' };
  if (byBody.length > 1) return { reason: 'ambiguous' };

  /* 兜底：发布时给标题加过前后缀（如 "[模拟发文] "）时，退化成唯一包含关系。 */
  if (articleTitle.length >= TITLE_CONTAIN_MIN_LENGTH) {
    const byContain = candidates.filter((topic) => {
      for (const raw of [topic.article?.title, topic.title]) {
        const topicTitle = normalizeText(raw);
        if (topicTitle.length < TITLE_CONTAIN_MIN_LENGTH) continue;
        if (articleTitle.includes(topicTitle) || topicTitle.includes(articleTitle)) return true;
      }
      return false;
    });
    if (byContain.length === 1) return { topic: byContain[0], reason: 'title-contains' };
    if (byContain.length > 1) return { reason: 'ambiguous' };
  }
  return { reason: 'none' };
}

/**
 * @description 统计每个文章库里仍完好的 `xhsParentTopicId`，用于把候选子选题收敛到同一母选题下。
 * @keyword-cn 母选题推断, 候选集收敛
 * @keyword-en infer-parent-topic, candidate-narrowing
 * @param {import('mongodb').Db} db 数据库句柄。
 * @returns {Promise<Map<number, number>>} libraryId → parentTopicId。
 */
export async function buildLibraryParentMap(db) {
  const rows = await db
    .collection('articles')
    .find(
      { source: 'xhs-topic', 'meta.xhsParentTopicId': { $exists: true, $ne: null } },
      { projection: { libraryId: 1, 'meta.xhsParentTopicId': 1 } },
    )
    .toArray();
  const map = new Map();
  for (const row of rows) {
    const parentId = Number(row.meta?.xhsParentTopicId);
    if (!Number.isInteger(parentId) || map.has(row.libraryId)) continue;
    map.set(row.libraryId, parentId);
  }
  return map;
}

/**
 * @description 收集"文章库 + 子选题"已有的绑定关系，防止同一个库里把一个子选题绑到两篇文章上。
 *   跨文章库复用同一子选题是正常的，只有同库重复才视为异常。
 * @keyword-cn 已占用选题, 重复绑定防护
 * @keyword-en taken-topic-ids, duplicate-binding-guard
 * @param {import('mongodb').Db} db 数据库句柄。
 * @returns {Promise<Map<string, number>>} `libraryId:topicId` → 已占用它的文章 ID。
 */
export async function buildTakenTopicMap(db) {
  const rows = await db
    .collection('articles')
    .find(
      { 'meta.xhsTopicId': { $exists: true, $ne: null } },
      { projection: { id: 1, libraryId: 1, 'meta.xhsTopicId': 1 } },
    )
    .toArray();
  const map = new Map();
  for (const row of rows) {
    const topicId = readTopicId(row.meta);
    if (!topicId) continue;
    const key = `${row.libraryId}:${topicId}`;
    if (!map.has(key)) map.set(key, row.id);
  }
  return map;
}

/**
 * @description 清掉抓取调度一次性回填标记，服务下次启动会用自身逻辑补建调度行。
 * @keyword-cn 重置调度标记, 触发调度补建
 * @keyword-en reset-schedule-marker, trigger-schedule-backfill
 * @param {import('mongodb').Db} db 数据库句柄。
 * @returns {Promise<void>}
 */
export async function resetScheduleBackfillMarker(db) {
  await db.collection('counters').deleteOne({ _id: SCHEDULE_BACKFILL_MARKER });
}

/**
 * @description 脚本主流程：找出受损文章、逐条恢复选题关联、回写并输出报告。
 * @keyword-cn 回填主流程, 修复报告
 * @keyword-en backfill-main, repair-report
 * @returns {Promise<void>}
 */
export async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveMongoConnection();
  const uri = resolved.uri;
  const dbName = args.dbName ?? resolved.dbName;

  console.log('[backfill-xhs-topic-id]');
  console.log(`  MongoDB: ${dbName}${args.dbName ? ' (--db 覆盖)' : ''}`);
  console.log(`  Mode: ${args.dryRun ? 'DRY-RUN (只报告不写库)' : 'LIVE (会写库)'}`);
  if (args.libraryId) console.log(`  Library: ${args.libraryId}`);
  if (args.articleId) console.log(`  Article: ${args.articleId}`);
  if (args.limit > 0) console.log(`  Limit: ${args.limit}`);
  console.log('');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const articles = db.collection('articles');

  const filter = {
    source: 'xhs-topic',
    $or: [{ 'meta.xhsTopicId': { $exists: false } }, { 'meta.xhsTopicId': null }],
  };
  if (args.libraryId) filter.libraryId = args.libraryId;
  if (args.articleId) filter.id = args.articleId;

  const broken = await articles.find(filter).sort({ id: 1 }).toArray();
  console.log(`受损文章：${broken.length} 篇\n`);
  if (!broken.length) {
    await client.close();
    return;
  }

  const [parentByLibrary, takenTopics, childTopics] = await Promise.all([
    buildLibraryParentMap(db),
    buildTakenTopicMap(db),
    db.collection('xhs_topics').find({ kind: 'child' }).toArray(),
  ]);

  const report = [];
  let updated = 0;
  for (const article of broken) {
    if (args.limit > 0 && report.length >= args.limit) break;

    const scoped = childTopics.filter((topic) => isSameScope(article, topic));
    const parentId = parentByLibrary.get(article.libraryId);
    const narrowed = parentId ? scoped.filter((topic) => Number(topic.parentId) === parentId) : scoped;

    const scheduleTopicId = await resolveTopicIdBySchedule(db, article);
    let topic = scheduleTopicId ? childTopics.find((item) => item.id === scheduleTopicId) : undefined;
    let matchedBy = topic ? 'schedule' : '';

    if (!topic) {
      const narrowHit = matchTopicByContent(article, narrowed);
      if (narrowHit.topic) {
        topic = narrowHit.topic;
        matchedBy = narrowHit.reason;
      } else if (narrowHit.reason !== 'ambiguous' && narrowed !== scoped) {
        const wideHit = matchTopicByContent(article, scoped);
        if (wideHit.topic) {
          topic = wideHit.topic;
          matchedBy = `${wideHit.reason}-global`;
        } else {
          matchedBy = wideHit.reason;
        }
      } else {
        matchedBy = narrowHit.reason;
      }
    }

    const row = {
      articleId: article.id,
      libraryId: article.libraryId,
      title: String(article.title ?? '').slice(0, 16),
      topicId: topic?.id ?? null,
      matchedBy: matchedBy || 'none',
      result: '',
    };

    if (!topic) {
      row.result = 'skip';
      report.push(row);
      continue;
    }

    const takenKey = `${article.libraryId}:${topic.id}`;
    const takenBy = takenTopics.get(takenKey);
    if (takenBy && takenBy !== article.id) {
      row.result = `taken-by-#${takenBy}`;
      report.push(row);
      continue;
    }

    if (args.dryRun) {
      row.result = 'would-update';
      report.push(row);
      continue;
    }

    await articles.updateOne(
      { _id: article._id },
      {
        $set: {
          'meta.xhsTopicId': topic.id,
          'meta.xhsParentTopicId': topic.parentId ?? parentId ?? null,
          'meta.xhsTopicType': topic.topicType ?? null,
          'meta.xhsTopicIdBackfilledAt': new Date(),
          'meta.xhsTopicIdBackfillSource': matchedBy,
          updatedAt: new Date(),
        },
      },
    );
    takenTopics.set(takenKey, article.id);
    updated += 1;
    row.result = 'updated';
    report.push(row);
  }

  console.table(report);

  const skipped = report.filter((row) => row.result === 'skip' || row.result.startsWith('taken'));
  console.log('\n=== Summary ===');
  console.log(`  受损文章: ${broken.length}`);
  console.log(`  已回填: ${updated}`);
  console.log(`  待人工处理: ${skipped.length}`);
  if (args.verbose && skipped.length) {
    for (const row of skipped) {
      console.log(`    #${row.articleId} 库${row.libraryId} 《${row.title}》 → ${row.result} (${row.matchedBy})`);
    }
  }

  if (!args.dryRun && updated > 0 && !args.keepMarker) {
    await resetScheduleBackfillMarker(db);
    console.log(`\n已清除 counters.${SCHEDULE_BACKFILL_MARKER} 标记：`);
    console.log('  重启服务后 XhsTopicCrawlService 会把这些已发布文章补进抓取调度表。');
  }
  if (skipped.length) {
    console.log('\n未命中的文章需要人工绑定：确认对应子选题后手工写入 meta.xhsTopicId，或在选题工作台重新保存。');
  }

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
