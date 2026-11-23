import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @description 预置曲目清单所在目录。
 * @keyword-cn 预置曲目目录, 清单位置
 * @keyword-en seed-directory, manifest-location
 */
const SEED_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * @description 本地预置音频目录（不进 Git）：文件在这里且哈希一致时直接上传，不用重新下载。
 * @keyword-cn 本地预置音频, 免重复下载
 * @keyword-en local-seed-audio, skip-redownload
 */
const DEFAULT_AUDIO_DIR = join(SEED_DIR, 'audio');

/**
 * @description 曲目下载地址：先用 FreePD 公开镜像，失败或校验不过时改用互联网档案馆保存的官方原文件。
 * @keyword-cn 曲目下载来源, 官方存档回退
 * @keyword-en seed-download-sources, official-archive-fallback
 */
const SOURCE_BASES = Object.freeze({
  mirror: 'https://a.ocv.me/pub/stuff/music/freepd',
  archive: 'https://web.archive.org/web/2024id_/https://freepd.com/music',
});

/**
 * @description 单次下载超时（毫秒）。
 * @keyword-cn 曲目下载超时, 网络保护
 * @keyword-en seed-download-timeout, network-guard
 */
const DOWNLOAD_TIMEOUT_MS = 180 * 1000;

/**
 * @description 把字节编码成 RFC4648 Base32，和互联网档案馆的文件摘要同一格式。
 * @keyword-cn Base32编码, 文件摘要格式
 * @keyword-en base32-encode, digest-format
 * @param {Buffer} bytes 字节。
 * @returns {string} Base32 文本。
 */
function toBase32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits ? output + alphabet[(value << (5 - bits)) & 31] : output;
}

/**
 * @description 判断文件内容是否就是清单里校验过的官方原文件。
 * @keyword-cn 校验曲目哈希, 官方原文件
 * @keyword-en verify-track-hash, official-original
 * @param {Buffer} bytes 文件内容。
 * @param {{sha1: string}} track 清单曲目。
 * @returns {boolean} 一致时为 true。
 */
function isVerifiedAudio(bytes, track) {
  return toBase32(createHash('sha1').update(bytes).digest()) === track.sha1;
}

/**
 * @description 写入曲库的授权来源说明。
 * @keyword-cn 预置授权说明, 曲目授权来源
 * @keyword-en seed-license-note, track-license-source
 * @param {{source: string}} track 清单曲目。
 * @returns {string} 授权来源。
 */
export function licenseNoteOf(track) {
  return `CC0 1.0 公共领域 · FreePD《${track.source}》· 已与官方存档文件校验`;
}

/**
 * @description 取得通过哈希校验的曲目：先看本地缓存目录，再依次试镜像和官方存档；都不通过时报错，绝不上传未校验的文件。
 * @keyword-cn 获取校验曲目, 拒绝未校验文件
 * @keyword-en load-verified-audio, reject-unverified-file
 * @param {{source: string, folder: string, sha1: string}} track 清单曲目。
 * @param {{cacheDir?: string, fetchImpl: typeof fetch}} options 缓存目录与下载函数。
 * @returns {Promise<Buffer>} 文件内容。
 * @throws {Error} 所有来源都拿不到校验通过的文件。
 */
async function loadVerifiedAudio(track, options) {
  const cached = options.cacheDir
    ? join(options.cacheDir, `${track.source.replace(/[^A-Za-z0-9]+/g, '-')}.mp3`)
    : '';
  if (cached && existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (isVerifiedAudio(bytes, track)) return bytes;
  }
  const encoded = encodeURIComponent(track.source);
  const urls = [
    `${SOURCE_BASES.mirror}/${track.folder}/${encoded}.mp3`,
    `${SOURCE_BASES.archive}/${encoded}.mp3`,
  ];
  for (const url of urls) {
    try {
      const response = await options.fetchImpl(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (isVerifiedAudio(bytes, track)) return bytes;
    } catch {
      // 这个来源不通，换下一个
    }
  }
  throw new Error(`《${track.source}》下载失败或校验不通过，已停止导入`);
}

/**
 * @description 调用曲库接口，把鉴权失败翻译成能照着处理的说明；令牌只发给曲库接口。
 * @keyword-cn 调用曲库接口, 鉴权失败说明
 * @keyword-en call-music-api, auth-failure-message
 * @param {string} path 接口路径。
 * @param {RequestInit} init 请求配置。
 * @param {{api: string, token: string, fetchImpl: typeof fetch}} options 接口地址、令牌与请求函数。
 * @returns {Promise<any>} JSON 响应。
 * @throws {Error} 接口报错。
 */
async function callMusicApi(path, init, options) {
  const response = await options.fetchImpl(`${options.api}/api/douyin-music${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${options.token}` },
  });
  const raw = await response.text();
  if (response.status === 401) throw new Error('令牌无效或已过期，请重新登录管理后台后再试');
  if (response.status === 403) throw new Error('预置曲目要公开给所有租户，需要超级管理员的令牌');
  if (response.status === 404) throw new Error('接口不存在，请先部署带背景音乐模块的后端');
  if (!response.ok) throw new Error(`曲库接口报错 HTTP ${response.status}: ${raw.slice(0, 200)}`);
  return raw ? JSON.parse(raw) : {};
}

/**
 * @description 把一首校验过的曲目上传成平台公开曲目。
 * @keyword-cn 上传预置曲目, 平台公开曲目
 * @keyword-en upload-seed-track, platform-public-track
 * @param {object} track 清单曲目。
 * @param {Buffer} bytes 文件内容。
 * @param {{api: string, token: string, fetchImpl: typeof fetch}} options 接口地址、令牌与请求函数。
 * @returns {Promise<void>}
 */
async function uploadSeedTrack(track, bytes, options) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), `${track.source.replace(/[^A-Za-z0-9]+/g, '-')}.mp3`);
  form.append('name', track.name);
  form.append('category', track.category);
  form.append('licenseNote', licenseNoteOf(track));
  form.append('isPublic', 'true');
  await callMusicApi('', { method: 'POST', body: form }, options);
}

/**
 * @description 导入预置曲库：已有同名曲目的跳过，可重复执行；`dryRun` 只校验文件不写入；遇到错误立即停止。
 * @keyword-cn 导入预置曲库, 重复执行跳过
 * @keyword-en seed-music-library, idempotent-import
 * @param {{api: string, token: string, dryRun?: boolean, cacheDir?: string, fetchImpl?: typeof fetch, log?: (line: string) => void}} input 导入参数。
 * @returns {Promise<{added: number, skipped: number, checked: number}>} 导入结果。
 */
export async function seedMusicLibrary(input) {
  const options = { fetchImpl: fetch, log: console.log, ...input, api: String(input.api).replace(/\/+$/, '') };
  const { tracks } = JSON.parse(readFileSync(join(SEED_DIR, 'freepd-tracks.json'), 'utf8'));
  const existing = options.dryRun
    ? new Set()
    : new Set(((await callMusicApi('?source=library&includeArchived=1', {}, options)).tracks || []).map((item) => item.name));
  const result = { added: 0, skipped: 0, checked: 0 };
  for (const track of tracks) {
    if (existing.has(track.name)) {
      result.skipped += 1;
      options.log(`跳过（已存在）${track.name}`);
      continue;
    }
    const bytes = await loadVerifiedAudio(track, options);
    result.checked += 1;
    if (options.dryRun) {
      options.log(`校验通过 ${track.name}`);
      continue;
    }
    await uploadSeedTrack(track, bytes, options);
    result.added += 1;
    options.log(`已导入 ${track.name}`);
  }
  return result;
}

/**
 * @description 命令行入口：`DOUYIN_MUSIC_TOKEN` 传超管令牌，`DOUYIN_MUSIC_API` 指定后端（默认本机 3011），`--dry-run` 只校验，默认读取 `seed/audio`，`--cache <目录>` 可换成别的音频目录。
 * @keyword-cn 曲库导入命令, 超管令牌
 * @keyword-en seed-music-cli, super-admin-token
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cacheIndex = args.indexOf('--cache');
  const token = String(process.env.DOUYIN_MUSIC_TOKEN || '').trim();
  if (!token && !dryRun) throw new Error('请先设置环境变量 DOUYIN_MUSIC_TOKEN（超级管理员登录后的 admin_token）');
  const api = process.env.DOUYIN_MUSIC_API || 'http://localhost:3011';
  const result = await seedMusicLibrary({ api, token, dryRun, cacheDir: cacheIndex >= 0 ? args[cacheIndex + 1] : DEFAULT_AUDIO_DIR });
  console.log(dryRun ? `校验完成：${result.checked} 首通过` : `导入完成：新增 ${result.added} 首，跳过 ${result.skipped} 首`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
