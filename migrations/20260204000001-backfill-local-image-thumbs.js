const { join, extname, dirname } = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

function normalizeExtLower(fileName) {
  return String(extname(String(fileName || '')) || '').toLowerCase();
}

function isImageFile(fileName) {
  const ext = normalizeExtLower(fileName);
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.gif';
}

async function mapLimit(items, limit, iterator) {
  const list = Array.isArray(items) ? items : [];
  const lim = Math.max(1, Math.floor(limit || 1));
  let idx = 0;
  let running = 0;
  return await new Promise((resolve, reject) => {
    const next = () => {
      if (idx >= list.length && running === 0) return resolve();
      while (running < lim && idx < list.length) {
        const cur = list[idx++];
        running += 1;
        Promise.resolve()
          .then(() => iterator(cur))
          .then(
            () => {
              running -= 1;
              next();
            },
            (e) => reject(e),
          );
      }
    };
    next();
  });
}

async function createImageThumbnail({ sourcePath, outputPath, maxWidth, maxHeight, quality }) {
  const src = String(sourcePath || '');
  const out = String(outputPath || '');
  if (!src || !out) return { ok: false, reason: 'no-path' };

  const mw = Math.max(1, Math.floor(maxWidth ?? 720));
  const mh = Math.max(1, Math.floor(maxHeight ?? 720));
  const q = Math.min(92, Math.max(35, Math.floor(quality ?? 68)));

  let mod;
  try {
    mod = require('jimp');
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }

  const Jimp = (mod && mod.Jimp) || mod;
  if (!Jimp || typeof Jimp.read !== 'function') {
    return { ok: false, reason: 'jimp-unavailable' };
  }

  let img;
  try {
    img = await Jimp.read(src);
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }

  const w = img && img.bitmap && typeof img.bitmap.width === 'number' ? img.bitmap.width : 0;
  const h = img && img.bitmap && typeof img.bitmap.height === 'number' ? img.bitmap.height : 0;
  if (w > 0 && h > 0) {
    const ratio = Math.min(mw / w, mh / h, 1);
    const nw = Math.max(1, Math.floor(w * ratio));
    const nh = Math.max(1, Math.floor(h * ratio));
    if (nw !== w || nh !== h) {
      if (typeof img.resize === 'function') img.resize({ w: nw, h: nh });
    }
  }

  try {
    fs.mkdirSync(dirname(out), { recursive: true });
  } catch {}

  try {
    if (typeof img.write === 'function') {
      await img.write(out, { quality: q });
    } else if (typeof img.writeAsync === 'function') {
      await img.writeAsync(out);
    } else {
      return { ok: false, reason: 'write-unsupported' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

async function ensureThumbForLocalFile({ absPath, fileName }) {
  const src = String(absPath || '');
  const name = String(fileName || '');
  if (!src || !name) return null;
  if (!isImageFile(name)) return null;
  if (!fs.existsSync(src)) return null;

  const rawExt = normalizeExtLower(name);
  const ext = rawExt && rawExt.length <= 12 ? rawExt : '';
  const outExt = ext === '.gif' ? '.jpg' : ext || '.jpg';
  const thumbFileName = `${Date.now()}-${randomUUID()}${outExt}`;
  const outputDir = join(process.cwd(), 'public', 'uploads_thumbs');
  const outputPath = join(outputDir, thumbFileName);

  const r = await createImageThumbnail({
    sourcePath: src,
    outputPath,
    maxWidth: 720,
    maxHeight: 720,
    quality: 68,
  });
  if (!r.ok) return null;

  return {
    thumbFileName,
    thumbUrl: `/static/uploads_thumbs/${thumbFileName}`,
  };
}

function escapeRegex(s) {
  return String(s || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function normalizePathKey(p) {
  return String(p || '').replace(/\\/g, '/');
}

function resolveLocalImageFsPath({ localDirAbs, storedAbsPath, fileName }) {
  const p = normalizePathKey(storedAbsPath);
  if (p.startsWith(normalizePathKey(localDirAbs))) return p;
  if (p.startsWith('public/uploads/local-image/')) {
    const rawName = p.slice('public/uploads/local-image/'.length);
    return join(localDirAbs, rawName);
  }
  return join(localDirAbs, String(fileName || ''));
}

module.exports = {
  async up(db) {
    const userId = 'default';
    const localDirRel = join('public', 'uploads', 'local-image');
    const localDirAbs = join(process.cwd(), localDirRel);
    if (!fs.existsSync(localDirAbs)) {
      console.log(`[Migration] local image dir not found: ${localDirAbs}`);
      return;
    }

    const absPrefix = `^${escapeRegex(localDirAbs)}`;
    const relPrefix = '^public/uploads/local-image/';
    const images = db.collection('gallery_images');
    const rows = await images
      .find(
        {
          userId,
          $or: [{ absPath: { $regex: absPrefix } }, { absPath: { $regex: relPrefix } }],
          $or: [{ thumbUrl: { $exists: false } }, { thumbUrl: null }, { thumbUrl: '' }],
        },
        { projection: { _id: 1, absPath: 1, fileName: 1, url: 1 } },
      )
      .toArray();

    const targets = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        _id: r && r._id,
        storedAbsPath: String(r && r.absPath ? r.absPath : ''),
        fileName: String(r && r.fileName ? r.fileName : ''),
        fsPath: resolveLocalImageFsPath({ localDirAbs, storedAbsPath: r && r.absPath, fileName: r && r.fileName }),
      }))
      .filter((x) => x._id && x.fileName && x.fsPath);

    if (targets.length === 0) {
      console.log('[Migration] no local-image rows need thumb backfill');
      return;
    }

    let okCount = 0;
    const concurrency = 2;
    await mapLimit(targets, concurrency, async (x) => {
      const t = await ensureThumbForLocalFile({ absPath: x.fsPath, fileName: x.fileName });
      if (!t) return;
      await images.updateOne(
        { userId, _id: x._id },
        {
          $set: {
            thumbFileName: t.thumbFileName,
            thumbUrl: t.thumbUrl,
            updatedAt: new Date(),
          },
        },
      );
      okCount += 1;
    });

    console.log(`[Migration] local-image thumb backfill ok=${okCount} total=${targets.length}`);
  },

  async down(db) {
    const userId = 'default';
    const localDirRel = join('public', 'uploads', 'local-image');
    const localDirAbs = join(process.cwd(), localDirRel);
    const absPrefix = `^${escapeRegex(localDirAbs)}`;
    const relPrefix = '^public/uploads/local-image/';
    const images = db.collection('gallery_images');
    await images.updateMany(
      {
        userId,
        $or: [{ absPath: { $regex: absPrefix } }, { absPath: { $regex: relPrefix } }],
      },
      { $unset: { thumbFileName: '', thumbUrl: '' }, $set: { updatedAt: new Date() } },
    );
  },
};
