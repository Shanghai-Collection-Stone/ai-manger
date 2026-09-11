import { Inject, Injectable, Logger } from '@nestjs/common';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { BaseMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import type { AiCreditTransactionEntity } from '../entities/ai-credit-transaction.entity.js';
import {
  AI_CREDIT_SERVICE_CATALOG,
  type AiCreditServiceCode,
  type AiServiceCreditConfigEntity,
  type AiServiceUsageRecordEntity,
} from '../entities/ai-service-credit.entity.js';
import type {
  AiBillingContext,
  AiProviderBillingSnapshot,
  AiUsageRecordEntity,
} from '../entities/ai-usage-record.entity.js';

/**
 * @description 一个 Credit 拆分成的整数最小计费单位，避免浮点累加误差。
 * @keyword-cn 最小计费单位, Credit精度
 * @keyword-en billing-unit-scale, credit-precision
 */
export const CREDIT_UNIT_SCALE = 1_000_000;

/**
 * @description 流式输出按小块提前占用 Token，余额用尽时尽快终止模型流。
 * @keyword-cn 流式预占, Token分块
 * @keyword-en stream-reservation, token-block
 */
export const STREAM_TOKEN_BLOCK = 16;

interface ActiveCallState {
  callId: string;
  tenantObjectId?: ObjectId;
  unlimited: boolean;
  provider: AiProviderBillingSnapshot;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  reservedTokens: number;
  reservedUnits: number;
}

/**
 * @description LangChain 模型回调，把每次物理 LLM 调用接入统一计量与扣费服务。
 * @keyword-cn 模型计费回调, 流式扣费
 * @keyword-en model-billing-callback, streaming-charge
 */
export class AiBillingCallbackHandler extends BaseCallbackHandler {
  name = 'AiBillingCallbackHandler';

  /**
   * @description 创建阻塞式计费回调，计费异常会终止模型调用。
   * @keyword-cn 计费回调初始化, 失败关闭
   * @keyword-en billing-callback-init, fail-closed
   */
  constructor(
    private readonly billing: AiBillingService,
    private readonly context: AiBillingContext,
    private readonly provider: AiProviderBillingSnapshot,
  ) {
    super({ raiseError: true, _awaitHandler: true });
  }

  /**
   * @description 模型请求发出前登记调用并预扣输入及首个输出块。
   * @keyword-cn 调用前预扣, 输入Token
   * @keyword-en pre-call-reserve, input-token
   */
  async handleChatModelStart(
    _llm: unknown,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    await this.billing.beginTextCall({
      callId: runId,
      parentCallId: parentRunId,
      context: this.context,
      provider: this.provider,
      messages,
    });
  }

  /**
   * @description 每次收到流式文本块时推进输出计量，额度耗尽即抛错中断。
   * @keyword-cn 流式Token扣费, 额度中断
   * @keyword-en streaming-token-charge, credit-interrupt
   */
  async handleLLMNewToken(
    token: string,
    _idx: { prompt: number; completion: number },
    runId: string,
  ): Promise<void> {
    await this.billing.consumeTextChunk(runId, token);
  }

  /**
   * @description 模型完成后使用厂商真实 usage 结算并退回多余预占。
   * @keyword-cn 真实用量结算, 预占退款
   * @keyword-en actual-usage-settlement, reservation-refund
   */
  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    await this.billing.completeTextCall(runId, output);
  }

  /**
   * @description 模型失败时按已经消耗的估算量结算并记录错误。
   * @keyword-cn 失败调用结算, 错误流水
   * @keyword-en failed-call-settlement, error-ledger
   */
  async handleLLMError(error: unknown, runId: string): Promise<void> {
    await this.billing.failTextCall(runId, error);
  }
}

/**
 * @description AI Token 用量、Credit 原子扣减和调用流水服务。
 * @keyword-cn AI计费服务, 原子扣费
 * @keyword-en ai-billing-service, atomic-charge
 */
@Injectable()
export class AiBillingService {
  private readonly logger = new Logger(AiBillingService.name);
  private readonly tenants: Collection<SassTenantEntity>;
  private readonly usages: Collection<AiUsageRecordEntity>;
  private readonly serviceConfigs: Collection<AiServiceCreditConfigEntity>;
  private readonly serviceUsages: Collection<AiServiceUsageRecordEntity>;
  private readonly creditTransactions: Collection<AiCreditTransactionEntity>;
  private readonly activeCalls = new Map<string, ActiveCallState>();
  private readonly creditUnitsReady = new Set<string>();
  private readonly providerBillingSuppression =
    new AsyncLocalStorage<boolean>();

  /**
   * @description 初始化计费集合并异步创建查询与幂等索引。
   * @keyword-cn 计费服务初始化, 用量索引
   * @keyword-en billing-service-init, usage-index
   */
  constructor(@Inject('CTX_MONGO_DB') private readonly db: Db) {
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
    this.usages = db.collection<AiUsageRecordEntity>('ai_usage_records');
    this.serviceConfigs = db.collection<AiServiceCreditConfigEntity>(
      'ai_service_credit_configs',
    );
    this.serviceUsages = db.collection<AiServiceUsageRecordEntity>(
      'ai_service_usage_records',
    );
    this.creditTransactions = db.collection<AiCreditTransactionEntity>(
      'ai_credit_transactions',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 创建 AI 用量集合的幂等与租户时间索引。
   * @keyword-cn 用量索引, 调用幂等
   * @keyword-en usage-index, call-idempotency
   */
  async ensureIndexes(): Promise<void> {
    await this.usages.createIndex({ callId: 1 }, { unique: true });
    await this.usages.createIndex({ tenantId: 1, createdAt: -1 });
    await this.usages.createIndex({ sessionId: 1, createdAt: -1 });
    await this.usages.createIndex({ operationId: 1, createdAt: -1 });
    await this.serviceConfigs.createIndex({ serviceCode: 1 }, { unique: true });
    await this.serviceUsages.createIndex({ chargeId: 1 }, { unique: true });
    await this.serviceUsages.createIndex({ tenantId: 1, createdAt: -1 });
    await this.serviceUsages.createIndex({ operationId: 1, createdAt: -1 });
    await this.creditTransactions.createIndex(
      { transactionId: 1 },
      { unique: true },
    );
    await this.creditTransactions.createIndex({ tenantId: 1, createdAt: -1 });
  }

  /**
   * @description 按代码内固定服务目录读取当前生效的 Credit 点数。
   * @keyword-cn 读取服务价格, 固定目录
   * @keyword-en resolve-service-price, fixed-catalog
   */
  async getServiceCreditCost(
    serviceCode: AiCreditServiceCode,
  ): Promise<number> {
    const definition = AI_CREDIT_SERVICE_CATALOG.find(
      (item) => item.code === serviceCode,
    );
    if (!definition) throw this.billingError('AI_SERVICE_NOT_FOUND');
    const config = await this.serviceConfigs.findOne({ serviceCode });
    return this.normalizeCreditCost(
      config?.creditCost,
      definition.defaultCreditCost,
    );
  }

  /**
   * @description 按服务当前固定点数原子扣减租户 Credit，并记录独立服务流水。
   * @keyword-cn 服务固定扣费, 服务流水
   * @keyword-en fixed-service-charge, service-ledger
   */
  async chargeService(input: {
    serviceCode: AiCreditServiceCode;
    tenantId?: string;
    userId?: string;
    operationId?: string;
    source?: string;
    platformScope?: boolean;
  }): Promise<AiServiceUsageRecordEntity> {
    const definition = AI_CREDIT_SERVICE_CATALOG.find(
      (item) => item.code === input.serviceCode,
    );
    if (!definition) throw this.billingError('AI_SERVICE_NOT_FOUND');
    const creditCost = await this.getServiceCreditCost(input.serviceCode);
    const tenant = await this.resolveTenant({
      tenantId: input.tenantId,
      userId: input.userId,
      operationId: input.operationId,
      source: input.source,
      platformScope: input.platformScope,
    });
    const unlimited =
      !tenant || typeof tenant.credit !== 'number' || tenant.credit === -1;
    const chargedUnits = unlimited
      ? 0
      : Math.round(creditCost * CREDIT_UNIT_SCALE);
    const now = new Date();
    const record: AiServiceUsageRecordEntity = {
      _id: new ObjectId(),
      chargeId: randomUUID(),
      serviceCode: definition.code,
      serviceName: definition.name,
      tenantId: input.tenantId,
      userId: input.userId,
      operationId: input.operationId,
      source: input.source,
      creditCost,
      chargedUnits,
      unlimited,
      status: 'succeeded',
      createdAt: now,
    };
    if (tenant && chargedUnits > 0) {
      await this.ensureCreditUnits(tenant._id);
      const session = this.db.client.startSession();
      try {
        try {
          await session.withTransaction(async () => {
            await this.commitServiceCharge(
              tenant._id,
              definition,
              record,
              session,
            );
          });
        } catch (error) {
          if (!this.isMongoTransactionUnsupported(error)) throw error;
          await this.commitServiceCharge(tenant._id, definition, record);
        }
      } catch (error) {
        if (this.errorCode(error) === 'CREDIT_EXHAUSTED') {
          record.status = 'credit_exhausted';
          record.errorCode = 'CREDIT_EXHAUSTED';
          record.chargedUnits = 0;
          await this.serviceUsages.insertOne(record);
        }
        throw error;
      } finally {
        await session.endSession();
      }
      return record;
    }
    await this.serviceUsages.insertOne(record);
    return record;
  }

  /**
   * @description 同步提交服务扣费余额、统一流水和服务用量；单机写入失败时补偿余额。
   * @keyword-cn 提交服务扣费, 单机补偿
   * @keyword-en commit-service-charge, standalone-compensation
   */
  private async commitServiceCharge(
    tenantId: ObjectId,
    definition: (typeof AI_CREDIT_SERVICE_CATALOG)[number],
    record: AiServiceUsageRecordEntity,
    session?: import('mongodb').ClientSession,
  ): Promise<void> {
    const options = session ? { session } : undefined;
    const chargedUnits = record.chargedUnits;
    const result = await this.tenants.findOneAndUpdate(
      {
        _id: tenantId,
        credit: { $ne: -1 },
        creditUnits: { $gte: chargedUnits },
      },
      {
        $inc: {
          creditUnits: -chargedUnits,
          credit: -chargedUnits / CREDIT_UNIT_SCALE,
        },
        $set: { updatedAt: record.createdAt },
      },
      { returnDocument: 'after', includeResultMetadata: true, ...options },
    );
    if (!result.value) throw this.billingError('CREDIT_EXHAUSTED');
    const transaction: AiCreditTransactionEntity = {
      _id: new ObjectId(),
      transactionId: record.chargeId,
      tenantId: result.value._id.toHexString(),
      type: 'service_charge',
      amount: -record.creditCost,
      amountUnits: -chargedUnits,
      balanceBefore:
        (result.value.creditUnits + chargedUnits) / CREDIT_UNIT_SCALE,
      balanceAfter: result.value.creditUnits / CREDIT_UNIT_SCALE,
      reason: `${definition.name}消费`,
      operatorType: 'system',
      referenceId: record.operationId,
      serviceCode: definition.code,
      serviceName: definition.name,
      createdAt: record.createdAt,
    };
    try {
      await this.creditTransactions.insertOne(transaction, options);
      await this.serviceUsages.insertOne(record, options);
    } catch (error) {
      if (!session) {
        await this.creditTransactions.deleteOne({
          transactionId: transaction.transactionId,
        });
        await this.tenants.updateOne(
          { _id: tenantId, creditUnits: result.value.creditUnits },
          {
            $inc: {
              creditUnits: chargedUnits,
              credit: chargedUnits / CREDIT_UNIT_SCALE,
            },
            $set: { updatedAt: new Date() },
          },
        );
      }
      throw error;
    }
  }

  /**
   * @description 判断 MongoDB 是否因单机部署而拒绝事务。
   * @keyword-cn 单机事务识别, 兼容降级
   * @keyword-en transaction-support-detect, compatibility-fallback
   */
  private isMongoTransactionUnsupported(error: unknown): boolean {
    const record =
      error && typeof error === 'object'
        ? (error as { code?: unknown; message?: unknown })
        : {};
    const code = Number(record.code);
    const message =
      typeof record.message === 'string' ? record.message.toLowerCase() : '';
    return (
      code === 20 ||
      code === 263 ||
      message.includes('transaction numbers are only allowed') ||
      message.includes('transactions are not supported')
    );
  }

  /**
   * @description 在服务级已固定扣费的异步调用链中关闭底层 Provider 重复扣费。
   * @keyword-cn 抑制重复扣费, 服务调用链
   * @keyword-en suppress-provider-charge, service-call-chain
   */
  runWithServiceBilling<T>(operation: () => Promise<T>): Promise<T> {
    return this.providerBillingSuppression.run(true, operation);
  }

  /**
   * @description 为指定模型创建可继承到 Agent 与子代理的计费回调。
   * @keyword-cn 创建计费回调, 子代理计量
   * @keyword-en create-billing-callback, subagent-metering
   */
  createCallback(
    context: AiBillingContext,
    provider: AiProviderBillingSnapshot,
  ): AiBillingCallbackHandler {
    return new AiBillingCallbackHandler(this, context, provider);
  }

  /**
   * @description 开始文本调用，有限租户先预扣输入估算量与首个流式输出块。
   * @keyword-cn 文本调用开始, 流式预扣
   * @keyword-en text-call-start, streaming-precharge
   */
  async beginTextCall(input: {
    callId: string;
    parentCallId?: string;
    context: AiBillingContext;
    provider: AiProviderBillingSnapshot;
    messages: BaseMessage[][];
  }): Promise<void> {
    if (this.providerBillingSuppression.getStore()) return;
    if (this.activeCalls.has(input.callId)) return;
    const estimatedInputTokens = this.estimateTokens(input.messages);
    const fixed = this.positiveInteger(input.provider.fixedTokensPerCall);
    const initialTokens = fixed ?? estimatedInputTokens + 1;
    const state = await this.createCallState({
      callId: input.callId,
      parentCallId: input.parentCallId,
      context: input.context,
      provider: input.provider,
      modality: 'chat',
      initialTokens,
      estimatedInputTokens,
    });
    if (state) {
      state.reservedTokens = initialTokens;
      this.activeCalls.set(input.callId, state);
    }
  }

  /**
   * @description 消费流式文本块并按 16 Token 小块继续预扣，余额不足时抛 CREDIT_EXHAUSTED。
   * @keyword-cn 消费流式文本, 余额耗尽
   * @keyword-en consume-stream-text, balance-exhausted
   */
  async consumeTextChunk(callId: string, token: string): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state || this.positiveInteger(state.provider.fixedTokensPerCall)) {
      return;
    }
    state.estimatedOutputTokens += this.estimateTokens(token);
    const consumed = state.estimatedInputTokens + state.estimatedOutputTokens;
    while (consumed > state.reservedTokens) {
      const reservedTokens = await this.reserveMore(state, STREAM_TOKEN_BLOCK);
      state.reservedTokens += reservedTokens;
      if (reservedTokens <= 0 || consumed > state.reservedTokens) {
        throw this.billingError('CREDIT_EXHAUSTED');
      }
    }
  }

  /**
   * @description 成功完成文本调用并优先采用厂商返回的真实 Token 用量结算。
   * @keyword-cn 文本调用完成, Token结算
   * @keyword-en text-call-complete, token-settlement
   */
  async completeTextCall(callId: string, output: LLMResult): Promise<void> {
    const usage = this.extractUsage(output);
    await this.finishCall(callId, 'succeeded', usage);
  }

  /**
   * @description 记录失败文本调用；额度耗尽使用独立状态并保留已消费部分。
   * @keyword-cn 文本调用失败, 额度耗尽状态
   * @keyword-en text-call-failure, credit-exhausted-status
   */
  async failTextCall(callId: string, error: unknown): Promise<void> {
    const code = this.errorCode(error);
    await this.finishCall(
      callId,
      code === 'CREDIT_EXHAUSTED' ? 'credit_exhausted' : 'failed',
      undefined,
      code,
    );
  }

  /**
   * @description 生图调用前按固定 Token 一次预扣；有限租户未配置固定计费时拒绝调用。
   * @keyword-cn 生图预扣, 固定Token计费
   * @keyword-en image-precharge, fixed-token-billing
   */
  async beginImageCall(input: {
    callId: string;
    parentCallId?: string;
    context: AiBillingContext;
    provider: AiProviderBillingSnapshot;
  }): Promise<void> {
    if (this.providerBillingSuppression.getStore()) return;
    const fixed = this.positiveInteger(input.provider.fixedTokensPerCall);
    const state = await this.createCallState({
      ...input,
      modality: 'image',
      initialTokens: fixed ?? 0,
      estimatedInputTokens: 0,
      requireFixedForFiniteTenant: true,
    });
    if (state) this.activeCalls.set(input.callId, state);
  }

  /**
   * @description 生图成功后完成固定计费流水，可同时记录接口返回的真实 Token。
   * @keyword-cn 生图完成, 生图用量
   * @keyword-en image-complete, image-usage
   */
  async completeImageCall(
    callId: string,
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number },
  ): Promise<void> {
    await this.finishCall(callId, 'succeeded', usage);
  }

  /**
   * @description 生图失败时保留固定调用费用并记录供应商错误。
   * @keyword-cn 生图失败计费, 生图错误流水
   * @keyword-en image-failure-charge, image-error-ledger
   */
  async failImageCall(callId: string, error: unknown): Promise<void> {
    await this.finishCall(callId, 'failed', undefined, this.errorCode(error));
  }

  /**
   * @description 分页查询 AI 用量流水，并按调用方租户作用域强制过滤。
   * @keyword-cn 用量流水查询, 租户过滤
   * @keyword-en usage-ledger-query, tenant-filter
   */
  async listUsage(input: {
    tenantId?: string;
    limit?: number;
    before?: Date;
  }): Promise<AiUsageRecordEntity[]> {
    const filter: Record<string, unknown> = {};
    if (input.tenantId) filter.tenantId = input.tenantId;
    if (input.before) filter.createdAt = { $lt: input.before };
    return this.usages
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, input.limit ?? 50)))
      .toArray();
  }

  /**
   * @description 创建调用流水与内存状态，并对有限租户执行第一次原子预扣。
   * @keyword-cn 创建调用状态, 首次原子预扣
   * @keyword-en create-call-state, initial-atomic-reserve
   */
  private async createCallState(input: {
    callId: string;
    parentCallId?: string;
    context: AiBillingContext;
    provider: AiProviderBillingSnapshot;
    modality: 'chat' | 'image';
    initialTokens: number;
    estimatedInputTokens: number;
    requireFixedForFiniteTenant?: boolean;
  }): Promise<ActiveCallState | null> {
    const now = new Date();
    const tenant = await this.resolveTenant(input.context);
    const unlimited =
      !tenant || typeof tenant.credit !== 'number' || tenant.credit === -1;
    const tokensPerCredit = this.positiveInteger(
      input.provider.tokensPerCredit,
    );
    const fixed = this.positiveInteger(input.provider.fixedTokensPerCall);
    if (!unlimited && !tokensPerCredit) {
      throw this.billingError('AI_BILLING_PROVIDER_NOT_CONFIGURED');
    }
    if (
      !unlimited &&
      input.modality === 'chat' &&
      input.provider.streaming === false &&
      !fixed
    ) {
      throw this.billingError('TEXT_FIXED_TOKEN_NOT_CONFIGURED');
    }
    if (!unlimited && input.requireFixedForFiniteTenant && !fixed) {
      throw this.billingError('IMAGE_FIXED_TOKEN_NOT_CONFIGURED');
    }
    const reservedUnits =
      !unlimited && tokensPerCredit
        ? this.tokensToUnits(input.initialTokens, tokensPerCredit)
        : 0;
    const inserted = await this.usages.updateOne(
      { callId: input.callId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          callId: input.callId,
          parentCallId: input.parentCallId,
          tenantId: input.context.tenantId,
          userId: input.context.userId,
          sessionId: input.context.sessionId,
          operationId: input.context.operationId,
          source: input.context.source,
          modality: input.modality,
          providerId: input.provider.providerId,
          providerCode: input.provider.providerCode,
          model: input.provider.model,
          modelCategory: input.provider.modelCategory,
          status: 'started',
          tokenSource: fixed ? 'fixed' : 'estimated',
          inputTokens: input.estimatedInputTokens,
          outputTokens: 0,
          billedTokens: input.initialTokens,
          tokensPerCredit,
          fixedTokensPerCall: fixed,
          reservedUnits,
          chargedUnits: reservedUnits,
          theoreticalUnits: tokensPerCredit
            ? this.tokensToUnits(input.initialTokens, tokensPerCredit)
            : 0,
          unlimited,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (inserted.upsertedCount === 0) return null;
    if (tenant && !unlimited && reservedUnits > 0) {
      try {
        await this.reserveTenantUnits(tenant._id, reservedUnits, {
          referenceId: input.callId,
          reason: `${input.provider.providerCode} 模型预扣`,
        });
      } catch (error) {
        const failedAt = new Date();
        await this.usages.updateOne(
          { callId: input.callId, status: 'started' },
          {
            $set: {
              status: 'credit_exhausted',
              chargedUnits: 0,
              errorCode: this.errorCode(error),
              updatedAt: failedAt,
              completedAt: failedAt,
            },
          },
        );
        throw error;
      }
    }
    return {
      callId: input.callId,
      tenantObjectId: tenant?._id,
      unlimited,
      provider: input.provider,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: 0,
      reservedTokens: input.initialTokens,
      reservedUnits,
    };
  }

  /**
   * @description 为活跃调用追加原子预扣并同步流水累计值。
   * @keyword-cn 追加预扣, 活跃调用
   * @keyword-en additional-reserve, active-call
   */
  private async reserveMore(
    state: ActiveCallState,
    tokens: number,
  ): Promise<number> {
    const ratio = this.positiveInteger(state.provider.tokensPerCredit);
    if (!ratio) return 0;
    const units = this.tokensToUnits(tokens, ratio);
    let reservedUnits = units;
    if (!state.unlimited && state.tenantObjectId) {
      try {
        await this.reserveTenantUnits(state.tenantObjectId, units, {
          referenceId: state.callId,
          reason: `${state.provider.providerCode} 模型追加预扣`,
        });
      } catch (error) {
        if (this.errorCode(error) !== 'CREDIT_EXHAUSTED') throw error;
        reservedUnits = await this.drainTenantUnits(state.tenantObjectId, {
          referenceId: state.callId,
          reason: `${state.provider.providerCode} 模型耗尽尾款`,
        });
      }
      state.reservedUnits += reservedUnits;
    }
    await this.usages.updateOne(
      { callId: state.callId, status: 'started' },
      {
        $inc: {
          reservedUnits: state.unlimited ? 0 : reservedUnits,
          chargedUnits: state.unlimited ? 0 : reservedUnits,
          theoreticalUnits: reservedUnits,
        },
        $set: { updatedAt: new Date() },
      },
    );
    if (state.unlimited) return tokens;
    return Math.floor((reservedUnits * ratio) / CREDIT_UNIT_SCALE);
  }

  /**
   * @description 当完整 Token 块无法预扣时原子取走最后余额，使最后一个 Credit 被完整利用。
   * @keyword-cn 耗尽最后余额, Credit归零
   * @keyword-en drain-final-balance, zero-credit
   */
  private async drainTenantUnits(
    tenantId: ObjectId,
    meta?: { referenceId?: string; reason?: string },
  ): Promise<number> {
    const result = await this.tenants.findOneAndUpdate(
      { _id: tenantId, credit: { $ne: -1 }, creditUnits: { $gt: 0 } },
      { $set: { credit: 0, creditUnits: 0, updatedAt: new Date() } },
      { returnDocument: 'before', includeResultMetadata: true },
    );
    const units = Math.max(0, Math.floor(result.value?.creditUnits ?? 0));
    if (result.value && units > 0) {
      await this.creditTransactions.insertOne({
        _id: new ObjectId(),
        transactionId: randomUUID(),
        tenantId: tenantId.toHexString(),
        type: 'provider_charge',
        amount: -units / CREDIT_UNIT_SCALE,
        amountUnits: -units,
        balanceBefore: units / CREDIT_UNIT_SCALE,
        balanceAfter: 0,
        reason: meta?.reason ?? 'AI Provider 消费',
        operatorType: 'system',
        referenceId: meta?.referenceId,
        createdAt: new Date(),
      });
    }
    return units;
  }

  /**
   * @description 原子扣减租户整数计费单位，余额不足时抛出 CREDIT_EXHAUSTED。
   * @keyword-cn 原子扣减余额, 额度耗尽
   * @keyword-en atomic-balance-debit, credit-exhausted
   */
  private async reserveTenantUnits(
    tenantId: ObjectId,
    units: number,
    meta?: { referenceId?: string; reason?: string },
  ): Promise<SassTenantEntity> {
    await this.ensureCreditUnits(tenantId);
    const result = await this.tenants.findOneAndUpdate(
      { _id: tenantId, credit: { $ne: -1 }, creditUnits: { $gte: units } },
      {
        $inc: {
          creditUnits: -units,
          credit: -units / CREDIT_UNIT_SCALE,
        },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value) throw this.billingError('CREDIT_EXHAUSTED');
    await this.creditTransactions.insertOne({
      _id: new ObjectId(),
      transactionId: randomUUID(),
      tenantId: tenantId.toHexString(),
      type: 'provider_charge',
      amount: -units / CREDIT_UNIT_SCALE,
      amountUnits: -units,
      balanceBefore: (result.value.creditUnits + units) / CREDIT_UNIT_SCALE,
      balanceAfter: result.value.creditUnits / CREDIT_UNIT_SCALE,
      reason: meta?.reason ?? 'AI Provider 消费',
      operatorType: 'system',
      referenceId: meta?.referenceId,
      createdAt: new Date(),
    });
    return result.value;
  }

  /**
   * @description 为历史租户懒初始化 Credit 与整数计费单位，缺省视为无限额度。
   * @keyword-cn 历史租户兼容, 余额单位初始化
   * @keyword-en legacy-tenant-compat, balance-unit-init
   */
  private async ensureCreditUnits(tenantId: ObjectId): Promise<void> {
    const tenantKey = tenantId.toHexString();
    if (this.creditUnitsReady.has(tenantKey)) return;
    const tenant = await this.tenants.findOne({ _id: tenantId });
    if (!tenant) throw this.billingError('TENANT_NOT_FOUND');
    if (typeof tenant.credit !== 'number') {
      await this.tenants.updateOne(
        { _id: tenantId, credit: { $exists: false } },
        { $set: { credit: -1, creditUnits: -1, updatedAt: new Date() } },
      );
      this.creditUnitsReady.add(tenantKey);
      return;
    }
    if (typeof tenant.creditUnits !== 'number') {
      const units =
        tenant.credit === -1
          ? -1
          : Math.max(0, Math.floor(tenant.credit * CREDIT_UNIT_SCALE));
      await this.tenants.updateOne(
        { _id: tenantId, creditUnits: { $exists: false } },
        { $set: { creditUnits: units, updatedAt: new Date() } },
      );
    }
    this.creditUnitsReady.add(tenantKey);
  }

  /**
   * @description 完成调用，按固定或真实 Token 计算最终费用并退回多余预占。
   * @keyword-cn 完成调用结算, Credit退款
   * @keyword-en finish-call-settlement, credit-refund
   */
  private async finishCall(
    callId: string,
    status: AiUsageRecordEntity['status'],
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number },
    errorCode?: string,
  ): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state) return;
    this.activeCalls.delete(callId);
    const fixed = this.positiveInteger(state.provider.fixedTokensPerCall);
    const estimatedTotal =
      state.estimatedInputTokens + state.estimatedOutputTokens;
    const billedTokens = fixed ?? usage?.totalTokens ?? estimatedTotal;
    const ratio = this.positiveInteger(state.provider.tokensPerCredit);
    const desiredUnits = ratio ? this.tokensToUnits(billedTokens, ratio) : 0;
    let chargedUnits = state.unlimited ? 0 : state.reservedUnits;
    if (!state.unlimited && state.tenantObjectId && ratio) {
      if (desiredUnits > state.reservedUnits) {
        const extra = desiredUnits - state.reservedUnits;
        try {
          await this.reserveTenantUnits(state.tenantObjectId, extra, {
            referenceId: callId,
            reason: `${state.provider.providerCode} 模型结算补扣`,
          });
          chargedUnits += extra;
        } catch (error) {
          this.logger.error(
            `[billing] final settlement exceeded reserved credit callId=${callId} extraUnits=${extra}`,
          );
          status = 'credit_exhausted';
          errorCode = this.errorCode(error);
        }
      } else if (desiredUnits < state.reservedUnits) {
        const refund = state.reservedUnits - desiredUnits;
        const refundResult = await this.tenants.findOneAndUpdate(
          { _id: state.tenantObjectId, credit: { $ne: -1 } },
          {
            $inc: {
              creditUnits: refund,
              credit: refund / CREDIT_UNIT_SCALE,
            },
            $set: { updatedAt: new Date() },
          },
          { returnDocument: 'after', includeResultMetadata: true },
        );
        if (refundResult.value) {
          await this.creditTransactions.insertOne({
            _id: new ObjectId(),
            transactionId: randomUUID(),
            tenantId: state.tenantObjectId.toHexString(),
            type: 'refund',
            amount: refund / CREDIT_UNIT_SCALE,
            amountUnits: refund,
            balanceBefore:
              (refundResult.value.creditUnits - refund) / CREDIT_UNIT_SCALE,
            balanceAfter: refundResult.value.creditUnits / CREDIT_UNIT_SCALE,
            reason: `${state.provider.providerCode} 模型预扣退款`,
            operatorType: 'system',
            referenceId: callId,
            createdAt: new Date(),
          });
        }
        chargedUnits -= refund;
      }
    }
    const now = new Date();
    await this.usages.updateOne(
      { callId, status: 'started' },
      {
        $set: {
          status,
          tokenSource: fixed ? 'fixed' : usage ? 'actual' : 'estimated',
          inputTokens: usage?.inputTokens ?? state.estimatedInputTokens,
          outputTokens: usage?.outputTokens ?? state.estimatedOutputTokens,
          actualTotalTokens: usage?.totalTokens,
          billedTokens,
          chargedUnits,
          theoreticalUnits: desiredUnits,
          errorCode,
          updatedAt: now,
          completedAt: now,
        },
      },
    );
  }

  /**
   * @description 从 LangChain 多厂商输出结构中提取输入、输出和总 Token。
   * @keyword-cn Token用量解析, 多厂商兼容
   * @keyword-en token-usage-parser, multi-provider-compat
   */
  private extractUsage(
    output: LLMResult,
  ):
    | { inputTokens: number; outputTokens: number; totalTokens: number }
    | undefined {
    const candidates: unknown[] = [output.llmOutput];
    for (const row of output.generations ?? []) {
      for (const generation of row ?? []) {
        const message = (generation as { message?: unknown }).message;
        if (message && typeof message === 'object') {
          const rec = message as Record<string, unknown>;
          candidates.push(rec['usage_metadata'], rec['response_metadata']);
        }
      }
    }
    for (const candidate of candidates) {
      const usage = this.normalizeUsageCandidate(candidate);
      if (usage) return usage;
    }
    return undefined;
  }

  /**
   * @description 规范 OpenAI、Anthropic、Gemini 与 LangChain 的 Token 字段别名。
   * @keyword-cn Token字段归一, 用量元数据
   * @keyword-en token-field-normalize, usage-metadata
   */
  private normalizeUsageCandidate(
    value: unknown,
  ):
    | { inputTokens: number; outputTokens: number; totalTokens: number }
    | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const rec = value as Record<string, unknown>;
    const nested = [
      rec['tokenUsage'],
      rec['usage'],
      rec['usage_metadata'],
      rec['usageMetadata'],
    ];
    for (const item of nested) {
      const found = this.normalizeUsageCandidate(item);
      if (found) return found;
    }
    const input = this.firstNumber(rec, [
      'input_tokens',
      'inputTokens',
      'prompt_tokens',
      'promptTokens',
      'promptTokenCount',
    ]);
    const output = this.firstNumber(rec, [
      'output_tokens',
      'outputTokens',
      'completion_tokens',
      'completionTokens',
      'candidatesTokenCount',
    ]);
    const total = this.firstNumber(rec, [
      'total_tokens',
      'totalTokens',
      'totalTokenCount',
    ]);
    const normalizedTotal = total ?? (input ?? 0) + (output ?? 0);
    if (normalizedTotal <= 0) return undefined;
    return {
      inputTokens: Math.max(0, Math.floor(input ?? normalizedTotal)),
      outputTokens: Math.max(0, Math.floor(output ?? 0)),
      totalTokens: Math.max(0, Math.floor(normalizedTotal)),
    };
  }

  /**
   * @description 从对象的一组候选字段中读取首个非负有限数字。
   * @keyword-cn 数字字段读取, Token别名
   * @keyword-en numeric-field-read, token-alias
   */
  private firstNumber(
    record: Record<string, unknown>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const value = Number(record[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return undefined;
  }

  /**
   * @description 用 UTF-8 字节数作为保守 Token 上界估算，确保流式扣费不低估可见文本。
   * @keyword-cn Token保守估算, UTF8字节
   * @keyword-en conservative-token-estimate, utf8-byte
   */
  private estimateTokens(value: unknown): number {
    let text = '';
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    } catch {
      text =
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
          ? String(value)
          : value == null
            ? ''
            : Object.prototype.toString.call(value);
    }
    return Math.max(1, Buffer.byteLength(text, 'utf8'));
  }

  /**
   * @description 按 Provider 比率把 Token 转成整数最小 Credit 单位并向上取整。
   * @keyword-cn Token转Credit, 向上取整
   * @keyword-en token-to-credit, ceiling-rounding
   */
  private tokensToUnits(tokens: number, tokensPerCredit: number): number {
    return Math.max(
      0,
      Math.ceil((Math.max(0, tokens) * CREDIT_UNIT_SCALE) / tokensPerCredit),
    );
  }

  /**
   * @description 解析并校验正整数配置，空值与零表示未配置。
   * @keyword-cn 正整数配置, 计费参数校验
   * @keyword-en positive-integer-config, billing-validation
   */
  private positiveInteger(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  }

  /**
   * @description 把后台服务点数配置归一为最多六位小数的非负值。
   * @keyword-cn 服务点数归一, 小数精度
   * @keyword-en normalize-service-credit, decimal-precision
   */
  private normalizeCreditCost(value: unknown, fallback: number): number {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    const resolved =
      Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
    return Math.round(resolved * CREDIT_UNIT_SCALE) / CREDIT_UNIT_SCALE;
  }

  /**
   * @description 根据计费上下文读取租户；无 tenantId 仅在明确平台作用域时放行。
   * @keyword-cn 租户计费作用域, 平台调用声明
   * @keyword-en tenant-billing-scope, platform-call-declaration
   */
  private async resolveTenant(
    context: AiBillingContext,
  ): Promise<SassTenantEntity | null> {
    const raw = String(context.tenantId ?? '').trim();
    if (!raw) {
      if (!context.platformScope) {
        throw this.billingError('AI_BILLING_CONTEXT_REQUIRED');
      }
      return null;
    }
    if (!ObjectId.isValid(raw)) throw this.billingError('INVALID_TENANT_ID');
    const tenant = await this.tenants.findOne({ _id: new ObjectId(raw) });
    if (!tenant) throw this.billingError('TENANT_NOT_FOUND');
    return tenant;
  }

  /**
   * @description 构造带稳定错误码的计费异常。
   * @keyword-cn 计费异常, 错误码
   * @keyword-en billing-error, error-code
   */
  private billingError(code: string): Error {
    const error = new Error(code) as Error & { code?: string };
    error.name = code;
    error.code = code;
    return error;
  }

  /**
   * @description 从未知异常中提取稳定错误码供流水与前端使用。
   * @keyword-cn 错误码提取, 异常归一
   * @keyword-en error-code-extract, exception-normalize
   */
  private errorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const rec = error as {
        code?: unknown;
        name?: unknown;
        message?: unknown;
      };
      for (const value of [rec.code, rec.name, rec.message]) {
        const text =
          typeof value === 'string'
            ? value.trim()
            : typeof value === 'number'
              ? String(value)
              : '';
        const match = /([A-Z][A-Z0-9_]{2,})/.exec(text);
        if (match?.[1]) return match[1];
      }
    }
    return 'AI_CALL_FAILED';
  }
}
