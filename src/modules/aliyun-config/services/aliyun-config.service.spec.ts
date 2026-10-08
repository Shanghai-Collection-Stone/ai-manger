import type { Db } from 'mongodb';
import { AliyunConfigCryptoService } from './aliyun-config-crypto.service';
import {
  AliyunConfigService,
  normalizeOssRegion,
  readEnvOssSummary,
  resolveOssEndpoint,
} from './aliyun-config.service';

type Doc = Record<string, unknown>;

/** 只支持本服务用到的单文档 findOne / updateOne（$set / $unset / $setOnInsert / upsert）的内存集合 */
function createFakeDb(seed: Record<string, Doc[]> = {}): Db {
  const store: Record<string, Doc[]> = { ...seed };
  const matches = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, value]): boolean => {
      if (key === '$or') {
        return (value as Doc[]).some((clause): boolean => matches(doc, clause));
      }
      if (value && typeof value === 'object' && '$exists' in value) {
        return key in doc === (value as { $exists: boolean }).$exists;
      }
      return doc[key] === value;
    });
  const collection = (name: string) => {
    store[name] ??= [];
    const rows = store[name];
    return {
      createIndex: () => Promise.resolve('ok'),
      findOne: (filter: Doc) =>
        Promise.resolve(rows.find((doc) => matches(doc, filter)) ?? null),
      updateOne: (
        filter: Doc,
        update: { $set?: Doc; $unset?: Doc; $setOnInsert?: Doc },
        options?: { upsert?: boolean },
      ) => {
        let doc = rows.find((row) => matches(row, filter));
        if (!doc && options?.upsert) {
          if (rows.some((row) => row.scopeId === filter.scopeId)) {
            return Promise.reject(new Error('E11000 duplicate key'));
          }
          doc = { ...(update.$setOnInsert ?? {}) };
          rows.push(doc);
        }
        if (doc) {
          Object.assign(doc, update.$set ?? {});
          for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
        }
        return Promise.resolve({ matchedCount: doc ? 1 : 0 });
      },
    };
  };
  return { collection } as unknown as Db;
}

describe('阿里云配置辅助函数', () => {
  it('地域缺 oss- 前缀时补上，endpoint 缺省按地域推导', () => {
    expect(normalizeOssRegion('cn-shanghai')).toBe('oss-cn-shanghai');
    expect(normalizeOssRegion(' OSS-CN-Hangzhou ')).toBe('oss-cn-hangzhou');
    expect(normalizeOssRegion('oss-cn-shanghai.aliyuncs.com')).toBe(
      'oss-cn-shanghai',
    );
    expect(resolveOssEndpoint('', 'oss-cn-shanghai')).toBe(
      'oss-cn-shanghai.aliyuncs.com',
    );
    expect(
      resolveOssEndpoint('https://x.aliyuncs.com/', 'oss-cn-shanghai'),
    ).toBe('x.aliyuncs.com');
  });
});

describe('AliyunConfigService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('OSS_')) delete process.env[key];
    }
    process.env.SMS_ENCRYPTION_KEY = 'unit-test-key';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('保存后 OSS Secret 只回掩码，OSS 齐全才按后台配置生效', async () => {
    const service = new AliyunConfigService(
      createFakeDb(),
      new AliyunConfigCryptoService(),
    );
    await service.onModuleInit();
    service.onModuleDestroy();
    expect(service.readOssConfig()).toBeNull();

    const view = await service.save(
      {
        oss: {
          accessKeyId: 'LTAI-test',
          accessKeySecret: 'secret-1234',
          region: 'cn-shanghai',
          bucket: 'demo-bucket',
        },
      },
      'admin-1',
    );
    expect(view.oss.accessKeyId).toBe('LTAI-test');
    expect(view.oss.accessKeySecretMasked).toBe('****1234');
    expect(view.oss.effectiveSource).toBe('admin');
    expect(view.oss.publicUrlPrefix).toBe(
      'https://demo-bucket.oss-cn-shanghai.aliyuncs.com/video-library/',
    );
    expect(service.readOssConfig()).toMatchObject({
      bucket: 'demo-bucket',
      endpoint: 'oss-cn-shanghai.aliyuncs.com',
      accessKeySecret: 'secret-1234',
    });

    const cleared = await service.save(
      { oss: { accessKeySecret: '' } },
      'admin-1',
    );
    expect(service.readOssConfig()).toBeNull();
    expect(cleared.oss).toMatchObject({
      accessKeyId: 'LTAI-test',
      hasAccessKeySecret: false,
      bucket: 'demo-bucket',
    });
  });

  it('只传部分字段时（DTO 未传字段为 undefined）不覆盖已保存的 OSS 设置与密钥', async () => {
    const service = new AliyunConfigService(
      createFakeDb(),
      new AliyunConfigCryptoService(),
    );
    await service.onModuleInit();
    service.onModuleDestroy();
    await service.save(
      {
        oss: {
          accessKeyId: 'LTAI-oss',
          accessKeySecret: 'secret-1234',
          region: 'oss-cn-shanghai',
          bucket: 'demo-bucket',
          rootDir: 'media',
        },
      },
      'admin-1',
    );
    await service.save(
      {
        oss: {
          accessKeyId: undefined,
          accessKeySecret: 'secret-5678',
          region: undefined,
          bucket: undefined,
          rootDir: undefined,
        },
      },
      'admin-1',
    );
    expect(service.readOssConfig()).toMatchObject({
      accessKeyId: 'LTAI-oss',
      accessKeySecret: 'secret-5678',
      bucket: 'demo-bucket',
      rootDir: 'media',
    });
  });

  it('后台没配 OSS 时标出环境变量来源', async () => {
    process.env.OSS_REGION = 'oss-cn-hangzhou';
    process.env.OSS_BUCKET = 'env-bucket';
    process.env.OSS_ACCESS_KEY_ID = 'ak';
    process.env.OSS_ACCESS_KEY_SECRET = 'sk';
    expect(readEnvOssSummary().configured).toBe(true);
    const service = new AliyunConfigService(
      createFakeDb(),
      new AliyunConfigCryptoService(),
    );
    await service.onModuleInit();
    service.onModuleDestroy();
    const view = await service.getView();
    expect(view.oss.effectiveSource).toBe('env');
    expect(view.oss.publicUrlPrefix).toBe(
      'https://env-bucket.oss-cn-hangzhou.aliyuncs.com/video-library/',
    );
  });

  it('短信配置里的 AccessKey 不会被当作 OSS 密钥', async () => {
    const crypto = new AliyunConfigCryptoService();
    const db = createFakeDb({
      sms_settings: [
        {
          scopeId: '__platform__',
          accessKeyId: 'LTAI-sms',
          accessKeySecret: crypto.encrypt('sms-secret-9876'),
        },
      ],
    });
    const service = new AliyunConfigService(db, crypto);
    await service.onModuleInit();
    service.onModuleDestroy();
    const view = await service.save(
      { oss: { region: 'oss-cn-shanghai', bucket: 'demo-bucket' } },
      'admin-1',
    );
    expect(service.readOssConfig()).toBeNull();
    expect(view.oss).toMatchObject({
      accessKeyId: '',
      hasAccessKeySecret: false,
      effectiveSource: 'none',
    });
  });

  it('OSS 自检：未配置直接失败，已配置时调用对象存储注册的自检', async () => {
    const service = new AliyunConfigService(
      createFakeDb(),
      new AliyunConfigCryptoService(),
    );
    await service.onModuleInit();
    service.onModuleDestroy();
    await expect(service.probeOss()).resolves.toEqual({
      ok: false,
      source: 'none',
      message: 'OSS_NOT_CONFIGURED',
    });
    await service.save(
      {
        oss: {
          accessKeyId: 'ak',
          accessKeySecret: 'sk',
          region: 'oss-cn-shanghai',
          bucket: 'demo-bucket',
        },
      },
      'admin-1',
    );
    service.registerOssProbe(() => Promise.resolve({ ok: true }));
    await expect(service.probeOss()).resolves.toEqual({
      ok: true,
      source: 'admin',
    });
  });
});
