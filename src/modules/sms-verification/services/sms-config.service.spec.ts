import type { Db } from 'mongodb';
import { SmsConfigService } from './sms-config.service';
import { SmsCryptoService } from './sms-crypto.service';

type Doc = Record<string, unknown>;

/** 只支持本服务用到的单文档 findOne / updateOne 的内存集合；同一字段出现在多个更新操作符里时像 Mongo 一样报错 */
function createFakeDb(): Db {
  const rows: Doc[] = [];
  const collection = {
    createIndex: () => Promise.resolve('ok'),
    findOne: (filter: Doc) =>
      Promise.resolve(
        rows.find((doc) => doc.scopeId === filter.scopeId) ?? null,
      ),
    updateOne: (
      filter: Doc,
      update: { $set?: Doc; $unset?: Doc; $setOnInsert?: Doc },
      options?: { upsert?: boolean },
    ) => {
      const paths = [update.$set, update.$unset, update.$setOnInsert].flatMap(
        (part) => Object.keys(part ?? {}),
      );
      const conflict = paths.find(
        (path, index) => paths.indexOf(path) !== index,
      );
      if (conflict) {
        return Promise.reject(
          new Error(
            `Updating the path '${conflict}' would create a conflict at '${conflict}'`,
          ),
        );
      }
      let doc = rows.find((row) => row.scopeId === filter.scopeId);
      if (!doc && options?.upsert) {
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
  return { collection: () => collection } as unknown as Db;
}

describe('SmsConfigService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SMS_ENCRYPTION_KEY = 'unit-test-key';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('首次保存带接口类型时不与缺省值冲突，短信专用 AccessKey 只回掩码', async () => {
    const service = new SmsConfigService(createFakeDb(), new SmsCryptoService());
    const view = await service.save(
      {
        provider: 'aliyun_dypns',
        enabled: true,
        accessKeyId: 'LTAI-sms',
        accessKeySecret: 'sms-secret-1234',
        dypnsSignName: '速通互联验证码',
        dypnsTemplateCode: '100001',
      },
      'admin-1',
    );
    expect(view).toMatchObject({
      provider: 'aliyun_dypns',
      enabled: true,
      accessKeyId: 'LTAI-sms',
      hasAccessKeySecret: true,
      accessKeySecretMasked: '****1234',
      ready: true,
    });
    await expect(service.resolveRuntime()).resolves.toMatchObject({
      provider: 'aliyun_dypns',
      accessKeyId: 'LTAI-sms',
      accessKeySecret: 'sms-secret-1234',
    });
  });

  it('未传接口类型时按 Dysms 建档，清空 Secret 后不再就绪', async () => {
    const service = new SmsConfigService(createFakeDb(), new SmsCryptoService());
    await service.save(
      {
        enabled: true,
        accessKeyId: 'LTAI-sms',
        accessKeySecret: 'sms-secret-1234',
        signName: '签名',
        templateCode: 'SMS_1',
      },
      'admin-1',
    );
    const cleared = await service.save({ accessKeySecret: '' }, 'admin-1');
    expect(cleared).toMatchObject({
      provider: 'aliyun_dysms',
      accessKeyId: 'LTAI-sms',
      hasAccessKeySecret: false,
      ready: false,
    });
  });
});
