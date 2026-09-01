import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 采集规则可用性状态的展示映射，与后端 `HotTopicRuleHealthStatus` 逐字对应。
 * @keyword-cn 可用状态映射, 状态徽标
 * @keyword-en health-status-map, status-badge
 */
const HEALTH_BADGES = {
  ok: { label: '可用', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  failed: { label: '不可用', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  unknown: { label: '未自检', className: 'bg-slate-50 text-slate-500 border-slate-200' },
};

/** @type {object} 新建采集规则表单的初始值，与后端 CreateHotTopicRuleDto 字段一一对应。 */
const EMPTY_RULE_FORM = {
  id: null,
  name: '',
  category: 'social',
  platform: '',
  endpoint: '',
  listPath: '',
  fieldTitle: 'title',
  fieldUrl: '',
  fieldHeat: '',
  fieldSummary: '',
  urlTemplate: '',
  defaultTags: '',
  limit: 50,
  enabled: true,
  headers: '',
};

/**
 * @description 把后端规则实体铺平成表单值，编辑时直接回填。
 * @param {object} rule - 采集规则实体。
 * @returns {object} 表单值。
 * @keyword-cn 规则转表单, 编辑回填
 * @keyword-en rule-to-form, edit-prefill
 */
const ruleToForm = (rule) => ({
  id: rule.id,
  name: rule.name || '',
  category: rule.category || 'social',
  platform: rule.platform || '',
  endpoint: rule.endpoint || '',
  listPath: rule.listPath || '',
  fieldTitle: rule.fields?.title || 'title',
  fieldUrl: rule.fields?.url || '',
  fieldHeat: rule.fields?.heat || '',
  fieldSummary: rule.fields?.summary || '',
  urlTemplate: rule.urlTemplate || '',
  defaultTags: (rule.defaultTags || []).join('、'),
  limit: rule.limit ?? 50,
  enabled: rule.enabled !== false,
  headers: rule.headers ? JSON.stringify(rule.headers, null, 2) : '',
});

/**
 * @description 把表单值转回接口入参；请求头按 JSON 解析，解析失败直接抛出让调用方提示。
 * @param {object} form - 表单值。
 * @returns {object} 接口入参。
 * @throws {Error} 请求头不是合法 JSON 对象时抛出。
 * @keyword-cn 表单转入参, 请求头解析
 * @keyword-en form-to-payload, headers-parse
 */
const formToPayload = (form) => {
  let headers;
  const rawHeaders = String(form.headers || '').trim();
  if (rawHeaders) {
    let parsed;
    try {
      parsed = JSON.parse(rawHeaders);
    } catch {
      throw new Error('附加请求头必须是合法 JSON，例如 {"Referer":"https://example.com/"}');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('附加请求头必须是 JSON 对象');
    }
    headers = parsed;
  }
  return {
    name: form.name.trim(),
    category: form.category,
    platform: form.platform.trim() || undefined,
    endpoint: form.endpoint.trim(),
    listPath: form.listPath.trim() || undefined,
    fields: {
      title: form.fieldTitle.trim() || 'title',
      url: form.fieldUrl.trim() || undefined,
      heat: form.fieldHeat.trim() || undefined,
      summary: form.fieldSummary.trim() || undefined,
    },
    urlTemplate: form.urlTemplate.trim() || undefined,
    defaultTags: String(form.defaultTags || '')
      .split(/[、,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 5),
    limit: Number(form.limit) || 50,
    enabled: form.enabled !== false,
    ...(headers ? { headers } : {}),
  };
};

/**
 * @description 把时间戳格式化成「YYYY-MM-DD HH:mm」，空值显示占位符。
 * @param {string|Date|null} value - 时间值。
 * @returns {string} 展示文本。
 * @keyword-cn 时间格式化, 空值占位
 * @keyword-en format-datetime, empty-placeholder
 */
const formatTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * @description 热点采集榜后台面板：采集规则管理（含可用性自检）、触发采集（默认清除历史）、
 *  榜单浏览与过滤、AI 归类标签弹窗，以及按母选题推荐热点。
 * @param {{ onNotice: (text: string) => void, onError: (text: string) => void }} props - 顶层提示回调。
 * @returns {JSX.Element} 面板节点。
 * @keyword-cn 热点采集面板, 采集规则管理, 标签弹窗
 * @keyword-en hot-topic-panel, collect-rule-admin, tag-dialog
 */
const HotTopicPanel = ({ onNotice, onError }) => {
  const [meta, setMeta] = useState({ categories: [], suggestedTags: [] });
  const [rules, setRules] = useState([]);
  const [items, setItems] = useState([]);
  const [itemTotal, setItemTotal] = useState(0);
  const [summary, setSummary] = useState({ total: 0, tagged: 0, latestAt: null });
  const [filter, setFilter] = useState({
    category: '',
    ruleId: '',
    tag: '',
    keyword: '',
    page: 1,
    pageSize: 50,
  });
  const [selectedRuleIds, setSelectedRuleIds] = useState([]);
  const [clearPrevious, setClearPrevious] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [busy, setBusy] = useState('');
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [tagDialog, setTagDialog] = useState({ open: false, loading: false, rows: [] });
  const [collectResult, setCollectResult] = useState(null);
  const [recommendForm, setRecommendForm] = useState({
    parentTopic: '',
    parentTopicBrief: '',
    limit: 5,
  });
  const [recommendResult, setRecommendResult] = useState(null);

  const categoryLabel = useMemo(() => {
    const map = {};
    for (const entry of meta.categories) map[entry.id] = entry.label;
    return map;
  }, [meta.categories]);

  /**
   * @description 统一包装异步动作：置忙、失败上抛顶层错误提示、成功给一句 notice。
   * @keyword-cn 异步动作包装, 统一提示
   * @keyword-en async-action-wrapper, unified-feedback
   */
  const run = useCallback(
    async (key, fn, successText) => {
      setBusy(key);
      try {
        const result = await fn();
        if (successText) onNotice(successText);
        return result;
      } catch (error) {
        onError(error.message || String(error));
        return null;
      } finally {
        setBusy('');
      }
    },
    [onError, onNotice],
  );

  /**
   * @description 拉取采集规则列表。
   * @keyword-cn 加载采集规则, 刷新列表
   * @keyword-en load-rules, refresh-list
   */
  const loadRules = useCallback(async () => {
    const data = await adminApi.listHotTopicRules();
    setRules(data?.rules || []);
  }, []);

  /**
   * @description 按当前过滤条件拉取榜单条目与概况。
   * @keyword-cn 加载榜单条目, 过滤查询
   * @keyword-en load-items, filtered-query
   */
  const loadItems = useCallback(async (nextFilter) => {
    const query = nextFilter || filter;
    const data = await adminApi.listHotTopicItems(query);
    setItems(data?.rows || []);
    setItemTotal(data?.total || 0);
    setSummary(data?.summary || { total: 0, tagged: 0, latestAt: null });
  }, [filter]);

  useEffect(() => {
    (async () => {
      try {
        const [metaData] = await Promise.all([adminApi.getHotTopicMeta()]);
        setMeta(metaData || { categories: [], suggestedTags: [] });
        await loadRules();
        await loadItems();
      } catch (error) {
        onError(error.message || String(error));
      }
    })();
    // 只在挂载时拉一次；后续刷新由各操作显式触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * @description 初始化平台内置的社会/娱乐热点预置规则。
   * @keyword-cn 初始化预置规则, 幂等补齐
   * @keyword-en seed-builtin-rules, idempotent-fill
   */
  const onSeed = () =>
    run(
      'seed',
      async () => {
        const data = await adminApi.seedHotTopicRules();
        setRules(data?.rules || []);
        return data;
      },
      '预置规则已初始化',
    );

  /**
   * @description 对一条规则做真实抓取自检并刷新它的可用性徽标。
   * @keyword-cn 规则自检, 可用性探测
   * @keyword-en rule-self-check, availability-probe
   */
  const onCheckRule = (rule) =>
    run(`check-${rule.id}`, async () => {
      const data = await adminApi.checkHotTopicRule(rule.id);
      const next = data?.rule;
      if (next) setRules((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      if (next?.health?.status === 'ok') {
        onNotice(`「${rule.name}」可用：${next.health.message || ''}`);
      } else {
        onError(`「${rule.name}」不可用：${next?.health?.message || '未知原因'}`);
      }
      return data;
    });

  /**
   * @description 切换一条规则的启用状态；停用后该规则不再参与任何采集。
   * @keyword-cn 切换启用, 采集闸门
   * @keyword-en toggle-enabled, collect-gate
   */
  const onToggleEnabled = (rule) =>
    run(
      `toggle-${rule.id}`,
      async () => {
        const data = await adminApi.updateHotTopicRule(rule.id, {
          enabled: rule.enabled === false,
        });
        const next = data?.rule;
        if (next) setRules((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      },
      rule.enabled === false ? '规则已启用' : '规则已停用',
    );

  /**
   * @description 删除一条采集规则（内置规则可通过初始化预置规则补回）。
   * @keyword-cn 删除采集规则, 二次确认
   * @keyword-en delete-rule, confirm-delete
   */
  const onDeleteRule = (rule) => {
    if (!window.confirm(`确定删除采集规则「${rule.name}」？`)) return;
    return run(
      `delete-${rule.id}`,
      async () => {
        await adminApi.deleteHotTopicRule(rule.id);
        setRules((prev) => prev.filter((r) => r.id !== rule.id));
      },
      '规则已删除',
    );
  };

  /**
   * @description 提交新建或更新采集规则表单。
   * @keyword-cn 提交规则表单, 新建更新
   * @keyword-en submit-rule-form, create-or-update
   */
  const onSubmitRule = () =>
    run(
      'submit-rule',
      async () => {
        const payload = formToPayload(ruleForm);
        if (!payload.name) throw new Error('规则名称不能为空');
        if (!payload.endpoint) throw new Error('榜单地址不能为空');
        if (ruleForm.id) {
          await adminApi.updateHotTopicRule(ruleForm.id, payload);
        } else {
          await adminApi.createHotTopicRule(payload);
        }
        await loadRules();
        setShowRuleForm(false);
        setRuleForm(EMPTY_RULE_FORM);
      },
      ruleForm.id ? '规则已更新' : '规则已新建',
    );

  /**
   * @description 触发一次采集：默认先清除历史再采，采完自动做 AI 归类。
   * @keyword-cn 触发采集, 默认清除历史
   * @keyword-en trigger-collect, clear-previous-default
   */
  const onCollect = () =>
    run(
      'collect',
      async () => {
        const data = await adminApi.collectHotTopics({
          ...(selectedRuleIds.length ? { ruleIds: selectedRuleIds } : {}),
          clearPrevious,
          autoTag,
        });
        setCollectResult(data?.result || null);
        await loadRules();
        const nextFilter = { ...filter, page: 1 };
        setFilter(nextFilter);
        await loadItems(nextFilter);
        return data;
      },
      '采集完成',
    );

  /**
   * @description 对尚未 AI 归类的条目补跑一次归类。
   * @keyword-cn 补跑归类, 未归类条目
   * @keyword-en retag-pending, untagged-items
   */
  const onRetag = () =>
    run(
      'retag',
      async () => {
        const data = await adminApi.retagHotTopics();
        await loadItems();
        onNotice(`待归类 ${data?.pending ?? 0} 条，本次归类 ${data?.tagged ?? 0} 条`);
        return data;
      },
    );

  /**
   * @description 清空当前榜单条目。
   * @keyword-cn 清空榜单, 二次确认
   * @keyword-en clear-items, confirm-clear
   */
  const onClearItems = () => {
    if (!window.confirm('确定清空当前热点榜的全部条目？')) return;
    return run(
      'clear-items',
      async () => {
        await adminApi.clearHotTopicItems();
        await loadItems();
      },
      '榜单已清空',
    );
  };

  /**
   * @description 打开采集标签弹窗，线性拉取全部归类标签及其条目数与示例标题。
   * @keyword-cn 打开标签弹窗, 线性查看标签
   * @keyword-en open-tag-dialog, linear-tag-view
   */
  const onOpenTagDialog = async () => {
    setTagDialog({ open: true, loading: true, rows: [] });
    try {
      const data = await adminApi.listHotTopicTags();
      setTagDialog({ open: true, loading: false, rows: data?.tags || [] });
    } catch (error) {
      setTagDialog({ open: false, loading: false, rows: [] });
      onError(error.message || String(error));
    }
  };

  /**
   * @description 从标签弹窗点某个标签，直接把榜单过滤到该标签。
   * @keyword-cn 按标签过滤, 弹窗联动
   * @keyword-en filter-by-tag, dialog-linkage
   */
  const onPickTag = async (tag) => {
    const nextFilter = { ...filter, tag, page: 1 };
    setFilter(nextFilter);
    setTagDialog({ open: false, loading: false, rows: [] });
    await loadItems(nextFilter).catch((error) => onError(error.message));
  };

  /**
   * @description 按母选题调用推荐接口，展示结构化推荐结果。
   * @keyword-cn 热点推荐, 母选题匹配
   * @keyword-en recommend-hot-topics, parent-topic-match
   */
  const onRecommend = () =>
    run('recommend', async () => {
      if (!recommendForm.parentTopic.trim()) {
        throw new Error('请先填写母选题');
      }
      const data = await adminApi.recommendHotTopics({
        parentTopic: recommendForm.parentTopic.trim(),
        parentTopicBrief: recommendForm.parentTopicBrief.trim() || undefined,
        limit: Number(recommendForm.limit) || 5,
      });
      setRecommendResult(data);
      return data;
    });

  /**
   * @description 应用榜单过滤条件并回到第一页。
   * @keyword-cn 应用过滤, 重置分页
   * @keyword-en apply-filter, reset-page
   */
  const onApplyFilter = (patch) => {
    const nextFilter = { ...filter, ...patch, page: 1 };
    setFilter(nextFilter);
    loadItems(nextFilter).catch((error) => onError(error.message));
  };

  const totalPages = Math.max(1, Math.ceil(itemTotal / (filter.pageSize || 50)));
  const enabledRuleCount = rules.filter((r) => r.enabled !== false).length;
  const okRuleCount = rules.filter((r) => r.health?.status === 'ok').length;

  return (
    <div className="space-y-4 pb-8">
      {/* 采集规则管理 | @keyword-en collect rule table */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">热点采集规则</h2>
            <p className="text-xs text-slate-500 mt-1">
              一条规则 = 一个公开榜单接口 + 一组取值路径。「是否可用」是最近一次自检或采集的真实结果，
              上游改版式后会自动标红并给出原因，改路径即可恢复。当前
              <span className="font-medium text-slate-700"> {rules.length} </span>条规则，
              启用 <span className="font-medium text-slate-700">{enabledRuleCount}</span> 条，
              自检可用 <span className="font-medium text-emerald-700">{okRuleCount}</span> 条。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSeed}
              disabled={busy === 'seed'}
              className="px-3 py-2 border border-slate-300 text-sm rounded hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'seed' ? '初始化中…' : '初始化预置规则'}
            </button>
            <button
              onClick={() => {
                setRuleForm(EMPTY_RULE_FORM);
                setShowRuleForm(true);
              }}
              className="px-3 py-2 bg-slate-900 text-white text-sm rounded"
            >
              新建规则
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2 w-8"> </th>
                <th className="py-2 pr-2">规则</th>
                <th className="py-2 pr-2">分类</th>
                <th className="py-2 pr-2">来源</th>
                <th className="py-2 pr-2">条数</th>
                <th className="py-2 pr-2">启用</th>
                <th className="py-2 pr-2">是否可用</th>
                <th className="py-2 pr-2">最近自检</th>
                <th className="py-2 pr-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-400 text-xs">
                    还没有采集规则，点「初始化预置规则」一键装上社会热点与娱乐热点各 4 条。
                  </td>
                </tr>
              ) : (
                rules.map((rule) => {
                  const badge = HEALTH_BADGES[rule.health?.status] || HEALTH_BADGES.unknown;
                  const checked = selectedRuleIds.includes(rule.id);
                  return (
                    <tr key={rule.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRuleIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== rule.id)
                                : [...prev, rule.id],
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-slate-900">{rule.name}</div>
                        <div className="text-[11px] text-slate-400 break-all max-w-[320px]">
                          {rule.endpoint}
                        </div>
                        {rule.builtin ? (
                          <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            内置
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 text-slate-600">
                        {categoryLabel[rule.category] || rule.category}
                      </td>
                      <td className="py-2 pr-2 text-slate-600">{rule.platform}</td>
                      <td className="py-2 pr-2 text-slate-600">{rule.limit}</td>
                      <td className="py-2 pr-2">
                        <button
                          onClick={() => onToggleEnabled(rule)}
                          disabled={busy === `toggle-${rule.id}`}
                          className={`px-2 py-0.5 text-xs rounded border ${
                            rule.enabled !== false
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          {rule.enabled !== false ? '已启用' : '已停用'}
                        </button>
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {rule.health?.message ? (
                          <div className="text-[11px] text-slate-400 mt-1 max-w-[240px]">
                            {rule.health.message}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 text-xs text-slate-500">
                        {formatTime(rule.health?.checkedAt)}
                      </td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => onCheckRule(rule)}
                          disabled={busy === `check-${rule.id}`}
                          className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy === `check-${rule.id}` ? '自检中…' : '自检'}
                        </button>
                        <button
                          onClick={() => {
                            setRuleForm(ruleToForm(rule));
                            setShowRuleForm(true);
                          }}
                          className="ml-1 px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => onDeleteRule(rule)}
                          className="ml-1 px-2 py-1 text-xs border border-rose-200 text-rose-600 rounded hover:bg-rose-50"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 规则编辑表单 | @keyword-en rule form */}
      {showRuleForm ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">
              {ruleForm.id ? `编辑规则 #${ruleForm.id}` : '新建采集规则'}
            </h3>
            <button
              onClick={() => {
                setShowRuleForm(false);
                setRuleForm(EMPTY_RULE_FORM);
              }}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              取消
            </button>
          </div>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">规则名称</span>
              <input
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5"
                placeholder="例如 微博热搜榜"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">分类</span>
              <select
                value={ruleForm.category}
                onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5"
              >
                {meta.categories.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">来源平台</span>
              <input
                value={ruleForm.platform}
                onChange={(e) => setRuleForm({ ...ruleForm, platform: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5"
                placeholder="例如 微博"
              />
            </label>
            <label className="space-y-1 md:col-span-3">
              <span className="text-xs text-slate-500">
                榜单接口地址（只支持 http/https 公网地址）
              </span>
              <input
                value={ruleForm.endpoint}
                onChange={(e) => setRuleForm({ ...ruleForm, endpoint: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="https://weibo.com/ajax/side/hotSearch"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">
                榜单数组路径（留空自动探测）
              </span>
              <input
                value={ruleForm.listPath}
                onChange={(e) => setRuleForm({ ...ruleForm, listPath: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="data.realtime"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">标题路径（必填）</span>
              <input
                value={ruleForm.fieldTitle}
                onChange={(e) => setRuleForm({ ...ruleForm, fieldTitle: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="word"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">链接路径</span>
              <input
                value={ruleForm.fieldUrl}
                onChange={(e) => setRuleForm({ ...ruleForm, fieldUrl: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="url"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">热度路径</span>
              <input
                value={ruleForm.fieldHeat}
                onChange={(e) => setRuleForm({ ...ruleForm, fieldHeat: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="num"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">摘要路径</span>
              <input
                value={ruleForm.fieldSummary}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, fieldSummary: e.target.value })
                }
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="desc"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">保留条数</span>
              <input
                type="number"
                min={1}
                max={200}
                value={ruleForm.limit}
                onChange={(e) => setRuleForm({ ...ruleForm, limit: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-slate-500">
                链接模板（榜单不给直链时用，占位符 {'{title}'} 或任意字段路径如 {'{contId}'}）
              </span>
              <input
                value={ruleForm.urlTemplate}
                onChange={(e) => setRuleForm({ ...ruleForm, urlTemplate: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder="https://s.weibo.com/weibo?q=%23{title}%23"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">
                AI 归类失败时的兜底标签（顿号分隔，最多 5 个）
              </span>
              <input
                value={ruleForm.defaultTags}
                onChange={(e) => setRuleForm({ ...ruleForm, defaultTags: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5"
                placeholder="社会民生、突发事件"
              />
            </label>
            <label className="space-y-1 md:col-span-3">
              <span className="text-xs text-slate-500">
                附加请求头 JSON（可留空；不填 User-Agent 会自动补一个桌面 UA）
              </span>
              <textarea
                value={ruleForm.headers}
                onChange={(e) => setRuleForm({ ...ruleForm, headers: e.target.value })}
                rows={3}
                className="w-full border border-slate-300 rounded px-2 py-1.5 font-mono text-xs"
                placeholder={'{\n  "Referer": "https://weibo.com/"\n}'}
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={ruleForm.enabled}
                onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
              />
              启用该规则
            </label>
            <button
              onClick={onSubmitRule}
              disabled={busy === 'submit-rule'}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:opacity-50"
            >
              {busy === 'submit-rule' ? '保存中…' : '保存规则'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 采集操作 | @keyword-en collect action bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">执行采集</h2>
            <p className="text-xs text-slate-500 mt-1">
              勾选上方规则即只采这几条，不勾就跑全部已启用规则。停用的规则即使勾选也会被跳过。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={clearPrevious}
                onChange={(e) => setClearPrevious(e.target.checked)}
              />
              采集前清除之前的（默认）
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={autoTag}
                onChange={(e) => setAutoTag(e.target.checked)}
              />
              采集后 AI 归类打标
            </label>
            <button
              onClick={onCollect}
              disabled={busy === 'collect'}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:opacity-50"
            >
              {busy === 'collect' ? '采集中…' : '开始采集'}
            </button>
          </div>
        </div>

        {collectResult ? (
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-xs space-y-2">
            <div className="text-slate-600">
              批次 <span className="font-mono">{collectResult.batchId.slice(0, 8)}</span>
              ｜清除 {collectResult.cleared} 条｜新采 {collectResult.collected} 条｜AI 归类{' '}
              {collectResult.tagged} 条
            </div>
            <div className="space-y-1">
              {collectResult.rules.map((row) => (
                <div key={row.ruleId} className="flex gap-2">
                  <span className={row.ok ? 'text-emerald-700' : 'text-rose-600'}>
                    {row.ok ? '✓' : '✕'}
                  </span>
                  <span className="text-slate-700 w-32 shrink-0">{row.ruleName}</span>
                  <span className="text-slate-500">
                    {row.ok ? `采到 ${row.collected} 条` : row.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* 榜单浏览 | @keyword-en board list */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">当前热点榜</h2>
            <p className="text-xs text-slate-500 mt-1">
              共 {summary.total} 条，其中 AI 已归类 {summary.tagged} 条；最近采集{' '}
              {formatTime(summary.latestAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onOpenTagDialog}
              className="px-3 py-2 border border-slate-300 text-sm rounded hover:bg-slate-50"
            >
              查看采集标签
            </button>
            <button
              onClick={onRetag}
              disabled={busy === 'retag'}
              className="px-3 py-2 border border-slate-300 text-sm rounded hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'retag' ? '归类中…' : '补跑 AI 归类'}
            </button>
            <button
              onClick={onClearItems}
              className="px-3 py-2 border border-rose-200 text-rose-600 text-sm rounded hover:bg-rose-50"
            >
              清空榜单
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={filter.category}
            onChange={(e) => onApplyFilter({ category: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1.5"
          >
            <option value="">全部分类</option>
            {meta.categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            value={filter.ruleId}
            onChange={(e) => onApplyFilter({ ruleId: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1.5"
          >
            <option value="">全部来源</option>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
          <input
            value={filter.keyword}
            onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onApplyFilter({ keyword: filter.keyword });
            }}
            placeholder="搜索标题后回车"
            className="border border-slate-300 rounded px-2 py-1.5"
          />
          {filter.tag ? (
            <button
              onClick={() => onApplyFilter({ tag: '' })}
              className="px-2 py-1.5 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700"
            >
              标签：{filter.tag} ✕
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2 w-10">#</th>
                <th className="py-2 pr-2">标题</th>
                <th className="py-2 pr-2 whitespace-nowrap">来源</th>
                <th className="py-2 pr-2 whitespace-nowrap">热度</th>
                <th className="py-2 pr-2 w-[132px]">归类标签</th>
                <th className="py-2 pr-2 whitespace-nowrap">采集时间</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400 text-xs">
                    还没有采集到热点，先在上面执行一次采集。
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-400">{item.rank}</td>
                    {/* 标题列限宽 + 单行截断：摘要动辄上百字，不限宽会把右边几列挤出屏幕 */}
                    <td className="py-2 pr-2 max-w-0 w-full">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          title={item.title}
                          className="block truncate text-slate-900 hover:text-blue-600"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span
                          title={item.title}
                          className="block truncate text-slate-900"
                        >
                          {item.title}
                        </span>
                      )}
                      {item.summary ? (
                        <div
                          title={item.summary}
                          className="truncate text-[11px] text-slate-400"
                        >
                          {item.summary}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-slate-600 whitespace-nowrap">
                      {item.platform}
                    </td>
                    <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">
                      {item.heat || '—'}
                    </td>
                    <td className="py-2 pr-2 w-[132px] min-w-[132px]">
                      {(item.tags || []).length === 0 ? (
                        <span className="text-xs text-slate-300">未归类</span>
                      ) : (
                        item.tags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => onApplyFilter({ tag })}
                            className={`mr-1 mb-1 inline-block px-1.5 py-0.5 text-[11px] rounded border ${
                              item.tagSource === 'ai'
                                ? 'bg-violet-50 text-violet-700 border-violet-200'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}
                          >
                            {tag}
                          </button>
                        ))
                      )}
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-500 whitespace-nowrap">
                      {formatTime(item.collectedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {itemTotal > (filter.pageSize || 50) ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <button
              disabled={filter.page <= 1}
              onClick={() => {
                const nextFilter = { ...filter, page: filter.page - 1 };
                setFilter(nextFilter);
                loadItems(nextFilter).catch((error) => onError(error.message));
              }}
              className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
            >
              上一页
            </button>
            <span className="text-xs text-slate-500">
              {filter.page} / {totalPages}
            </span>
            <button
              disabled={filter.page >= totalPages}
              onClick={() => {
                const nextFilter = { ...filter, page: filter.page + 1 };
                setFilter(nextFilter);
                loadItems(nextFilter).catch((error) => onError(error.message));
              }}
              className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>

      {/* 按母选题推荐热点 | @keyword-en recommend by parent topic */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">按母选题推荐热点</h2>
          <p className="text-xs text-slate-500 mt-1">
            调用 <span className="font-mono">POST /api/hot-topic/recommend</span>：
            模型只能从当前榜单里挑，结果由工具逐条写入并以结构化 JSON 返回，不解析模型自然语言。
          </p>
        </div>
        <div className="grid md:grid-cols-4 gap-3 text-sm">
          <label className="space-y-1 md:col-span-1">
            <span className="text-xs text-slate-500">母选题</span>
            <input
              value={recommendForm.parentTopic}
              onChange={(e) =>
                setRecommendForm({ ...recommendForm, parentTopic: e.target.value })
              }
              className="w-full border border-slate-300 rounded px-2 py-1.5"
              placeholder="例如 都市女性情绪疗愈"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs text-slate-500">补充说明（账号定位 / 受众，可留空）</span>
            <input
              value={recommendForm.parentTopicBrief}
              onChange={(e) =>
                setRecommendForm({ ...recommendForm, parentTopicBrief: e.target.value })
              }
              className="w-full border border-slate-300 rounded px-2 py-1.5"
              placeholder="例如 面向一线城市 25-35 岁女性，偏生活方式向"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">推荐条数</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={10}
                value={recommendForm.limit}
                onChange={(e) =>
                  setRecommendForm({ ...recommendForm, limit: e.target.value })
                }
                className="w-20 border border-slate-300 rounded px-2 py-1.5"
              />
              <button
                onClick={onRecommend}
                disabled={busy === 'recommend'}
                className="flex-1 px-3 py-2 bg-slate-900 text-white text-sm rounded disabled:opacity-50"
              >
                {busy === 'recommend' ? '推荐中…' : '推荐'}
              </button>
            </div>
          </label>
        </div>

        {recommendResult ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">
              母选题「{recommendResult.parentTopic}」｜候选{' '}
              {recommendResult.candidateCount} 条｜命中{' '}
              {recommendResult.recommendations.length} 条
              {/* 让人看得出候选是被哪几个标签圈出来的，还是走了全量兜底 */}
              {recommendResult.tagFiltered &&
              recommendResult.matchedTags?.length ? (
                <span>
                  ｜先按标签圈定范围：
                  <span className="text-violet-700">
                    {recommendResult.matchedTags.join('、')}
                  </span>
                </span>
              ) : (
                <span>｜未命中相关标签，已在全量榜单里判定</span>
              )}
            </div>
            {recommendResult.recommendations.length === 0 ? (
              <div className="text-xs text-slate-400 border border-slate-200 rounded p-3">
                当前榜单里没有和这个母选题足够贴合的热点，换个母选题或先补一轮采集。
              </div>
            ) : (
              recommendResult.recommendations.map((row) => (
                <div
                  key={row.hotTopicId}
                  className="border border-slate-200 rounded-lg p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                      契合度 {row.matchScore}
                    </span>
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-slate-900 hover:text-blue-600"
                      >
                        {row.title}
                      </a>
                    ) : (
                      <span className="font-medium text-slate-900">{row.title}</span>
                    )}
                    <span className="text-xs text-slate-400">
                      {row.platform}
                      {row.tags?.length ? `｜${row.tags.join('、')}` : ''}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">匹配理由：{row.reason}</div>
                  <div className="text-xs text-slate-600">切入角度：{row.angle}</div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* 采集标签弹窗 | @keyword-en collected tag dialog */}
      {tagDialog.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div>
                <h3 className="font-semibold text-slate-900">采集标签</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  由 AI 对采集到的热点逐条归类得出。点任一标签即把下方榜单过滤到该标签。
                </p>
              </div>
              <button
                onClick={() => setTagDialog({ open: false, loading: false, rows: [] })}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-2">
              {tagDialog.loading ? (
                <div className="text-xs text-slate-400 py-6 text-center">加载中…</div>
              ) : tagDialog.rows.length === 0 ? (
                <div className="text-xs text-slate-400 py-6 text-center">
                  还没有归类标签。先执行一次采集，或点「补跑 AI 归类」。
                </div>
              ) : (
                tagDialog.rows.map((row) => (
                  <button
                    key={row.tag}
                    onClick={() => onPickTag(row.tag)}
                    className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">{row.tag}</span>
                      <span className="text-xs text-slate-500">
                        {row.count} 条｜{formatTime(row.latestAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      分类：
                      {(row.categories || [])
                        .map((id) => categoryLabel[id] || id)
                        .join('、') || '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      示例：{(row.sampleTitles || []).join('；') || '—'}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HotTopicPanel;
