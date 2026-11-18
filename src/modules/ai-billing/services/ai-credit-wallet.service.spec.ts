import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { AiCreditWalletService } from './ai-credit-wallet.service';

const SCALE = 1_000_000;
const TENANT_ID = new ObjectId();
const MEMBER_ID = new ObjectId();
const ACCOUNT_ID = new ObjectId().toHexString();

/**
 * @description 构造钱包服务会用到的集合方法的假 Db，按集合名返回独立 jest mock。
 * @keyword-cn 钱包假数据库, 集合模拟
 * @keyword-en wallet-fake-db, collection-mock
 */
function createWalletDb() {
  const make = () => ({
    createIndex: jest.fn().mockResolvedValue('ok'),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  });
  const collections: Record<string, ReturnType<typeof make>> = {
    ai_credit_wallets: make(),
    sass_tenants: make(),
    admin_users: make(),
    ai_credit_transactions: make(),
  };
  const db = {
    collection: (name: string) => collections[name],
  } as unknown as Db;
  return {
    db,
    wallets: collections.ai_credit_wallets,
    tenants: collections.sass_tenants,
    users: collections.admin_users,
    transactions: collections.ai_credit_transactions,
  };
}

/**
 * @description 生成一个有限额度租户文档样本。
 * @keyword-cn 租户样本, 额度模式
 * @keyword-en tenant-fixture, credit-mode
 */
function tenantDoc(
  mode: 'shared' | 'allocated',
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: TENANT_ID,
    name: '测试租户',
    credit: 10,
    creditUnits: 10 * SCALE,
    creditMode: mode,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

/**
 * @description 生成已关联手机号账号的成员付款顺序：成员租户额度 → 个人额度。
 * @keyword-cn 成员付款顺序, 个人额度
 * @keyword-en member-payer-order, personal-credit
 */
function memberPayers() {
  const tenantId = TENANT_ID.toHexString();
  const memberId = MEMBER_ID.toHexString();
  return [
    {
      kind: 'member' as const,
      ownerId: memberId,
      tenantId,
      memberId,
      accountId: ACCOUNT_ID,
    },
    {
      kind: 'account' as const,
      ownerId: ACCOUNT_ID,
      tenantId,
      memberId,
      accountId: ACCOUNT_ID,
    },
  ];
}

describe('AiCreditWalletService.resolvePayers', () => {
  it('分配模式先扣成员在本租户的额度，再扣个人额度', async () => {
    const fake = createWalletDb();
    fake.users.findOne.mockResolvedValue({
      _id: MEMBER_ID,
      tenantId: TENANT_ID.toHexString(),
      accountId: ACCOUNT_ID,
    });
    const service = new AiCreditWalletService(fake.db);

    const payers = await service.resolvePayers(
      tenantDoc('allocated'),
      MEMBER_ID.toHexString(),
    );

    expect(payers.map((item) => item.kind)).toEqual(['member', 'account']);
    expect(fake.users.findOne).toHaveBeenCalledWith({
      _id: MEMBER_ID,
      tenantId: TENANT_ID.toHexString(),
    });
  });

  it('共用模式先扣租户余额，再扣个人额度', async () => {
    const fake = createWalletDb();
    fake.users.findOne.mockResolvedValue({
      _id: MEMBER_ID,
      tenantId: TENANT_ID.toHexString(),
      accountId: ACCOUNT_ID,
    });
    const service = new AiCreditWalletService(fake.db);

    const payers = await service.resolvePayers(
      tenantDoc('shared'),
      MEMBER_ID.toHexString(),
    );

    expect(payers.map((item) => item.kind)).toEqual(['tenant', 'account']);
  });

  it('查不到调用成员（系统任务）只扣租户余额', async () => {
    const fake = createWalletDb();
    const service = new AiCreditWalletService(fake.db);

    const payers = await service.resolvePayers(tenantDoc('allocated'));

    expect(payers).toEqual([
      {
        kind: 'tenant',
        ownerId: TENANT_ID.toHexString(),
        tenantId: TENANT_ID.toHexString(),
      },
    ]);
    expect(fake.users.findOne).not.toHaveBeenCalled();
  });
});

describe('AiCreditWalletService.debit', () => {
  it('成员额度不够时先扣光成员额度，差额从个人额度补齐并各记一笔流水', async () => {
    const fake = createWalletDb();
    fake.wallets.findOneAndUpdate
      .mockResolvedValueOnce({ value: { creditUnits: 0.3 * SCALE } })
      .mockResolvedValueOnce({ value: { creditUnits: 4.3 * SCALE } });
    const service = new AiCreditWalletService(fake.db);

    const result = await service.debit({
      payers: memberPayers(),
      units: SCALE,
      meta: { type: 'service_charge', reason: '生文服务消费' },
    });

    expect(result.allocations.map((item) => [item.kind, item.units])).toEqual([
      ['member', 0.3 * SCALE],
      ['account', 0.7 * SCALE],
    ]);
    expect(fake.wallets.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        walletKey: `account:${ACCOUNT_ID}`,
        creditUnits: { $gte: 0.7 * SCALE },
      },
      expect.objectContaining({ $inc: { creditUnits: -0.7 * SCALE } }),
      expect.anything(),
    );
    expect(fake.transactions.insertOne).toHaveBeenCalledTimes(2);
    expect(fake.transactions.insertOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        wallet: 'member',
        amountUnits: -0.3 * SCALE,
        balanceAfter: 0,
      }),
    );
    expect(fake.transactions.insertOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        wallet: 'account',
        accountId: ACCOUNT_ID,
        amountUnits: -0.7 * SCALE,
        balanceAfter: 4.3,
      }),
    );
  });

  it('两个钱包加起来都不够时把已扣的成员额度加回去并抛 CREDIT_EXHAUSTED，不写流水', async () => {
    const fake = createWalletDb();
    fake.wallets.findOneAndUpdate
      .mockResolvedValueOnce({ value: { creditUnits: 0.3 * SCALE } })
      .mockResolvedValueOnce({ value: null })
      .mockResolvedValueOnce({ value: { creditUnits: 0.3 * SCALE } });
    const service = new AiCreditWalletService(fake.db);

    await expect(
      service.debit({
        payers: memberPayers(),
        units: SCALE,
        meta: { type: 'service_charge', reason: '生文服务消费' },
      }),
    ).rejects.toThrow('CREDIT_EXHAUSTED');
    expect(fake.wallets.findOneAndUpdate).toHaveBeenLastCalledWith(
      { walletKey: `member:${MEMBER_ID.toHexString()}` },
      expect.objectContaining({ $inc: { creditUnits: 0.3 * SCALE } }),
      expect.objectContaining({ upsert: true }),
    );
    expect(fake.transactions.insertOne).not.toHaveBeenCalled();
  });

  it('partial 追加预扣时余额不够整块也取光尾款，不抛错', async () => {
    const fake = createWalletDb();
    fake.wallets.findOneAndUpdate
      .mockResolvedValueOnce({ value: null })
      .mockResolvedValueOnce({ value: { creditUnits: 200 } });
    const service = new AiCreditWalletService(fake.db);

    const result = await service.debit({
      payers: memberPayers(),
      units: 500,
      partial: true,
      meta: { type: 'provider_charge', reason: '模型追加预扣' },
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({ kind: 'account', units: 200 }),
    ]);
  });
});

describe('AiCreditWalletService.refund', () => {
  it('从后往前原路退：先退个人额度，再退成员额度', async () => {
    const fake = createWalletDb();
    fake.wallets.findOneAndUpdate.mockResolvedValue({
      value: { creditUnits: 5 * SCALE },
    });
    const service = new AiCreditWalletService(fake.db);
    const [member, account] = memberPayers();

    const result = await service.refund({
      allocations: [
        { ...member, units: 0.3 * SCALE },
        { ...account, units: 0.7 * SCALE },
      ],
      units: 0.5 * SCALE,
      meta: { type: 'refund', reason: '模型预扣退款' },
    });

    expect(result.refundedUnits).toBe(0.5 * SCALE);
    expect(fake.wallets.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(fake.wallets.findOneAndUpdate).toHaveBeenCalledWith(
      { walletKey: `account:${ACCOUNT_ID}` },
      expect.objectContaining({ $inc: { creditUnits: 0.5 * SCALE } }),
      expect.anything(),
    );
    expect(result.remaining.map((item) => [item.kind, item.units])).toEqual([
      ['member', 0.3 * SCALE],
      ['account', 0.2 * SCALE],
    ]);
  });
});

describe('AiCreditWalletService.grantNewMember', () => {
  it('共用模式租户不赠送，也不碰钱包', async () => {
    const fake = createWalletDb();
    const service = new AiCreditWalletService(fake.db);

    const units = await service.grantNewMember(
      tenantDoc('shared', { memberCreditGrant: 5 }),
      { memberId: MEMBER_ID.toHexString() },
    );

    expect(units).toBe(0);
    expect(fake.wallets.updateOne).not.toHaveBeenCalled();
  });

  it('同一成员已经领过（唯一键冲突）时不再赠送', async () => {
    const fake = createWalletDb();
    fake.wallets.updateOne.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    const service = new AiCreditWalletService(fake.db);

    const units = await service.grantNewMember(
      tenantDoc('allocated', { memberCreditGrant: 5 }),
      { memberId: MEMBER_ID.toHexString() },
    );

    expect(units).toBe(0);
    expect(fake.tenants.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('待分配额度够时从租户划给新成员，写出入两笔赠送流水', async () => {
    const fake = createWalletDb();
    fake.tenants.findOne.mockResolvedValue(tenantDoc('allocated'));
    fake.tenants.findOneAndUpdate.mockResolvedValue({
      value: { creditUnits: 5 * SCALE },
    });
    fake.wallets.findOneAndUpdate.mockResolvedValue({
      value: { creditUnits: 5 * SCALE },
    });
    const service = new AiCreditWalletService(fake.db);

    const units = await service.grantNewMember(
      tenantDoc('allocated', { memberCreditGrant: 5 }),
      { memberId: MEMBER_ID.toHexString() },
    );

    expect(units).toBe(5 * SCALE);
    expect(fake.tenants.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TENANT_ID, credit: { $ne: -1 }, creditUnits: { $gte: 5 * SCALE } },
      expect.objectContaining({
        $inc: { creditUnits: -5 * SCALE, credit: -5 },
      }),
      expect.anything(),
    );
    expect(fake.transactions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: 'tenant',
        type: 'registration_grant',
        amountUnits: -5 * SCALE,
      }),
    );
    expect(fake.transactions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: 'member',
        type: 'registration_grant',
        amountUnits: 5 * SCALE,
      }),
    );
  });
});
