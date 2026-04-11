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

/**
 * @description 全量 Tab 定义（含平台限定标记）
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
  { id: 'dashboard_configs', label: '看板配置' },
  { id: 'platform_info', label: '平台AI配置' },
];

const AdminApp = () => {
  const [currentRole, setCurrentRole] = useState('');
  const tabs = useMemo(
    () => ALL_TABS.filter((t) => !t.platformOnly || isSuperAdmin(currentRole)),
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
  const [editingUserId, setEditingUserId] = useState('');
  const [editingProviderId, setEditingProviderId] = useState('');
  const [editingTenantId, setEditingTenantId] = useState('');
  const [editingKeyId, setEditingKeyId] = useState('');
  const [editingSourceCode, setEditingSourceCode] = useState('');
  const [editingDashboardConfigId, setEditingDashboardConfigId] = useState('');
  const [editingClawConfigId, setEditingClawConfigId] = useState('');
  const [pingLoadingId, setPingLoadingId] = useState('');
  const [editingAgentConfigId, setEditingAgentConfigId] = useState('');
  const [filters, setFilters] = useState({
    users: { keyword: '', tenantId: '' },
    providers: { keyword: '' },
    tenants: { keyword: '' },
    keys: { keyword: '', tenantId: '' },
    sources: { keyword: '', status: '' },
    dashboardConfigs: { keyword: '', tenantId: '' },
    clawConfigs: { keyword: '' },
    agentConfigs: { keyword: '' },
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
