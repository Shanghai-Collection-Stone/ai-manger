import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { AiBillingService, CREDIT_UNIT_SCALE } from './ai-billing.service';

const TENANT_ID = new ObjectId();
const OPERATION_ID = 'xhs-article:42:op-1';

/**
 * @description 构造只含退款会用到的集合方法的假 Db，按集合名返回独立的 jest mock。
 * @keyword-cn 假数据库, 集合模拟
 * @keyword-en fake-db, collection-mock
 */
function createFakeDb() {
  const make = () => ({
    createIndex: jest.fn().mockResolvedValue('ok'),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  });
  const collections: Record<string, ReturnType<typeof make>> = {
    sass_tenants: make(),
    ai_usage_records: make(),
    ai_service_credit_configs: make(),
    ai_service_usage_records: make(),
    ai_credit_transactions: make(),
  };
  const db = {
    collection: (name: string) => collections[name],
  } as unknown as Db;
  return {
    db,
    tenants: collections.sass_tenants,
    serviceUsages: collections.ai_service_usage_records,
    transactions: collections.ai_credit_transactions,
  };
}

/**
 * @description 生成一条已成功扣 1 Credit 的服务流水，作为退款抢占返回的 before 文档。
 * @keyword-cn 服务流水样本, 退款前文档
 * @keyword-en service-record-fixture, pre-refund-document
 */
function chargedRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    chargeId: 'charge-1',
    serviceCode: 'text-generation',
    serviceName: '生文服务',
    tenantId: TENANT_ID.toHexString(),
    operationId: OPERATION_ID,
    creditCost: 1,
    chargedUnits: CREDIT_UNIT_SCALE,
    unlimited: false,
    status: 'succeeded',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AiBillingService.refundService', () => {
  it('退回已扣的服务点数并追加一条正向 refund 余额流水', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({
      value: chargedRecord(),
    });
    fake.tenants.findOneAndUpdate.mockResolvedValue({
      value: { _id: TENANT_ID, creditUnits: 5 * CREDIT_UNIT_SCALE },
    });
    const service = new AiBillingService(fake.db);

    const refunded = await service.refundService({
      operationId: OPERATION_ID,
      reason: 'XHS_ARTICLE_GALLERY_TAGS_EMPTY',
    });

    expect(refunded).toBe(true);
    expect(fake.serviceUsages.findOneAndUpdate).toHaveBeenCalledWith(
      { operationId: OPERATION_ID, status: 'succeeded' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'refunded',
          refundReason: 'XHS_ARTICLE_GALLERY_TAGS_EMPTY',
        }),
      }),
      expect.anything(),
    );
    expect(fake.tenants.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TENANT_ID, credit: { $ne: -1 } },
      expect.objectContaining({
        $inc: { creditUnits: CREDIT_UNIT_SCALE, credit: 1 },
      }),
      expect.anything(),
    );
    expect(fake.transactions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refund',
        amount: 1,
        amountUnits: CREDIT_UNIT_SCALE,
        balanceBefore: 4,
        balanceAfter: 5,
        referenceId: OPERATION_ID,
        serviceCode: 'text-generation',
      }),
    );
  });

  it('已退过或从未扣成功时抢不到退款权，不动余额', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({ value: null });
    const service = new AiBillingService(fake.db);

    const refunded = await service.refundService({
      operationId: OPERATION_ID,
      reason: 'X',
    });

    expect(refunded).toBe(false);
    expect(fake.tenants.findOneAndUpdate).not.toHaveBeenCalled();
    expect(fake.transactions.insertOne).not.toHaveBeenCalled();
  });

  it('扣费时就是无限额度(chargedUnits=0)只翻状态，不加余额', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({
      value: chargedRecord({ chargedUnits: 0, unlimited: true }),
    });
    const service = new AiBillingService(fake.db);

    await expect(
      service.refundService({ operationId: OPERATION_ID, reason: 'X' }),
    ).resolves.toBe(true);
    expect(fake.tenants.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('租户期间被改成无限额度时不追加余额流水', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({
      value: chargedRecord(),
    });
    fake.tenants.findOneAndUpdate.mockResolvedValue({ value: null });
    const service = new AiBillingService(fake.db);

    await expect(
      service.refundService({ operationId: OPERATION_ID, reason: 'X' }),
    ).resolves.toBe(true);
    expect(fake.transactions.insertOne).not.toHaveBeenCalled();
  });

  it('余额加回失败时把流水还原成 succeeded，允许下次重退', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({
      value: chargedRecord(),
    });
    fake.tenants.findOneAndUpdate.mockRejectedValue(new Error('network'));
    const service = new AiBillingService(fake.db);

    await expect(
      service.refundService({ operationId: OPERATION_ID, reason: 'X' }),
    ).rejects.toThrow('network');
    expect(fake.serviceUsages.updateOne).toHaveBeenCalledWith(
      { chargeId: 'charge-1', status: 'refunded' },
      expect.objectContaining({ $set: { status: 'succeeded' } }),
    );
  });

  it('余额已加回但余额流水写失败时不还原状态，避免重复退款', async () => {
    const fake = createFakeDb();
    fake.serviceUsages.findOneAndUpdate.mockResolvedValue({
      value: chargedRecord(),
    });
    fake.tenants.findOneAndUpdate.mockResolvedValue({
      value: { _id: TENANT_ID, creditUnits: CREDIT_UNIT_SCALE },
    });
    fake.transactions.insertOne.mockRejectedValue(new Error('ledger down'));
    const service = new AiBillingService(fake.db);

    await expect(
      service.refundService({ operationId: OPERATION_ID, reason: 'X' }),
    ).resolves.toBe(true);
    expect(fake.serviceUsages.updateOne).not.toHaveBeenCalled();
  });

  it('operationId 为空时直接返回 false', async () => {
    const fake = createFakeDb();
    const service = new AiBillingService(fake.db);

    await expect(
      service.refundService({ operationId: '  ', reason: 'X' }),
    ).resolves.toBe(false);
    expect(fake.serviceUsages.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
