import React, { useEffect, useMemo, useState } from 'react';
import { adminApi, clearAdminToken, resolveAdminPageHref } from './adminApi';

const PAGE_SIZE = 6;

const toText = (value) => (typeof value === 'string' ? value : '');

const toLower = (value) => toText(value).toLowerCase();

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

const getRoleLabel = (role) => {
  const match = ROLE_OPTIONS.find((item) => item.value === role);
  return match?.label || role || '';
};

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

const AdminApp = () => {
  const tabs = useMemo(
    () => [
      { id: 'users', label: '用户管理' },
      { id: 'providers', label: 'Ai提供商设置' },
      { id: 'tenants', label: '租户管理' },
      { id: 'keys', label: 'key管理' },
      { id: 'sources', label: '数据源管理' },
    ],
    [],
  );

  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [keys, setKeys] = useState([]);
  const [sources, setSources] = useState([]);
  const [editingUserId, setEditingUserId] = useState('');
  const [editingProviderId, setEditingProviderId] = useState('');
  const [editingTenantId, setEditingTenantId] = useState('');
  const [editingKeyId, setEditingKeyId] = useState('');
  const [editingSourceCode, setEditingSourceCode] = useState('');
  const [filters, setFilters] = useState({
    users: { keyword: '', tenantId: '' },
    providers: { keyword: '', tenantId: '' },
    tenants: { keyword: '' },
    keys: { keyword: '', tenantId: '' },
    sources: { keyword: '', status: '' },
  });
  const [pages, setPages] = useState({
    users: 1,
    providers: 1,
    tenants: 1,
    keys: 1,
    sources: 1,
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
      model: '',
      apiKey: '',
      tenantId: '',
      enabled: true,
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
  });

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const meRes = await adminApi.me();
      setMe(meRes);
      const [u, p, t, k, s] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listProviders(),
        adminApi.listTenants(),
        adminApi.listKeys(),
        adminApi.listDataSources(),
      ]);
      const tenantRows = t.tenants || [];
      setUsers(u.users || []);
      setProviders(p.providers || []);
      setTenants(tenantRows);
      setKeys(k.keys || []);
      setSources(s.sources || []);
      if (tenantRows.length > 0) {
        setForms((prev) => ({
          ...prev,
          key: {
            ...prev.key,
            tenantId: prev.key.tenantId || tenantRows[0]._id,
          },
        }));
      }
    } catch {
      clearAdminToken();
      window.location.href = resolveAdminPageHref('login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

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

  const onLogout = async () => {
    try {
      await adminApi.logout();
    } catch {
      undefined;
    }
    clearAdminToken();
    window.location.href = resolveAdminPageHref('login');
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
      model: forms.provider.model.trim() || undefined,
      apiKey: forms.provider.apiKey.trim(),
      tenantId: forms.provider.tenantId || undefined,
      enabled: forms.provider.enabled,
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
    const hitTenant =
      !filters.providers.tenantId ||
      toText(item.tenantId) === filters.providers.tenantId;
    return hitKeyword && hitTenant;
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

  const pagedUsers = buildPagedRows(filteredUsers, pages.users);
  const pagedProviders = buildPagedRows(filteredProviders, pages.providers);
  const pagedTenants = buildPagedRows(filteredTenants, pages.tenants);
  const pagedKeys = buildPagedRows(filteredKeys, pages.keys);
  const pagedSources = buildPagedRows(filteredSources, pages.sources);

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
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入提供商编码（如openai）" value={forms.provider.providerCode} onChange={(e) => updateForm('provider', 'providerCode', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入提供商名称" value={forms.provider.name} onChange={(e) => updateForm('provider', 'name', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入服务地址（可选）" value={forms.provider.baseUrl} onChange={(e) => updateForm('provider', 'baseUrl', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入默认模型（可选）" value={forms.provider.model} onChange={(e) => updateForm('provider', 'model', e.target.value)} />
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="请输入API Key" value={forms.provider.apiKey} onChange={(e) => updateForm('provider', 'apiKey', e.target.value)} />
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.tenantId} onChange={(e) => updateForm('provider', 'tenantId', e.target.value)}>
                <option value="">不绑定租户（平台级）</option>
                {tenants.map((tenant) => (
                  <option key={tenant._id} value={tenant._id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <select className="w-full border rounded px-3 py-2 text-sm" value={forms.provider.enabled ? '1' : '0'} onChange={(e) => updateForm('provider', 'enabled', e.target.value === '1')}>
                <option value="1">启用</option>
                <option value="0">禁用</option>
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
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input className="border rounded px-3 py-2 text-sm" placeholder="按编码或名称搜索" value={filters.providers.keyword} onChange={(e) => updateFilter('providers', 'keyword', e.target.value)} />
                <select className="border rounded px-3 py-2 text-sm" value={filters.providers.tenantId} onChange={(e) => updateFilter('providers', 'tenantId', e.target.value)}>
                  <option value="">全部租户</option>
                  {tenants.map((tenant) => (
                    <option key={tenant._id} value={tenant._id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 text-sm">
                {pagedProviders.rows.map((item) => (
                  <div key={item._id} className="border rounded-lg p-3 flex justify-between">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-slate-500">{item.providerCode}</div>
                      <div className="text-xs text-slate-500">{item.tenantId || '平台级(空租户)'}</div>
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
                            model: item.model || '',
                            apiKey: item.apiKey || '',
                            tenantId: item.tenantId || '',
                            enabled: Boolean(item.enabled),
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
      </div>
    </div>
  );
};

export default AdminApp;
