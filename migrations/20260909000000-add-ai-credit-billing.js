/**
 * @description 为历史租户补齐 Credit，并创建服务配置、服务用量和追加式余额流水索引。
 * @keyword-cn AI计费迁移, Credit流水
 * @keyword-en ai-billing-migration, credit-ledger
 */
async function up(db) {
  await db
    .collection('sass_tenants')
    .updateMany(
      { credit: { $exists: false } },
      { $set: { credit: -1, creditUnits: -1 } },
    );
  const usages = db.collection('ai_usage_records');
  await usages.createIndex({ callId: 1 }, { unique: true });
  await usages.createIndex({ tenantId: 1, createdAt: -1 });
  await usages.createIndex({ sessionId: 1, createdAt: -1 });
  await usages.createIndex({ operationId: 1, createdAt: -1 });
  const serviceConfigs = db.collection('ai_service_credit_configs');
  await serviceConfigs.createIndex({ serviceCode: 1 }, { unique: true });
  const serviceUsages = db.collection('ai_service_usage_records');
  await serviceUsages.createIndex({ chargeId: 1 }, { unique: true });
  await serviceUsages.createIndex({ tenantId: 1, createdAt: -1 });
  await serviceUsages.createIndex({ operationId: 1, createdAt: -1 });
  const transactions = db.collection('ai_credit_transactions');
  await transactions.createIndex({ transactionId: 1 }, { unique: true });
  await transactions.createIndex({ tenantId: 1, createdAt: -1 });
  await transactions.createIndex(
    { tenantId: 1, referenceId: 1 },
    {
      name: 'admin_credit_reference_unique',
      unique: true,
      partialFilterExpression: {
        operatorType: 'admin',
        referenceId: { $type: 'string' },
      },
    },
  );
  const tenants = await db.collection('sass_tenants').find({}).toArray();
  if (tenants.length > 0) {
    await transactions.bulkWrite(
      tenants.map((tenant) => {
        const tenantId = String(tenant._id);
        const credit = typeof tenant.credit === 'number' ? tenant.credit : -1;
        return {
          updateOne: {
            filter: { transactionId: `migration:${tenantId}` },
            update: {
              $setOnInsert: {
                transactionId: `migration:${tenantId}`,
                tenantId,
                type: 'initial_credit',
                amount: credit,
                amountUnits:
                  credit === -1 ? -1 : Math.round(credit * 1_000_000),
                balanceBefore: 0,
                balanceAfter: credit,
                reason: '历史余额迁移',
                operatorType: 'system',
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      }),
    );
  }
}

/**
 * @description 回滚 AI 用量、服务计费和 Credit 流水集合及租户余额字段。
 * @keyword-cn AI计费回滚, Credit流水清理
 * @keyword-en ai-billing-rollback, credit-ledger-cleanup
 */
async function down(db) {
  await db
    .collection('ai_usage_records')
    .drop()
    .catch(() => undefined);
  for (const collectionName of [
    'ai_service_credit_configs',
    'ai_service_usage_records',
    'ai_credit_transactions',
  ]) {
    await db
      .collection(collectionName)
      .drop()
      .catch(() => undefined);
  }
  await db
    .collection('sass_tenants')
    .updateMany({}, { $unset: { credit: '', creditUnits: '' } });
}

module.exports = { up, down };
