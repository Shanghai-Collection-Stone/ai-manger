const { ObjectId } = require('mongodb');
const { join, extname, dirname } = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

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

function normalizeExtLower(fileName) {
  return String(extname(String(fileName || '')) || '').toLowerCase();
}

function isImageFile(fileName) {
  const ext = normalizeExtLower(fileName);
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.gif';
}

function guessMimeType(fileName) {
  const ext = normalizeExtLower(fileName);
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return undefined;
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
    const dir = dirname(out);
    fs.mkdirSync(dir, { recursive: true });
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

async function ensureCountersDoc(counters, docId, fallbackSeq) {
  const exists = await counters.findOne({ _id: docId });
  if (!exists) {
    await counters.insertOne({ _id: docId, seq: fallbackSeq });
    return fallbackSeq;
  }
  const seq = exists && typeof exists.seq === 'number' ? exists.seq : 0;
  return seq;
}

async function findMaxId(collection) {
  const row = await collection
    .find({}, { projection: { id: 1 } })
    .sort({ id: -1 })
    .limit(1)
    .toArray();
  const maxId = row && row[0] && typeof row[0].id === 'number' ? row[0].id : 0;
  return maxId;
}

async function nextIdRange({ counters, counterId, collection, count }) {
  const maxId = await findMaxId(collection);
  const curSeq = await ensureCountersDoc(counters, counterId, maxId);
  const start = Math.max(curSeq, maxId) + 1;
  const nextSeq = start + Math.max(0, count) - 1;
  if (count > 0) {
    await counters.updateOne({ _id: counterId }, { $set: { seq: nextSeq } }, { upsert: true });
  }
  return { start, nextSeq };
}

async function ensureGalleryIndexes({ images, groups }) {
  await images.createIndex({ id: 1 }, { unique: true });
  await images.createIndex({ userId: 1 });
  await images.createIndex({ groupId: 1, createdAt: -1 });
  await images.createIndex({ tags: 1 });
  await images.createIndex({ createdAt: -1 });

  await groups.createIndex({ id: 1 }, { unique: true });
  await groups.createIndex({ userId: 1 });
  await groups.createIndex({ tags: 1 });
  await groups.createIndex({ createdAt: -1 });
}

module.exports = {
  async up(db) {
    const userId = 'default';
    const localDir = join(process.cwd(), 'public', 'uploads', 'local-image');
    if (!fs.existsSync(localDir)) {
      console.log(`[Migration] local image dir not found: ${localDir}`);
      return;
    }

    const images = db.collection('gallery_images');
    const groups = db.collection('gallery_groups');
    const counters = db.collection('counters');
    await ensureGalleryIndexes({ images, groups });

    const groupName = 'local-image';
    const groupMarker = 'migration:import-local-image-20260204';
    let group = await groups.findOne({ userId, name: groupName, description: groupMarker });
    if (!group) {
      const { start } = await nextIdRange({
        counters,
        counterId: 'gallery_groups',
        collection: groups,
        count: 1,
      });
      const now = new Date();
      const embedding = new Array(768).fill(0);
      const doc = {
        _id: new ObjectId(),
        id: start,
        userId,
        name: groupName,
        description: groupMarker,
        tags: ['local-image'],
        embedding,
        createdAt: now,
        updatedAt: now,
      };
      await groups.insertOne(doc);
      group = doc;
    }

    const fileNames = fs
      .readdirSync(localDir, { withFileTypes: true })
      .filter((d) => d && d.isFile && d.isFile())
      .map((d) => d.name)
      .filter(isImageFile);

    if (fileNames.length === 0) {
      console.log('[Migration] no images found under public/uploads/local-image');
      return;
    }

    const absPrefix = `^${localDir.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`;
    const existing = await images
      .find({ absPath: { $regex: absPrefix } }, { projection: { absPath: 1, thumbUrl: 1 } })
      .toArray();
    const existingAbs = new Set((existing || []).map((x) => String(x && x.absPath ? x.absPath : '')).filter(Boolean));
    const missingThumbAbs = new Set(
      (existing || [])
        .filter((x) => x && typeof x.absPath === 'string' && (!x.thumbUrl || String(x.thumbUrl).trim().length === 0))
        .map((x) => x.absPath),
    );

    const localFiles = fileNames.map((fileName) => ({
      fileName,
      absPath: join(localDir, fileName),
    }));
    const toImport = localFiles.filter((x) => !existingAbs.has(x.absPath));
    const toBackfillThumb = localFiles.filter((x) => missingThumbAbs.has(x.absPath));

    if (toImport.length === 0 && toBackfillThumb.length === 0) {
      console.log('[Migration] all local-image files already imported and thumb-ready, skipping');
      return;
    }

    const { start } = await nextIdRange({
      counters,
      counterId: 'gallery_images',
      collection: images,
      count: toImport.length,
    });

    const now = new Date();
    const embedding = new Array(768).fill(0);
    const thumbMap = new Map();
    const thumbCandidates = [...toImport, ...toBackfillThumb];
    if (thumbCandidates.length > 0) {
      const concurrency = 2;
      await mapLimit(thumbCandidates, concurrency, async (x) => {
        const t = await ensureThumbForLocalFile({ absPath: x.absPath, fileName: x.fileName });
        if (!t) return;
        thumbMap.set(x.absPath, t);
      });
    }

    const docs = toImport.map((x, idx) => {
      const st = fs.statSync(x.absPath);
      const urlPath = `/static/uploads/local-image/${encodeURIComponent(x.fileName)}`;
      const thumb = thumbMap.get(x.absPath);
      return {
        _id: new ObjectId(),
        id: start + idx,
        userId,
        groupId: group.id,
        originalName: x.fileName,
        fileName: x.fileName,
        url: urlPath,
        ...(thumb ? { thumbFileName: thumb.thumbFileName, thumbUrl: thumb.thumbUrl } : {}),
        absPath: x.absPath,
        mimeType: guessMimeType(x.fileName),
        size: typeof st.size === 'number' ? st.size : undefined,
        tags: ['local-image'],
        description: groupMarker,
        embedding,
        createdAt: now,
        updatedAt: now,
      };
    });

    const batchSize = 200;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      await images.insertMany(batch);
    }

    if (toBackfillThumb.length > 0) {
      const updates = toBackfillThumb
        .map((x) => {
          const t = thumbMap.get(x.absPath);
          if (!t) return null;
          return { absPath: x.absPath, ...t };
        })
        .filter(Boolean);

      if (updates.length > 0) {
        await mapLimit(updates, 4, async (u) => {
          await images.updateOne(
            { absPath: u.absPath, userId },
            {
              $set: {
                thumbFileName: u.thumbFileName,
                thumbUrl: u.thumbUrl,
                updatedAt: new Date(),
              },
            },
          );
        });
      }
    }

    console.log(
      `[Migration] imported ${docs.length} images, backfilled ${toBackfillThumb.length} thumbs (groupId=${group.id})`,
    );
  },

  async down(db) {
    const userId = 'default';
    const localDir = join(process.cwd(), 'public', 'uploads', 'local-image');
    const groupName = 'local-image';
    const groupMarker = 'migration:import-local-image-20260204';

    const images = db.collection('gallery_images');
    const groups = db.collection('gallery_groups');

    await images.deleteMany({
      userId,
      absPath: { $regex: `^${localDir.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}` },
      description: groupMarker,
    });
    await groups.deleteOne({ userId, name: groupName, description: groupMarker });
  },
};
