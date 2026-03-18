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
};
