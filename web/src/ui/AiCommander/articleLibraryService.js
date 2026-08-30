// 与 chatService 一致的环境探测
const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * @description 构建登录态请求头
 * @keyword-en build auth headers for article library
 * @returns {Record<string, string>}
 */
const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * @description 封装 fetch 的 JSON 请求，统一错误处理
 * @keyword-en json request with auth
 * @param {string} path 相对路径
 * @param {object} [options] fetch options
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
const request = async (path, options = {}) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
    });
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: e?.message || 'NETWORK_ERROR' } };
  }
};

/** @type {Record<string, string>} 后端建库错误码 → 可读提示。 */
const LIBRARY_ERROR_TEXT = {
  SUPER_CLAW_NOT_CONFIGURED: '后台还没有配置 SuperClaw 节点',
  SUPER_CLAW_OFFLINE: 'SuperClaw 节点全部离线，请先让节点连上再建库',
  SUPER_CLAW_CAPACITY_EXCEEDED: 'SuperClaw 节点工作区槽位已满，请扩容或清理闲置工作区',
  SUPER_CLAW_NOT_FOUND: '租户绑定的 SuperClaw 节点已不存在，请重新分配节点',
  TENANT_SUPER_CLAW_REQUIRED: '当前租户还没有绑定 SuperClaw 节点',
  WORKSPACE_NAME_ALREADY_EXISTS: '同名工作区已存在，换个文章库名称再试',
  NAME_REQUIRED: '请输入文章库名称',
};

/**
 * @description 把后端返回的错误码翻译成可读文案，未知错误码原样附在后面便于排查。
 * @keyword-en describe library error code
 * @keyword-cn 文章库错误码文案
 * @param {any} res 请求返回体，失败时形如 { message: 'SUPER_CLAW_OFFLINE' }
 * @param {string} fallback 兜底文案
 * @returns {string}
 */
export const describeLibraryError = (res, fallback) => {
  const raw = Array.isArray(res?.message) ? res.message[0] : res?.message;
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) return fallback;
  return LIBRARY_ERROR_TEXT[code]
    ? `${fallback}：${LIBRARY_ERROR_TEXT[code]}`
    : `${fallback}（${code}）`;
};

/**
 * @description 文章库前端 API Client
 * @keyword-en article library frontend api client crud lease
 */
export const articleLibraryService = {
  /**
   * @description 列出文章库（含统计和缩略图）
   * @keyword-en list libraries with stats thumbnails
   */
  async listLibraries({ type, limit, offset } = {}) {
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (limit != null) q.set('limit', String(limit));
    if (offset != null) q.set('offset', String(offset));
    const qs = q.toString();
    const { ok, data } = await request(`/api/article-library${qs ? `?${qs}` : ''}`);
    return ok ? data : { items: [], total: 0 };
  },

  /**
   * @description 获取单个文章库详情
   * @keyword-en get library detail
   */
  async getLibrary(libraryId) {
    const { ok, data } = await request(`/api/article-library/${libraryId}`);
    return ok ? data : null;
  },

  /**
   * @description 获取文章库二维码内容
   * @keyword-en get article library qr payload
   */
  async getPushQr(libraryId) {
    const { ok, data } = await request(`/api/article-library/${libraryId}/push-qr`);
    return ok ? data : null;
  },

  /**
   * @description 创建文章库
   * @keyword-en create library
   */
  async createLibrary({ name, type, pushConfig }) {
    const { ok, data } = await request(`/api/article-library`, {
      method: 'POST',
      body: JSON.stringify({ name, type, pushConfig }),
    });
    // 失败时也把响应体带回去：调用方判空看的是 data.library，错误码留给 describeLibraryError。
    return ok ? data : { ...(data || {}), library: null };
  },

  /**
   * @description 更新文章库（名称/类型/推送配置）
   * @keyword-en update library
   */
  async updateLibrary(libraryId, patch) {
    const { ok, data } = await request(`/api/article-library/${libraryId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });
    return ok ? data : null;
  },

  /**
   * @description 删除文章库（级联删除文章）
   * @keyword-en delete library cascade
   */
  async deleteLibrary(libraryId) {
    const { ok, data } = await request(`/api/article-library/${libraryId}`, {
      method: 'DELETE',
    });
    return ok && data?.ok === true;
  },

  /**
   * @description 列出库下文章
   * @keyword-en list articles in library
   */
  async listArticles(libraryId, { status, limit, offset } = {}) {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (limit != null) q.set('limit', String(limit));
    if (offset != null) q.set('offset', String(offset));
    const qs = q.toString();
    const { ok, data } = await request(
      `/api/article-library/${libraryId}/articles${qs ? `?${qs}` : ''}`,
    );
    return ok ? data : { items: [], total: 0 };
  },

  /**
   * @description 把一批文章存入文章库（单篇或整份 canvas）
   * @keyword-en put articles into library batch
   * @param {number} libraryId
   * @param {Array<{title: string, tags?: string[], contentJson?: object, text?: string, imageUrls?: string[], imageIds?: number[], publishStatus?: 'unpublished'|'published', source?: string, sourceRef?: {canvasId?: number, canvasArticleId?: number}}>} articles
   */
  async putArticles(libraryId, articles) {
    const list = Array.isArray(articles) ? articles : [articles];
    const { ok, data } = await request(`/api/article-library/${libraryId}/articles`, {
      method: 'POST',
      body: JSON.stringify({ articles: list }),
    });
    return ok ? data : null;
  },

  /**
   * @description 更新文章发布状态
   * @keyword-en update article publish status
   */
  async updateArticleStatus(libraryId, articleId, status) {
    const { ok, data } = await request(
      `/api/article-library/${libraryId}/articles/${articleId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    );
    return ok ? data : null;
  },

  /**
   * @description 删除文章
   * @keyword-en delete article
   */
  async deleteArticle(libraryId, articleId) {
    const { ok, data } = await request(
      `/api/article-library/${libraryId}/articles/${articleId}`,
      { method: 'DELETE' },
    );
    return ok && data?.ok === true;
  },

  /**
   * @description 管理端测试：队列领取下一篇
   * @keyword-en admin lease next for test
   */
  async leaseNext(libraryId, statusFilter) {
    const { ok, data } = await request(
      `/api/article-library/${libraryId}/articles/lease-next`,
      { method: 'POST', body: JSON.stringify({ statusFilter }) },
    );
    return ok ? data : null;
  },
};
