import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import {
  MODEL_CONCURRENCY_SLOT_GRACE_MS,
  MODEL_CONCURRENCY_TICK_MS,
  type ModelConcurrencyKind,
  type ModelConcurrencyLimitEntity,
  type ModelConcurrencySlotEntity,
  type ModelConcurrencyTarget,
  type ModelConcurrencyUsage,
  type ModelConcurrencyWaiterEntity,
} from '../entities/model-concurrency.entity.js';

/**
 * @description 判断是否 Mongo 唯一索引冲突（E11000）。
 * @keyword-cn 唯一索引冲突, 名额已被占
 * @keyword-en is-duplicate-key, slot-taken
 * @param error 捕获的错误。
 * @returns {boolean} 是唯一索引冲突时为 true。
 */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}

/**
 * @description 按「提供商 + 模型」限制全平台并发：名额、排队与上限都存在 Mongo 里，多进程、重启后都按同一份数据算。
 *   业务提交前调 `admit`：有空位直接提交，没空位登记排队；主进程每 5 秒回收已结束任务的名额，再按先来先到把排队任务交给业务提交。
 * @keyword-cn 模型并发限制, 超出排队, 全平台并发上限
 * @keyword-en model-concurrency, queue-when-full, platform-concurrency-limit
 */
@Injectable()
export class ModelConcurrencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelConcurrencyService.name);
  private readonly limits: Collection<ModelConcurrencyLimitEntity>;
  private readonly slots: Collection<ModelConcurrencySlotEntity>;
  private readonly waiters: Collection<ModelConcurrencyWaiterEntity>;
  private readonly kinds = new Map<string, ModelConcurrencyKind>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  /**
   * @description 初始化上限、名额与排队三个集合。
   * @keyword-cn 初始化并发服务, 名额集合
   * @keyword-en init-model-concurrency, slot-collections
   * @param db 业务 Mongo 库。
   */
  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.limits = db.collection<ModelConcurrencyLimitEntity>(
      'model_concurrency_limits',
    );
    this.slots = db.collection<ModelConcurrencySlotEntity>(
      'model_concurrency_slots',
    );
    this.waiters = db.collection<ModelConcurrencyWaiterEntity>(
      'model_concurrency_waiters',
    );
  }

  /**
   * @description 建索引；主进程上启动定时回收名额与派发排队任务。
   * @keyword-cn 启动排队派发, 建立名额索引
   * @keyword-en start-concurrency-dispatch, ensure-slot-indexes
   */
  async onModuleInit(): Promise<void> {
    await this.ensureIndexes().catch((error) =>
      this.logger.warn(
        `[onModuleInit] 建索引失败: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    if (!isLeaderProcess()) return;
    this.timer = setInterval(() => void this.tick(), MODEL_CONCURRENCY_TICK_MS);
    this.timer.unref?.();
  }

  /**
   * @description 停止定时派发。
   * @keyword-cn 停止排队派发, 模块销毁
   * @keyword-en stop-concurrency-dispatch, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 建立上限、名额、排队的索引：名额 `key + slot` 唯一保证不超额，排队按任务唯一。
   * @keyword-cn 建立名额索引, 唯一约束
   * @keyword-en ensure-slot-indexes, unique-constraint
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.limits.createIndex({ providerId: 1, model: 1 }, { unique: true }),
      this.slots.createIndex({ key: 1, slot: 1 }, { unique: true }),
      this.slots.createIndex({ holder: 1 }),
      this.waiters.createIndex({ holder: 1 }, { unique: true }),
      this.waiters.createIndex({ key: 1, enqueuedAt: 1 }),
    ]);
  }

  /**
   * @description 名额与排队按模型分组的键 `providerId:model`。
   * @keyword-cn 模型键, 名额分组
   * @keyword-en model-key, slot-group
   * @param target 提供商与模型。
   * @returns {string} 分组键。
   */
  keyOf(target: ModelConcurrencyTarget): string {
    return `${String(target.providerId).trim()}:${String(target.model).trim()}`;
  }

  /**
   * @description 业务注册任务种类，派发排队任务与回收名额时按种类找回调。
   * @keyword-cn 注册排队任务种类, 业务提交回调
   * @keyword-en register-concurrency-kind, dispatch-handler
   * @param kind 种类名。
   * @param handler 提交与状态查询回调。
   */
  registerKind(kind: string, handler: ModelConcurrencyKind): void {
    this.kinds.set(kind, handler);
  }

  /**
   * @description 读取模型的并发上限，没有设置返回 null（不限）。
   * @keyword-cn 读取并发上限, 未设置不限
   * @keyword-en read-concurrency-limit, unlimited-when-unset
   * @param target 提供商与模型。
   * @returns {Promise<number|null>} 上限或 null。
   */
  async readLimit(target: ModelConcurrencyTarget): Promise<number | null> {
    const row = await this.limits.findOne({
      providerId: String(target.providerId).trim(),
      model: String(target.model).trim(),
    });
    const limit = Math.floor(Number(row?.limit));
    return row && limit >= 1 ? limit : null;
  }

  /**
   * @description 设置或清除模型的并发上限；调高后主进程下一轮就放行排队任务。
   * @keyword-cn 设置并发上限, 清除上限
   * @keyword-en set-concurrency-limit, clear-limit
   * @param target 提供商与模型。
   * @param limit 新上限，null 表示不限。
   * @param updatedBy 操作人 ID。
   */
  async setLimit(
    target: ModelConcurrencyTarget,
    limit: number | null,
    updatedBy?: string,
  ): Promise<void> {
    const filter = {
      providerId: String(target.providerId).trim(),
      model: String(target.model).trim(),
    };
    if (limit === null) {
      await this.limits.deleteOne(filter);
      return;
    }
    await this.limits.updateOne(
      filter,
      {
        $set: {
          limit: Math.max(1, Math.floor(limit)),
          updatedAt: new Date(),
          updatedBy,
        },
      },
      { upsert: true },
    );
  }

  /**
   * @description 列出设了上限、或正在跑 / 排队的模型的并发情况。
   * @keyword-cn 模型并发概览, 排队数量
   * @keyword-en list-concurrency-usage, waiting-count
   * @returns {Promise<ModelConcurrencyUsage[]>} 各模型的上限、执行数与排队数。
   */
  async overview(): Promise<ModelConcurrencyUsage[]> {
    const [limits, slots, waiters] = await Promise.all([
      this.limits.find({}).toArray(),
      this.slots.find({}, { projection: { key: 1 } }).toArray(),
      this.waiters
        .find({}, { projection: { key: 1, providerId: 1, model: 1 } })
        .toArray(),
    ]);
    const usage = new Map<string, ModelConcurrencyUsage>();
    const entry = (target: ModelConcurrencyTarget) => {
      const key = this.keyOf(target);
      let item = usage.get(key);
      if (!item) {
        item = {
          providerId: target.providerId,
          model: target.model,
          limit: null,
          running: 0,
          waiting: 0,
        };
        usage.set(key, item);
      }
      return item;
    };
    for (const row of limits) entry(row).limit = row.limit;
    for (const row of waiters) entry(row).waiting += 1;
    for (const row of slots) {
      const split = row.key.indexOf(':');
      if (split < 0) continue;
      entry({
        providerId: row.key.slice(0, split),
        model: row.key.slice(split + 1),
      }).running += 1;
    }
    return [...usage.values()];
  }

  /**
   * @description 提交前申请名额：不限时登记一条统计用名额直接放行；有上限时前面没人排队且有空位就占一个名额放行，否则登记排队返回 false。
   *   同一个任务重复申请不会重复占名额。
   * @keyword-cn 申请模型名额, 满了排队
   * @keyword-en admit-model-slot, queue-when-full
   * @param kind 任务种类（已 `registerKind`）。
   * @param target 提供商与模型。
   * @param holder 任务 ID。
   * @returns {Promise<boolean>} true 可以立即提交，false 已排队。
   */
  async admit(
    kind: string,
    target: ModelConcurrencyTarget,
    holder: string,
  ): Promise<boolean> {
    if (await this.slots.findOne({ holder })) return true;
    const key = this.keyOf(target);
    const limit = await this.readLimit(target);
    if (limit === null) {
      await this.takeFreeSlot(kind, key, holder);
      return true;
    }
    // 前面有人排队时不插队，直接排到后面
    const queued = await this.waiters.findOne({ key });
    if (!queued && (await this.tryAcquire(kind, key, holder, limit)))
      return true;
    await this.waiters.updateOne(
      { holder },
      {
        $setOnInsert: {
          key,
          holder,
          kind,
          providerId: String(target.providerId).trim(),
          model: String(target.model).trim(),
          enqueuedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return false;
  }

  /**
   * @description 确保任务还在排队登记里（主进程派发中途退出导致排队登记丢了时补回）；已拿到名额的不补。
   * @keyword-cn 补回排队登记, 中断恢复
   * @keyword-en ensure-waiting, recover-lost-waiter
   * @param kind 任务种类。
   * @param target 提供商与模型。
   * @param holder 任务 ID。
   * @param enqueuedAt 原排队时间，保持先来先到。
   */
  async ensureWaiting(
    kind: string,
    target: ModelConcurrencyTarget,
    holder: string,
    enqueuedAt: Date,
  ): Promise<void> {
    if (await this.slots.findOne({ holder })) return;
    await this.waiters.updateOne(
      { holder },
      {
        $setOnInsert: {
          key: this.keyOf(target),
          holder,
          kind,
          providerId: String(target.providerId).trim(),
          model: String(target.model).trim(),
          enqueuedAt,
        },
      },
      { upsert: true },
    );
  }

  /**
   * @description 归还任务的名额并撤掉它的排队登记，重复调用无副作用。
   * @keyword-cn 归还模型名额, 撤销排队
   * @keyword-en release-model-slot, cancel-waiting
   * @param holder 任务 ID。
   */
  async release(holder: string): Promise<void> {
    await Promise.all([
      this.slots.deleteMany({ holder }),
      this.waiters.deleteMany({ holder }),
    ]);
  }

  /**
   * @description 查询一批排队任务前面还有几个（同一模型、更早排队的数量）；不在排队的任务不放进结果。
   * @keyword-cn 查询排队位置, 前面还有几个
   * @keyword-en query-queue-position, waiting-ahead
   * @param holders 任务 ID。
   * @returns {Promise<Map<string, number>>} 任务 ID → 前面的数量。
   */
  async positions(holders: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!holders.length) return result;
    const mine = await this.waiters
      .find({ holder: { $in: holders } }, { projection: { key: 1 } })
      .toArray();
    const keys = [...new Set(mine.map((row) => row.key))];
    if (!keys.length) return result;
    const all = await this.waiters
      .find({ key: { $in: keys } }, { projection: { key: 1, holder: 1 } })
      .sort({ enqueuedAt: 1, _id: 1 })
      .toArray();
    const wanted = new Set(holders);
    const seen = new Map<string, number>();
    for (const row of all) {
      const ahead = seen.get(row.key) ?? 0;
      if (wanted.has(row.holder)) result.set(row.holder, ahead);
      seen.set(row.key, ahead + 1);
    }
    return result;
  }

  /**
   * @description 主进程一轮：先回收已结束任务的名额，再按先来先到派发排队任务；同一进程内不重入。
   * @keyword-cn 排队派发一轮, 回收名额
   * @keyword-en concurrency-tick, reclaim-slots
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reclaim();
      await this.drain();
    } catch (error) {
      this.logger.warn(
        `[tick] 排队派发失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /**
   * @description 回收名额：业务说任务已结束的立即回收；查不到任务（或种类没注册）的过了保护期再回收。
   * @keyword-cn 回收已结束名额, 名额保护期
   * @keyword-en reclaim-finished-slots, slot-grace
   */
  private async reclaim(): Promise<void> {
    const rows = await this.slots.find({}).toArray();
    if (!rows.length) return;
    const byKind = new Map<string, string[]>();
    for (const row of rows) {
      const list = byKind.get(row.kind) ?? [];
      list.push(row.holder);
      byKind.set(row.kind, list);
    }
    const states = new Map<string, boolean>();
    for (const [kind, holders] of byKind) {
      const handler = this.kinds.get(kind);
      if (!handler) continue;
      const found = await handler.inspect(holders);
      for (const [holder, active] of found) states.set(holder, active);
    }
    const graceBefore = Date.now() - MODEL_CONCURRENCY_SLOT_GRACE_MS;
    for (const row of rows) {
      const active = states.get(row.holder);
      if (
        active === false ||
        (active === undefined &&
          new Date(row.acquiredAt).getTime() < graceBefore)
      )
        await this.slots.deleteOne({ key: row.key, slot: row.slot });
    }
  }

  /**
   * @description 派发排队任务：按排队先后逐个看，某个模型拿不到名额就跳过它后面同模型的任务，其余模型照常放行；
   *   拿到名额后撤掉排队登记，交给业务后台提交，提交失败或业务说不用提交时归还名额。
   * @keyword-cn 派发排队任务, 先来先到
   * @keyword-en drain-model-queue, fifo-order
   */
  private async drain(): Promise<void> {
    const waiting = await this.waiters
      .find({})
      .sort({ enqueuedAt: 1, _id: 1 })
      .limit(500)
      .toArray();
    const blocked = new Set<string>();
    const limits = new Map<string, number | null>();
    for (const row of waiting) {
      if (blocked.has(row.key)) continue;
      const handler = this.kinds.get(row.kind);
      if (!handler) continue;
      if (!limits.has(row.key)) limits.set(row.key, await this.readLimit(row));
      const limit = limits.get(row.key) ?? null;
      if (limit === null)
        await this.takeFreeSlot(row.kind, row.key, row.holder);
      else if (!(await this.tryAcquire(row.kind, row.key, row.holder, limit))) {
        blocked.add(row.key);
        continue;
      }
      const removed = await this.waiters.findOneAndDelete({
        holder: row.holder,
      });
      if (!removed) {
        await this.slots.deleteMany({ holder: row.holder });
        continue;
      }
      void this.dispatch(handler, row.holder);
    }
  }

  /**
   * @description 交给业务提交一个已拿到名额的任务，失败或不用提交时归还名额。
   * @keyword-cn 提交排队任务, 失败归还名额
   * @keyword-en dispatch-waiting-task, release-on-failure
   * @param handler 业务回调。
   * @param holder 任务 ID。
   */
  private async dispatch(
    handler: ModelConcurrencyKind,
    holder: string,
  ): Promise<void> {
    try {
      if (!(await handler.dispatch(holder)))
        await this.slots.deleteMany({ holder });
    } catch (error) {
      this.logger.warn(
        `[dispatch] 排队任务提交失败 holder=${holder}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.slots.deleteMany({ holder });
    }
  }

  /**
   * @description 有上限时占一个空位：已用数达到上限就失败；否则从 0 开始找没被占的序号插入，被别的进程抢先（唯一索引冲突）就试下一个。
   * @keyword-cn 占用名额, 唯一索引防超额
   * @keyword-en acquire-slot, unique-index-guard
   * @param kind 任务种类。
   * @param key 模型键。
   * @param holder 任务 ID。
   * @param limit 上限。
   * @returns {Promise<boolean>} 是否占到。
   */
  private async tryAcquire(
    kind: string,
    key: string,
    holder: string,
    limit: number,
  ): Promise<boolean> {
    const used = await this.slots
      .find({ key }, { projection: { slot: 1 } })
      .toArray();
    if (used.length >= limit) return false;
    const taken = new Set(used.map((row) => row.slot));
    for (let index = 0; index < limit; index += 1) {
      const slot = String(index);
      if (taken.has(slot)) continue;
      try {
        await this.slots.insertOne({
          key,
          slot,
          holder,
          kind,
          acquiredAt: new Date(),
        });
        return true;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    return false;
  }

  /**
   * @description 不限时登记一条只用来统计的名额，之后设了上限也能算上已经在跑的任务。
   * @keyword-cn 登记统计名额, 不限并发
   * @keyword-en take-free-slot, unlimited-concurrency
   * @param kind 任务种类。
   * @param key 模型键。
   * @param holder 任务 ID。
   */
  private async takeFreeSlot(
    kind: string,
    key: string,
    holder: string,
  ): Promise<void> {
    await this.slots.updateOne(
      { key, slot: `free:${holder}` },
      { $setOnInsert: { holder, kind, acquiredAt: new Date() } },
      { upsert: true },
    );
  }
}
