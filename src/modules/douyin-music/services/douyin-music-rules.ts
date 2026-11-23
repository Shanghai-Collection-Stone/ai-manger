import {
  DOUYIN_MUSIC_CATEGORIES,
  DOUYIN_MUSIC_DEFAULT_VOLUME,
  type DouyinBackgroundMusicSetting,
  type DouyinMusicCategory,
} from '../entities/douyin-music.entity.js';

/**
 * @description 规整曲库分类，未登记的取值回退为「其他」。
 * @keyword-cn 规整音乐分类, 默认分类
 * @keyword-en normalize-music-category, default-category
 * @param {string|null} [input] 前端传入的分类。
 * @returns {DouyinMusicCategory} 规整后的分类。
 */
export function normalizeMusicCategory(
  input?: string | null,
): DouyinMusicCategory {
  const key = String(input ?? '');
  return Object.hasOwn(DOUYIN_MUSIC_CATEGORIES, key)
    ? (key as DouyinMusicCategory)
    : 'other';
}

/**
 * @description 规整脚本的背景音乐设置：曲目 ID 非正数按不用音乐，音量限制在 1～100；曲目和音量都没变时沿用原改动时间，避免误判成片过期。
 * @keyword-cn 规整背景音乐, 音乐改动时间
 * @keyword-en normalize-background-music, music-change-time
 * @param {{trackId?: number, volume?: number}} input 前端传入的设置。
 * @param {DouyinBackgroundMusicSetting} [current] 脚本现有设置。
 * @param {Date} [now] 当前时间。
 * @returns {DouyinBackgroundMusicSetting} 规整后的设置。
 */
export function normalizeBackgroundMusic(
  input: { trackId?: number; volume?: number },
  current?: DouyinBackgroundMusicSetting,
  now: Date = new Date(),
): DouyinBackgroundMusicSetting {
  const rawId = Math.round(Number(input.trackId) || 0);
  const trackId = rawId > 0 ? rawId : 0;
  const rawVolume = Math.round(Number(input.volume));
  const volume = Number.isFinite(rawVolume)
    ? Math.min(100, Math.max(1, rawVolume))
    : (current?.volume ?? DOUYIN_MUSIC_DEFAULT_VOLUME);
  const unchanged = current?.trackId === trackId && current.volume === volume;
  return { trackId, volume, updatedAt: unchanged ? current.updatedAt : now };
}

/**
 * @description 按文件头认音频格式（MP3 / WAV / M4A），不信任扩展名和浏览器给的类型；认不出返回 null。
 * @keyword-cn 识别音频格式, 文件头校验
 * @keyword-en sniff-music-format, magic-bytes
 * @param {Buffer} buffer 文件内容。
 * @returns {{extension: string, contentType: string}|null} 扩展名与 MIME 类型。
 */
export function sniffMusicFormat(
  buffer: Buffer,
): { extension: string; contentType: string } | null {
  if (buffer.length < 12) return null;
  /** @description 按单字节读取文件头片段。 @keyword-cn 读取文件头, 单字节文本 @keyword-en read-file-header, latin1-slice */
  const ascii = (start: number, end: number) =>
    buffer.subarray(start, end).toString('latin1');
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { extension: '.wav', contentType: 'audio/wav' };
  if (ascii(4, 8) === 'ftyp')
    return { extension: '.m4a', contentType: 'audio/mp4' };
  // MP3 帧同步：11 个 1，且 layer 不为 0（layer 为 0 的是 AAC ADTS）
  const mpegFrame =
    buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) > 0;
  if (ascii(0, 3) === 'ID3' || mpegFrame)
    return { extension: '.mp3', contentType: 'audio/mpeg' };
  return null;
}

/**
 * @description 从上传文件名得到展示名：multer 按 latin1 解出的中文名还原成 UTF-8，去扩展名并压缩空白，最多 60 字。
 * @keyword-cn 音乐展示名, 中文文件名还原
 * @keyword-en music-display-name, decode-upload-name
 * @param {string} originalName multipart 里的文件名。
 * @returns {string} 展示名，取不到时为「未命名音乐」。
 */
export function musicNameFromFile(originalName: string): string {
  const raw = String(originalName ?? '');
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  // 已含超出单字节范围的字符，说明上游解码过，不能再按 latin1 还原
  const alreadyDecoded = Array.from(raw).some(
    (char) => char.charCodeAt(0) > 0xff,
  );
  const readable = alreadyDecoded || decoded.includes('�') ? raw : decoded;
  const name = readable
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return name || '未命名音乐';
}
