import { ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ObjectId, type Db } from 'mongodb';
import type { MailTemplateContent } from '../../mail/entities/mail.entity';
import type { MailService } from '../../mail/services/mail.service';
import { EmailCodeGuard } from '../guards/email-code.guard';
import { EmailVerificationService } from './email-verification.service';

type Doc = Record<string, unknown>;

/** 比较单个字段条件：支持相等、$lt、$gte、$exists（ObjectId / Date 按值比较） */
function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected);
  }
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    const ops = expected as Record<string, unknown>;
    if ('$exists' in ops) return (actual !== undefined) === ops.$exists;
    if ('$lt' in ops) return (actual as number) < (ops.$lt as number);
    if ('$gte' in ops) {
      return (actual as Date).getTime() >= (ops.$gte as Date).getTime();
    }
  }
  return actual === expected;
}

/** 只支持本服务用到的集合操作的内存 Db：rows 是验证码集合，accounts 是账号集合（用于注册场景发码前查重） */
function createFakeDb(): { db: Db; rows: Doc[]; accounts: Doc[] } {
  const rows: Doc[] = [];
  const accounts: Doc[] = [];
  const codes = createFakeCollection(rows);
  const accountCollection = createFakeCollection(accounts);
  const db = {
    collection: (name: string) =>
      name === 'admin_accounts' ? accountCollection : codes,
  } as unknown as Db;
  return { db, rows, accounts };
}

/** 基于内存数组的单个集合 */
function createFakeCollection(rows: Doc[]) {
  const matches = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, value]) => matchValue(doc[key], value));
  const newest = (filter: Doc): Doc | null =>
    rows
      .filter((doc) => matches(doc, filter))
      .sort(
        (a, b) =>
          (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      )[0] ?? null;
  const collection = {
    createIndex: () => Promise.resolve('ok'),
    insertOne: (doc: Doc) => {
      rows.push({ ...doc });
      return Promise.resolve({ insertedId: doc._id });
    },
    findOne: (filter: Doc) => Promise.resolve(newest(filter)),
    findOneAndUpdate: (filter: Doc, update: { $inc: Record<string, number> }) => {
      const doc = rows.find((row) => matches(row, filter));
      if (doc) {
        for (const [key, step] of Object.entries(update.$inc)) {
          doc[key] = (doc[key] as number) + step;
        }
      }
      return Promise.resolve({ value: doc ?? null });
    },
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
  return collection;
}

/** 记录发送内容的假发信服务，可切换为抛错 */
function createFakeMail(): {
  mail: MailService;
  sent: Array<{ to: string; content: MailTemplateContent }>;
  fail: { error?: Error };
} {
  const sent: Array<{ to: string; content: MailTemplateContent }> = [];
  const fail: { error?: Error } = {};
  const mail = {
    sendTemplate: (to: string, content: MailTemplateContent) => {
      if (fail.error) return Promise.reject(fail.error);
      sent.push({ to, content });
      return Promise.resolve({ messageId: 'test' });
    },
  } as unknown as MailService;
  return { mail, sent, fail };
}

describe('EmailVerificationService', () => {
  it('发码后用邮件里的验证码校验通过，作废后不能再用', async () => {
    const { db } = createFakeDb();
    const { mail, sent } = createFakeMail();
    const service = new EmailVerificationService(db, mail);

    const res = await service.send({
      email: '  User@Example.COM ',
      scene: 'register',
      ip: '1.1.1.1',
    });
    expect(res).toEqual({ expiresInSeconds: 600, resendAfterSeconds: 60 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('user@example.com');
    const code = sent[0].content.code ?? '';
    expect(code).toMatch(/^\d{6}$/);
    expect(sent[0].content.paragraphs.join('')).toContain('注册 AI 营销官账号');

    const verified = await service.verify({
      email: 'user@example.com',
      scene: 'register',
      code,
    });
    expect(verified.email).toBe('user@example.com');
    await expect(service.consume(verified.codeId)).resolves.toBe(true);
    await expect(service.consume(verified.codeId)).resolves.toBe(false);
    await expect(
      service.verify({ email: 'user@example.com', scene: 'register', code }),
    ).rejects.toThrow('EMAIL_CODE_EXPIRED');
  });

  it('验证码错误累计 5 次后失效，换邮箱也不能复用', async () => {
    const { db } = createFakeDb();
    const { mail, sent } = createFakeMail();
    const service = new EmailVerificationService(db, mail);
    await service.send({ email: 'a@example.com', scene: 'register', ip: '' });
    const code = sent[0].content.code ?? '';
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(
      service.verify({ email: 'b@example.com', scene: 'register', code }),
    ).rejects.toThrow('EMAIL_CODE_EXPIRED');
    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.verify({ email: 'a@example.com', scene: 'register', code: wrong }),
      ).rejects.toThrow('EMAIL_CODE_INVALID');
    }
    await expect(
      service.verify({ email: 'a@example.com', scene: 'register', code }),
    ).rejects.toThrow('EMAIL_CODE_TOO_MANY_ATTEMPTS');
  });

  it('注册场景邮箱已注册：不发信直接报已注册，但这次请求计入频控，留下的记录也不能拿来校验', async () => {
    const { db, rows, accounts } = createFakeDb();
    const { mail, sent } = createFakeMail();
    const service = new EmailVerificationService(db, mail);
    accounts.push({ _id: new ObjectId(), email: 'taken@example.com' });

    await expect(
      service.send({ email: ' Taken@Example.com ', scene: 'register', ip: '2.2.2.2' }),
    ).rejects.toThrow('EMAIL_ALREADY_REGISTERED');
    expect(sent).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockedReason: 'registered', ip: '2.2.2.2' });
    await expect(
      service.send({ email: 'taken@example.com', scene: 'register', ip: '2.2.2.2' }),
    ).rejects.toThrow('EMAIL_SEND_TOO_FREQUENT');
    await expect(
      service.verify({ email: 'taken@example.com', scene: 'register', code: '123456' }),
    ).rejects.toThrow('EMAIL_CODE_EXPIRED');

    await service.send({ email: 'free@example.com', scene: 'register', ip: '2.2.2.2' });
    expect(sent).toHaveLength(1);
  });

  it('60 秒内重发被拒绝，邮箱格式错误直接拒绝', async () => {
    const { db } = createFakeDb();
    const { mail } = createFakeMail();
    const service = new EmailVerificationService(db, mail);
    await service.send({ email: 'a@example.com', scene: 'register', ip: '' });
    await expect(
      service.send({ email: 'a@example.com', scene: 'register', ip: '' }),
    ).rejects.toThrow('EMAIL_SEND_TOO_FREQUENT');
    await expect(
      service.send({ email: 'not-an-email', scene: 'register', ip: '' }),
    ).rejects.toThrow('EMAIL_ADDRESS_INVALID');
    await expect(
      service.send({ email: 'a@example.com', scene: 'login', ip: '' }),
    ).rejects.toThrow('EMAIL_SCENE_INVALID');
  });

  it('发信失败删除记录不占额度，未配置与 SMTP 错误分别映射且不泄露原始错误', async () => {
    const { db, rows } = createFakeDb();
    const { mail, fail } = createFakeMail();
    const service = new EmailVerificationService(db, mail);

    fail.error = new ServiceUnavailableException('MAIL_NOT_CONFIGURED');
    await expect(
      service.send({ email: 'a@example.com', scene: 'register', ip: '' }),
    ).rejects.toThrow('EMAIL_NOT_CONFIGURED');
    expect(rows).toHaveLength(0);

    fail.error = new ServiceUnavailableException({
      code: 'MAIL_SEND_FAILED',
      message: '535 Authentication failed: secret-user',
    });
    const error = await service
      .send({ email: 'a@example.com', scene: 'register', ip: '' })
      .then(
        () => undefined,
        (err: unknown) => err as ServiceUnavailableException,
      );
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(error?.getResponse())).not.toContain('secret-user');
    expect(error?.message).toBe('EMAIL_SEND_FAILED');
    expect(rows).toHaveLength(0);
  });
});

describe('EmailCodeGuard', () => {
  /** 构造只带 body 与 headers 的执行上下文 */
  const contextOf = (req: Record<string, unknown>): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: () => 'register' } as unknown as Reflector;

  it('校验通过后移除 emailCode、邮箱换成规范化值并挂上可信邮箱', async () => {
    const { db } = createFakeDb();
    const { mail, sent } = createFakeMail();
    const service = new EmailVerificationService(db, mail);
    await service.send({ email: 'user@example.com', scene: 'register', ip: '' });
    const req: Record<string, unknown> = {
      headers: {},
      body: { email: ' USER@example.com ', emailCode: sent[0].content.code },
    };
    await expect(
      new EmailCodeGuard(reflector, service).canActivate(contextOf(req)),
    ).resolves.toBe(true);
    expect(req.body).toEqual({ email: 'user@example.com' });
    expect(req.emailVerification).toMatchObject({
      email: 'user@example.com',
      scene: 'register',
    });
  });

  it('缺少邮箱或验证码时报 EMAIL_CODE_REQUIRED', async () => {
    const { db } = createFakeDb();
    const { mail } = createFakeMail();
    const guard = new EmailCodeGuard(
      reflector,
      new EmailVerificationService(db, mail),
    );
    await expect(
      guard.canActivate(contextOf({ headers: {}, body: { email: 'a@b.com' } })),
    ).rejects.toThrow('EMAIL_CODE_REQUIRED');
  });
});
