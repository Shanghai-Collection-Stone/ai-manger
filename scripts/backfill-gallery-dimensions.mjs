/**
 * @title Backfill Gallery Image Dimensions
 * @description 回填旧图库图片的尺寸数据（width, height, isPortrait）
 * @description 遍历 gallery_images 集合，对缺少尺寸信息的记录：
 *   1. 读取图片文件的实际尺寸
 *   2. 更新 width, height, isPortrait 字段
 *
 * 使用方式：
 *   node scripts/backfill-gallery-dimensions.mjs
 *   node scripts/backfill-gallery-dimensions.mjs --dry-run   # 不实际写入，仅预览
 *   node scripts/backfill-gallery-dimensions.mjs --limit=100 # 限制处理数量
 *
 * @keyword-en backfill gallery dimensions, migration
 */

import { MongoClient } from 'mongodb';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

function loadEnv() {
  try {
    const envPath = join(projectRoot, '.env.development');
    if (existsSync(envPath)) {
      const envConfig = readFileSync(envPath, 'utf-8');
      for (const line of envConfig.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) process.env[key] = val;
      }
    }
  } catch {
    // ignore
  }
}

loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

const MONGO_HOST = process.env.DEV_MONGODB_HOST || 'localhost';
const MONGO_USER = process.env.DEV_MONGODB_USER || '';
const MONGO_PASS = process.env.DEV_MONGODB_PASS || '';
const MONGO_DB = process.env.DEV_MONGODB_DB || 'ai_system';
const MONGO_TOPOLOGY = (process.env.DEV_MONGODB_TOPOLOGY || '').toLowerCase();

let mongoUrl;
if (MONGO_USER && MONGO_PASS) {
  const params = new URLSearchParams();
  params.set('authSource', process.env.DEV_MONGODB_AUTH_SOURCE || MONGO_DB);
  if (MONGO_TOPOLOGY === 'standalone') params.set('directConnection', 'true');
  mongoUrl = `mongodb://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASS)}@${MONGO_HOST}:27017/?${params.toString()}`;
} else {
  mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017';
}

const PUBLIC_DIR = join(projectRoot, 'public');

async function readImageDimensions(filePath) {
  try {
    const fs = await import('fs');
    const mod = await import('jimp');
    const Jimp = mod.Jimp ?? mod.default?.Jimp ?? mod.default;
    if (!Jimp || typeof Jimp.read !== 'function') {
      console.error('Jimp not properly exported:', Object.keys(mod));
      return null;
    }
    // Read file as buffer (jimp can read from buffer)
    const buf = fs.readFileSync(filePath);
    const img = await Jimp.read(buf);
    const w = img.bitmap?.width ?? 0;
    const h = img.bitmap?.height ?? 0;
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h, isPortrait: h > w };
  } catch (err) {
    console.error('Jimp read error:', err.message);
    return null;
  }
}

function resolveImagePath(doc) {
  if (!doc) return null;
  const abs = doc.absPath;
  if (abs && existsSync(abs)) return abs;
  // Handle Windows paths with backslashes
  const normalizedAbs = abs?.replace(/\\/g, '/');
  if (normalizedAbs && normalizedAbs !== abs && existsSync(normalizedAbs)) return normalizedAbs;
  const fileName = doc.fileName;
  if (!fileName) return null;
  // Try multiple subdirectories
  const candidates = [
    join(PUBLIC_DIR, 'uploads', 'local-image', fileName),
    join(PUBLIC_DIR, 'uploads', fileName),
    join(PUBLIC_DIR, 'uploads_thumbs', fileName),
    join(PUBLIC_DIR, fileName),
    // Also try with normalized abs path
    normalizedAbs,
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function main() {
  console.log(`[backfill-gallery-dimensions]`);
  console.log(`  MongoDB: ${MONGO_HOST}/${MONGO_DB}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will write)'}`);
  if (LIMIT > 0) console.log(`  Limit: ${LIMIT}`);
  console.log('');

  // Test jimp availability
  try {
    const testDims = await readImageDimensions(join(PUBLIC_DIR, 'uploads', '.gitkeep'));
    console.log('Jimp module test:', testDims === null ? 'OK (null for missing file expected)' : testDims);
  } catch (e) {
    console.error('Jimp module test failed:', e.message);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(MONGO_DB);
  const coll = db.collection('gallery_images');

  const filter = {
    $or: [
      { width: { $exists: false } },
      { width: null },
    ],
  };
  const total = await coll.countDocuments(filter);
  console.log(`Found ${total} images missing width/height data.\n`);

  if (total === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  const cursor = coll.find(filter, {
    projection: { _id: 1, id: 1, fileName: 1, absPath: 1, url: 1 },
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  while (await cursor.hasNext()) {
    if (LIMIT > 0 && processed >= LIMIT) {
      console.log(`\nReached limit of ${LIMIT}, stopping.`);
      break;
    }

    const doc = await cursor.next();
    processed++;

    const filePath = resolveImagePath(doc);
    if (!filePath) {
      console.log(`  [${processed}] #${doc.id}: file not found, skipping`);
      skipped++;
      continue;
    }

    const dims = await readImageDimensions(filePath);
    if (!dims) {
      console.log(`  [${processed}] #${doc.id}: could not read dimensions, skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  [${processed}/${total}] #${doc.id}: ${dims.width}x${dims.height} (portrait=${dims.isPortrait})`);

    if (DRY_RUN) {
      process.stdout.write(' [DRY-RUN]\n');
    } else {
      try {
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: {
              width: dims.width,
              height: dims.height,
              isPortrait: dims.isPortrait,
              updatedAt: new Date(),
            },
          },
        );
        process.stdout.write(' [OK]\n');
        updated++;
      } catch (err) {
        process.stdout.write(` [ERROR: ${err.message}]\n`);
        errors++;
      }
    }

    if (processed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total found: ${total}`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);

  await client.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
