const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4322'
    ? 'http://localhost:3011'
    : typeof window !== 'undefined'
      ? window.location.origin
      : '';

const TOKEN_KEY = 'admin_token';

/**
 * @description 读取后台token
 * @keyword-en get admin token
 */
export function getAdminToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

/**
 * @description 写入后台token
 * @keyword-en set admin token
 */
export function setAdminToken(token) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

/**
 * @description 清理后台token
 * @keyword-en clear admin token
 */
export function clearAdminToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * @description 解析后台页面跳转路径
 * @keyword-en resolve admin page href
 */
export function resolveAdminPageHref(pageName) {
  if (typeof window === 'undefined') return `/pages/${pageName}.html`;
  const currentPath = window.location.pathname || '';
  if (currentPath.startsWith('/pages/')) {
    return `./${pageName}.html`;
  }
  return `/pages/${pageName}.html`;
}

/**
 * @description 解析前台页面跳转路径
 * @keyword-en resolve frontend page href
 */
export function resolveFrontendPageHref(pageName = 'ai-commander') {
  if (typeof window === 'undefined') return `/pages/${pageName}.html`;
  const currentPath = window.location.pathname || '';
  if (currentPath.startsWith('/pages/')) {
    return `./${pageName}.html`;
  }
  return `/pages/${pageName}.html`;
}

/**
 * @description 解析登录页面地址并附带来源参数
 * @keyword-en resolve login page href with source
 */
export function resolveLoginPageHref(options = {}) {
  const base = resolveAdminPageHref('login');
  const params = new URLSearchParams();
  if (typeof options.from === 'string' && options.from.trim()) {
    params.set('from', options.from.trim());
  }
  if (typeof options.next === 'string' && options.next.trim()) {
    params.set('next', options.next.trim());
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * @description 后台API请求
 * @keyword-en admin api request
 */
async function request(path, options = {}) {
  const token = getAdminToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/admin${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let message = `请求失败(${res.status})`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      message = `请求失败(${res.status})`;
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * @description 后台管理API封装
 * @keyword-en admin api service
 */
export const adminApi = {
  async login(username, password, tenantId = '') {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        tenantId: tenantId || undefined,
      }),
    });
  },
  async listLoginTenants() {
    return request('/auth/tenants');
  },
  async me() {
    return request('/auth/me');
  },
  async logout() {
    return request('/auth/logout', { method: 'POST' });
  },
  async listUsers() {
    return request('/users');
  },
  async createUser(payload) {
    return request('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateUser(id, payload) {
    return request(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteUser(id) {
    return request(`/users/${id}`, {
      method: 'DELETE',
    });
  },
  async listProviders() {
    return request('/ai-providers');
  },
  async saveProvider(payload) {
    return request('/ai-providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateProvider(id, payload) {
    return request(`/ai-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteProvider(id) {
    return request(`/ai-providers/${id}`, {
      method: 'DELETE',
    });
  },
  async listTenants() {
    return request('/tenants');
  },
  async createTenant(payload) {
    return request('/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateTenant(id, payload) {
    return request(`/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteTenant(id) {
    return request(`/tenants/${id}`, {
      method: 'DELETE',
    });
  },
  async listKeys(tenantId = '') {
    const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    return request(`/keys${query}`);
  },
  async createKey(payload) {
    return request('/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async revokeKey(id) {
    return request(`/keys/${id}/revoke`, { method: 'POST' });
  },
  async updateKey(id, payload) {
    return request(`/keys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteKey(id) {
    return request(`/keys/${id}`, {
      method: 'DELETE',
    });
  },
  async listDataSources() {
    return request('/data-sources');
  },
  async createDataSource(payload) {
    return request('/data-sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateDataSource(code, payload) {
    return request(`/data-sources/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteDataSource(code) {
    return request(`/data-sources/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 列出看板配置映射
   * @keyword-en list dashboard config mappings
   */
  async listDashboardConfigMappings() {
    return request('/dashboard-config/mappings');
  },

  /**
   * @description Upsert 看板配置映射
   * @keyword-en upsert dashboard config mapping
   */
  async upsertDashboardConfigMapping(payload) {
    return request('/dashboard-config/mappings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除看板配置映射
   * @keyword-en delete dashboard config mapping
   */
  async deleteDashboardConfigMapping(id) {
    return request(`/dashboard-config/mappings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 清除 AI 修改的 customConfig，回退到文件配置
   * @keyword-en reset dashboard custom config to file
   */
  async resetDashboardCustomConfig(dashboardCode) {
    return request('/dashboard-config/reset-custom', {
      method: 'POST',
      body: JSON.stringify({ dashboardCode }),
    });
  },

  /**
   * @description 获取平台信息（AI补充说明）
   * @keyword-en get platform info
   */
  async getPlatformInfo() {
    return request('/platform-info');
  },

  /**
   * @description 更新平台信息（AI补充说明）
   * @keyword-en upsert platform info
   */
  async upsertPlatformInfo(aiPromptSupplement, enableAiCover = false) {
    return request('/platform-info', {
      method: 'PUT',
      body: JSON.stringify({ aiPromptSupplement, enableAiCover }),
    });
  },

  // ─── Claw 管理 ───────────────────────────────────────────────────────────────

  /**
   * @description 获取 Claw 配置列表
   * @keyword-en list claw configs
   */
  async listClawConfigs() {
    return request('/claw-configs');
  },

  /**
   * @description 创建 Claw 配置
   * @keyword-en create claw config
   */
  async createClawConfig(payload) {
    return request('/claw-configs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 更新 Claw 配置
   * @keyword-en update claw config
   */
  async updateClawConfig(id, payload) {
    return request(`/claw-configs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除 Claw 配置
   * @keyword-en delete claw config
   */
  async deleteClawConfig(id) {
    return request(`/claw-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 测试 Claw 连通性
   * @keyword-en ping claw config, test connectivity
   */
  async pingClawConfig(id) {
    return request(`/claw-configs/${encodeURIComponent(id)}/ping`, {
      method: 'POST',
    });
  },

  // ─── Agent 管理 ──────────────────────────────────────────────────────────────

  /**
   * @description 获取 Agent 配置列表
   * @keyword-en list agent configs
   */
  async listAgentConfigs() {
    return request('/agent-configs');
  },

  /**
   * @description 创建 Agent 配置
   * @keyword-en create agent config
   */
  async createAgentConfig(payload) {
    return request('/agent-configs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 更新 Agent 配置
   * @keyword-en update agent config
   */
  async updateAgentConfig(id, payload) {
    return request(`/agent-configs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除 Agent 配置
   * @keyword-en delete agent config
   */
  async deleteAgentConfig(id) {
    return request(`/agent-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ─── 自媒体账号管理 ─────────────────────────────────────────────────────────

  /**
   * @description 获取自媒体账号列表（按平台过滤）
   * @keyword-en list social accounts by platform
   */
  async listXhsAccounts() {
    return request('/social-accounts?platform=xhs');
  },

  /**
   * @description 创建自媒体账号
   * @keyword-en create social account
   */
  async createXhsAccount(payload) {
    return request('/social-accounts', {
      method: 'POST',
      body: JSON.stringify({ platform: 'xhs', ...payload }),
    });
  },

  /**
   * @description 更新自媒体账号
   * @keyword-en update social account
   */
  async updateXhsAccount(id, payload) {
    return request(`/social-accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除自媒体账号
   * @keyword-en delete social account
   */
  async deleteXhsAccount(id) {
    return request(`/social-accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 测试登录自媒体账号（触发 Claw 登录）
   * @keyword-en test login social account via claw
   */
  async testLoginXhsAccount(id) {
    return request(`/social-accounts/${encodeURIComponent(id)}/test-login`, {
      method: 'POST',
    });
  },
};
