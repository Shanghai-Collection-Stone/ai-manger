import { createHash } from 'crypto';
import { ObjectId, type Db } from 'mongodb';
import type { AliyunDypnsService } from './aliyun-dypns.service';
import type { AliyunSmsService } from './aliyun-sms.service';
import type { SmsConfigService } from './sms-config.service';
import type { SmsCryptoService } from './sms-crypto.service';
import { SmsVerificationService } from './sms-verification.service';

type Doc = Record<string, unknown>;

/** 比较单个字段条件：支持相等、$lt、$gt、$gte、$exists（ObjectId / Date 按值比较） */
function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected);
  }
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    const ops = expected as Record<string, unknown>;
    if ('$exists' in ops) return (actual !== undefined) === ops.$exists;
    if ('$lt' in ops) return (actual as number) < (ops.$lt as number);
    if ('$gt' in ops) {
      return (actual as Date).getTime() > (ops.$gt as Date).getTime();
    }
    if ('$gte' in ops) {
      return (actual as Date).getTime() >= (ops.$gte as Date).getTime();
    }
  }
  return actual === expected;
}

/** 基于内存数组的单个集合，只实现本服务用到的操作 */
function createFakeCollection(rows: Doc[]) {
  const matches = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, value]) => matchValue(doc[key], value));
  return {
    createIndex: () => Promise.resolve('ok'),
    insertOne: (doc: Doc) => {
      rows.push({ ...doc });
      return Promise.resolve({ insertedId: doc._id });
    },
    findOne: (filter: Doc) =>
      Promise.resolve(
        rows
          .filter((doc) => matches(doc, filter))
          .sort(
            (a, b) =>
              ((b.createdAt as Date)?.getTime() ?? 0) -
              ((a.createdAt as Date)?.getTime() ?? 0),
          )[0] ?? null,
      ),
    updateOne: (filter: Doc, update: { $set: Doc }) => {
      const doc = rows.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    },
    deleteOne: (filter: Doc) => {
      const index = rows.findIndex((row) => matches(row, filter));
      if (index >= 0) rows.splice(index, 1);
      return Promise.resolve({ deletedCount: index >= 0 ? 1 : 0 });
    },
    countDocuments: (filter: Doc) =>
      Promise.resolve(rows.filter((row) => matches(row, filter)).length),
  };
}

/** 模拟发送模式下的短信验证码服务，验证码集合与账号集合分开 */
function createService(): {
  service: SmsVerificationService;
  rows: Doc[];
  accounts: Doc[];
} {
  const rows: Doc[] = [];
  const accounts: Doc[] = [];
  const codes = createFakeCollection(rows);
  const accountCollection = createFakeCollection(accounts);
  const db = {
    collection: (name: string) =>
      name === 'admin_accounts' ? accountCollection : codes,
  } as unknown as Db;
  const config = {
    isMockMode: () => true,
    resolveRuntime: () => Promise.resolve(null),
  } as unknown as SmsConfigService;
  const crypto = {
    hashCode: (phone: string, scene: string, code: string) =>
      createHash('sha256').update(`${phone}:${scene}:${code}`).digest('hex'),
  } as unknown as SmsCryptoService;
  const service = new SmsVerificationService(
    db,
    config,
    {} as AliyunSmsService,
    {} as AliyunDypnsService,
    crypto,
  );
  return { service, rows, accounts };
}

describe('SmsVerificationService 注册场景发码前查重', () => {
  it('手机号已注册：不发码直接报已注册，这次请求计入频控，留下的记录不能拿来校验', async () => {
    const { service, rows, accounts } = createService();
    accounts.push({ _id: new ObjectId(), phone: '13800138000' });

    await expect(
      service.send({ phone: '13800138000', scene: 'register', ip: '3.3.3.3' }),
    ).rejects.toThrow('PHONE_ALREADY_REGISTERED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockedReason: 'registered', ip: '3.3.3.3' });
    await expect(
      service.send({ phone: '13800138000', scene: 'register', ip: '3.3.3.3' }),
    ).rejects.toThrow('SMS_SEND_TOO_FREQUENT');
    await expect(
      service.verify({ phone: '13800138000', scene: 'register', code: '123456' }),
    ).rejects.toThrow('SMS_CODE_EXPIRED');
  });

  it('手机号未注册：照常发码', async () => {
    const { service, rows } = createService();
    await expect(
      service.send({ phone: '13900139000', scene: 'register', ip: '3.3.3.3' }),
    ).resolves.toMatchObject({ resendAfterSeconds: 60 });
    expect(rows).toHaveLength(1);
    expect(rows[0].blockedReason).toBeUndefined();
  });
});
