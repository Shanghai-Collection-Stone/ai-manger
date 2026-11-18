import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 成员 Credit 接口错误码到中文提示的映射
 * @keyword-cn 成员额度错误文案, 错误码映射
 * @keyword-en member-credit-error-messages, error-code-map
 */
const CREDIT_ERROR_MESSAGES = {
  CREDIT_POOL_INSUFFICIENT: '待分配额度不够，请先让超管给租户充值，或少分一些。',
  MEMBER_CREDIT_INSUFFICIENT: '该成员的额度不够回收这么多。',
  CREDIT_OVERDRAFT: '个人额度不够扣减这么多。',
  CREDIT_AMOUNT_INVALID: '数量无效，最多 6 位小数且不能为 0。',
  TENANT_CREDIT_SHARED_MODE: '该租户还是「全员共用」的旧模式，需要超管先切换到分配模式。',
  TENANT_CREDIT_ALREADY_ALLOCATED: '该租户已经是分配模式了。',
  UNLIMITED_CREDIT_CANNOT_ALLOCATE: '无限额度租户的成员本来就不扣费，不需要分配。',
  TENANT_REQUIRED: '请先选择租户。',
  MEMBER_NOT_FOUND: '成员不存在或已移除。',
  ACCOUNT_NOT_FOUND: '该成员没有关联手机号账号，无法使用个人额度。',
  ACCOUNT_DELETED: '该账号已注销。',
  CROSS_TENANT_FORBIDDEN: '不能操作其他租户。',
  PERMISSION_DENIED: '没有权限执行该操作。',
};

/**
 * @description 流水类型的中文名
 * @keyword-cn 流水类型名称
 * @keyword-en ledger-type-names
 */
const LEDGER_TYPE_NAMES = {
  initial_credit: '初始额度',
  recharge: '充值',
  manual_adjustment: '人工调账',
  service_charge: '服务消费',
  provider_charge: '模型消费',
  refund: '退款',
  allocation: '额度分配',
  registration_grant: '新成员赠送',
  migration: '旧余额迁移',
};

/**
 * @description 把接口错误翻译成中文，未收录的原样返回
 * @keyword-cn 成员额度错误提示
 * @keyword-en member-credit-error-text
 */
const describeCreditError = (message) => CREDIT_ERROR_MESSAGES[message] || message || '操作失败，请稍后重试';

/**
 * @description 格式化 Credit 数值，-1 显示为无限
 * @keyword-cn 额度格式化, 无限额度
 * @keyword-en credit-format, unlimited-credit
 */
const formatCredit = (value) => {
  const amount = Number(value);
  if (amount === -1) return '∞';
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
};

/**
 * @description 格式化带正负号的流水变动额
 * @keyword-cn 变动额格式化, 正负号
 * @keyword-en signed-credit-format, ledger-delta
 */
const formatDelta = (value) => {
  const amount = Number(value) || 0;
  const text = Math.abs(amount).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  return amount > 0 ? `+${text}` : amount < 0 ? `-${text}` : text;
};

/**
 * @description 格式化流水时间
 * @keyword-cn 流水时间格式化
 * @keyword-en ledger-time-format
 */
const formatTime = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');

/**
 * @description 角色中文名
 * @keyword-cn 成员角色名称
 * @keyword-en member-role-names
 */
const ROLE_NAMES = { tenant_admin: '租户管理员', operator: '操作员', super_admin: '超管' };

/**
 * @description 一组流水的通用列表，供成员流水与个人流水弹窗复用
 * @keyword-cn 流水列表, 加载更多
 * @keyword-en ledger-list, load-more
 */
function LedgerList({ rows, hasMore, loading, onLoadMore }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400">暂无流水</p>;
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.transactionId || row._id} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium text-slate-800 truncate">{row.serviceName || row.reason || LEDGER_TYPE_NAMES[row.type] || '余额变动'}</div>
            <div className="text-xs text-slate-500">
              {LEDGER_TYPE_NAMES[row.type] || row.type} · {formatTime(row.createdAt)}
              {row.operatorName ? ` · ${row.operatorName}` : ''}
            </div>
          </div>
          <div className="text-right whitespace-nowrap">
            <div className={Number(row.amount) > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-800 font-semibold'}>{formatDelta(row.amount)}</div>
            <div className="text-xs text-slate-400">余额 {formatCredit(row.balanceAfter)}</div>
          </div>
        </div>
      ))}
      {hasMore ? (
        <div className="pt-2 text-center">
          <button disabled={loading} onClick={onLoadMore} className="px-3 py-1 text-xs border rounded disabled:opacity-50">{loading ? '加载中…' : '加载更多'}</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * @description 每页流水条数
 * @keyword-cn 流水分页大小
 * @keyword-en ledger-page-size
 */
const LEDGER_PAGE_SIZE = 30;

/**
 * @description 成员 Credit 面板：租户管理员把待分配额度分给成员、设置新成员赠送；超管另可切换 / 迁移旧共用租户并给个人额度充值
 * @keyword-cn 成员额度面板, 额度分配
 * @keyword-en member-credit-panel, credit-allocation
 */
export default function MemberCreditPanel({ currentRole, tenants, onNotice, onError }) {
  const superAdmin = currentRole === 'super_admin';
  const [tenantId, setTenantId] = useState('');
  const [overview, setOverview] = useState(null);
  const [grantInput, setGrantInput] = useState('');
  const [busy, setBusy] = useState('');
  const [allocateDialog, setAllocateDialog] = useState(null);
  const [ledgerDialog, setLedgerDialog] = useState(null);
  const [personalDialog, setPersonalDialog] = useState(null);

  /**
   * @description 包装异步动作，统一忙碌状态与中文错误提示
   * @keyword-cn 额度异步动作
   * @keyword-en member-credit-action
   */
  const run = useCallback(async (key, action, successText) => {
    setBusy(key);
    try {
      await action();
      if (successText) onNotice?.(successText);
      return true;
    } catch (err) {
      onError?.(describeCreditError(err.message));
      return false;
    } finally {
      setBusy('');
    }
  }, [onError, onNotice]);

  /**
   * @description 读取租户额度总览与成员列表
   * @keyword-cn 加载成员额度
   * @keyword-en load-member-credits
   */
  const loadOverview = useCallback(async (target = tenantId) => {
    if (superAdmin && !target) {
      setOverview(null);
      return;
    }
    const res = await adminApi.getTenantCreditOverview(superAdmin ? target : undefined);
    setOverview(res);
    setGrantInput(String(res?.tenant?.memberCreditGrant ?? 0));
  }, [superAdmin, tenantId]);

  useEffect(() => {
    loadOverview().catch((err) => onError?.(describeCreditError(err.message)));
  }, []);

  const summary = overview?.tenant;
  const members = overview?.members || [];
  const activeTenantId = summary?.tenantId || tenantId;
  const allocatable = summary && summary.mode === 'allocated' && !summary.unlimited;

  /**
   * @description 保存新成员赠送额度
   * @keyword-cn 保存新成员赠送
   * @keyword-en save-new-member-grant
   */
  const onSaveGrant = () => {
    const value = Number(grantInput);
    if (!Number.isFinite(value) || value < 0) {
      onError?.('赠送额度需为不小于 0 的数字');
      return;
    }
    run('grant', async () => {
      await adminApi.updateTenantCreditSettings(activeTenantId, { memberCreditGrant: value });
      await loadOverview(activeTenantId);
    }, '新成员赠送额度已保存');
  };

  /**
   * @description 超管把旧共用租户切到分配模式，可选迁移原余额给每个成员各一份全额
   * @keyword-cn 切换分配模式, 旧余额迁移
   * @keyword-en switch-credit-mode, legacy-credit-migration
   */
  const onSwitchMode = (migrate) => {
    const enabledCount = members.filter((row) => row.enabled).length;
    const text = migrate
      ? `确认迁移？租户当前余额 ${formatCredit(summary?.poolCredit)} 会给 ${enabledCount} 个启用成员每人各发一份全额，租户余额清零，之后成员只用自己分到的额度。此操作不可撤销。`
      : '确认直接切换到分配模式？租户当前余额保留为待分配额度，成员额度从 0 开始，需要再逐个分配。';
    if (!window.confirm(text)) return;
    run(`mode-${migrate}`, async () => {
      const res = await adminApi.switchTenantCreditMode(activeTenantId, { migrate });
      await loadOverview(activeTenantId);
      if (res?.migration?.failed?.length) {
        onError?.(`有 ${res.migration.failed.length} 个成员迁移失败，请查看后台日志后手动分配`);
      }
    }, migrate ? '已迁移，每个成员各得一份全额' : '已切换到分配模式');
  };

  /**
   * @description 提交分配或回收成员额度
   * @keyword-cn 提交成员额度分配
   * @keyword-en submit-member-allocation
   */
  const onSubmitAllocate = async () => {
    const amount = Number(allocateDialog.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onError?.('请输入大于 0 的数量');
      return;
    }
    if (allocateDialog.reason.trim().length < 2) {
      onError?.('请填写至少 2 个字的原因');
      return;
    }
    const ok = await run('allocate', async () => {
      await adminApi.allocateMemberCredit(activeTenantId, allocateDialog.member.memberId, {
        amount: allocateDialog.direction === 'reclaim' ? -amount : amount,
        reason: allocateDialog.reason.trim(),
      });
      await loadOverview(activeTenantId);
    }, allocateDialog.direction === 'reclaim' ? '已回收到待分配额度' : '已分配给成员');
    if (ok) setAllocateDialog(null);
  };

  /**
   * @description 打开或翻页读取成员本租户额度流水
   * @keyword-cn 成员额度流水弹窗
   * @keyword-en member-ledger-dialog
   */
  const loadMemberLedger = async (member, before) => {
    const res = await adminApi.listMemberCreditTransactions(activeTenantId, member.memberId, { limit: LEDGER_PAGE_SIZE, before });
    const rows = res?.transactions || [];
    setLedgerDialog((prev) => ({
      member,
      rows: before && prev ? [...prev.rows, ...rows] : rows,
      hasMore: rows.length >= LEDGER_PAGE_SIZE,
    }));
  };

  /**
   * @description 打开或翻页读取个人额度与流水（超管）
   * @keyword-cn 个人额度弹窗
   * @keyword-en personal-credit-dialog
   */
  const loadPersonal = async (member, before) => {
    const res = await adminApi.getPersonalCreditAccount(member.accountId, { limit: LEDGER_PAGE_SIZE, before });
    const rows = res?.transactions || [];
    setPersonalDialog((prev) => ({
      member,
      credit: res?.credit ?? 0,
      rows: before && prev ? [...prev.rows, ...rows] : rows,
      hasMore: rows.length >= LEDGER_PAGE_SIZE,
      kind: prev?.kind || 'recharge',
      amount: before && prev ? prev.amount : '',
      reason: before && prev ? prev.reason : '',
      referenceId: before && prev ? prev.referenceId : '',
    }));
  };

  /**
   * @description 提交个人额度充值或调账（超管）
   * @keyword-cn 提交个人充值
   * @keyword-en submit-personal-recharge
   */
  const onSubmitPersonal = async () => {
    const amount = Number(personalDialog.amount);
    if (!Number.isFinite(amount) || amount === 0 || (personalDialog.kind === 'recharge' && amount < 0)) {
      onError?.(personalDialog.kind === 'recharge' ? '充值数量需大于 0' : '调账数量不能为 0');
      return;
    }
    if (personalDialog.reason.trim().length < 2) {
      onError?.('请填写至少 2 个字的原因');
      return;
    }
    await run('personal', async () => {
      await adminApi.changePersonalCredit(personalDialog.member.accountId, personalDialog.kind === 'adjust' ? 'adjust' : 'recharge', {
        amount,
        reason: personalDialog.reason.trim(),
        referenceId: personalDialog.referenceId.trim() || undefined,
      });
      setPersonalDialog((prev) => ({ ...prev, amount: '', reason: '', referenceId: '' }));
      await loadPersonal(personalDialog.member);
      await loadOverview(activeTenantId);
    }, '个人额度已入账');
  };

  const modeLabel = !summary
    ? ''
    : summary.unlimited
      ? '无限额度'
      : summary.mode === 'allocated'
        ? '分配模式'
        : '全员共用（旧模式）';

  return (
    <div className="space-y-4 pb-8">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">成员 Credit</h2>
            <p className="text-xs text-slate-500 mt-1">
              租户的 Credit 统一分配给成员：成员只能用自己分到的额度，切到别的租户不能混用；成员个人充值的额度在所有租户都能用。使用时先扣租户分的，用完再扣个人的。
            </p>
          </div>
          {superAdmin ? (
            <select
              className="border rounded px-3 py-2 text-sm"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                loadOverview(e.target.value).catch((err) => onError?.(describeCreditError(err.message)));
              }}
            >
              <option value="">请选择租户</option>
              {tenants.map((tenant) => (
                <option key={tenant._id || tenant.id} value={tenant._id || tenant.id}>{tenant.name}</option>
              ))}
            </select>
          ) : null}
        </div>

        {summary ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">额度模式</div>
              <div className="mt-1 font-semibold text-slate-900">{modeLabel}</div>
              {summary.creditMigratedAt ? <div className="mt-1 text-xs text-slate-400">迁移于 {formatTime(summary.creditMigratedAt)}</div> : null}
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{summary.mode === 'allocated' ? '待分配额度' : '全员共用余额'}</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{formatCredit(summary.poolCredit)}</div>
              <div className="mt-1 text-xs text-slate-400">由超管在「租户管理 → 充值/流水」入账</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">新成员赠送（从待分配额度扣）</div>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={grantInput}
                  onChange={(e) => setGrantInput(e.target.value)}
                  className="w-28 border rounded px-2 py-1 text-sm"
                />
                <button disabled={Boolean(busy)} onClick={onSaveGrant} className="px-3 py-1 text-sm bg-slate-900 text-white rounded disabled:bg-slate-300">
                  {busy === 'grant' ? '保存中…' : '保存'}
                </button>
              </div>
              <div className="mt-1 text-xs text-slate-400">注册、邀请或审批通过加入本租户的新成员自动领取；待分配额度不足时不发</div>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">{superAdmin ? '请选择要管理的租户' : '加载中…'}</p>
        )}

        {summary && superAdmin && summary.mode !== 'allocated' && !summary.unlimited ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
            <div>该租户还是全员共用一个余额的旧模式。切换后成员各用各的额度，旧余额可以迁移给成员，也可以留作待分配额度再逐个分。</div>
            <div className="flex flex-wrap gap-2">
              <button disabled={Boolean(busy)} onClick={() => onSwitchMode(true)} className="px-3 py-1.5 text-sm rounded bg-amber-600 text-white disabled:opacity-50">
                {busy === 'mode-true' ? '迁移中…' : '迁移：每个成员各得一份全额'}
              </button>
              <button disabled={Boolean(busy)} onClick={() => onSwitchMode(false)} className="px-3 py-1.5 text-sm rounded border border-amber-300 bg-white disabled:opacity-50">
                {busy === 'mode-false' ? '切换中…' : '直接切换（余额留作待分配）'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {summary ? (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b">
                  <th className="py-2 pr-3">成员</th>
                  <th className="py-2 pr-3">角色</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3 text-right">本租户额度</th>
                  {superAdmin ? <th className="py-2 pr-3 text-right">个人额度</th> : null}
                  <th className="py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.length ? members.map((row) => (
                  <tr key={row.memberId} className="border-b border-slate-100">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.displayName}</div>
                      <div className="text-xs text-slate-500">{row.phone || '—'}</div>
                    </td>
                    <td className="py-3 pr-3">{ROLE_NAMES[row.role] || row.role}</td>
                    <td className="py-3 pr-3">{row.enabled ? <span className="text-emerald-600">启用</span> : <span className="text-slate-400">停用</span>}</td>
                    <td className="py-3 pr-3 text-right font-semibold">{summary.unlimited ? '∞' : formatCredit(row.tenantCredit)}</td>
                    {superAdmin ? <td className="py-3 pr-3 text-right">{row.accountId ? formatCredit(row.personalCredit) : '—'}</td> : null}
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        disabled={Boolean(busy) || !allocatable}
                        title={allocatable ? '' : '分配模式的有限额度租户才能分配'}
                        onClick={() => setAllocateDialog({ member: row, direction: 'allocate', amount: '', reason: '' })}
                        className="px-2 py-1 text-xs rounded bg-slate-900 text-white disabled:bg-slate-300"
                      >
                        分配 / 回收
                      </button>
                      <button
                        onClick={() => loadMemberLedger(row).catch((err) => onError?.(describeCreditError(err.message)))}
                        className="ml-1 px-2 py-1 text-xs rounded border"
                      >
                        流水
                      </button>
                      {superAdmin ? (
                        <button
                          disabled={!row.accountId}
                          onClick={() => loadPersonal(row).catch((err) => onError?.(describeCreditError(err.message)))}
                          className="ml-1 px-2 py-1 text-xs rounded border border-blue-200 text-blue-600 disabled:opacity-40"
                        >
                          个人额度
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={superAdmin ? 6 : 5} className="py-8 text-center text-slate-400">暂无成员</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {allocateDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3">
            <h3 className="font-semibold text-slate-900">{allocateDialog.member.displayName} · 本租户额度</h3>
            <p className="text-xs text-slate-500">当前额度 {formatCredit(allocateDialog.member.tenantCredit)}，待分配额度 {formatCredit(summary?.poolCredit)}</p>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="radio" checked={allocateDialog.direction === 'allocate'} onChange={() => setAllocateDialog({ ...allocateDialog, direction: 'allocate' })} />分配给成员</label>
              <label className="flex items-center gap-1"><input type="radio" checked={allocateDialog.direction === 'reclaim'} onChange={() => setAllocateDialog({ ...allocateDialog, direction: 'reclaim' })} />收回到待分配</label>
            </div>
            <label className="block text-sm text-slate-700">数量
              <input type="number" min="0" step="any" value={allocateDialog.amount} onChange={(e) => setAllocateDialog({ ...allocateDialog, amount: e.target.value })} className="mt-1 w-full border rounded px-3 py-2" />
            </label>
            <label className="block text-sm text-slate-700">原因
              <input maxLength={200} value={allocateDialog.reason} onChange={(e) => setAllocateDialog({ ...allocateDialog, reason: e.target.value })} className="mt-1 w-full border rounded px-3 py-2" placeholder="例如：11 月额度" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAllocateDialog(null)} className="px-3 py-2 text-sm border rounded">取消</button>
              <button disabled={Boolean(busy)} onClick={onSubmitAllocate} className="px-3 py-2 text-sm bg-slate-900 text-white rounded disabled:opacity-50">{busy === 'allocate' ? '提交中…' : '确认'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {ledgerDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-4 space-y-3 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{ledgerDialog.member.displayName} · 本租户额度流水</h3>
              <button onClick={() => setLedgerDialog(null)} className="px-2 py-1 text-sm border rounded">关闭</button>
            </div>
            <div className="overflow-y-auto">
              <LedgerList
                rows={ledgerDialog.rows}
                hasMore={ledgerDialog.hasMore}
                loading={false}
                onLoadMore={() => {
                  const last = ledgerDialog.rows[ledgerDialog.rows.length - 1];
                  loadMemberLedger(ledgerDialog.member, last?.createdAt).catch((err) => onError?.(describeCreditError(err.message)));
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {personalDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-4 space-y-3 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{personalDialog.member.displayName} · 个人额度</h3>
                <p className="text-xs text-slate-500">当前 {formatCredit(personalDialog.credit)}，该账号加入的所有租户都能用</p>
              </div>
              <button onClick={() => setPersonalDialog(null)} className="px-2 py-1 text-sm border rounded">关闭</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <select value={personalDialog.kind} onChange={(e) => setPersonalDialog({ ...personalDialog, kind: e.target.value })} className="border rounded px-2 py-2">
                <option value="recharge">充值（正数）</option>
                <option value="adjust">人工调账（可负数）</option>
              </select>
              <input type="number" step="any" placeholder="数量" value={personalDialog.amount} onChange={(e) => setPersonalDialog({ ...personalDialog, amount: e.target.value })} className="border rounded px-2 py-2" />
              <input maxLength={200} placeholder="原因（必填）" value={personalDialog.reason} onChange={(e) => setPersonalDialog({ ...personalDialog, reason: e.target.value })} className="border rounded px-2 py-2" />
              <input maxLength={100} placeholder="外部单号（可选，防重复）" value={personalDialog.referenceId} onChange={(e) => setPersonalDialog({ ...personalDialog, referenceId: e.target.value })} className="border rounded px-2 py-2" />
            </div>
            <div className="flex justify-end">
              <button disabled={Boolean(busy)} onClick={onSubmitPersonal} className="px-3 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50">{busy === 'personal' ? '提交中…' : '入账'}</button>
            </div>
            <div className="overflow-y-auto">
              <LedgerList
                rows={personalDialog.rows}
                hasMore={personalDialog.hasMore}
                loading={false}
                onLoadMore={() => {
                  const last = personalDialog.rows[personalDialog.rows.length - 1];
                  loadPersonal(personalDialog.member, last?.createdAt).catch((err) => onError?.(describeCreditError(err.message)));
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
