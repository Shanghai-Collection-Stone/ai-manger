import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur || !cur.startsWith('--')) continue;
    const raw = cur.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      const k = raw.slice(0, eq);
      const v = raw.slice(eq + 1);
      out[k] = v === '' ? true : v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[raw] = next;
      i += 1;
    } else {
      out[raw] = true;
    }
  }
  return out;
}

function toInt(v, fallback) {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || '').trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n') return false;
  return Boolean(v);
}

async function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out;
}

function formatBytes(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let u = 0;
  while (x >= 1024 && u < units.length - 1) {
    x /= 1024;
    u += 1;
  }
  return `${x.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Math.floor(limit || 1));
  let idx = 0;
  const results = new Array(list.length);

  const workers = new Array(Math.min(n, list.length)).fill(0).map(async () => {
    while (true) {
      const cur = idx;
      idx += 1;
      if (cur >= list.length) return;
      results[cur] = await mapper(list[cur], cur);
    }
  });

  await Promise.all(workers);
  return results;
}

async function compressJpegFile({ Jimp, filePath, maxWidth, maxHeight, quality, dryRun }) {
  let beforeSize = 0;
  try {
    const beforeStat = await fs.stat(filePath);
    beforeSize = beforeStat.size;
  } catch {
    return {
      filePath,
      changed: false,
      beforeSize: 0,
      afterSize: 0,
      width: 0,
      height: 0,
      reason: 'stat-failed',
    };
  }

  const ext = path.extname(filePath) || '.jpg';
  const base = ext && filePath.toLowerCase().endsWith(ext.toLowerCase())
    ? filePath.slice(0, -ext.length)
    : filePath;

  let img;
  try {
    img = await Jimp.read(filePath);
  } catch (e) {
    return {
      filePath,
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      width: 0,
      height: 0,
      reason: e && typeof e === 'object' && 'message' in e ? String(e.message) : 'unreadable',
    };
  }
  const w = typeof img.bitmap?.width === 'number' ? img.bitmap.width : 0;
  const h = typeof img.bitmap?.height === 'number' ? img.bitmap.height : 0;

  if (w > 0 && h > 0) {
    const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
    if (ratio < 1) {
      const nw = Math.max(1, Math.floor(w * ratio));
      const nh = Math.max(1, Math.floor(h * ratio));
      img.resize({ w: nw, h: nh });
    }
  }

  const tmpPath = `${base}.__compress_tmp__${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
  await img.write(tmpPath, { quality });
  const afterStat = await fs.stat(tmpPath);
  const afterSize = afterStat.size;

  const improved = afterSize + 1024 < beforeSize;
  if (!improved || dryRun) {
    await fs.unlink(tmpPath);
    return {
      filePath,
      changed: improved,
      beforeSize,
      afterSize: dryRun ? (improved ? afterSize : beforeSize) : beforeSize,
      width: w,
      height: h,
      reason: dryRun ? (improved ? 'dry-run' : 'not-smaller') : 'not-smaller',
    };
  }

  const bakPath = `${base}.__compress_bak__${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
  await fs.rename(filePath, bakPath);
  try {
    await fs.rename(tmpPath, filePath);
  } catch (e) {
    try {
      if (fsSync.existsSync(bakPath)) await fs.rename(bakPath, filePath);
    } catch {}
    throw e;
  }
  await fs.unlink(bakPath);

  return {
    filePath,
    changed: true,
    beforeSize,
    afterSize,
    width: w,
    height: h,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(String(args.dir || path.join(process.cwd(), 'public', 'uploads', 'local-image')));
  const maxWidth = Math.max(1, toInt(args.maxWidth, 1600));
  const maxHeight = Math.max(1, toInt(args.maxHeight, 1600));
  const quality = Math.min(95, Math.max(30, toInt(args.quality, 75)));
  const concurrency = Math.max(1, toInt(args.concurrency, 2));
  const limit = toInt(args.limit, 0);
  const dryRun = toBool(args.dryRun);
  const verbose = toBool(args.verbose);

  if (!fsSync.existsSync(dir)) {
    console.error(`dir not found: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const { Jimp } = await import('jimp');
  const all = await listFilesRecursive(dir);
  const jpgs = all.filter((p) => {
    const ext = path.extname(p).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg';
  });

  const targets = limit > 0 ? jpgs.slice(0, limit) : jpgs;
  if (targets.length === 0) {
    console.log('no jpg files found');
    return;
  }

  console.log(JSON.stringify({ dir, maxWidth, maxHeight, quality, concurrency, count: targets.length, dryRun }));

  let beforeTotal = 0;
  let afterTotal = 0;
  let changedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  await mapLimit(targets, concurrency, async (filePath) => {
    const r = await compressJpegFile({
      Jimp,
      filePath,
      maxWidth,
      maxHeight,
      quality,
      dryRun,
    });
    beforeTotal += r.beforeSize;
    afterTotal += r.afterSize;
    if (r.reason && r.reason !== 'dry-run' && r.reason !== 'not-smaller') {
      errorCount += 1;
      console.error(`[compress-skip] ${filePath} :: ${r.reason}`);
      if (verbose) {
        console.error(r);
      }
      skippedCount += 1;
      return r;
    }
    if (r.changed) changedCount += 1;
    else skippedCount += 1;
    return r;
  });

  const saved = Math.max(0, beforeTotal - afterTotal);
  const pct = beforeTotal > 0 ? ((saved / beforeTotal) * 100).toFixed(2) : '0.00';
  console.log(
    JSON.stringify({
      processed: targets.length,
      changed: changedCount,
      skipped: skippedCount,
      errors: errorCount,
      beforeTotal: formatBytes(beforeTotal),
      afterTotal: formatBytes(afterTotal),
      saved: formatBytes(saved),
      savedPercent: `${pct}%`,
    }),
  );
}

await main();
