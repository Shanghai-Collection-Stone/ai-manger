import React, { useEffect, useMemo, useState } from 'react';
import '@uiw/react-md-editor/markdown-editor.css';
import MDEditor from '@uiw/react-md-editor';
import {
  adminApi,
  clearAdminToken,
  resolveFrontendPageHref,
  resolveLoginPageHref,
} from './adminApi';

const PAGE_SIZE = 6;
const ADMIN_ACTIVE_TAB_KEY = 'admin_active_tab';

const toText = (value) => (typeof value === 'string' ? value : '');

const toLower = (value) => toText(value).toLowerCase();

/**
 * @description 将财务 Agent tool 参数/结果格式化为可展示文本
 * @keyword-en finance-agent-tool-value, tool-display
 * @param {unknown} value
 * @returns {string}
 */
const formatFinanceToolValue = (value) => {
  if (value === undefined || value === null) return '';
  const text =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        })();
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text;
};

/**
 * @description 合并财务 Agent tool 流式事件到消息工具列表
 * @keyword-en finance-agent-tool-event, tool-stream
 * @param {Array<Record<string, unknown>>} tools
 * @param {Record<string, unknown>} patch
 * @returns {Array<Record<string, unknown>>}
 */
const mergeFinanceToolEvent = (tools = [], patch = {}) => {
  const key = toText(patch.id) || `${toText(patch.name) || 'tool'}:${patch.index ?? 0}`;
  const next = Array.isArray(tools) ? [...tools] : [];
  const idx = next.findIndex((item) => {
    const itemKey =
      toText(item.id) || `${toText(item.name) || 'tool'}:${item.index ?? 0}`;
    return itemKey === key;
  });
  const existing = idx >= 0 ? next[idx] : {};
  const merged = {
    ...existing,
    ...patch,
    id: toText(patch.id) || toText(existing.id) || key,
    name: toText(patch.name) || toText(existing.name) || 'tool',
  };
  if (patch.argsChunk) {
    merged.argsText = `${toText(existing.argsText)}${toText(patch.argsChunk)}`;
    delete merged.argsChunk;
  }
  if (idx >= 0) {
    next[idx] = merged;
  } else {
    next.push(merged);
  }
  return next;
};

/**
 * @description 清洗发送给财务 Agent 后端的消息,只保留 DTO 允许的 role/content
 * @keyword-en finance-agent-message-sanitize, chat-payload
 * @param {Array<Record<string, unknown>>} messages
 * @returns {Array<{role: string, content: string}>}
 */
const sanitizeFinanceAgentMessages = (messages = []) =>
  (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: ['user', 'assistant', 'system'].includes(message?.role)
        ? message.role
        : 'assistant',
      content: toText(message?.content).trim(),
    }))
    .filter((message) => message.content.length > 0);

/**
 * @description 读取后台管理当前tab（用于刷新保留）
 * @keyword-en read admin active tab
 * @returns {string}
 */
const readAdminActiveTab = () => {
  if (typeof window === 'undefined') return '';
  return toText(window.localStorage.getItem(ADMIN_ACTIVE_TAB_KEY)).trim();
};

/**
 * @description 写入后台管理当前tab（用于刷新保留）
 * @keyword-en write admin active tab
 * @param {string} tabId
 * @returns {void}
 */
const writeAdminActiveTab = (tabId) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_ACTIVE_TAB_KEY, toText(tabId));
};

const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const ROLE_OPTIONS = [
  { value: 'super_admin', label: '平台超级管理员' },
  { value: 'tenant_admin', label: '租户管理员' },
  { value: 'operator', label: '运营人员' },
];

const PROVIDER_CODE_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'doubao', label: '豆包 Doubao' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'glm', label: '智谱 GLM (z.ai 国际端)' },
];

const getRoleLabel = (role) => {
  const match = ROLE_OPTIONS.find((item) => item.value === role);
  return match?.label || role || '';
};

const hasAdminFullAccess = (role) =>
  role === 'super_admin' || role === 'tenant_admin';

const buildPagedRows = (rows, page) => {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return {
    rows: rows.slice(start, start + PAGE_SIZE),
    currentPage,
    totalPages,
  };
};

const renderPager = (pageInfo, onPrev, onNext) => (
  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
    <span>
      第 {pageInfo.currentPage} / {pageInfo.totalPages} 页
    </span>
    <div className="flex gap-2">
      <button className="px-2 py-1 border rounded" onClick={onPrev}>
        上一页
      </button>
      <button className="px-2 py-1 border rounded" onClick={onNext}>
        下一页
      </button>
    </div>
  </div>
);

/**
 * @description 判断是否为母平台超级管理员（区别于 hasAdminFullAccess 包含 tenant_admin）
 * @keyword-en check super admin role
 */
const isSuperAdmin = (role) => role === 'super_admin';

const PUSH_STATUS_COLOR = {
  ok: 'bg-emerald-100 text-emerald-700',
  auth: 'bg-red-100 text-red-700',
  scope: 'bg-orange-100 text-orange-700',
  validation: 'bg-amber-100 text-amber-700',
  network: 'bg-slate-200 text-slate-700',
  unknown: 'bg-slate-200 text-slate-700',
};
const PUSH_STATUS_LABEL = {
  ok: '连通正常',
  auth: 'API Key 无效',
  scope: '缺少 scope',
  validation: '校验失败',
  network: '网络错误',
  unknown: '未知错误',
};

/**
 * @description 财务子 Tab 预设(name 内部固定,用户不可见;每种类预置默认 flow/partyType,提交 binding 时自动注入)
 * 对齐 api.md §6 的四类业务:银行流水 / 报销审批 / 应付 / 应收
 * @keyword-en finance kinds preset, four kinds bank approval payable receivable, hidden name, flow and party type defaults
 */
const FINANCE_KINDS = [
  {
    id: 'bank',
    label: '流水表',
    // 银行流水 in/out 都有(由 DSL 按金额正负或借贷字段决定),不预设 flowDefault
    flowDefault: undefined,
    partyTypeDefault: 'counterparty',
    hint: '银行/支付通道流水(收支混合,直接结算落账)',
  },
  {
    id: 'expense',
    label: '审批表',
    flowDefault: 'out',
    partyTypeDefault: 'employee',
    hint: '报销/差旅/办公等员工审批支出(stage 由审批状态映射:已通过→settled、审批中→intent、驳回→dead)',
  },
  {
    id: 'payable',
    label: '应付表',
    flowDefault: 'out',
    partyTypeDefault: 'supplier',
    hint: '采购/物料/服务等供应商应付(committed 挂账 → settled 已付)',
  },
  {
    id: 'receivable',
    label: '应收表',
    flowDefault: 'in',
    partyTypeDefault: 'customer',
    hint: '客户应收(committed 挂账 → settled 已收)',
  },
];

/**
 * @description 全量 Tab 定义(platformOnly:仅 super_admin 可见;tenantOnly:仅租户级用户可见)
 * @keyword-en all admin tabs definition
 */
const ALL_TABS = [
  { id: 'users', label: '用户管理' },
  { id: 'providers', label: 'Ai提供商设置', platformOnly: true },
  { id: 'tenants', label: '租户管理', platformOnly: true },
  { id: 'keys', label: 'key管理' },
  { id: 'sources', label: '数据源管理' },
  { id: 'claw_configs', label: 'Claw管理', platformOnly: true },
  { id: 'agent_configs', label: 'Agent管理', platformOnly: true },
  { id: 'social_accounts', label: '自媒体账号管理' },
  { id: 'dashboard_configs', label: '看板配置' },
  { id: 'platform_info', label: '平台AI配置' },
  { id: 'feishu_credentials', label: '飞书凭证' },
  { id: 'finance', label: '财务' },
];

const AdminApp = () => {
  const [currentRole, setCurrentRole] = useState('');
  const tabs = useMemo(
    () =>
      ALL_TABS.filter(
        (t) =>
          (!t.platformOnly || isSuperAdmin(currentRole)) &&
          (!t.tenantOnly || !isSuperAdmin(currentRole)),
      ),
    [currentRole],
  );

  const [activeTab, setActiveTab] = useState(() => {
    const stored = readAdminActiveTab();
    const fallback = 'users';
    // 初始时 tabs 可能不含 platformOnly 项，安全回退
    return ALL_TABS.some((t) => t.id === stored) ? stored : fallback;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [keys, setKeys] = useState([]);
  const [sources, setSources] = useState([]);
  const [dashboardConfigs, setDashboardConfigs] = useState([]);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [clawConfigs, setClawConfigs] = useState([]);
  const [agentConfigs, setAgentConfigs] = useState([]);
  const [xhsAccounts, setXhsAccounts] = useState([]);
  const [feishuCredentials, setFeishuCredentials] = useState([]);
  /** binding 列表(按 name 任意多个) | @keyword-en finance bindings array */
  const [financeBindings, setFinanceBindings] = useState([]);
  /** transforms 按 name 索引 | @keyword-en finance transforms by name */
  const [financeTransforms, setFinanceTransforms] = useState({});
  /** 每个 binding name 一份独立聊天历史(持久化到 localStorage,跨刷新保留;清空对话才会删) | @keyword-en finance chat history per binding name persisted to localStorage */
  const [financeChat, setFinanceChat] = useState(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem('finance_chat_history');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const restored = {};
      for (const [k, v] of Object.entries(parsed)) {
        const messages = Array.isArray(v?.messages) ? v.messages : [];
        restored[k] = { messages, input: '', loading: false };
      }
      return restored;
    } catch {
      return {};
    }
  });
  /** 推送配置(每作用域一份) | @keyword-en finance push config single */
  const [financePushConfig, setFinancePushConfig] = useState(null);
  /** 推送类按钮 loading(test/save 全局,run 记录当前正在 run 的 name) | @keyword-en finance push pending flags */
  const [financePushPending, setFinancePushPending] = useState({
    test: false,
    save: false,
    run: '',
  });
  /** 推送即时反馈(全局一条) | @keyword-en finance push transient result */
  const [financePushFeedback, setFinancePushFeedback] = useState(null);
  /** 推送时间窗(按 occurredAt 过滤,YYYY-MM-DD;空=全量) | @keyword-en finance push date window */
  const [financePushDateWindow, setFinancePushDateWindow] = useState({
    startDate: '',
    endDate: '',
  });
  /** 当前选中的 binding name(空=新建) | @keyword-en finance currently selected binding name */
  const [financeSelectedName, setFinanceSelectedName] = useState('');
  const [editingUserId, setEditingUserId] = useState('');
  const [editingProviderId, setEditingProviderId] = useState('');
  const [editingTenantId, setEditingTenantId] = useState('');
  const [editingKeyId, setEditingKeyId] = useState('');
  const [editingSourceCode, setEditingSourceCode] = useState('');
  const [editingDashboardConfigId, setEditingDashboardConfigId] = useState('');
  const [editingClawConfigId, setEditingClawConfigId] = useState('');
  const [pingLoadingId, setPingLoadingId] = useState('');
  const [editingAgentConfigId, setEditingAgentConfigId] = useState('');
  const [editingXhsAccountId, setEditingXhsAccountId] = useState('');
  const [testLoginLoadingId, setTestLoginLoadingId] = useState('');
  /** 自媒体账号管理当前平台子 Tab | @keyword-en social account platform sub tab */
  const [socialAccountSubTab, setSocialAccountSubTab] = useState('xhs');
  /** 财务子 Tab(预设 expense/payable;切换会自动同步对应 binding 到表单) | @keyword-en finance sub tab */
  const [financeSubTab, setFinanceSubTab] = useState(FINANCE_KINDS[0].id);
  /** 推送配置卡片折叠态 | @keyword-en finance push config collapsed */
  const [financePushCollapsed, setFinancePushCollapsed] = useState(true);
  /** 飞书多维表批量添加弹窗(挂在当前编辑的 binding 上,不再带 category) | @keyword-en bitable batch picker modal state */
  const [bitableModal, setBitableModal] = useState({
    open: false,
    appToken: '',
    loading: false,
    tables: [],
    selected: {},
    error: '',
  });
  const [filters, setFilters] = useState({
    users: { keyword: '', tenantId: '' },
    providers: { keyword: '' },
    tenants: { keyword: '' },
    keys: { keyword: '', tenantId: '' },
    sources: { keyword: '', status: '' },
    dashboardConfigs: { keyword: '', tenantId: '' },
    clawConfigs: { keyword: '' },
    agentConfigs: { keyword: '' },
    xhsAccounts: { keyword: '' },
  });
  const [pages, setPages] = useState({
    users: 1,
    providers: 1,
    tenants: 1,
    keys: 1,
    sources: 1,
    dashboardConfigs: 1,
    clawConfigs: 1,
    agentConfigs: 1,
    xhsAccounts: 1,
  });
  const [forms, setForms] = useState({
    user: {
      username: '',
      displayName: '',
      password: '',
      role: 'operator',
      tenantId: '',
      enabled: true,
    },
    provider: {
      providerCode: '',
      name: '',
      baseUrl: '',
      modelCategory: 'llm',
      model: '',
      apiKey: '',
      enabled: true,
      isDefault: false,
    },
    tenant: {
      name: '',
      description: '',
    },
    key: {
      tenantId: '',
      name: '',
      expireDays: 365,
      expiresAt: '',
      revokedAt: '',
    },
    source: {
      code: '',
      name: '',
      description: '',
      moduleRef: '',
      status: 'active',
    },
    dashboardConfig: {
      dashboardCode: 'ai-commander',
      tenantId: '',
      filePath: 'config/dashboards/platform.dashboard.json',
      enabled: true,
    },
    platformInfo: {
      aiPromptSupplement: '',
      enableAiCover: false,
    },
    clawConfig: {
      name: '',
      description: '',
      token: '',
      serviceUrl: '',
    },
    agentConfig: {
      name: '',
      module: 'xhs_publisher',
      clawConfigId: '',
      clawAgentId: 'main',
      prompt: '',
      enabled: true,
    },
    xhsAccount: {
      username: '',
      adspowerId: '',
      clawConfigId: '',
      clawAgentId: '',
      notes: '',
    },
    feishuCredential: {
      appId: '',
      appSecret: '',
      remark: '',
    },
    /** 当前编辑中的 binding 表单 | @keyword-en finance binding edit form */
    financeBinding: {
      name: '',
      flowDefault: '',
      partyTypeDefault: '',
      sources: [],
      remark: '',
      dslText: '',
      explanation: '',
    },
    /** 全局推送配置表单 | @keyword-en finance push config form */
    financePush: {
      baseUrl: '',
      apiKey: '',
      externalTenantId: '',
    },
  });

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const meRes = await adminApi.me();
      if (!hasAdminFullAccess(meRes?.role)) {
        window.location.href = resolveFrontendPageHref('ai-commander');
        return;
      }
      setMe(meRes);
      setCurrentRole(meRes?.role || '');
      const isSA = meRes?.role === 'super_admin';

      // 母平台加载全部数据；租户跳过 providers / tenants
      const [u, p, t, k, s, dc] = await Promise.all([
        adminApi.listUsers(),
        isSA ? adminApi.listProviders() : { providers: [] },
        adminApi.listTenants(),
        adminApi.listKeys(),
        adminApi.listDataSources(),
        adminApi.listDashboardConfigMappings(),
      ]);
      const tenantRows = t.tenants || [];
      setUsers(u.users || []);
      setProviders(p.providers || []);
      setTenants(tenantRows);
      setKeys(k.keys || []);
      setSources(s.sources || []);
      setDashboardConfigs(dc.rows || []);
      // 加载 Claw 和 Agent 配置（仅超级管理员）
      if (isSA) {
        try {
          const [cc, ac] = await Promise.all([
            adminApi.listClawConfigs(),
            adminApi.listAgentConfigs(),
          ]);
          setClawConfigs(cc.clawConfigs || []);
          setAgentConfigs(ac.agentConfigs || []);
        } catch {
          // 忽略加载失败
        }
      }
      // 加载平台AI配置（租户级）
      try {
        const pi = await adminApi.getPlatformInfo();
        setPlatformInfo(pi.platformInfo || null);
        setForms((prev) => ({
          ...prev,
          platformInfo: {
            aiPromptSupplement: pi.platformInfo?.aiPromptSupplement || '',
            enableAiCover: Boolean(pi.platformInfo?.enableAiCover),
          },
        }));
      } catch {
        // 忽略加载失败
      }
      // 加载小红书账号（租户级）
      try {
        const xa = await adminApi.listXhsAccounts();
        setXhsAccounts(xa.accounts || []);
      } catch {
        // 忽略加载失败
      }
      // 加载飞书凭证 + 财务配置(租户级)
      try {
        const [fc, fb, ft, fp] = await Promise.all([
          adminApi.listFeishuCredentials(),
          adminApi.listFinanceBindings(),
          adminApi.listFinanceTransforms(),
          adminApi.getFinancePushConfig().catch(() => ({ config: null })),
        ]);
        const credentials = fc.credentials || [];
        setFeishuCredentials(credentials);
        const ownCred = meRes?.tenantId
          ? credentials.find((c) => c.tenantId === meRes.tenantId)
          : credentials[0];
        const bindingList = fb.bindings || [];
        setFinanceBindings(bindingList);
        const transformsByName = (ft.transforms || []).reduce(
          (acc, row) => ({ ...acc, [row.name]: row }),
          {},
        );
        setFinanceTransforms(transformsByName);
        // 仅为没有持久化历史的 binding 补一份空聊天态(保留已有的 localStorage 历史)
        setFinanceChat((prev) => {
          const next = { ...prev };
          for (const b of bindingList) {
            if (!next[b.name]) {
              next[b.name] = { messages: [], input: '', loading: false };
            }
          }
          return next;
        });
        const pushConfig = fp?.config || null;
        setFinancePushConfig(pushConfig);
        // 默认选中第一个 binding(useEffect 会再按当前 financeSubTab 同步覆盖)
        const firstName = bindingList[0]?.name || '';
        setFinanceSelectedName(firstName);
        const firstBinding = bindingList[0] || null;
        const firstTransform = firstName ? transformsByName[firstName] : null;
        setForms((prev) => ({
          ...prev,
          feishuCredential: ownCred
            ? {
                appId: ownCred.appId || '',
                appSecret: ownCred.appSecret || '',
                remark: ownCred.remark || '',
              }
            : prev.feishuCredential,
          financeBinding: {
            name: firstName,
            flowDefault: firstBinding?.flowDefault || '',
            partyTypeDefault: firstBinding?.partyTypeDefault || '',
            sources: firstBinding?.sources || [],
            remark: firstBinding?.remark || '',
            dslText: firstTransform?.dsl
              ? JSON.stringify(firstTransform.dsl, null, 2)
              : '',
            explanation: firstTransform?.explanation || '',
          },
          financePush: {
            baseUrl: pushConfig?.baseUrl || '',
            apiKey: pushConfig?.apiKey || '',
            externalTenantId: pushConfig?.externalTenantId || '',
          },
        }));
      } catch {
        // 忽略加载失败
      }
      if (tenantRows.length > 0) {
        setForms((prev) => ({
          ...prev,
          key: {
            ...prev.key,
            tenantId: prev.key.tenantId || tenantRows[0]._id,
          },
          // 租户管理员默认锁定自己的 tenantId
          dashboardConfig: {
            ...prev.dashboardConfig,
            tenantId: meRes?.tenantId || prev.dashboardConfig.tenantId,
          },
        }));
      }
    } catch {
      clearAdminToken();
      window.location.href = resolveLoginPageHref({
        from: 'admin',
        next: 'admin',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // 角色变更后若当前 Tab 不可见，回退到首个可见 Tab
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs]);

  useEffect(() => {
    writeAdminActiveTab(activeTab);
  }, [activeTab]);

  // 持久化 financeChat 到 localStorage(仅保存 messages,input/loading 是临时态)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const persisted = {};
      for (const [k, v] of Object.entries(financeChat || {})) {
        if (Array.isArray(v?.messages) && v.messages.length > 0) {
          persisted[k] = {
            messages: v.messages.map((m) => ({
              role: m.role,
              content: toText(m.content),
              ...(Array.isArray(m.tools) && m.tools.length > 0
                ? { tools: m.tools }
                : {}),
            })),
          };
        }
      }
      window.localStorage.setItem('finance_chat_history', JSON.stringify(persisted));
    } catch {
      // ignore quota errors
    }
  }, [financeChat]);

  // 切换财务子 Tab 时把对应 binding 同步到表单(用户不感知 name 概念);binding/transform 列表变化(初次 load / 保存后)也同步一次
  useEffect(() => {
    if (activeTab !== 'finance') return;
    onSelectFinanceBinding(financeSubTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, financeSubTab, financeBindings.length]);

  const updateForm = (group, key, value) => {
    setForms((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value,
      },
    }));
  };

  const updateFilter = (group, key, value) => {
    setFilters((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value,
      },
    }));
    setPages((prev) => ({ ...prev, [group]: 1 }));
  };

  const gotoPage = (group, next) => {
    setPages((prev) => ({ ...prev, [group]: Math.max(1, next) }));
  };

  /**
   * @description 刷新看板配置映射列表
   * @keyword-en reload dashboard config mappings
   * @returns {Promise<void>}
   */
  const reloadDashboardConfigs = async () => {
    const res = await adminApi.listDashboardConfigMappings();
    setDashboardConfigs(res.rows || []);
  };

  /**
   * @description 提交看板配置映射（创建/更新）
   * @keyword-en submit dashboard config mapping
   * @returns {Promise<void>}
   */
  const onSubmitDashboardConfig = async () => {
    const payload = {
      dashboardCode: toText(forms.dashboardConfig.dashboardCode).trim() || undefined,
      tenantId: toText(forms.dashboardConfig.tenantId).trim() || undefined,
      filePath: toText(forms.dashboardConfig.filePath).trim(),
      enabled: Boolean(forms.dashboardConfig.enabled),
    };
    const res = await adminApi.upsertDashboardConfigMapping(payload);
    setEditingDashboardConfigId(toText(res?.row?._id));
    await reloadDashboardConfigs();
    setNotice(editingDashboardConfigId ? '看板配置映射已更新' : '看板配置映射已创建');
  };

  /**
   * @description 删除看板配置映射
   * @keyword-en delete dashboard config mapping
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onDeleteDashboardConfig = async (id) => {
    await adminApi.deleteDashboardConfigMapping(id);
    await reloadDashboardConfigs();
    if (editingDashboardConfigId === id) {
      setEditingDashboardConfigId('');
    }
    setNotice('看板配置映射已删除');
  };

  /**
   * @description 重置 AI 修改的 customConfig，回退到文件配置
   * @keyword-en reset dashboard custom config to file config
   * @param {string} dashboardCode
   * @returns {Promise<void>}
   */
  const onResetDashboardCustomConfig = async (dashboardCode) => {
    await adminApi.resetDashboardCustomConfig(dashboardCode || 'ai-commander');
    setNotice('已重置 AI 修改，已回退到文件配置');
  };

  /**
   * @description 保存平台AI配置
   * @keyword-en submit platform info
   * @returns {Promise<void>}
   */
  const onSubmitPlatformInfo = async () => {
    const res = await adminApi.upsertPlatformInfo(
      forms.platformInfo.aiPromptSupplement,
      forms.platformInfo.enableAiCover,
    );
    setPlatformInfo(res.platformInfo || null);
    setForms((prev) => ({
      ...prev,
      platformInfo: {
        aiPromptSupplement: res.platformInfo?.aiPromptSupplement || '',
        enableAiCover: Boolean(res.platformInfo?.enableAiCover),
      },
    }));
    setNotice('平台AI配置已保存');
  };

  /**
   * @description 保存飞书凭证（appId / appSecret，仅本租户）
   * @keyword-en submit feishu credential
   */
  const onSubmitFeishuCredential = async () => {
    const payload = {
      appId: toText(forms.feishuCredential.appId).trim(),
      appSecret: toText(forms.feishuCredential.appSecret).trim(),
      remark: toText(forms.feishuCredential.remark).trim() || undefined,
    };
    if (!payload.appId || !payload.appSecret) {
      throw new Error('appId 和 appSecret 必填');
    }
    await adminApi.upsertFeishuCredential(payload);
    const fc = await adminApi.listFeishuCredentials();
    const credentials = fc.credentials || [];
    setFeishuCredentials(credentials);
    const own = credentials[0];
    setForms((prev) => ({
      ...prev,
      feishuCredential: own
        ? {
            appId: own.appId || '',
            appSecret: own.appSecret || '',
            remark: own.remark || '',
          }
        : prev.feishuCredential,
    }));
    setNotice('飞书凭证已保存');
  };

  /**
   * @description 删除当前租户的飞书凭证
   * @keyword-en delete feishu credential
   */
  const onDeleteFeishuCredential = async (id) => {
    await adminApi.deleteFeishuCredential(id);
    const fc = await adminApi.listFeishuCredentials();
    setFeishuCredentials(fc.credentials || []);
    setForms((prev) => ({
      ...prev,
      feishuCredential: { appId: '', appSecret: '', remark: '' },
    }));
    setNotice('飞书凭证已删除');
  };

  /**
   * @description 把指定 name 的 binding/transform 同步到表单(切 Tab 时自动调用,name 由 FINANCE_KINDS 预设)
   * @keyword-en sync binding by preset name to form
   */
  const onSelectFinanceBinding = (name) => {
    const binding = financeBindings.find((b) => b.name === name) || null;
    const transform = name ? financeTransforms[name] : null;
    setFinanceSelectedName(name);
    setForms((prev) => ({
      ...prev,
      financeBinding: {
        name,
        flowDefault: binding?.flowDefault || '',
        partyTypeDefault: binding?.partyTypeDefault || '',
        sources: binding?.sources || [],
        remark: binding?.remark || '',
        dslText: transform?.dsl ? JSON.stringify(transform.dsl, null, 2) : '',
        explanation: transform?.explanation || '',
      },
    }));
  };

  /**
   * @description 打开"添加多维表"弹窗(挂在当前编辑 binding)
   * @keyword-en open bitable batch picker modal
   */
  const onAddBitableSource = () => {
    setBitableModal({
      open: true,
      appToken: '',
      loading: false,
      tables: [],
      selected: {},
      error: '',
    });
  };

  /**
   * @description 关闭多维表弹窗
   * @keyword-en close bitable modal
   */
  const onCloseBitableModal = () => {
    setBitableModal((prev) => ({ ...prev, open: false }));
  };

  /**
   * @description 拉取 appToken 下所有 tables
   * @keyword-en load bitable tables list
   */
  const onLoadBitableTables = async () => {
    const token = toText(bitableModal.appToken).trim();
    if (!token) {
      setBitableModal((prev) => ({ ...prev, error: '请输入 appToken' }));
      return;
    }
    setBitableModal((prev) => ({
      ...prev,
      loading: true,
      error: '',
      tables: [],
      selected: {},
    }));
    try {
      const res = await adminApi.listBitableTables(token);
      setBitableModal((prev) => ({
        ...prev,
        loading: false,
        tables: res.tables || [],
      }));
    } catch (err) {
      setBitableModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || '加载失败',
      }));
    }
  };

  /**
   * @description 切换某张 table 的勾选状态
   * @keyword-en toggle bitable table selection
   */
  const onToggleBitableTable = (tableId) => {
    setBitableModal((prev) => ({
      ...prev,
      selected: { ...prev.selected, [tableId]: !prev.selected[tableId] },
    }));
  };

  /**
   * @description 批量把勾选的 tables 加入到当前 binding 的 sources(去重)
   * @keyword-en confirm bitable batch add to sources
   */
  const onConfirmBitableModal = () => {
    const { appToken, tables, selected } = bitableModal;
    const token = toText(appToken).trim();
    const picks = tables.filter((t) => selected[t.tableId]);
    if (picks.length === 0) {
      setBitableModal((prev) => ({ ...prev, error: '请至少勾选一张表' }));
      return;
    }
    setForms((prev) => {
      const existing = new Set(
        prev.financeBinding.sources
          .filter((s) => s.type === 'bitable')
          .map((s) => `${s.appToken}::${s.tableId}`),
      );
      const additions = picks
        .filter((t) => !existing.has(`${token}::${t.tableId}`))
        .map((t) => ({
          type: 'bitable',
          appToken: token,
          tableId: t.tableId,
          alias: t.name || '',
        }));
      return {
        ...prev,
        financeBinding: {
          ...prev.financeBinding,
          sources: [...prev.financeBinding.sources, ...additions],
        },
      };
    });
    setBitableModal((prev) => ({ ...prev, open: false }));
  };

  /**
   * @description 添加 approval 源到当前 binding 表单
   * @keyword-en add approval source
   */
  const onAddApprovalSource = () => {
    setForms((prev) => ({
      ...prev,
      financeBinding: {
        ...prev.financeBinding,
        sources: [
          ...prev.financeBinding.sources,
          { type: 'approval', approvalCode: '', alias: '' },
        ],
      },
    }));
  };

  /**
   * @description 修改某个 source 字段
   * @keyword-en update finance source field
   */
  const onUpdateSourceField = (idx, key, value) => {
    setForms((prev) => {
      const next = [...prev.financeBinding.sources];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, financeBinding: { ...prev.financeBinding, sources: next } };
    });
  };

  /**
   * @description 移除一个 source
   * @keyword-en remove finance source
   */
  const onRemoveSource = (idx) => {
    setForms((prev) => ({
      ...prev,
      financeBinding: {
        ...prev.financeBinding,
        sources: prev.financeBinding.sources.filter((_, i) => i !== idx),
      },
    }));
  };

  /**
   * @description 保存当前子 Tab 的 binding(name + flow/partyType 默认值由 FINANCE_KINDS 自动注入,用户不感知)
   * @keyword-en submit finance binding with preset name and defaults
   */
  const onSubmitFinanceBinding = async () => {
    const kind = FINANCE_KINDS.find((k) => k.id === financeSubTab) || FINANCE_KINDS[0];
    const form = forms.financeBinding;
    const sources = (form.sources || []).map((s) => {
      const base = { alias: toText(s.alias).trim() || undefined };
      if (s.type === 'bitable') {
        return {
          ...base,
          type: 'bitable',
          appToken: toText(s.appToken).trim(),
          tableId: toText(s.tableId).trim(),
        };
      }
      return {
        ...base,
        type: 'approval',
        approvalCode: toText(s.approvalCode).trim(),
      };
    });
    if (sources.length === 0) throw new Error('至少绑定一个源');
    const payload = {
      name: kind.id,
      sources,
      remark: toText(form.remark).trim() || undefined,
      flowDefault: kind.flowDefault,
      partyTypeDefault: kind.partyTypeDefault,
    };
    const res = await adminApi.upsertFinanceBinding(payload);
    const fb = await adminApi.listFinanceBindings();
    setFinanceBindings(fb.bindings || []);
    setFinanceSelectedName(res.binding.name);
    setNotice(`${kind.label}已保存`);
  };

  /**
   * @description 财务聊天输入框联动(按 binding name)
   * @keyword-en update finance chat input
   */
  const onUpdateFinanceChatInput = (name, value) => {
    setFinanceChat((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || { messages: [] }), input: value },
    }));
  };

  /**
   * @description 清空当前 binding 的聊天历史
   * @keyword-en clear finance chat
   */
  const onClearFinanceChat = (name) => {
    setFinanceChat((prev) => ({
      ...prev,
      [name]: { messages: [], input: '', loading: false },
    }));
  };

  /**
   * @description 刷新 transform 显示(agent 可能调用 patch_transform 落库;按 name 索引)
   * @keyword-en reload finance transforms after chat
   */
  const reloadFinanceTransforms = async () => {
    const ft = await adminApi.listFinanceTransforms();
    const transformsByName = (ft.transforms || []).reduce(
      (acc, row) => ({ ...acc, [row.name]: row }),
      {},
    );
    setFinanceTransforms(transformsByName);
    // 如果当前编辑中的 binding 的 transform 被 agent 改了,同步更新表单
    const cur = financeSelectedName;
    if (!cur) return;
    const t = transformsByName[cur];
    if (t?.dsl) {
      setForms((prev) => ({
        ...prev,
        financeBinding: {
          ...prev.financeBinding,
          dslText: JSON.stringify(t.dsl, null, 2),
          explanation: t.explanation || prev.financeBinding.explanation,
        },
      }));
    }
  };

  /**
   * @description 发送财务 Agent 聊天(按 binding name;结束后刷新 transform)
   * @keyword-en send finance agent chat
   */
  const onSendFinanceChat = async (name) => {
    if (!name) return;
    const current = financeChat[name] || { messages: [], input: '', loading: false };
    const text = toText(current.input).trim();
    if (!text) return;
    const displayHistory = [...current.messages, { role: 'user', content: text }];
    const requestHistory = sanitizeFinanceAgentMessages(displayHistory);
    const assistantIndex = displayHistory.length;
    const initialAssistant = {
      role: 'assistant',
      content: '',
      tools: [],
      streaming: true,
      status: 'Agent 已开始处理...',
    };
    const initialMessages = [...displayHistory, initialAssistant];
    setFinanceChat((prev) => ({
      ...prev,
      [name]: { messages: initialMessages, input: '', loading: true },
    }));

    /**
     * @description 更新当前财务 Agent 流式 assistant 消息
     * @keyword-en finance-agent-stream-message, streaming-ui
     * @param {(message: Record<string, unknown>) => Record<string, unknown>} updater
     * @returns {void}
     */
    const patchAssistant = (updater) => {
      setFinanceChat((prev) => {
        const prevState = prev[name] || {};
        const messages = [...(prevState.messages || initialMessages)];
        const currentMessage = messages[assistantIndex] || initialAssistant;
        messages[assistantIndex] = updater(currentMessage);
        return {
          ...prev,
          [name]: {
            ...prevState,
            messages,
            input: '',
            loading: true,
          },
        };
      });
    };
    try {
      await adminApi.chatFinanceAgentStream(
        { name, messages: requestHistory },
        {
          onStart: () => {
            patchAssistant((m) => ({ ...m, status: 'Agent 已连接,等待模型输出...' }));
          },
          onToken: (payload) => {
            const chunk = toText(payload?.text);
            if (!chunk) return;
            patchAssistant((m) => ({
              ...m,
              content: `${toText(m.content)}${chunk}`,
              status: '正在生成回复...',
            }));
          },
          onToolStart: (payload) => {
            const toolName = toText(payload?.name) || 'tool';
            patchAssistant((m) => ({
              ...m,
              tools: mergeFinanceToolEvent(m.tools, {
                id: payload?.id,
                name: toolName,
                input: payload?.input,
                status: 'running',
              }),
              status: `正在调用工具: ${toolName}`,
            }));
          },
          onToolChunk: (payload) => {
            const toolName = toText(payload?.name) || 'tool';
            patchAssistant((m) => ({
              ...m,
              tools: mergeFinanceToolEvent(m.tools, {
                id: payload?.id,
                name: toolName,
                index: payload?.index,
                argsChunk: payload?.args,
                status: 'running',
              }),
              status: `正在组装工具参数: ${toolName}`,
            }));
          },
          onToolEnd: (payload) => {
            const toolName = toText(payload?.name) || 'tool';
            patchAssistant((m) => ({
              ...m,
              tools: mergeFinanceToolEvent(m.tools, {
                id: payload?.id,
                name: toolName,
                output: payload?.output,
                status: 'completed',
              }),
              status: `工具已完成: ${toolName}`,
            }));
          },
          onEnd: (payload) => {
            patchAssistant((m) => ({
              ...m,
              content: toText(m.content).trim()
                ? m.content
                : toText(payload?.text).trim() || '(空回复)',
              streaming: false,
              status: payload?.ok === false ? '调用失败' : '已完成',
              toolResults: payload?.tool_results,
            }));
          },
          onError: (payload) => {
            const message = payload?.message || String(payload || '调用失败');
            patchAssistant((m) => ({
              ...m,
              content: toText(m.content).trim()
                ? `${toText(m.content)}\n\n❌ 调用失败:${message}`
                : `❌ 调用失败:${message}`,
              streaming: false,
              status: '调用失败',
            }));
          },
        },
      );
      setFinanceChat((prev) => ({
        ...prev,
        [name]: {
          ...(prev[name] || {}),
          input: '',
          loading: false,
        },
      }));
      await reloadFinanceTransforms().catch(() => undefined);
    } catch (err) {
      setFinanceChat((prev) => ({
        ...prev,
        [name]: {
          messages: [
            ...displayHistory,
            { role: 'assistant', content: `❌ 调用失败:${err.message || String(err)}` },
          ],
          input: '',
          loading: false,
        },
      }));
    }
  };

  /**
   * @description 保存 transform DSL(name 按当前子 Tab 自动取;前端 JSON.parse,后端再校验)
   * @keyword-en submit finance transform with preset name
   */
  const onSubmitFinanceTransform = async () => {
    const kind = FINANCE_KINDS.find((k) => k.id === financeSubTab) || FINANCE_KINDS[0];
    const form = forms.financeBinding;
    let dsl;
    try {
      dsl = JSON.parse(form.dslText || '{}');
    } catch (err) {
      throw new Error('DSL JSON 解析失败:' + err.message);
    }
    const payload = {
      name: kind.id,
      dsl,
      explanation: toText(form.explanation).trim() || undefined,
    };
    const res = await adminApi.upsertFinanceTransform(payload);
    setFinanceTransforms((prev) => ({ ...prev, [res.transform.name]: res.transform }));
    setNotice(`${kind.label} Transform 已保存`);
  };

  /**
   * @description 保存全局推送配置(每作用域一份,含 webhook 外部租户映射)
   * @keyword-en submit finance push config
   */
  const onSubmitFinancePushConfig = async () => {
    const baseUrl = toText(forms.financePush.baseUrl).trim();
    const apiKey = toText(forms.financePush.apiKey).trim();
    const externalTenantId = toText(forms.financePush.externalTenantId).trim();
    if (!baseUrl || !apiKey) throw new Error('baseUrl 和 apiKey 必填');
    setFinancePushPending((prev) => ({ ...prev, save: true }));
    try {
      const res = await adminApi.upsertFinancePushConfig({
        baseUrl,
        apiKey,
        externalTenantId,
      });
      setFinancePushConfig(res.config);
      setNotice('推送配置已保存');
    } finally {
      setFinancePushPending((prev) => ({ ...prev, save: false }));
    }
  };

  /**
   * @description 测试推送 key 有效性(GET /api/v1/me)
   * @keyword-en test finance push connectivity
   */
  const onTestFinancePush = async () => {
    setFinancePushPending((prev) => ({ ...prev, test: true }));
    setFinancePushFeedback(null);
    try {
      const res = await adminApi.testFinancePush();
      setFinancePushFeedback({ kind: 'test', ...(res.result || {}) });
      try {
        const fp = await adminApi.getFinancePushConfig();
        setFinancePushConfig(fp.config || null);
      } catch {
        // ignore
      }
    } catch (err) {
      setFinancePushFeedback({
        kind: 'test',
        status: 'unknown',
        message: err.message || String(err),
      });
    } finally {
      setFinancePushPending((prev) => ({ ...prev, test: false }));
    }
  };

  /**
   * @description 立即推送指定 binding(SSE 流式;每条 log 实时累积到 feedback.logs,前端边推边渲染)
   * @keyword-en run finance push by binding name with streaming logs
   */
  const onRunFinancePush = async (name) => {
    if (!name) return;
    const sd = toText(financePushDateWindow.startDate).trim();
    const ed = toText(financePushDateWindow.endDate).trim();
    const winLabel = sd || ed ? `时间窗 [${sd || '不限'} → ${ed || '不限'}]` : '全量';
    if (
      !window.confirm(
        `确认立即推送 binding「${name}」到外部财务系统?\n${winLabel}\n整批拒收语义:任意一行不合规整批被拒。`,
      )
    ) {
      return;
    }
    setFinancePushPending((prev) => ({ ...prev, run: name }));
    // 推送启动即清空旧反馈并初始化空 logs,让"执行日志"区立刻出现并随 SSE 增量更新
    setFinancePushFeedback({ kind: 'run', name, streaming: true, logs: [] });
    try {
      await adminApi.runFinancePushStream(
        name,
        { startDate: sd, endDate: ed },
        {
          onLog: (entry) => {
            if (!entry || typeof entry !== 'object') return;
            setFinancePushFeedback((prev) => {
              if (!prev || prev.kind !== 'run') return prev;
              return { ...prev, logs: [...(prev.logs || []), entry] };
            });
          },
          onResult: (result) => {
            if (!result || typeof result !== 'object') return;
            setFinancePushFeedback((prev) => {
              const prevLogs = prev?.logs || [];
              // 后端 result.logs 是完整的最终列表,可能比流式累积的更全(末尾几条);优先用 result.logs
              return {
                kind: 'run',
                ...result,
                logs:
                  Array.isArray(result.logs) && result.logs.length >= prevLogs.length
                    ? result.logs
                    : prevLogs,
                streaming: false,
              };
            });
          },
          onError: (err) => {
            setFinancePushFeedback((prev) => ({
              ...(prev || { kind: 'run', name }),
              kind: 'run',
              name,
              error: err?.message || String(err) || '推送失败',
              streaming: false,
            }));
          },
        },
      );
      try {
        const fp = await adminApi.getFinancePushConfig();
        setFinancePushConfig(fp.config || null);
      } catch {
        // ignore
      }
    } catch (err) {
      setFinancePushFeedback((prev) => ({
        ...(prev || {}),
        kind: 'run',
        name,
        error: err.message || String(err),
        streaming: false,
      }));
    } finally {
      setFinancePushPending((prev) => ({ ...prev, run: '' }));
    }
  };

  /**
   * @description 把推送失败详情格式化成 Markdown(HTTP/错误信息/对方原始响应/前 3 条 payload),给 Agent 排错用
   * @keyword-en format push failure as markdown for agent
   */
  const formatPushFailureMarkdown = (feedback) => {
    if (!feedback || feedback.kind !== 'run') return '';
    const fb = feedback.failedBatch;
    const lines = [];
    lines.push(`# 推送失败,请帮我修 Transform DSL`);
    lines.push('');
    lines.push(`- binding: **${feedback.name}**`);
    if (feedback.startDate || feedback.endDate) {
      lines.push(`- 时间窗: [${feedback.startDate || '不限'} → ${feedback.endDate || '不限'}]`);
    }
    lines.push(
      `- 源拉取 ${feedback.totalRows};transform 输出 ${feedback.transformedRows};filter ${feedback.filteredRows};transform 错 ${feedback.transformErrors}` +
        (feedback.dateFilteredRows > 0 ? `;时间窗滤掉 ${feedback.dateFilteredRows}` : ''),
    );
    if (feedback.error) {
      lines.push('');
      lines.push(`## 错误`);
      lines.push('```');
      lines.push(String(feedback.error));
      lines.push('```');
      return lines.join('\n');
    }
    if (!fb) return lines.join('\n');
    lines.push(
      `- 失败批次: #${fb.index + 1} · HTTP ${fb.httpStatus}${fb.code ? ` · ${fb.code}` : ''}${fb.contentType ? ` · ${fb.contentType}` : ''}`,
    );
    lines.push('');
    lines.push(`## 错误信息(对方返回)`);
    lines.push('```');
    lines.push(typeof fb.message === 'string' ? fb.message : '(无)');
    lines.push('```');
    if (fb.rawResponseBody !== undefined && fb.rawResponseBody !== null) {
      const rawStr =
        typeof fb.rawResponseBody === 'string'
          ? fb.rawResponseBody
          : JSON.stringify(fb.rawResponseBody, null, 2);
      // message 可能就等于 rawString,避免重复
      if (rawStr && rawStr !== fb.message) {
        lines.push('');
        lines.push(`## 对方原始响应 body`);
        lines.push('```');
        lines.push(rawStr);
        lines.push('```');
      }
    }
    if (Array.isArray(fb.payloadAll) && fb.payloadAll.length > 0) {
      lines.push('');
      lines.push(`## 推送过去的 payload(共 ${fb.payloadAll.length} 条,以下前 3 条)`);
      lines.push('```json');
      lines.push(JSON.stringify(fb.payloadAll.slice(0, 3), null, 2));
      lines.push('```');
    }
    lines.push('');
    lines.push(
      `请先调 finance_get_transform 拿当前 DSL,定位是哪几个字段不合 schema(对照 financial_event 的必填字段与枚举),心算出预期 DSL 用 finance_dry_run_transform 试跑确认,再用 finance_patch_transform 走最窄路径的 ops 局部修补(不要根 replace、不要把整份 DSL 塞进 ops)。`,
    );
    return lines.join('\n');
  };

  /**
   * @description 复制推送失败详情到剪贴板(给 Agent 排错用)
   * @keyword-en copy push failure to clipboard
   */
  const onCopyPushFailure = async (feedback) => {
    const md = formatPushFailureMarkdown(feedback);
    if (!md) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(md);
      setNotice('失败详情已复制到剪贴板');
    } else {
      throw new Error('浏览器不支持剪贴板,请改用"发给 Agent"按钮');
    }
  };

  /**
   * @description 把推送失败详情塞进 Agent 输入框(用户点击发送即可让 Agent 修 DSL)
   * @keyword-en send push failure to agent chat composer
   */
  const onSendPushFailureToAgent = (name, feedback) => {
    if (!name) return;
    const md = formatPushFailureMarkdown(feedback);
    if (!md) return;
    setFinanceChat((prev) => ({
      ...prev,
      [name]: {
        ...(prev[name] || { messages: [] }),
        input: md,
        loading: false,
      },
    }));
    setNotice('已塞入 Agent 输入框,在右侧检查后点发送');
  };

  /**
   * @description 提交 Claw 配置（创建/更新）
   * @keyword-en submit claw config
   * @returns {Promise<void>}
   */
  const onSubmitClawConfig = async () => {
    const payload = {
      name: toText(forms.clawConfig.name).trim(),
      description: toText(forms.clawConfig.description).trim() || undefined,
      token: toText(forms.clawConfig.token).trim(),
      serviceUrl: toText(forms.clawConfig.serviceUrl).trim(),
    };
    if (editingClawConfigId) {
      const res = await adminApi.updateClawConfig(editingClawConfigId, payload);
      setClawConfigs((prev) =>
        prev.map((item) => (item._id === editingClawConfigId ? res.clawConfig : item)),
      );
      setNotice('Claw配置已更新');
    } else {
      const res = await adminApi.createClawConfig(payload);
      setClawConfigs((prev) => [res.clawConfig, ...prev]);
      setEditingClawConfigId(toText(res.clawConfig._id));
      setNotice('Claw配置已创建');
    }
  };

  /**
   * @description 删除 Claw 配置
   * @keyword-en delete claw config
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onDeleteClawConfig = async (id) => {
    await adminApi.deleteClawConfig(id);
    setClawConfigs((prev) => prev.filter((item) => item._id !== id));
    if (editingClawConfigId === id) setEditingClawConfigId('');
    setNotice('Claw配置已删除');
  };

  /**
   * @description 测试 Claw 连通性
   * @keyword-en ping claw config, test connectivity
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onPingClawConfig = async (id) => {
    setPingLoadingId(id);
    try {
      const res = await adminApi.pingClawConfig(id);
      setClawConfigs((prev) =>
        prev.map((item) =>
          item._id === id
            ? { ...item, connectStatus: res.status, connectCheckedAt: new Date().toISOString() }
            : item,
        ),
      );
      const label = res.status === 'full' ? '完全通畅' : res.status === 'api_only' ? '接口通畅, skill未接' : '连接失败';
      setNotice(`连通测试完成：${label}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPingLoadingId('');
    }
  };

  /**
   * @description 提交 Agent 配置（创建/更新）
   * @keyword-en submit agent config
   * @returns {Promise<void>}
   */
  const onSubmitAgentConfig = async () => {
    const payload = {
      name: toText(forms.agentConfig.name).trim(),
      module: toText(forms.agentConfig.module).trim(),
      clawConfigId: toText(forms.agentConfig.clawConfigId).trim() || undefined,
      clawAgentId: toText(forms.agentConfig.clawAgentId).trim() || undefined,
      prompt: toText(forms.agentConfig.prompt) || undefined,
      enabled: Boolean(forms.agentConfig.enabled),
    };
    if (editingAgentConfigId) {
      const res = await adminApi.updateAgentConfig(editingAgentConfigId, payload);
      setAgentConfigs((prev) =>
        prev.map((item) => (item._id === editingAgentConfigId ? res.agentConfig : item)),
      );
      setNotice('Agent配置已更新');
    } else {
      const res = await adminApi.createAgentConfig(payload);
      setAgentConfigs((prev) => [res.agentConfig, ...prev]);
      setEditingAgentConfigId(toText(res.agentConfig._id));
      setNotice('Agent配置已创建');
    }
  };

  /**
   * @description 删除 Agent 配置
   * @keyword-en delete agent config
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onDeleteAgentConfig = async (id) => {
    await adminApi.deleteAgentConfig(id);
    setAgentConfigs((prev) => prev.filter((item) => item._id !== id));
    if (editingAgentConfigId === id) setEditingAgentConfigId('');
    setNotice('Agent配置已删除');
  };

  /**
   * @description 提交小红书账号（创建/更新）
   * @keyword-en submit xhs account create update
   * @returns {Promise<void>}
   */
  const onSubmitXhsAccount = async () => {
    const payload = {
      username: toText(forms.xhsAccount.username).trim(),
      adspowerId: toText(forms.xhsAccount.adspowerId).trim() || undefined,
      clawConfigId: toText(forms.xhsAccount.clawConfigId).trim() || undefined,
      clawAgentId: toText(forms.xhsAccount.clawAgentId).trim() || undefined,
      notes: toText(forms.xhsAccount.notes).trim() || undefined,
    };
    if (!payload.username) throw new Error('账号名称不能为空');
    if (editingXhsAccountId) {
      const res = await adminApi.updateXhsAccount(editingXhsAccountId, payload);
      setXhsAccounts((prev) =>
        prev.map((item) => (toText(item._id) === editingXhsAccountId ? res.account : item)),
      );
      setNotice('小红书账号已更新');
    } else {
      const res = await adminApi.createXhsAccount(payload);
      setXhsAccounts((prev) => [res.account, ...prev]);
      setEditingXhsAccountId(toText(res.account._id));
      setNotice('小红书账号已创建');
    }
  };

  /**
   * @description 删除小红书账号
   * @keyword-en delete xhs account
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onDeleteXhsAccount = async (id) => {
    await adminApi.deleteXhsAccount(id);
    setXhsAccounts((prev) => prev.filter((item) => toText(item._id) !== id));
    if (editingXhsAccountId === id) setEditingXhsAccountId('');
    setNotice('小红书账号已删除');
  };

  /**
   * @description 测试登录小红书账号（触发 Claw 登录流程）
   * @keyword-en test login xhs account, claw login
   * @param {string} id
   * @returns {Promise<void>}
   */
  const onTestLoginXhsAccount = async (id) => {
    setTestLoginLoadingId(id);
    try {
      const res = await adminApi.testLoginXhsAccount(id);
      setXhsAccounts((prev) =>
        prev.map((item) =>
          toText(item._id) === id
            ? { ...item, loginStatus: res.loginStatus, lastLoginAt: new Date().toISOString() }
            : item,
        ),
      );
      const statusLabel = { online: '在线', offline: '离线', error: '异常', unknown: '未知' }[res.loginStatus] ?? res.loginStatus;
      setNotice(`登录测试完成：${statusLabel}${res.message ? `（${res.message}）` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setTestLoginLoadingId('');
    }
  };

  const onLogout = async () => {
    try {
      await adminApi.logout();
    } catch {
      undefined;
    }
    clearAdminToken();
    window.location.href = resolveLoginPageHref({
      from: 'admin',
      next: 'admin',
    });
  };

  const onSubmitUser = async () => {
    const payload = {
      displayName: forms.user.displayName.trim(),
      role: forms.user.role,
      tenantId: forms.user.tenantId || undefined,
      enabled: forms.user.enabled,
      password: forms.user.password,
    };
    if (editingUserId) {
      if (!payload.password) delete payload.password;
      const res = await adminApi.updateUser(editingUserId, payload);
      setUsers((prev) =>
        prev.map((item) => (item.id === editingUserId ? res.user : item)),
      );
      setEditingUserId('');
      setNotice('用户已更新');
      return;
    }
    const res = await adminApi.createUser({
      username: forms.user.username.trim(),
      displayName: payload.displayName,
      password: payload.password,
      role: payload.role,
      tenantId: payload.tenantId,
    });
    setUsers((prev) => [res.user, ...prev]);
    setNotice('用户已创建');
  };

  const onDeleteUser = async (id) => {
    await adminApi.deleteUser(id);
    setUsers((prev) => prev.filter((item) => item.id !== id));
    setNotice('用户已删除');
  };

  const onSubmitProvider = async () => {
    const payload = {
      providerCode: forms.provider.providerCode.trim(),
      name: forms.provider.name.trim(),
      baseUrl: forms.provider.baseUrl.trim() || undefined,
      modelCategory: forms.provider.modelCategory,
      model: forms.provider.model.trim() || undefined,
      apiKey: forms.provider.apiKey.trim() || undefined,
      enabled: forms.provider.enabled,
      isDefault: forms.provider.isDefault,
    };
    if (editingProviderId) {
      const res = await adminApi.updateProvider(editingProviderId, payload);
      setProviders((prev) =>
        prev.map((item) => (item._id === editingProviderId ? res.provider : item)),
      );
      setEditingProviderId('');
      setNotice('AI提供商已更新');
      return;
    }
    const res = await adminApi.saveProvider(payload);
    setProviders((prev) => [res.provider, ...prev]);
    setEditingProviderId(res.provider._id);
    setForms((prev) => ({
      ...prev,
      provider: { ...res.provider },
    }));
    setNotice('AI提供商已创建');
  };

  const onDeleteProvider = async (id) => {
    await adminApi.deleteProvider(id);
    setProviders((prev) => prev.filter((item) => item._id !== id));
    setNotice('AI提供商已删除');
  };

  const [testingProviderId, setTestingProviderId] = useState('');
  const onTestProvider = async (id) => {
    setTestingProviderId(id);
    try {
      const res = await adminApi.testProvider(id);
      const head = res.ok
        ? `✓ 连通 ${res.status} · ${res.latencyMs}ms`
        : `✗ 失败 ${res.status || '-'} · ${res.latencyMs}ms`;
      const modelInfo =
        typeof res.modelCount === 'number'
          ? ` · 模型${res.modelCount}个${
              Array.isArray(res.sample) && res.sample.length > 0
                ? `(${res.sample.slice(0, 3).join(', ')}${res.sample.length > 3 ? '…' : ''})`
                : ''
            }`
          : '';
      const tail = res.ok ? '' : `\n${res.message || ''}`;
      const endpointInfo = res.endpoint ? `\nendpoint=${res.endpoint}` : '';
      if (res.ok) {
        setNotice(`${head}${modelInfo}${endpointInfo}`);
      } else {
        setError(`${head}${modelInfo}${endpointInfo}${tail}`);
      }
    } finally {
      setTestingProviderId('');
    }
  };

  const onSubmitTenant = async () => {
    const payload = {
      name: forms.tenant.name.trim(),
      description: forms.tenant.description.trim() || undefined,
    };
    if (editingTenantId) {
      const res = await adminApi.updateTenant(editingTenantId, payload);
      setTenants((prev) =>
        prev.map((item) => (item._id === editingTenantId ? res.tenant : item)),
      );
      setEditingTenantId('');
      setNotice('租户已更新');
      return;
    }
    const res = await adminApi.createTenant(payload);
    setTenants((prev) => [res.tenant, ...prev]);
    setNotice('租户已创建');
  };

  const onDeleteTenant = async (id) => {
    await adminApi.deleteTenant(id);
    setTenants((prev) => prev.filter((item) => item._id !== id));
    setNotice('租户已删除');
  };

  const onSubmitKey = async () => {
    if (editingKeyId) {
      const payload = {
        name: forms.key.name.trim() || undefined,
        expiresAt: forms.key.expiresAt.trim() || undefined,
        revokedAt: forms.key.revokedAt.trim() || undefined,
      };
      const res = await adminApi.updateKey(editingKeyId, payload);
      setKeys((prev) =>
        prev.map((item) => (item._id === editingKeyId ? res.key : item)),
      );
      setEditingKeyId('');
      setNotice('Key已更新');
      return;
    }
    const payload = {
      tenantId: forms.key.tenantId,
      name: forms.key.name.trim(),
      expireDays: Number(forms.key.expireDays || 365),
    };
    const res = await adminApi.createKey(payload);
    setNotice(`Key创建成功：${res.secret}`);
    const listRes = await adminApi.listKeys();
    setKeys(listRes.keys || []);
  };

  const onRevokeKey = async (id) => {
    await adminApi.revokeKey(id);
    const listRes = await adminApi.listKeys();
    setKeys(listRes.keys || []);
    setNotice('Key已撤销');
  };

  const onDeleteKey = async (id) => {
    await adminApi.deleteKey(id);
    setKeys((prev) => prev.filter((item) => item._id !== id));
    setNotice('Key已删除');
  };

  const onSubmitSource = async () => {
    const payload = {
      code: forms.source.code.trim(),
      name: forms.source.name.trim(),
      description: forms.source.description.trim(),
      moduleRef: forms.source.moduleRef.trim(),
      status: forms.source.status,
    };
    if (editingSourceCode) {
      const res = await adminApi.updateDataSource(editingSourceCode, {
        name: payload.name,
        description: payload.description,
        moduleRef: payload.moduleRef,
        status: payload.status,
      });
      setSources((prev) =>
        prev.map((item) => (item.code === editingSourceCode ? res.source : item)),
      );
      setEditingSourceCode('');
      setNotice('数据源已更新');
      return;
    }
    const res = await adminApi.createDataSource(payload);
    setSources((prev) => [res.source, ...prev]);
    setNotice('数据源已创建');
  };

  const onToggleSourceStatus = async (code, status) => {
    const res = await adminApi.updateDataSource(code, {
      status: status === 'active' ? 'inactive' : 'active',
    });
    setSources((prev) => prev.map((item) => (item.code === code ? res.source : item)));
    setNotice('数据源状态已更新');
  };

  const onDeleteSource = async (code) => {
    await adminApi.deleteDataSource(code);
    setSources((prev) => prev.filter((item) => item.code !== code));
    setNotice('数据源已删除');
  };

  const filteredUsers = users.filter((item) => {
    const keyword = toLower(filters.users.keyword.trim());
    const hitKeyword =
      !keyword ||
      toLower(item.username).includes(keyword) ||
      toLower(item.displayName).includes(keyword);
    const hitTenant =
      !filters.users.tenantId || toText(item.tenantId) === filters.users.tenantId;
    return hitKeyword && hitTenant;
  });
  const filteredProviders = providers.filter((item) => {
    const keyword = toLower(filters.providers.keyword.trim());
    const hitKeyword =
      !keyword ||
      toLower(item.providerCode).includes(keyword) ||
      toLower(item.name).includes(keyword);
    return hitKeyword;
  });
  const filteredTenants = tenants.filter((item) => {
    const keyword = toLower(filters.tenants.keyword.trim());
    if (!keyword) return true;
    return (
      toLower(item.name).includes(keyword) ||
      toLower(item.description).includes(keyword)
    );
  });
  const filteredKeys = keys.filter((item) => {
    const keyword = toLower(filters.keys.keyword.trim());
    const hitKeyword =
      !keyword ||
      toLower(item.name).includes(keyword) ||
      toLower(item.tokenPreview).includes(keyword);
    const hitTenant = !filters.keys.tenantId || item.tenantId === filters.keys.tenantId;
    return hitKeyword && hitTenant;
  });
  const filteredSources = sources.filter((item) => {
    const keyword = toLower(filters.sources.keyword.trim());
    const hitKeyword =
      !keyword ||
      toLower(item.code).includes(keyword) ||
      toLower(item.name).includes(keyword) ||
      toLower(item.moduleRef).includes(keyword);
    const hitStatus = !filters.sources.status || item.status === filters.sources.status;
    return hitKeyword && hitStatus;
  });

  const filteredDashboardConfigs = dashboardConfigs.filter((item) => {
    const keyword = toLower(filters.dashboardConfigs.keyword.trim());
    const hitKeyword =
      !keyword ||
      toLower(item.dashboardCode).includes(keyword) ||
      toLower(item.filePath).includes(keyword);
    const tenantFilter = toText(filters.dashboardConfigs.tenantId).trim();
    if (!tenantFilter) return hitKeyword;
    const isPlatform = !item.tenantId;
    if (tenantFilter === '__platform__') return hitKeyword && isPlatform;
    return hitKeyword && item.tenantId === tenantFilter;
  });

  const filteredClawConfigs = clawConfigs.filter((item) => {
    const keyword = toLower(filters.clawConfigs.keyword.trim());
    if (!keyword) return true;
    return (
      toLower(item.name).includes(keyword) ||
      toLower(item.description ?? '').includes(keyword) ||
      toLower(item.serviceUrl).includes(keyword)
    );
  });

  const filteredAgentConfigs = agentConfigs.filter((item) => {
    const keyword = toLower(filters.agentConfigs.keyword.trim());
    if (!keyword) return true;
    return (
      toLower(item.name).includes(keyword) ||
      toLower(item.module).includes(keyword)
    );
  });

  const filteredXhsAccounts = xhsAccounts.filter((item) => {
    const keyword = toLower(filters.xhsAccounts.keyword.trim());
    if (!keyword) return true;
    return (
      toLower(item.username).includes(keyword) ||
      toLower(item.adspowerId ?? '').includes(keyword) ||
      toLower(item.notes ?? '').includes(keyword)
    );
  });

  const pagedUsers = buildPagedRows(filteredUsers, pages.users);
  const pagedProviders = buildPagedRows(filteredProviders, pages.providers);
  const pagedTenants = buildPagedRows(filteredTenants, pages.tenants);
  const pagedKeys = buildPagedRows(filteredKeys, pages.keys);
  const pagedSources = buildPagedRows(filteredSources, pages.sources);
  const pagedDashboardConfigs = buildPagedRows(
    filteredDashboardConfigs,
    pages.dashboardConfigs,
  );
  const pagedClawConfigs = buildPagedRows(filteredClawConfigs, pages.clawConfigs);
  const pagedAgentConfigs = buildPagedRows(filteredAgentConfigs, pages.agentConfigs);
  const pagedXhsAccounts = buildPagedRows(filteredXhsAccounts, pages.xhsAccounts);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">
        加载中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="text-sm text-slate-700">
            {me?.displayName || '后台'} · {getRoleLabel(me?.role)}
          </div>
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700"
          >
            退出登录
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            {notice}
          </div>
        ) : null}

        {activeTab === 'users' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">
                {editingUserId ? '编辑用户' : '新增用户'}
              </h2>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入用户账号（3-60字符）" value={forms.user.username} disabled={Boolean(editingUserId)} onChange={(e) => updateForm('user', 'username', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入用户显示名称" value={forms.user.displayName} onChange={(e) => updateForm('user', 'displayName', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder={editingUserId ? '不修改密码可留空' : '请输入登录密码（至少6位）'} type="password" value={forms.user.password} onChange={(e) => updateForm('user', 'password', e.target.value)} />
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.user.role} onChange={(e) => updateForm('user', 'role', e.target.value)}>
                {ROLE_OPTIONS.map((roleItem) => (
                  <option key={roleItem.value} value={roleItem.value}>
                    {roleItem.label}
                  </option>
                ))}
              </select>
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.user.tenantId} onChange={(e) => updateForm('user', 'tenantId', e.target.value)}>
                <option value="">不绑定租户（平台级）</option>
                {tenants.map((tenant) => (
                  <option key={tenant._id} value={tenant._id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.user.enabled ? '1' : '0'} onChange={(e) => updateForm('user', 'enabled', e.target.value === '1')}>
                <option value="1">启用</option>
                <option value="0">禁用</option>
              </select>
              <div className="flex gap-2">
                <button onClick={() => onSubmitUser().catch((err) => setError(err.message))} className="px-3 py-2 bg-slate-900 text-white text-sm rounded">
                  {editingUserId ? '保存用户' : '创建用户'}
                </button>
                {editingUserId ? (
                  <button onClick={() => setEditingUserId('')} className="px-3 py-2 bg-white border text-sm rounded">
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">用户列表</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input className="border rounded px-3 py-2 text-sm" placeholder="按账号或名称搜索" value={filters.users.keyword} onChange={(e) => updateFilter('users', 'keyword', e.target.value)} />
                <select className="border rounded px-3 py-2 text-sm" value={filters.users.tenantId} onChange={(e) => updateFilter('users', 'tenantId', e.target.value)}>
                  <option value="">全部租户</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 text-sm">
                {pagedUsers.rows.map((item) => (
                  <div key={item.id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.displayName}</div>
                      <div className="text-slate-500">{item.username}</div>
                      <div className="text-xs text-slate-500">{getRoleLabel(item.role)}</div>
                      <div className="text-xs text-slate-500">{item.tenantId || '平台级(空租户)'}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => {
                        setEditingUserId(item.id);
                        setForms((prev) => ({
                          ...prev,
                          user: {
                            ...prev.user,
                            username: item.username || '',
                            displayName: item.displayName || '',
                            password: '',
                            role: item.role || 'operator',
                            tenantId: item.tenantId || '',
                            enabled: Boolean(item.enabled),
                          },
                        }));
                      }} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        编辑
                      </button>
                      <button onClick={() => onDeleteUser(item.id).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedUsers,
                () => gotoPage('users', pages.users - 1),
                () => gotoPage('users', pages.users + 1),
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'providers' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">{editingProviderId ? '编辑AI提供商' : '新增AI提供商'}</h2>
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.providerCode} onChange={(e) => updateForm('provider', 'providerCode', e.target.value)}>
                <option value="">请选择提供商编码</option>
                {PROVIDER_CODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入提供商名称" value={forms.provider.name} onChange={(e) => updateForm('provider', 'name', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入服务地址（可选）" value={forms.provider.baseUrl} onChange={(e) => updateForm('provider', 'baseUrl', e.target.value)} />
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.modelCategory} onChange={(e) => updateForm('provider', 'modelCategory', e.target.value)}>
                <option value="llm">类别: 非EM模型（LLM/关键词/任务）</option>
                <option value="em">类别: EM模型（向量计算）</option>
                <option value="image">类别: 生图模型（Image）</option>
              </select>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder={forms.provider.modelCategory === 'em' ? '请输入EM模型（向量模型）' : forms.provider.modelCategory === 'image' ? '请输入生图模型（Image模型）' : '请输入非EM模型（LLM模型）'} value={forms.provider.model} onChange={(e) => updateForm('provider', 'model', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入API Key（可修改）" value={forms.provider.apiKey} onChange={(e) => updateForm('provider', 'apiKey', e.target.value)} />
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.enabled ? '1' : '0'} onChange={(e) => updateForm('provider', 'enabled', e.target.value === '1')}>
                <option value="1">启用</option>
                <option value="0">禁用</option>
              </select>
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.isDefault ? '1' : '0'} onChange={(e) => updateForm('provider', 'isDefault', e.target.value === '1')}>
                <option value="0">非默认（当前类别）</option>
                <option value="1">设为默认（当前类别）</option>
              </select>
              <div className="flex gap-2">
                <button onClick={() => onSubmitProvider().catch((err) => setError(err.message))} className="px-3 py-2 bg-slate-900 text-white text-sm rounded">
                  {editingProviderId ? '保存提供商' : '创建提供商'}
                </button>
                {editingProviderId ? (
                  <button onClick={() => setEditingProviderId('')} className="px-3 py-2 bg-white border text-sm rounded">
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">提供商列表</h2>
              <div className="grid grid-cols-1 gap-2 mb-3">
                <input className="border rounded px-3 py-2 text-sm" placeholder="按编码或名称搜索" value={filters.providers.keyword} onChange={(e) => updateFilter('providers', 'keyword', e.target.value)} />
              </div>
              <div className="space-y-2 text-sm">
                {pagedProviders.rows.map((item) => (
                  <div key={item._id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-slate-500">{item.providerCode}</div>
                      <div className="text-xs text-slate-500">类别：{item.modelCategory === 'em' ? 'EM模型' : item.modelCategory === 'image' ? '生图模型' : '非EM模型'}</div>
                      <div className="text-xs text-slate-500">模型：{item.model || '-'}</div>
                      <div className="text-xs text-slate-500">{item.isDefault ? `${item.modelCategory === 'em' ? 'EM' : item.modelCategory === 'image' ? '生图' : '非EM'}默认` : '候选提供商'}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => {
                        setEditingProviderId(item._id);
                        setForms((prev) => ({
                          ...prev,
                          provider: {
                            ...prev.provider,
                            providerCode: item.providerCode || '',
                            name: item.name || '',
                            baseUrl: item.baseUrl || '',
                            modelCategory: item.modelCategory || 'llm',
                            model: item.model || '',
                            apiKey: item.apiKey || '',
                            enabled: Boolean(item.enabled),
                            isDefault: Boolean(item.isDefault),
                          },
                        }));
                      }} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        编辑
                      </button>
                      <button
                        onClick={() => onTestProvider(item._id).catch((err) => setError(err.message))}
                        disabled={testingProviderId === item._id}
                        className="text-xs px-2 py-1 h-fit rounded border border-emerald-300 text-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {testingProviderId === item._id ? '测试中…' : '测试连接'}
                      </button>
                      <button onClick={() => onDeleteProvider(item._id).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedProviders,
                () => gotoPage('providers', pages.providers - 1),
                () => gotoPage('providers', pages.providers + 1),
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'tenants' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">{editingTenantId ? '编辑租户' : '新增租户'}</h2>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入租户名称" value={forms.tenant.name} onChange={(e) => updateForm('tenant', 'name', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入租户描述（可选）" value={forms.tenant.description} onChange={(e) => updateForm('tenant', 'description', e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => onSubmitTenant().catch((err) => setError(err.message))} className="px-3 py-2 bg-slate-900 text-white text-sm rounded">
                  {editingTenantId ? '保存租户' : '创建租户'}
                </button>
                {editingTenantId ? (
                  <button onClick={() => setEditingTenantId('')} className="px-3 py-2 bg-white border text-sm rounded">
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">租户列表</h2>
              <input className="w-full border rounded px-3 py-2 text-sm mb-3" placeholder="按租户名称搜索" value={filters.tenants.keyword} onChange={(e) => updateFilter('tenants', 'keyword', e.target.value)} />
              <div className="space-y-2 text-sm">
                {pagedTenants.rows.map((item) => (
                  <div key={item._id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">{item._id}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => {
                        setEditingTenantId(item._id);
                        setForms((prev) => ({
                          ...prev,
                          tenant: {
                            ...prev.tenant,
                            name: item.name || '',
                            description: item.description || '',
                          },
                        }));
                      }} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        编辑
                      </button>
                      <button onClick={() => onDeleteTenant(item._id).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedTenants,
                () => gotoPage('tenants', pages.tenants - 1),
                () => gotoPage('tenants', pages.tenants + 1),
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'keys' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">{editingKeyId ? '编辑Key' : '创建Key'}</h2>
              {!editingKeyId ? (
                <>
                  <select className="w-full border rounded px-3 py-2 text-sm" value={forms.key.tenantId} onChange={(e) => updateForm('key', 'tenantId', e.target.value)}>
                    <option value="">请选择租户</option>
                    {tenants.map((tenant) => (
                      <option key={tenant._id} value={tenant._id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入Key名称" value={forms.key.name} onChange={(e) => updateForm('key', 'name', e.target.value)} />
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入有效天数（如365）" value={forms.key.expireDays} onChange={(e) => updateForm('key', 'expireDays', e.target.value)} />
                </>
              ) : (
                <>
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入Key名称" value={forms.key.name} onChange={(e) => updateForm('key', 'name', e.target.value)} />
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入过期时间（ISO格式，可空）" value={forms.key.expiresAt} onChange={(e) => updateForm('key', 'expiresAt', e.target.value)} />
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入撤销时间（ISO格式，可空）" value={forms.key.revokedAt} onChange={(e) => updateForm('key', 'revokedAt', e.target.value)} />
                </>
              )}
              <div className="flex gap-2">
                <button onClick={() => onSubmitKey().catch((err) => setError(err.message))} className="px-3 py-2 bg-slate-900 text-white text-sm rounded">
                  {editingKeyId ? '保存Key' : '创建Key'}
                </button>
                {editingKeyId ? (
                  <button onClick={() => setEditingKeyId('')} className="px-3 py-2 bg-white border text-sm rounded">
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">Key列表</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input className="border rounded px-3 py-2 text-sm" placeholder="按名称或预览值搜索" value={filters.keys.keyword} onChange={(e) => updateFilter('keys', 'keyword', e.target.value)} />
                <select className="border rounded px-3 py-2 text-sm" value={filters.keys.tenantId} onChange={(e) => updateFilter('keys', 'tenantId', e.target.value)}>
                  <option value="">全部租户</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 text-sm">
                {pagedKeys.rows.map((item) => (
                  <div key={item._id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.tokenPreview}</div>
                      <div className="text-xs text-slate-500">{item.tenantId}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => {
                        setEditingKeyId(item._id);
                        setForms((prev) => ({
                          ...prev,
                          key: {
                            ...prev.key,
                            name: item.name || '',
                            expiresAt: toDateInput(item.expiresAt),
                            revokedAt: toDateInput(item.revokedAt),
                          },
                        }));
                      }} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        编辑
                      </button>
                      <button onClick={() => onRevokeKey(item._id).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-amber-300 text-amber-700">
                        撤销
                      </button>
                      <button onClick={() => onDeleteKey(item._id).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedKeys,
                () => gotoPage('keys', pages.keys - 1),
                () => gotoPage('keys', pages.keys + 1),
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'sources' ? (
          <div className="grid lg:grid-cols-2 gap-4 pb-8">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">{editingSourceCode ? '编辑数据源' : '新增数据源'}</h2>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入数据源编码（唯一）" value={forms.source.code} disabled={Boolean(editingSourceCode)} onChange={(e) => updateForm('source', 'code', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入数据源名称" value={forms.source.name} onChange={(e) => updateForm('source', 'name', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入数据源描述" value={forms.source.description} onChange={(e) => updateForm('source', 'description', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入模块引用路径（如sources/mongo）" value={forms.source.moduleRef} onChange={(e) => updateForm('source', 'moduleRef', e.target.value)} />
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.source.status} onChange={(e) => updateForm('source', 'status', e.target.value)}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
              <div className="flex gap-2">
                <button onClick={() => onSubmitSource().catch((err) => setError(err.message))} className="px-3 py-2 bg-slate-900 text-white text-sm rounded">
                  {editingSourceCode ? '保存数据源' : '创建数据源'}
                </button>
                {editingSourceCode ? (
                  <button onClick={() => setEditingSourceCode('')} className="px-3 py-2 bg-white border text-sm rounded">
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">数据源列表</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input className="border rounded px-3 py-2 text-sm" placeholder="按编码、名称或路径搜索" value={filters.sources.keyword} onChange={(e) => updateFilter('sources', 'keyword', e.target.value)} />
                <select className="border rounded px-3 py-2 text-sm" value={filters.sources.status} onChange={(e) => updateFilter('sources', 'status', e.target.value)}>
                  <option value="">全部状态</option>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
              <div className="space-y-2 text-sm">
                {pagedSources.rows.map((item) => (
                  <div key={item.code} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.code}</div>
                      <div className="text-xs text-slate-500">{item.moduleRef}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => {
                        setEditingSourceCode(item.code);
                        setForms((prev) => ({
                          ...prev,
                          source: {
                            ...prev.source,
                            code: item.code || '',
                            name: item.name || '',
                            description: item.description || '',
                            moduleRef: item.moduleRef || '',
                            status: item.status || 'active',
                          },
                        }));
                      }} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        编辑
                      </button>
                      <button onClick={() => onToggleSourceStatus(item.code, item.status).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700">
                        切换状态
                      </button>
                      <button onClick={() => onDeleteSource(item.code).catch((err) => setError(err.message))} className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedSources,
                () => gotoPage('sources', pages.sources - 1),
                () => gotoPage('sources', pages.sources + 1),
              )}
            </div>
          </div>
        ) : null}

        {/* Claw管理 | @keyword-en claw config management */}
        {activeTab === 'claw_configs' ? (
          <div className="grid lg:grid-cols-2 gap-4 pb-8">
            {/* Claw 配置表单区域 | @keyword-en claw config form area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">
                {editingClawConfigId ? '编辑 Claw 配置' : '新增 Claw 配置'}
              </h2>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="名称（必填）"
                value={forms.clawConfig.name}
                onChange={(e) => updateForm('clawConfig', 'name', e.target.value)}
              />
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="描述（选填）"
                value={forms.clawConfig.description}
                onChange={(e) => updateForm('clawConfig', 'description', e.target.value)}
              />
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="Service URL（如 http://127.0.0.1:18789）"
                value={forms.clawConfig.serviceUrl}
                onChange={(e) => updateForm('clawConfig', 'serviceUrl', e.target.value)}
              />
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="Token（Bearer 令牌，必填）"
                type="password"
                value={forms.clawConfig.token}
                onChange={(e) => updateForm('clawConfig', 'token', e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    onSubmitClawConfig().catch((err) => setError(err.message))
                  }
                  className="px-4 py-2 bg-slate-900 text-white text-sm rounded"
                >
                  {editingClawConfigId ? '更新' : '创建'}
                </button>
                {editingClawConfigId ? (
                  <button
                    onClick={() => {
                      setEditingClawConfigId('');
                      setForms((prev) => ({
                        ...prev,
                        clawConfig: { name: '', description: '', token: '', serviceUrl: '' },
                      }));
                    }}
                    className="px-3 py-2 text-sm border rounded"
                  >
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            {/* Claw 配置列表区域 | @keyword-en claw config list area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Claw 配置列表</h2>
                <span className="text-xs text-slate-400">{filteredClawConfigs.length} 条</span>
              </div>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="搜索..."
                value={filters.clawConfigs.keyword}
                onChange={(e) => updateFilter('clawConfigs', 'keyword', e.target.value)}
              />
              {pagedClawConfigs.rows.map((item) => (
                <div
                  key={item._id}
                  className={`p-3 border rounded-lg text-sm space-y-1 cursor-pointer ${
                    editingClawConfigId === item._id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                  }`}
                  onClick={() => {
                    setEditingClawConfigId(toText(item._id));
                    setForms((prev) => ({
                      ...prev,
                      clawConfig: {
                        name: item.name || '',
                        description: item.description || '',
                        token: item.token || '',
                        serviceUrl: item.serviceUrl || '',
                      },
                    }));
                  }}
                >
                  <div className="font-medium text-slate-900">{item.name}</div>
                  {item.description ? (
                    <div className="text-slate-500 text-xs">{item.description}</div>
                  ) : null}
                  <div className="text-slate-400 text-xs font-mono truncate">{item.serviceUrl}</div>
                  {/* 连通状态 | @keyword-en connect status badge */}
                  {item.connectStatus ? (
                    <div className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${
                      item.connectStatus === 'full'
                        ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
                        : item.connectStatus === 'api_only'
                        ? 'text-amber-600 border-amber-200 bg-amber-50'
                        : 'text-rose-500 border-rose-200 bg-rose-50'
                    }`}>
                      {item.connectStatus === 'full' && '完全通畅'}
                      {item.connectStatus === 'api_only' && '接口通畅, skill未接'}
                      {item.connectStatus === 'error' && '连接失败'}
                    </div>
                  ) : null}
                  {/* 操作按钮区域 | @keyword-en action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPingClawConfig(toText(item._id)).catch((err) => setError(err.message));
                      }}
                      disabled={pingLoadingId === toText(item._id)}
                      className="text-xs text-blue-600 px-2 py-1 border border-blue-200 rounded disabled:opacity-50"
                    >
                      {pingLoadingId === toText(item._id) ? '测试中...' : '测试连接'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!window.confirm('确认删除该 Claw 配置？')) return;
                        onDeleteClawConfig(toText(item._id)).catch((err) => setError(err.message));
                      }}
                      className="text-xs text-rose-500 px-2 py-1 border border-rose-200 rounded"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {renderPager(
                pagedClawConfigs,
                () => gotoPage('clawConfigs', pages.clawConfigs - 1),
                () => gotoPage('clawConfigs', pages.clawConfigs + 1),
              )}
            </div>
          </div>
        ) : null}

        {/* Agent管理 | @keyword-en agent config management */}
        {activeTab === 'agent_configs' ? (
          <div className="grid lg:grid-cols-2 gap-4 pb-8">
            {/* Agent 配置表单区域 | @keyword-en agent config form area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">
                {editingAgentConfigId ? '编辑 Agent 配置' : '新增 Agent 配置'}
              </h2>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="Agent 名称（必填）"
                value={forms.agentConfig.name}
                onChange={(e) => updateForm('agentConfig', 'name', e.target.value)}
              />
              {/* Agent 所属模块选择 | @keyword-en agent module select */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">所属模块（来自 auto-task-robot）</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={forms.agentConfig.module}
                  onChange={(e) => updateForm('agentConfig', 'module', e.target.value)}
                >
                  <option value="xhs_publisher">小红书发布机（xhs_publisher）</option>
                  <option value="claw">OpenClaw 智能体（claw）</option>
                </select>
              </div>
              {/* Claw 配置选择（仅当 module=claw 时显示）| @keyword-en claw config selector when module is claw */}
              {forms.agentConfig.module === 'claw' ? (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">选择 Claw 配置</label>
                    <select
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={forms.agentConfig.clawConfigId}
                      onChange={(e) => updateForm('agentConfig', 'clawConfigId', e.target.value)}
                    >
                      <option value="">-- 请选择 --</option>
                      {clawConfigs.map((cc) => (
                        <option key={cc._id} value={cc._id}>
                          {cc.name} ({cc.serviceUrl})
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="Claw Agent ID（默认 main）"
                    value={forms.agentConfig.clawAgentId}
                    onChange={(e) => updateForm('agentConfig', 'clawAgentId', e.target.value)}
                  />
                </>
              ) : null}
              {/* Agent 启用状态 | @keyword-en agent enabled toggle */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(forms.agentConfig.enabled)}
                  onChange={(e) => updateForm('agentConfig', 'enabled', e.target.checked)}
                />
                启用
              </label>
              {/* Agent 提示词编辑区域（Markdown）| @keyword-en agent prompt markdown editor */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">Agent 提示词（Markdown）</label>
                <div className="w-full" data-color-mode="light">
                  <MDEditor
                    height={300}
                    value={forms.agentConfig.prompt}
                    onChange={(val) => updateForm('agentConfig', 'prompt', val || '')}
                    preview="edit"
                    textareaProps={{ placeholder: '在这里输入 Agent 的系统提示词...' }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    onSubmitAgentConfig().catch((err) => setError(err.message))
                  }
                  className="px-4 py-2 bg-slate-900 text-white text-sm rounded"
                >
                  {editingAgentConfigId ? '更新' : '创建'}
                </button>
                {editingAgentConfigId ? (
                  <button
                    onClick={() => {
                      setEditingAgentConfigId('');
                      setForms((prev) => ({
                        ...prev,
                        agentConfig: {
                          name: '',
                          module: 'xhs_publisher',
                          clawConfigId: '',
                          clawAgentId: 'main',
                          prompt: '',
                          enabled: true,
                        },
                      }));
                    }}
                    className="px-3 py-2 text-sm border rounded"
                  >
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>
            {/* Agent 配置列表区域 | @keyword-en agent config list area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Agent 配置列表</h2>
                <span className="text-xs text-slate-400">{filteredAgentConfigs.length} 条</span>
              </div>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="搜索..."
                value={filters.agentConfigs.keyword}
                onChange={(e) => updateFilter('agentConfigs', 'keyword', e.target.value)}
              />
              {pagedAgentConfigs.rows.map((item) => (
                <div
                  key={item._id}
                  className={`p-3 border rounded-lg text-sm space-y-1 cursor-pointer ${
                    editingAgentConfigId === item._id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                  }`}
                  onClick={() => {
                    setEditingAgentConfigId(toText(item._id));
                    setForms((prev) => ({
                      ...prev,
                      agentConfig: {
                        name: item.name || '',
                        module: item.module || 'xhs_publisher',
                        clawConfigId: item.clawConfigId || '',
                        clawAgentId: item.clawAgentId || 'main',
                        prompt: item.prompt || '',
                        enabled: item.enabled !== false,
                      },
                    }));
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{item.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${item.enabled ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : 'text-slate-400 border-slate-200 bg-slate-50'}`}>
                      {item.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                  <div className="text-slate-400 text-xs">
                    模块：{item.module}
                    {item.clawConfigId ? (
                      <span className="ml-2">
                        · Claw：{clawConfigs.find((c) => c._id === item.clawConfigId)?.name || item.clawConfigId}
                      </span>
                    ) : null}
                  </div>
                  {item.prompt ? (
                    <div className="text-slate-500 text-xs line-clamp-2">{item.prompt.slice(0, 100)}</div>
                  ) : null}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm('确认删除该 Agent 配置？')) return;
                      onDeleteAgentConfig(toText(item._id)).catch((err) => setError(err.message));
                    }}
                    className="text-xs text-rose-500 px-2 py-1 border border-rose-200 rounded"
                  >
                    删除
                  </button>
                </div>
              ))}
              {renderPager(
                pagedAgentConfigs,
                () => gotoPage('agentConfigs', pages.agentConfigs - 1),
                () => gotoPage('agentConfigs', pages.agentConfigs + 1),
              )}
            </div>
          </div>
        ) : null}

        {/* 自媒体账号管理 | @keyword-en social media account management */}
        {activeTab === 'social_accounts' ? (
          <div className="space-y-4 pb-8">
            {/* 平台子 Tab 导航 | @keyword-en platform sub tab nav */}
            <div className="flex gap-1 border-b border-slate-200">
              {[{ id: 'xhs', label: '小红书' }].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSocialAccountSubTab(p.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    socialAccountSubTab === p.id
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {socialAccountSubTab === 'xhs' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            {/* 小红书账号表单区域 | @keyword-en xhs account form area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">
                {editingXhsAccountId ? '编辑小红书账号' : '新增小红书账号'}
              </h2>
              {/* 账号名称输入 | @keyword-en username input */}
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="账号名称（必填，如小红书昵称）"
                value={forms.xhsAccount.username}
                onChange={(e) => updateForm('xhsAccount', 'username', e.target.value)}
              />
              {/* AdsPower 环境 ID | @keyword-en adspowerid input */}
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="AdsPower 环境 ID（选填）"
                value={forms.xhsAccount.adspowerId}
                onChange={(e) => updateForm('xhsAccount', 'adspowerId', e.target.value)}
              />
              {/* Claw 配置选择 | @keyword-en claw config selector */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">关联 Claw 配置（选填）</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={forms.xhsAccount.clawConfigId}
                  onChange={(e) => updateForm('xhsAccount', 'clawConfigId', e.target.value)}
                >
                  <option value="">-- 不关联 --</option>
                  {clawConfigs.map((cc) => (
                    <option key={toText(cc._id)} value={toText(cc._id)}>
                      {cc.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Claw Agent ID | @keyword-en claw agent id input */}
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="Claw Agent ID（选填，如 main）"
                value={forms.xhsAccount.clawAgentId}
                onChange={(e) => updateForm('xhsAccount', 'clawAgentId', e.target.value)}
              />
              {/* 备注 | @keyword-en notes textarea */}
              <textarea
                className="w-full border rounded px-3 py-2 text-sm resize-none"
                rows={2}
                placeholder="备注（选填）"
                value={forms.xhsAccount.notes}
                onChange={(e) => updateForm('xhsAccount', 'notes', e.target.value)}
              />
              {/* 操作按钮区域 | @keyword-en form action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => onSubmitXhsAccount().catch((err) => setError(err.message))}
                  className="px-4 py-2 bg-slate-900 text-white text-sm rounded"
                >
                  {editingXhsAccountId ? '更新' : '创建'}
                </button>
                {editingXhsAccountId ? (
                  <button
                    onClick={() => {
                      setEditingXhsAccountId('');
                      setForms((prev) => ({
                        ...prev,
                        xhsAccount: { username: '', adspowerId: '', clawConfigId: '', clawAgentId: '', notes: '' },
                      }));
                    }}
                    className="px-3 py-2 text-sm border rounded"
                  >
                    取消编辑
                  </button>
                ) : null}
              </div>
            </div>

            {/* 小红书账号列表区域 | @keyword-en xhs account list area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">账号列表</h2>
                <span className="text-xs text-slate-400">{filteredXhsAccounts.length} 条</span>
              </div>
              {/* 账号搜索框 | @keyword-en xhs account search input */}
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="搜索账号..."
                value={filters.xhsAccounts.keyword}
                onChange={(e) => updateFilter('xhsAccounts', 'keyword', e.target.value)}
              />
              {pagedXhsAccounts.rows.map((item) => {
                const statusStyle = {
                  online: 'text-emerald-600 border-emerald-200 bg-emerald-50',
                  offline: 'text-slate-500 border-slate-200 bg-slate-50',
                  error: 'text-rose-500 border-rose-200 bg-rose-50',
                  unknown: 'text-slate-400 border-slate-200 bg-slate-50',
                }[item.loginStatus ?? 'unknown'] ?? 'text-slate-400 border-slate-200 bg-slate-50';
                const statusText = { online: '在线', offline: '离线', error: '异常', unknown: '未知' }[item.loginStatus ?? 'unknown'] ?? '未知';
                const linkedClaw = clawConfigs.find((cc) => toText(cc._id) === toText(item.clawConfigId));
                return (
                  /* 单个账号卡片 | @keyword-en xhs account card */
                  <div
                    key={toText(item._id)}
                    className={`p-3 border rounded-lg text-sm space-y-1 cursor-pointer ${
                      editingXhsAccountId === toText(item._id) ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                    }`}
                    onClick={() => {
                      setEditingXhsAccountId(toText(item._id));
                      setForms((prev) => ({
                        ...prev,
                        xhsAccount: {
                          username: item.username || '',
                          adspowerId: item.adspowerId || '',
                          clawConfigId: toText(item.clawConfigId) || '',
                          clawAgentId: item.clawAgentId || '',
                          notes: item.notes || '',
                        },
                      }));
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {/* 账号名 | @keyword-en account username */}
                      <span className="font-medium text-slate-900 truncate">{item.username}</span>
                      {/* 登录状态徽章 | @keyword-en login status badge */}
                      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${statusStyle}`}>{statusText}</span>
                    </div>
                    {item.adspowerId ? (
                      <div className="text-xs text-slate-400 font-mono">AdsPower: {item.adspowerId}</div>
                    ) : null}
                    {linkedClaw ? (
                      <div className="text-xs text-slate-500">Claw: {linkedClaw.name}{item.clawAgentId ? ` / ${item.clawAgentId}` : ''}</div>
                    ) : null}
                    {item.notes ? (
                      <div className="text-xs text-slate-400 truncate">{item.notes}</div>
                    ) : null}
                    {/* 账号操作按钮 | @keyword-en account action buttons */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTestLoginXhsAccount(toText(item._id)).catch((err) => setError(err.message));
                        }}
                        disabled={testLoginLoadingId === toText(item._id)}
                        className="text-xs text-blue-600 px-2 py-1 border border-blue-200 rounded disabled:opacity-50"
                      >
                        {testLoginLoadingId === toText(item._id) ? '测试中...' : '测试登录'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm('确认删除该小红书账号？')) return;
                          onDeleteXhsAccount(toText(item._id)).catch((err) => setError(err.message));
                        }}
                        className="text-xs text-rose-500 px-2 py-1 border border-rose-200 rounded"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
              {renderPager(
                pagedXhsAccounts,
                () => gotoPage('xhsAccounts', pages.xhsAccounts - 1),
                () => gotoPage('xhsAccounts', pages.xhsAccounts + 1),
              )}
            </div>
          </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'dashboard_configs' ? (
          <div className="grid lg:grid-cols-2 gap-4 pb-8">
            {/* 看板配置映射编辑区域 | @keyword-en dashboard config mapping editor */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-900">
                {editingDashboardConfigId ? '编辑看板配置映射' : '新增看板配置映射'}
              </h2>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="dashboardCode（默认 ai-commander）"
                value={forms.dashboardConfig.dashboardCode}
                onChange={(e) => updateForm('dashboardConfig', 'dashboardCode', e.target.value)}
              />
              {/* 租户管理员锁定 tenantId，平台管理员可选 */}
              {isSuperAdmin(me?.role) ? (
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={forms.dashboardConfig.tenantId}
                  onChange={(e) => updateForm('dashboardConfig', 'tenantId', e.target.value)}
                >
                  <option value="">母平台（空租户）</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full border rounded px-3 py-2 text-sm text-slate-500 bg-slate-50">
                  租户：{tenants.find((t) => t._id === me?.tenantId)?.name || me?.tenantId || '当前租户'}
                </div>
              )}
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="配置文件路径（相对项目根，如 config/dashboards/xxx.json）"
                value={forms.dashboardConfig.filePath}
                onChange={(e) => updateForm('dashboardConfig', 'filePath', e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(forms.dashboardConfig.enabled)}
                  onChange={(e) => updateForm('dashboardConfig', 'enabled', e.target.checked)}
                />
                启用
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => onSubmitDashboardConfig().catch((err) => setError(err.message))}
                  className="px-3 py-2 bg-slate-900 text-white text-sm rounded"
                >
                  {editingDashboardConfigId ? '保存映射' : '创建映射'}
                </button>
                {editingDashboardConfigId ? (
                  <button
                    onClick={() => {
                      setEditingDashboardConfigId('');
                      setForms((prev) => ({
                        ...prev,
                        dashboardConfig: {
                          dashboardCode: 'ai-commander',
                          tenantId: '',
                          filePath: 'config/dashboards/platform.dashboard.json',
                          enabled: true,
                        },
                      }));
                    }}
                    className="px-3 py-2 bg-white border text-sm rounded"
                  >
                    取消编辑
                  </button>
                ) : null}
              </div>
              <div className="text-xs text-slate-500">
                配置文件仅允许在 <span className="font-mono">config/dashboards/</span> 目录下。
              </div>
            </div>

            {/* 看板配置映射列表区域 | @keyword-en dashboard config mapping list */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-900 mb-2">映射列表</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input
                  className="border rounded px-3 py-2 text-sm"
                  placeholder="按 dashboardCode 或 filePath 搜索"
                  value={filters.dashboardConfigs.keyword}
                  onChange={(e) => updateFilter('dashboardConfigs', 'keyword', e.target.value)}
                />
                <select
                  className="border rounded px-3 py-2 text-sm"
                  value={filters.dashboardConfigs.tenantId}
                  onChange={(e) => updateFilter('dashboardConfigs', 'tenantId', e.target.value)}
                >
                  <option value="">全部租户</option>
                  <option value="__platform__">母平台（空租户）</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 text-sm">
                {pagedDashboardConfigs.rows.map((item) => (
                  <div key={item._id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">
                        {item.dashboardCode || 'ai-commander'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {item.tenantId ? item.tenantId : '母平台(空租户)'}
                      </div>
                      <div className="text-xs text-slate-500">{item.filePath}</div>
                      <div className="text-xs text-slate-500">
                        {item.enabled ? 'enabled' : 'disabled'}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => {
                          setEditingDashboardConfigId(item._id);
                          setForms((prev) => ({
                            ...prev,
                            dashboardConfig: {
                              dashboardCode: item.dashboardCode || 'ai-commander',
                              tenantId: item.tenantId || '',
                              filePath: item.filePath || '',
                              enabled: Boolean(item.enabled),
                            },
                          }));
                        }}
                        className="text-xs px-2 py-1 h-fit rounded border border-slate-300 text-slate-700"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => onDeleteDashboardConfig(item._id).catch((err) => setError(err.message))}
                        className="text-xs px-2 py-1 h-fit rounded border border-rose-300 text-rose-600"
                      >
                        删除
                      </button>
                      {/* 重置 AI 修改按钮：清除 customConfig 回退到文件配置 | @keyword-en reset ai custom config */}
                      <button
                        onClick={() =>
                          onResetDashboardCustomConfig(item.dashboardCode).catch((err) =>
                            setError(err.message),
                          )
                        }
                        className="text-xs px-2 py-1 h-fit rounded border border-amber-300 text-amber-700"
                        title="清除 AI 修改的自定义配置，回退到文件配置"
                      >
                        重置配置
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderPager(
                pagedDashboardConfigs,
                () => gotoPage('dashboardConfigs', pages.dashboardConfigs - 1),
                () => gotoPage('dashboardConfigs', pages.dashboardConfigs + 1),
              )}
            </div>
          </div>
        ) : null}

        {/* 飞书凭证（仅本租户） | @keyword-en feishu credentials current tenant only */}
        {activeTab === 'feishu_credentials' ? (
          (() => {
            const ownCredential = feishuCredentials[0] || null;
            return (
              <div className="grid lg:grid-cols-1 gap-4 pb-8">
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  {/* 头部说明 + 保存 | @keyword-en feishu credential header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-slate-900">飞书 appId / appSecret</h2>
                      <p className="text-xs text-slate-500 mt-1">
                        本租户专属凭证，财务多维表 / 审批读取共用；同一租户只保留一份，重新提交即覆盖。
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {ownCredential ? (
                        <button
                          onClick={() =>
                            onDeleteFeishuCredential(ownCredential._id).catch((err) =>
                              setError(err.message),
                            )
                          }
                          className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded"
                        >
                          删除凭证
                        </button>
                      ) : null}
                      <button
                        onClick={() =>
                          onSubmitFeishuCredential().catch((err) => setError(err.message))
                        }
                        className="px-4 py-2 bg-slate-900 text-white text-sm rounded"
                      >
                        保存凭证
                      </button>
                    </div>
                  </div>
                  {/* 表单区域 | @keyword-en feishu credential form area */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-xs text-slate-600 space-y-1">
                      <div>appId</div>
                      <input
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={forms.feishuCredential.appId}
                        onChange={(e) => updateForm('feishuCredential', 'appId', e.target.value)}
                        placeholder="cli_xxxxxx"
                      />
                    </label>
                    <label className="text-xs text-slate-600 space-y-1">
                      <div>appSecret</div>
                      <input
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={forms.feishuCredential.appSecret}
                        onChange={(e) => updateForm('feishuCredential', 'appSecret', e.target.value)}
                        placeholder="xxxxxxxxxxxx"
                        type="password"
                      />
                    </label>
                    <label className="text-xs text-slate-600 space-y-1 md:col-span-2">
                      <div>备注</div>
                      <input
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={forms.feishuCredential.remark}
                        onChange={(e) => updateForm('feishuCredential', 'remark', e.target.value)}
                      />
                    </label>
                  </div>
                  {/* 状态信息 | @keyword-en feishu credential status info */}
                  <div className="text-xs text-slate-400">
                    {ownCredential
                      ? `上次更新：${new Date(ownCredential.updatedAt).toLocaleString()}`
                      : '当前租户尚未配置凭证，填写后点击保存。'}
                  </div>
                </div>
              </div>
            );
          })()
        ) : null}

        {/* 财务（内含 支出 / 应付 / 推送配置 三个子 Tab） | @keyword-en finance tab with category and push sub tabs */}
        {/* 财务 Tab(回归"支出/应付"子 Tab,name 由 FINANCE_KINDS 自动注入,用户不感知) | @keyword-en finance tab simplified preset kinds */}
        {activeTab === 'finance' ? (
          (() => {
            const currentKind =
              FINANCE_KINDS.find((k) => k.id === financeSubTab) || FINANCE_KINDS[0];
            const bindingForm = forms.financeBinding;
            const pushForm = forms.financePush;
            const currentBinding = financeBindings.find(
              (b) => b.name === currentKind.id,
            );
            const currentTransform = financeTransforms[currentKind.id];
            const chatState = financeChat[currentKind.id] || {
              messages: [],
              input: '',
              loading: false,
            };
            const pushConfig = financePushConfig;
            const canTest =
              !!toText(pushForm.baseUrl).trim() && !!toText(pushForm.apiKey).trim();
            const isRunning = financePushPending.run === currentKind.id;
            const canRun =
              !!pushConfig &&
              (bindingForm.sources?.length || 0) > 0 &&
              !!currentTransform?.dsl;
            const testStatusBadge =
              financePushFeedback && financePushFeedback.kind === 'test'
                ? {
                    status: financePushFeedback.status,
                    message: financePushFeedback.message,
                    code: financePushFeedback.code,
                    httpStatus: financePushFeedback.httpStatus,
                  }
                : pushConfig?.lastTestStatus
                  ? {
                      status: pushConfig.lastTestStatus,
                      message: pushConfig.lastTestMessage,
                      at: pushConfig.lastTestedAt,
                    }
                  : null;
            return (
              <>
              <div className="space-y-4 pb-8">
                {/* 顶部:推送配置卡片(默认折叠,显示状态摘要) | @keyword-en collapsible push config */}
                <div className="bg-white border border-slate-200 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFinancePushCollapsed((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        推送配置
                      </span>
                      {pushConfig ? (
                        <span className="text-xs text-slate-500 truncate font-mono">
                          {pushConfig.baseUrl}
                          {pushConfig.externalTenantId
                            ? ` · ${pushConfig.externalTenantId}`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600">未配置</span>
                      )}
                      {testStatusBadge ? (
                        <span
                          className={
                            'text-xs px-2 py-0.5 rounded ' +
                            (PUSH_STATUS_COLOR[testStatusBadge.status] || PUSH_STATUS_COLOR.unknown)
                          }
                        >
                          {PUSH_STATUS_LABEL[testStatusBadge.status] || testStatusBadge.status}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-400">
                      {financePushCollapsed ? '展开 ▾' : '收起 ▴'}
                    </span>
                  </button>
                  {!financePushCollapsed ? (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                      <p className="text-xs text-slate-500">
                        外部财务系统的 API 前缀(含 <code>/api/v1</code>) + API Key。外部租户 ID 用于 webhook tenantId 映射。统一推到 <code className="text-slate-700">/events/upsert</code>,探活打 <code className="text-slate-700">/me</code>。
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="text-xs text-slate-600 space-y-1">
                          <div>baseUrl</div>
                          <input
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                            placeholder="http(s)://your-server.example.com/api/v1"
                            value={pushForm.baseUrl}
                            onChange={(e) => updateForm('financePush', 'baseUrl', e.target.value)}
                          />
                        </label>
                        <label className="text-xs text-slate-600 space-y-1">
                          <div>apiKey</div>
                          <input
                            type="password"
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                            placeholder="fa_xxxxxxxxxxxx.yyyyyyyy"
                            value={pushForm.apiKey}
                            onChange={(e) => updateForm('financePush', 'apiKey', e.target.value)}
                          />
                        </label>
                        <label className="text-xs text-slate-600 space-y-1">
                          <div>外部租户ID</div>
                          <input
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                            placeholder="t_demo"
                            value={pushForm.externalTenantId}
                            onChange={(e) =>
                              updateForm('financePush', 'externalTenantId', e.target.value)
                            }
                          />
                        </label>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() =>
                            onSubmitFinancePushConfig().catch((err) => setError(err.message))
                          }
                          disabled={financePushPending.save}
                          className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded disabled:bg-slate-300"
                        >
                          {financePushPending.save ? '保存中…' : '保存配置'}
                        </button>
                        <button
                          onClick={() => onTestFinancePush()}
                          disabled={!canTest || financePushPending.test || !pushConfig}
                          title={!pushConfig ? '请先保存配置后再测试' : ''}
                          className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs rounded disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {financePushPending.test ? '测试中…' : '测试连通性'}
                        </button>
                      </div>
                      {testStatusBadge?.message ? (
                        <div className="text-xs text-slate-500 truncate">
                          {testStatusBadge.message}
                          {testStatusBadge.at ? (
                            <span className="ml-2 text-slate-400">
                              {new Date(testStatusBadge.at).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* 推送结果反馈 + 执行日志(全宽) | @keyword-en push run feedback with logs */}
                {financePushFeedback && financePushFeedback.kind === 'run' ? (
                  <div className="space-y-2">
                  {financePushFeedback.streaming ? (
                    <div className="text-xs bg-sky-50 border border-sky-200 text-sky-700 rounded p-2 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                      推送中… binding「{financePushFeedback.name}」
                      {Array.isArray(financePushFeedback.logs) && financePushFeedback.logs.length > 0
                        ? ` · ${financePushFeedback.logs[financePushFeedback.logs.length - 1].msg}`
                        : ''}
                    </div>
                  ) : financePushFeedback.error ? (
                    <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded p-2">
                      ❌ 推送失败:{financePushFeedback.error}
                    </div>
                  ) : financePushFeedback.failedBatch ? (
                    <div className="text-xs bg-red-50 border border-red-200 rounded p-2 space-y-2">
                      <div className="flex flex-wrap gap-2 items-start justify-between">
                        <div className="font-semibold text-red-700">
                          ❌ binding「{financePushFeedback.name}」批次 #{financePushFeedback.failedBatch.index + 1} 整批拒收
                          · HTTP {financePushFeedback.failedBatch.httpStatus}
                          {financePushFeedback.failedBatch.code ? ` · ${financePushFeedback.failedBatch.code}` : ''}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() =>
                              onCopyPushFailure(financePushFeedback).catch((err) =>
                                setError(err.message),
                              )
                            }
                            className="px-2 py-0.5 border border-slate-300 text-slate-700 text-xs rounded bg-white hover:bg-slate-50"
                            title="复制完整失败详情(HTTP / 错误信息 / 推送 payload / 对方原始响应)到剪贴板"
                          >
                            复制详情
                          </button>
                          <button
                            onClick={() =>
                              onSendPushFailureToAgent(currentKind.id, financePushFeedback)
                            }
                            className="px-2 py-0.5 bg-slate-900 text-white text-xs rounded"
                            title="把失败详情塞进右侧 Agent 输入框,让 Agent 修 DSL"
                          >
                            发给 Agent
                          </button>
                        </div>
                      </div>
                      <div className="text-slate-600">
                        成功 {financePushFeedback.successCount} / 共 {financePushFeedback.transformedRows} 条;
                        源拉取 {financePushFeedback.totalRows}(filter {financePushFeedback.filteredRows},transform 错 {financePushFeedback.transformErrors}
                        {financePushFeedback.dateFilteredRows > 0
                          ? `,时间窗滤掉 ${financePushFeedback.dateFilteredRows}`
                          : ''})
                      </div>
                      <details open>
                        <summary className="cursor-pointer text-slate-700 font-semibold">
                          错误信息(完整){financePushFeedback.failedBatch.contentType ? ` · ${financePushFeedback.failedBatch.contentType}` : ''}
                        </summary>
                        <pre className="mt-1 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-72 font-mono text-red-700 whitespace-pre-wrap break-all">
                          {financePushFeedback.failedBatch.message || '(无 message 字段)'}
                        </pre>
                      </details>
                      {financePushFeedback.failedBatch.rawResponseBody !== undefined &&
                      financePushFeedback.failedBatch.rawResponseBody !== null ? (
                        <details>
                          <summary className="cursor-pointer text-slate-500">
                            对方原始响应 body(完整)
                          </summary>
                          <pre className="mt-1 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-72 font-mono whitespace-pre-wrap break-all">
                            {typeof financePushFeedback.failedBatch.rawResponseBody === 'string'
                              ? financePushFeedback.failedBatch.rawResponseBody
                              : JSON.stringify(financePushFeedback.failedBatch.rawResponseBody, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      {Array.isArray(financePushFeedback.failedBatch.payloadAll) &&
                      financePushFeedback.failedBatch.payloadAll.length > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-slate-500">
                            该批推送 payload(共 {financePushFeedback.failedBatch.payloadAll.length} 条;展示首 3 条)
                          </summary>
                          <pre className="mt-1 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-72 font-mono">
                            {JSON.stringify(
                              financePushFeedback.failedBatch.payloadAll.slice(0, 3),
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded p-2">
                      ✅ 全部成功 · {financePushFeedback.successCount} 条 / {financePushFeedback.batches} 批
                      (源拉取 {financePushFeedback.totalRows},filter {financePushFeedback.filteredRows},transform 错 {financePushFeedback.transformErrors}
                      {financePushFeedback.dateFilteredRows > 0
                        ? `,时间窗滤掉 ${financePushFeedback.dateFilteredRows}`
                        : ''})
                    </div>
                  )}
                  {/* 执行日志(后端累积的关键步骤) | @keyword-en push run logs */}
                  {Array.isArray(financePushFeedback.logs) && financePushFeedback.logs.length > 0 ? (
                    <details className="text-xs bg-slate-50 border border-slate-200 rounded" open>
                      <summary className="cursor-pointer px-3 py-1.5 select-none text-slate-700">
                        执行日志 · {financePushFeedback.logs.length} 条
                      </summary>
                      <div className="px-3 py-2 max-h-64 overflow-y-auto space-y-0.5 font-mono">
                        {financePushFeedback.logs.map((entry, i) => (
                          <div
                            key={i}
                            className={
                              entry.level === 'error'
                                ? 'text-red-600'
                                : entry.level === 'warn'
                                  ? 'text-amber-600'
                                  : 'text-slate-600'
                            }
                          >
                            <span className="text-slate-400">
                              {new Date(entry.at).toLocaleTimeString()}
                            </span>{' '}
                            <span className="text-slate-400">[{entry.level}]</span>{' '}
                            {entry.msg}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  </div>
                ) : null}

                {/* 子 Tab(支出 / 应付) | @keyword-en finance sub tab bar */}
                <div className="flex gap-2 border-b border-slate-200 pb-2">
                  {FINANCE_KINDS.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setFinanceSubTab(k.id)}
                      className={
                        'px-4 py-1.5 text-sm rounded ' +
                        (financeSubTab === k.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                      }
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                {/* 主体:左 binding 编辑 | 右 Agent | @keyword-en finance editor and agent */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    {/* 源绑定 + 备注 + 保存/推送 | @keyword-en source binding card */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="font-semibold text-slate-900">{currentKind.label}</h2>
                          <p className="text-xs text-slate-500 mt-1">
                            {currentKind.hint}。可同时绑定多个多维表 / 审批,自动归类为 {currentKind.flowDefault === 'out' ? '支出' : '收入'}。
                          </p>
                        </div>
                        <div className="flex gap-2 flex-wrap shrink-0">
                          <button
                            onClick={onAddBitableSource}
                            className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs rounded whitespace-nowrap"
                          >
                            + 多维表
                          </button>
                          <button
                            onClick={onAddApprovalSource}
                            className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs rounded whitespace-nowrap"
                          >
                            + 审批
                          </button>
                          <button
                            onClick={() =>
                              onSubmitFinanceBinding().catch((err) => setError(err.message))
                            }
                            className="px-4 py-1.5 bg-slate-900 text-white text-xs rounded whitespace-nowrap"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => onRunFinancePush(currentKind.id)}
                            disabled={!canRun || isRunning}
                            title={
                              !pushConfig
                                ? '先保存推送配置(顶部)'
                                : (bindingForm.sources?.length || 0) === 0
                                  ? '请先绑定数据源'
                                  : !currentTransform?.dsl
                                    ? '请先让 Agent 生成 / 手填 Transform DSL'
                                    : ''
                            }
                            className="px-4 py-1.5 bg-emerald-600 text-white text-xs rounded whitespace-nowrap disabled:bg-slate-300"
                          >
                            {isRunning ? '推送中…' : '立即推送'}
                          </button>
                        </div>
                      </div>
                      {/* 推送时间窗(按 occurredAt 过滤;空=全量) | @keyword-en push date window inputs */}
                      <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                        <span className="text-slate-500">推送时间窗(按 occurredAt 过滤,留空=全量):</span>
                        <label className="space-y-0.5">
                          <div className="text-slate-400">起</div>
                          <input
                            type="date"
                            className="border border-slate-300 rounded px-2 py-1 text-xs"
                            value={financePushDateWindow.startDate}
                            onChange={(e) =>
                              setFinancePushDateWindow((p) => ({
                                ...p,
                                startDate: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="space-y-0.5">
                          <div className="text-slate-400">止</div>
                          <input
                            type="date"
                            className="border border-slate-300 rounded px-2 py-1 text-xs"
                            value={financePushDateWindow.endDate}
                            onChange={(e) =>
                              setFinancePushDateWindow((p) => ({
                                ...p,
                                endDate: e.target.value,
                              }))
                            }
                          />
                        </label>
                        {financePushDateWindow.startDate || financePushDateWindow.endDate ? (
                          <button
                            onClick={() =>
                              setFinancePushDateWindow({ startDate: '', endDate: '' })
                            }
                            className="text-slate-500 underline"
                          >
                            清空
                          </button>
                        ) : null}
                      </div>

                      {bindingForm.sources.length === 0 ? (
                        <div className="text-center text-slate-400 text-sm py-4 border border-dashed border-slate-200 rounded">
                          未绑定任何源,请用上方"+ 多维表"或"+ 审批"添加
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {bindingForm.sources.map((s, idx) => (
                            <div key={idx} className="border border-slate-200 rounded p-2 space-y-2">
                              <div className="flex items-start gap-2">
                                <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 mt-1">
                                  {s.type === 'bitable' ? '多维表' : '审批'}
                                </span>
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {s.type === 'bitable' ? (
                                    <>
                                      <input
                                        className="border border-slate-300 rounded px-2 py-1 text-xs"
                                        placeholder="appToken"
                                        value={s.appToken || ''}
                                        onChange={(e) =>
                                          onUpdateSourceField(idx, 'appToken', e.target.value)
                                        }
                                      />
                                      <input
                                        className="border border-slate-300 rounded px-2 py-1 text-xs"
                                        placeholder="tableId"
                                        value={s.tableId || ''}
                                        onChange={(e) =>
                                          onUpdateSourceField(idx, 'tableId', e.target.value)
                                        }
                                      />
                                    </>
                                  ) : (
                                    <input
                                      className="md:col-span-2 border border-slate-300 rounded px-2 py-1 text-xs"
                                      placeholder="approvalCode"
                                      value={s.approvalCode || ''}
                                      onChange={(e) =>
                                        onUpdateSourceField(idx, 'approvalCode', e.target.value)
                                      }
                                    />
                                  )}
                                  <input
                                    className="border border-slate-300 rounded px-2 py-1 text-xs"
                                    placeholder="别名(可选)"
                                    value={s.alias || ''}
                                    onChange={(e) =>
                                      onUpdateSourceField(idx, 'alias', e.target.value)
                                    }
                                  />
                                </div>
                                <button
                                  onClick={() => onRemoveSource(idx)}
                                  className="text-red-500 text-xs px-2 py-1"
                                >
                                  移除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                        💡 表的语义就是「别名」(如"云境上海银行流水")。Agent 会把别名当作表定义读懂归属/银行/业务,然后用 lookup 等手段产出 storeId / companyId / bankAccount 等字段。
                      </div>
                      <label className="block text-xs text-slate-600 space-y-1">
                        <div>备注</div>
                        <input
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                          value={bindingForm.remark}
                          onChange={(e) => updateForm('financeBinding', 'remark', e.target.value)}
                        />
                      </label>
                      <div className="text-xs text-slate-400 flex flex-wrap gap-3">
                        {currentBinding?.updatedAt ? (
                          <span>绑定上次更新:{new Date(currentBinding.updatedAt).toLocaleString()}</span>
                        ) : null}
                        {currentTransform?.updatedAt ? (
                          <span className={'text-emerald-600'}>
                            DSL 已就绪 · {new Date(currentTransform.updatedAt).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-amber-600">DSL 尚未就绪 — 请用右侧 Agent 生成</span>
                        )}
                      </div>
                    </div>

                    {/* 高级:Transform DSL(默认折叠) | @keyword-en transform dsl collapsed advanced */}
                    <details className="bg-white border border-slate-200 rounded-xl">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900 select-none">
                        高级:Transform DSL(可让 Agent 生成,通常无需手编)
                      </summary>
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                        <textarea
                          className="w-full border border-slate-300 rounded p-2 text-xs font-mono"
                          rows={14}
                          value={bindingForm.dslText}
                          onChange={(e) => updateForm('financeBinding', 'dslText', e.target.value)}
                          placeholder={'// 让 Agent 在右侧自动生成,或手填后点保存'}
                        />
                        <label className="block text-xs text-slate-600 space-y-1">
                          <div>解读说明</div>
                          <textarea
                            className="w-full border border-slate-300 rounded p-2 text-xs"
                            rows={2}
                            value={bindingForm.explanation}
                            onChange={(e) =>
                              updateForm('financeBinding', 'explanation', e.target.value)
                            }
                          />
                        </label>
                        <button
                          onClick={() =>
                            onSubmitFinanceTransform().catch((err) => setError(err.message))
                          }
                          className="px-4 py-1.5 bg-slate-900 text-white text-xs rounded"
                        >
                          保存 DSL
                        </button>
                      </div>
                    </details>
                  </div>

                  {/* 右栏:Agent 对话 | @keyword-en finance agent chat right column */}
                  <div className="space-y-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col h-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                        <div className="min-w-0">
                          <h2 className="font-semibold text-slate-900">{currentKind.label} - Agent</h2>
                          <p className="text-xs text-slate-500 mt-1">
                            让 AI 读飞书字段、自动生成 DSL。说"读字段"/"按下面方案存"等即可。
                          </p>
                        </div>
                        <button
                          onClick={() => onClearFinanceChat(currentKind.id)}
                          className="text-xs text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0"
                        >
                          清空
                        </button>
                      </div>
                      <div className="flex-1 min-h-[20rem] border border-slate-200 rounded p-3 overflow-y-auto space-y-3 bg-slate-50">
                        {chatState.messages.length === 0 ? (
                          <div className="text-xs text-slate-400 text-center py-6">
                            发起对话:"读一下当前绑定源的字段,给我一个 DSL 方案"
                          </div>
                        ) : (
                          chatState.messages.map((m, i) => (
                            <div key={i} className="text-sm">
                              <div
                                className={
                                  'text-xs font-semibold mb-1 ' +
                                  (m.role === 'user' ? 'text-slate-700' : 'text-blue-700')
                                }
                              >
                                {m.role === 'user' ? '你' : 'Finance Agent'}
                              </div>
                              <div
                                className="bg-white rounded p-2 border border-slate-200 overflow-hidden break-words finance-chat-bubble"
                                data-color-mode="light"
                              >
                                <MDEditor.Markdown
                                  source={toText(m.content)}
                                  style={{ background: 'transparent', fontSize: 13 }}
                                />
                                {Array.isArray(m.tools) && m.tools.length > 0 ? (
                                  <div className="mt-2 space-y-2">
                                    {m.tools.map((tool, toolIndex) => {
                                      const argsText = formatFinanceToolValue(
                                        tool.argsText || tool.input,
                                      );
                                      const outputText = formatFinanceToolValue(tool.output);
                                      const isDone = tool.status === 'completed';
                                      return (
                                        <div
                                          key={tool.id || `${tool.name}-${toolIndex}`}
                                          className="rounded border border-blue-100 bg-blue-50/70 px-2 py-1.5 text-xs text-slate-700"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-blue-700">
                                              Tool: {tool.name || 'tool'}
                                            </span>
                                            <span
                                              className={
                                                'rounded px-1.5 py-0.5 ' +
                                                (isDone
                                                  ? 'bg-emerald-100 text-emerald-700'
                                                  : 'bg-amber-100 text-amber-700')
                                              }
                                            >
                                              {isDone ? '完成' : '运行中'}
                                            </span>
                                          </div>
                                          {argsText ? (
                                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-1 font-mono text-[11px] text-slate-600">
                                              {argsText}
                                            </pre>
                                          ) : null}
                                          {outputText ? (
                                            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-1 font-mono text-[11px] text-slate-600">
                                              {outputText}
                                            </pre>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                {m.role !== 'user' && m.status ? (
                                  <div className="mt-2 text-xs text-slate-500">
                                    {m.status}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                        {chatState.loading ? (
                          <div className="text-xs text-slate-500 italic">
                            Agent 思考中(可能十几秒,期间会读字段 / 试跑 DSL)...
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <textarea
                          className="flex-1 border border-slate-300 rounded p-2 text-sm"
                          rows={2}
                          placeholder="输入消息,回车发送"
                          value={chatState.input}
                          onChange={(e) =>
                            onUpdateFinanceChatInput(currentKind.id, e.target.value)
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (!chatState.loading) {
                                onSendFinanceChat(currentKind.id).catch((err) =>
                                  setError(err.message),
                                );
                              }
                            }
                          }}
                          disabled={chatState.loading}
                        />
                        <button
                          onClick={() =>
                            onSendFinanceChat(currentKind.id).catch((err) =>
                              setError(err.message),
                            )
                          }
                          disabled={chatState.loading || !toText(chatState.input).trim()}
                          className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300"
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 多维表批量添加弹窗 | @keyword-en bitable batch picker modal */}
              {bitableModal.open ? (
                <div
                  className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
                  onClick={onCloseBitableModal}
                >
                  <div
                    className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">
                          添加飞书多维表 → {currentKind.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          填入 appToken 加载该多维表下所有数据表,勾选后批量绑定。
                        </div>
                      </div>
                      <button
                        onClick={onCloseBitableModal}
                        className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                    <div className="px-5 py-3 border-b border-slate-200 flex gap-2">
                      <input
                        className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                        placeholder="appToken(多维表 URL 中的 base/xxxx 部分)"
                        value={bitableModal.appToken}
                        onChange={(e) =>
                          setBitableModal((prev) => ({ ...prev, appToken: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !bitableModal.loading) {
                            e.preventDefault();
                            onLoadBitableTables();
                          }
                        }}
                      />
                      <button
                        onClick={onLoadBitableTables}
                        disabled={bitableModal.loading}
                        className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300 whitespace-nowrap"
                      >
                        {bitableModal.loading ? '加载中…' : '加载数据表'}
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[200px]">
                      {bitableModal.error ? (
                        <div className="text-xs text-red-500 mb-2">{bitableModal.error}</div>
                      ) : null}
                      {bitableModal.tables.length === 0 ? (
                        <div className="text-center text-slate-400 text-sm py-8">
                          {bitableModal.loading ? '加载中…' : '尚未加载,输入 appToken 后点击右上方按钮'}
                        </div>
                      ) : (
                        (() => {
                          const existed = new Set(
                            (forms.financeBinding.sources || [])
                              .filter((s) => s.type === 'bitable')
                              .map(
                                (s) =>
                                  `${toText(s.appToken).trim()}::${toText(s.tableId).trim()}`,
                              ),
                          );
                          const token = toText(bitableModal.appToken).trim();
                          return (
                            <div className="space-y-1">
                              {bitableModal.tables.map((t) => {
                                const isExisted = existed.has(`${token}::${t.tableId}`);
                                const checked = !!bitableModal.selected[t.tableId];
                                return (
                                  <label
                                    key={t.tableId}
                                    className={
                                      'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer ' +
                                      (isExisted
                                        ? 'bg-slate-50 text-slate-400'
                                        : 'hover:bg-slate-50')
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isExisted || checked}
                                      disabled={isExisted}
                                      onChange={() => onToggleBitableTable(t.tableId)}
                                    />
                                    <span className="flex-1 truncate">{t.name}</span>
                                    <span className="text-xs font-mono text-slate-400">
                                      {t.tableId}
                                    </span>
                                    {isExisted ? (
                                      <span className="text-xs text-slate-400">已绑定</span>
                                    ) : null}
                                  </label>
                                );
                              })}
                            </div>
                          );
                        })()
                      )}
                    </div>
                    <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
                      <button
                        onClick={onCloseBitableModal}
                        className="px-4 py-1.5 border border-slate-300 text-slate-700 text-sm rounded"
                      >
                        取消
                      </button>
                      <button
                        onClick={onConfirmBitableModal}
                        disabled={Object.values(bitableModal.selected).every((v) => !v)}
                        className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300"
                      >
                        添加 {Object.values(bitableModal.selected).filter(Boolean).length} 张表
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              </>
            );
          })()
        ) : null}

        {/* 平台AI配置 | @keyword-en platform info management */}
        {activeTab === 'platform_info' ? (
          <div className="grid lg:grid-cols-1 gap-4 pb-8">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">平台AI补充说明</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    此处的配置将作为AI补充提示，在所有LLM调用时自动注入，让AI更好地适应本平台的使用习惯。
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onSubmitPlatformInfo().catch((err) => setError(err.message))}
                    className="px-4 py-2 bg-slate-900 text-white text-sm rounded"
                  >
                    保存配置
                  </button>
                </div>
              </div>
              {/* Markdown编辑器区域 | @keyword-en markdown editor area */}
              <div className="w-full" data-color-mode="light">
                {/* AI封面开关区域 | @keyword-en ai cover toggle area */}
                <div className="mb-3 rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">是否开启AI封面</div>
                    <div className="text-xs text-slate-500 mt-1">开启后，生成图文/图组时会优先走生图模型生成封面并入图库。</div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(forms.platformInfo.enableAiCover)}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          platformInfo: {
                            ...prev.platformInfo,
                            enableAiCover: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>{forms.platformInfo.enableAiCover ? '已开启' : '已关闭'}</span>
                  </label>
                </div>
                <MDEditor
                  height={500}
                  value={forms.platformInfo.aiPromptSupplement}
                  onChange={(val) =>
                    setForms((prev) => ({
                      ...prev,
                      platformInfo: {
                        ...prev.platformInfo,
                        aiPromptSupplement: val || '',
                      },
                    }))
                  }
                  preview="edit"
                  textareaProps={{
                    placeholder: '# 平台AI补充说明\n\n在这里填写适合本平台的AI使用习惯和补充提示，支持Markdown格式：\n\n- 使用简洁的中文回复\n- 适当使用Emoji增加可读性\n- ...',
                  }}
                />
              </div>
              {platformInfo?.updatedAt ? (
                <div className="text-xs text-slate-400">
                  上次更新：{new Date(platformInfo.updatedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AdminApp;
