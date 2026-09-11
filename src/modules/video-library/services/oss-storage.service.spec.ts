import { createHmac } from 'crypto';
import { OssStorageService } from './oss-storage.service';

/**
 * @description OSS 直传票据签发的回归测试。签名和策略是**前端唯一能拿到的授权**，
 *   写错了不会在开发期报错——OSS 会在用户传完几百 MB 之后才拒收，所以逐条钉死。
 * @keyword-cn OSS签名测试, 直传票据测试
 * @keyword-en oss-signature-test, upload-ticket-test
 */
describe('OssStorageService', () => {
  const ENV_KEYS = [
    'OSS_REGION',
    'OSS_BUCKET',
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_ENDPOINT',
    'OSS_PUBLIC_BASE_URL',
    'OSS_VIDEO_LIBRARY_DIR',
    'OSS_VIDEO_MAX_BYTES',
    'OSS_POSTER_MAX_BYTES',
    'OSS_SIGNATURE_EXPIRE_SECONDS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_KEYS.forEach((key) => {
      saved[key] = process.env[key];
      delete process.env[key];
    });
    process.env.OSS_REGION = 'oss-cn-hangzhou';
    process.env.OSS_BUCKET = 'demo-bucket';
    process.env.OSS_ACCESS_KEY_ID = 'ak-test';
    process.env.OSS_ACCESS_KEY_SECRET = 'sk-test';
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  /**
   * @description 解出票据里的策略 JSON。
   * @keyword-cn 策略解码
   * @keyword-en decode-policy
   * @param {string} policy - base64 策略。
   * @returns {{expiration: string, conditions: unknown[]}} 策略内容。
   */
  const decodePolicy = (
    policy: string,
  ): { expiration: string; conditions: unknown[] } =>
    JSON.parse(Buffer.from(policy, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };

  it('签名是策略串的 HMAC-SHA1，策略锁死了对象键与大小上限', () => {
    const service = new OssStorageService();
    const ticket = service.createUploadTicket({
      scene: 'video',
      fileName: 'demo.mp4',
      contentType: 'video/mp4',
      tenantId: 'tenant-1',
    });

    const expected = createHmac('sha1', 'sk-test')
      .update(ticket.formFields.policy, 'utf8')
      .digest('base64');
    expect(ticket.formFields.Signature).toBe(expected);
    expect(ticket.formFields.OSSAccessKeyId).toBe('ak-test');
    expect(ticket.formFields.success_action_status).toBe('200');
    expect(ticket.formFields['Content-Type']).toBe('video/mp4');
    expect(ticket.formFields.key).toBe(ticket.key);
    expect(ticket.host).toBe(
      'https://demo-bucket.oss-cn-hangzhou.aliyuncs.com',
    );

    const policy = decodePolicy(ticket.formFields.policy);
    expect(policy.conditions).toContainEqual({ bucket: 'demo-bucket' });
    expect(policy.conditions).toContainEqual(['eq', '$key', ticket.key]);
    expect(policy.conditions).toContainEqual([
      'content-length-range',
      0,
      ticket.maxSizeBytes,
    ]);
    expect(policy.conditions).toContainEqual([
      'eq',
      '$Content-Type',
      'video/mp4',
    ]);
    expect(new Date(policy.expiration).getTime()).toBeGreaterThan(Date.now());
  });

  it('封面场景走自己的目录与更小的上限', () => {
    process.env.OSS_POSTER_MAX_BYTES = '1024';
    const service = new OssStorageService();
    const ticket = service.createUploadTicket({
      scene: 'poster',
      fileName: 'demo.jpg',
      contentType: 'image/jpeg',
      tenantId: 'tenant-1',
    });
    expect(ticket.key.startsWith('video-library/poster/tenant-1/')).toBe(true);
    expect(ticket.maxSizeBytes).toBe(1024);
  });

  it('对象键只保留扩展名，穿越与非法字符不会进 key', () => {
    const service = new OssStorageService();
    const key = service.buildObjectKey({
      scene: 'video',
      fileName: '../../etc/passwd 我的视频.MP4',
      tenantId: '../tenant one',
    });
    expect(key).not.toContain('..');
    expect(key).not.toContain(' ');
    expect(key).toMatch(
      /^video-library\/video\/tenantone\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp4$/,
    );
  });

  it('无租户时落到 platform 前缀', () => {
    const service = new OssStorageService();
    const key = service.buildObjectKey({ scene: 'video', fileName: 'a.mov' });
    expect(key.startsWith('video-library/video/platform/')).toBe(true);
  });

  it('可播放地址优先用 CDN 域名', () => {
    const service = new OssStorageService();
    expect(service.publicUrl('video-library/video/a.mp4')).toBe(
      'https://demo-bucket.oss-cn-hangzhou.aliyuncs.com/video-library/video/a.mp4',
    );
    process.env.OSS_PUBLIC_BASE_URL = 'https://cdn.example.com/';
    expect(service.publicUrl('video-library/video/a.mp4')).toBe(
      'https://cdn.example.com/video-library/video/a.mp4',
    );
  });

  it('可疑的 Content-Type 不进签名策略', () => {
    const service = new OssStorageService();
    const ticket = service.createUploadTicket({
      scene: 'video',
      fileName: 'demo.mp4',
      contentType: 'video/mp4; boundary=--x\nX-Injected: 1',
    });
    expect(ticket.formFields['Content-Type']).toBeUndefined();
    const policy = decodePolicy(ticket.formFields.policy);
    expect(
      policy.conditions.some(
        (item) => Array.isArray(item) && item[1] === '$Content-Type',
      ),
    ).toBe(false);
  });

  it('OSS 未配置时签票据直接 503，不静默降级到本地磁盘', () => {
    delete process.env.OSS_ACCESS_KEY_SECRET;
    const service = new OssStorageService();
    expect(service.isConfigured()).toBe(false);
    expect(() =>
      service.createUploadTicket({ scene: 'video', fileName: 'a.mp4' }),
    ).toThrow('OSS_NOT_CONFIGURED');
  });
});
