import {
  musicNameFromFile,
  normalizeBackgroundMusic,
  normalizeMusicCategory,
  sniffMusicFormat,
} from './douyin-music-rules.js';

/**
 * @description 按给定文件头补齐成可识别长度的测试文件。
 * @keyword-cn 构造音频文件头, 测试素材
 * @keyword-en build-audio-header, test-fixture
 * @param {number[]|string} head 文件头。
 * @returns {Buffer} 16 字节文件。
 */
function header(head: number[] | string): Buffer {
  const bytes =
    typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head);
  return Buffer.concat([bytes, Buffer.alloc(Math.max(0, 16 - bytes.length))]);
}

describe('douyin music rules', () => {
  it('recognizes real audio by magic bytes and rejects the rest', () => {
    expect(sniffMusicFormat(header('ID3\u0004'))?.extension).toBe('.mp3');
    expect(sniffMusicFormat(header([0xff, 0xfb, 0x90]))?.extension).toBe(
      '.mp3',
    );
    expect(sniffMusicFormat(header('RIFF\0\0\0\0WAVE'))?.extension).toBe(
      '.wav',
    );
    expect(sniffMusicFormat(header('\0\0\0 ftypM4A '))?.extension).toBe('.m4a');
    expect(sniffMusicFormat(header([0xff, 0xf1, 0x50]))).toBeNull();
    expect(sniffMusicFormat(header('<html>not audio'))).toBeNull();
    expect(sniffMusicFormat(Buffer.from('ID3'))).toBeNull();
  });

  it('clamps the setting and keeps the change time when nothing changed', () => {
    const before = new Date('2026-11-01T00:00:00Z');
    const now = new Date('2026-11-23T00:00:00Z');
    const current = { trackId: 5, volume: 30, updatedAt: before };
    expect(
      normalizeBackgroundMusic({ trackId: 5, volume: 30 }, current, now)
        .updatedAt,
    ).toBe(before);
    expect(
      normalizeBackgroundMusic({ trackId: 6, volume: 30 }, current, now)
        .updatedAt,
    ).toBe(now);
    expect(
      normalizeBackgroundMusic({ trackId: 5, volume: 500 }, current, now)
        .volume,
    ).toBe(100);
    expect(
      normalizeBackgroundMusic({ trackId: -3, volume: 0 }, undefined, now),
    ).toEqual({ trackId: 0, volume: 1, updatedAt: now });
    expect(
      normalizeBackgroundMusic({ trackId: 5 }, undefined, now).volume,
    ).toBe(25);
  });

  it('restores Chinese upload names and falls back on unknown categories', () => {
    const garbled = Buffer.from('轻快 午后.mp3', 'utf8').toString('latin1');
    expect(musicNameFromFile(garbled)).toBe('轻快 午后');
    expect(musicNameFromFile('已经正常.wav')).toBe('已经正常');
    expect(musicNameFromFile('.mp3')).toBe('未命名音乐');
    expect(normalizeMusicCategory('warm')).toBe('warm');
    expect(normalizeMusicCategory('constructor')).toBe('other');
  });
});
