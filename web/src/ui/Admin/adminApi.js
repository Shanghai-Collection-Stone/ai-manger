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
 * @description 业务API请求(不带 /admin 前缀,用于后台登录态可直接访问的业务路由)
 * @keyword-cn 业务接口请求, 非admin前缀
 * @keyword-en business api request, non-admin-prefix
 */
async function apiRequest(path, options = {}) {
  const token = getAdminToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
  async testProvider(id) {
    return request(`/ai-providers/${id}/test`, {
      method: 'POST',
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

  // ─── SuperClaw 平台节点 ─────────────────────────────────────────────────────

  /**
   * @description 获取平台 SuperClaw 节点列表
   * @keyword-cn 节点列表, 平台管理
   * @keyword-en super-claw-list, platform-management
   */
  async listSuperClaws() {
    return request('/super-claws');
  },

  /**
   * @description 创建 SuperClaw 并接收一次性明文 Token
   * @keyword-cn 创建节点, 一次性令牌
   * @keyword-en super-claw-create, one-time-token
   */
  async createSuperClaw(payload) {
    return request('/super-claws', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 更新 SuperClaw 基础信息与容量
   * @keyword-cn 更新节点, 容量上限
   * @keyword-en super-claw-update, capacity-limit
   */
  async updateSuperClaw(id, payload) {
    return request(`/super-claws/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除没有租户占用的 SuperClaw
   * @keyword-cn 删除节点, 占用保护
   * @keyword-en super-claw-delete, allocation-guard
   */
  async deleteSuperClaw(id) {
    return request(`/super-claws/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 轮换 SuperClaw 连接 Token
   * @keyword-cn 轮换令牌, 密钥管理
   * @keyword-en super-claw-token-rotate, secret-management
   */
  async rotateSuperClawToken(id) {
    return request(`/super-claws/${encodeURIComponent(id)}/token/rotate`, {
      method: 'POST',
    });
  },

  /**
   * @description 设置租户 SuperClaw 归属并迁移其工作区
   * @keyword-cn 租户节点归属, 工作区迁移
   * @keyword-en tenant-node-assignment, workspace-migration
   */
  async assignTenantSuperClaw(tenantId, payload) {
    return request(
      `/super-claws/tenant-allocations/${encodeURIComponent(tenantId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    );
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

  // ─── 飞书凭证管理 ───────────────────────────────────────────────────────────

  /**
   * @description 列出当前用户可见的飞书凭证
   * @keyword-en list tenant feishu credentials
   */
  async listFeishuCredentials() {
    return request('/tenant-feishu-credentials');
  },

  /**
   * @description Upsert 飞书凭证
   * @keyword-en upsert feishu credential
   */
  async upsertFeishuCredential(payload) {
    return request('/tenant-feishu-credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除飞书凭证
   * @keyword-en delete feishu credential
   */
  async deleteFeishuCredential(id) {
    return request(`/tenant-feishu-credentials/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ─── 小红书采集设置 ─────────────────────────────────────────────────────────

  /**
   * @description 读取小红书采集设置(抓取频率 / 采集渠道 / TikHub 配置视图 / 采集端可用性)
   * @keyword-cn 读取采集设置, 采集渠道
   * @keyword-en get xhs crawl settings, crawl channel
   */
  async getXhsCrawlSettings() {
    return apiRequest('/api/xhs-topic-data/crawl-settings');
  },

  /**
   * @description 保存小红书采集设置;tikhubApiKey 传空串=清空,不传=保持不变
   * @keyword-cn 保存采集设置, 切换渠道
   * @keyword-en save xhs crawl settings, switch channel
   */
  async saveXhsCrawlSettings(payload) {
    return apiRequest('/api/xhs-topic-data/crawl-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 用已保存的 Key 与域名做一次 TikHub 连通性自检
   * @keyword-cn 测试TikHub连接, 密钥自检
   * @keyword-en test tikhub connection, api key probe
   */
  async testTikhubConnection() {
    return apiRequest('/api/xhs-topic-data/crawl-settings/test-tikhub', {
      method: 'POST',
    });
  },

  // ─── 财务配置管理 ───────────────────────────────────────────────────────────

  /**
   * @description 列出财务源绑定(按 name 任意多个)
   * @keyword-en list finance bindings
   */
  async listFinanceBindings() {
    return request('/finance/bindings');
  },

  /**
   * @description Upsert 财务源绑定(name 自定义;改名传 previousName)
   * @keyword-en upsert finance binding by name
   */
  async upsertFinanceBinding(payload) {
    return request('/finance/bindings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除财务源绑定(按 name)
   * @keyword-en delete finance binding by name
   */
  async deleteFinanceBinding(name) {
    return request(`/finance/bindings/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 列出 appToken 下所有飞书多维表(弹窗批量勾选用)
   * @keyword-en list bitable tables under app token
   */
  async listBitableTables(appToken) {
    return request(
      `/finance/bitable-tables?appToken=${encodeURIComponent(appToken)}`,
    );
  },

  /**
   * @description 取当前作用域的推送配置(每作用域一份)
   * @keyword-en get finance push config
   */
  async getFinancePushConfig() {
    return request('/finance/push/config');
  },

  /**
   * @description Upsert 推送配置(每作用域一份,含 webhook 外部租户映射)
   * @keyword-en upsert finance push config
   */
  async upsertFinancePushConfig(payload) {
    return request('/finance/push/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除推送配置
   * @keyword-en delete finance push config
   */
  async deleteFinancePushConfig() {
    return request('/finance/push/config', { method: 'DELETE' });
  },

  /**
   * @description 测试推送 key 有效性(GET /api/v1/me)
   * @keyword-en test finance push connectivity
   */
  async testFinancePush() {
    return request('/finance/push/test', { method: 'POST' });
  },

  /**
   * @description 按 binding name 立即执行推送(SSE 流式;每条 log 实时回调 onLog;结束时 onResult 或 onError;最终 onEnd)
   * @keyword-en run finance push as SSE stream with live log callbacks
   */
  async runFinancePushStream(name, opts = {}, callbacks = {}) {
    const body = {};
    if (opts && typeof opts.startDate === 'string' && opts.startDate.trim()) {
      body.startDate = opts.startDate.trim();
    }
    if (opts && typeof opts.endDate === 'string' && opts.endDate.trim()) {
      body.endDate = opts.endDate.trim();
    }
    const token = getAdminToken();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `${API_BASE}/admin/finance/push/run/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts?.signal,
      },
    );
    if (!res.ok || !res.body) {
      let message = `请求失败(${res.status})`;
      try {
        const data = await res.json();
        message = data.message || data.error || message;
      } catch {
        // ignore json parse error
      }
      throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    /**
     * @description 分发财务 Agent SSE 事件到对应回调
     * @keyword-en finance-push-sse-dispatch, sse-event
     */
    const dispatch = (event, dataRaw) => {
      let payload = dataRaw;
      try {
        payload = JSON.parse(dataRaw);
      } catch {
        // 兼容空 data
      }
      if (event === 'log' && typeof callbacks.onLog === 'function') {
        callbacks.onLog(payload);
      } else if (
        event === 'result' &&
        typeof callbacks.onResult === 'function'
      ) {
        callbacks.onResult(payload);
      } else if (event === 'error' && typeof callbacks.onError === 'function') {
        callbacks.onError(payload);
      } else if (event === 'end' && typeof callbacks.onEnd === 'function') {
        callbacks.onEnd(payload);
      }
    };
    // SSE 帧:`event: NAME\ndata: JSON\n\n`;以空行分割,逐帧解析
    /**
     * @description 解析财务 Agent SSE 文本帧
     * @keyword-en finance-push-sse-parse, sse-frame
     */
    const parseChunk = () => {
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = 'message';
        const dataLines = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        dispatch(event, dataLines.join('\n'));
      }
    };
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        parseChunk();
      }
      buffer += decoder.decode();
      parseChunk();
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // ignore
      }
    }
  },

  /**
   * @description 透传外部财务系统门店列表(供前端选 storeId)
   * @keyword-en list external stores
   */
  async listExternalStores() {
    return request('/finance/push/external/stores');
  },

  /**
   * @description 透传外部财务系统公司列表(供前端选 companyId)
   * @keyword-en list external companies
   */
  async listExternalCompanies() {
    return request('/finance/push/external/companies');
  },

  /**
   * @description 列出财务 transform DSL
   * @keyword-en list finance transforms
   */
  async listFinanceTransforms() {
    return request('/finance/transforms');
  },

  /**
   * @description Upsert 财务 transform DSL(按 name;改名传 previousName)
   * @keyword-en upsert finance transform by name
   */
  async upsertFinanceTransform(payload) {
    return request('/finance/transforms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 删除财务 transform DSL(按 name)
   * @keyword-en delete finance transform by name
   */
  async deleteFinanceTransform(name) {
    return request(`/finance/transforms/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  /**
   * @description 财务 Agent 同步聊天(传 name + 完整历史 messages,返回最终 reply)
   * @keyword-en finance agent chat
   */
  async chatFinanceAgent(payload) {
    return request('/finance/agent/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * @description 财务 Agent 流式聊天(SSE;实时回调 token 与 tool 调用事件)
   * @keyword-en finance-agent-chat-stream, sse-chat
   */
  async chatFinanceAgentStream(payload, callbacks = {}) {
    const { signal, ...bodyPayload } =
      payload && typeof payload === 'object' ? payload : {};
    const token = getAdminToken();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/admin/finance/agent/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    });
    if (!res.ok || !res.body) {
      let message = `请求失败(${res.status})`;
      try {
        const data = await res.json();
        message = data.message || data.error || message;
      } catch {
        // ignore json parse error
      }
      throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    /**
     * @description 分发财务 Agent SSE 事件到对应回调
     * @keyword-en finance-agent-sse-dispatch, sse-event
     */
    const dispatch = (event, dataRaw) => {
      let payloadData = dataRaw;
      try {
        payloadData = JSON.parse(dataRaw);
      } catch {
        // 兼容空 data
      }
      if (typeof callbacks.onEvent === 'function') {
        callbacks.onEvent(event, payloadData);
      }
      const handlerMap = {
        start: callbacks.onStart,
        token: callbacks.onToken,
        tool_narration: callbacks.onToolNarration,
        reasoning: callbacks.onReasoning,
        tool_start: callbacks.onToolStart,
        tool_chunk: callbacks.onToolChunk,
        tool_end: callbacks.onToolEnd,
        subagent: callbacks.onSubagent,
        end: callbacks.onEnd,
        error: callbacks.onError,
      };
      const handler = handlerMap[event];
      if (typeof handler === 'function') handler(payloadData);
    };
    /**
     * @description 解析财务 Agent SSE 文本帧
     * @keyword-en finance-agent-sse-parse, sse-frame
     */
    const parseChunk = () => {
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = 'message';
        const dataLines = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        dispatch(event, dataLines.join('\n'));
      }
    };
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        parseChunk();
      }
      buffer += decoder.decode();
      parseChunk();
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // ignore
      }
    }
  },
};
