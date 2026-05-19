
// Auto-detect: Astro dev (4322) → NestJS (3011), production → same origin
const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * @description 读取登录Token并转请求头
 * @keyword-en build auth headers
 * @returns {Record<string, string>}
 */
const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * @description Chat Service for AiCommander
 * @keyword-en ChatService
 */
export const chatService = {
  /**
   * Create a new chat session
   * @returns {Promise<{sessionId: string}>}
   */
  async createSession(options = {}) {
    try {
      const res = await fetch(`${API_BASE}/chat/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          sessionType: options.sessionType || 'default',
        }),
      });
      return await res.json();
    } catch {
      return { sessionId: 'local-' + Date.now() };
    }
  },

  /**
   * Send a message via stream
   * @param {string} sessionId 
   * @param {string} input 
   * @returns {Promise<Response>}
   */
  async streamChatPost(sessionId, input, options = {}) {
    const payload = {
      sessionId,
      input,
      sessionType: options.sessionType || 'default',
    };
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        detail = '';
      }
      throw new Error(
        `STREAM_HTTP_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }
    return res;
  },

  /**
   * Fetch chat history
   * @param {string} sessionId 
   * @returns {Promise<Array>}
   */
  async fetchHistory(sessionId, options = {}) {
    try {
      // Use the chat messages endpoint for full history
      const type = options.sessionType || 'default';
      const res = await fetch(
        `${API_BASE}/chat/messages/${sessionId}?sessionType=${encodeURIComponent(type)}`,
        {
        headers: getAuthHeaders(),
        },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch {
      return [];
    }
  },

  async listDecisionCards(sessionId) {
    try {
      const path =
        typeof sessionId === 'string' && sessionId.trim().length > 0
          ? `/decision-cards/session/${sessionId}`
          : '/decision-cards';
      const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
      if (!res.ok) return { cards: [] };
      return await res.json();
    } catch {
      return { cards: [] };
    }
  },

  async applyDecisionCard(cardId) {
    if (!cardId) return { success: false };
    try {
      const res = await fetch(`${API_BASE}/decision-cards/${cardId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch {
      return { success: false };
    }
  },

  /**
   * @description 获取图库标签列表（供 tag-select 弹窗联想搜索使用）
   * @keyword-en list gallery tags for tag-select autocomplete
   */
  async listGalleryTags({ userId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', String(userId));
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/tags${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { tags: [] };
      return await res.json();
    } catch {
      return { tags: [] };
    }
  },

  async getDecisionCard(cardId) {
    if (!cardId) return { card: null };
    try {
      const res = await fetch(`${API_BASE}/decision-cards/${cardId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { card: null };
      return await res.json();
    } catch {
      return { card: null };
    }
  },

  async getCanvas(canvasId) {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return { canvas: null };
    try {
      const res = await fetch(`${API_BASE}/canvas/${cid}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * 查询 Canvas 列表
   * @param {{ type?: 'article'|'image-group', limit?: number, skip?: number, tag?: string }} opts
   * @returns {Promise<{ canvases: object[] }>}
   */
  async listCanvases(opts = {}) {
    try {
      const params = new URLSearchParams({ limit: String(opts.limit ?? 50) });
      if (opts.type) params.set('type', opts.type);
      if (opts.skip) params.set('skip', String(opts.skip));
      if (opts.tag) params.set('tag', opts.tag);
      const res = await fetch(`${API_BASE}/canvas?${params}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { canvases: [] };
      return await res.json();
    } catch {
      return { canvases: [] };
    }
  },

  /**
   * 创建图片组 Canvas（返回 generating 状态，后台异步生成）
   * @param {{ topic?: string, articles: Array<{title: string, tags: string[]}> }} input
   * @returns {Promise<{canvas: object|null}>}
   */
  async createImageGroupCanvas(input) {
    try {
      const res = await fetch(`${API_BASE}/canvas/image-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * 删除整个 Canvas
   * @param {number} canvasId
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteCanvas(canvasId) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { deleted: false };
      return await res.json();
    } catch {
      return { deleted: false };
    }
  },

  /**
   * 删除 Canvas 中的文章
   * @param {number} canvasId
   * @param {number} articleId
   * @returns {Promise<{canvas: object|null}>}
   */
  async deleteCanvasArticle(canvasId, articleId) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/articles/${articleId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * 更新 Canvas 文章内容
   * @param {number} canvasId
   * @param {number} articleId
   * @param {{ title?: string, tags?: string[], contentJson?: object }} patch
   * @returns {Promise<{canvas: object|null}>}
   */
  async updateCanvasArticle(canvasId, articleId, patch) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * 删除图片组中的图片
   * @param {number} canvasId
   * @param {number} groupId
   * @param {number} imageId
   * @returns {Promise<{canvas: object|null}>}
   */
  async deleteCanvasGroupImage(canvasId, groupId, imageId) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/images/${imageId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  // --- Remote Session Management ---

  /**
   * Get all chat sessions from backend
   * @returns {Promise<Array<{sessionId: string, title: string, timestamp: number}>>}
   */
  async getSessions(options = {}) {
    try {
      const type = options.sessionType || 'default';
      const res = await fetch(`${API_BASE}/context/list?sessionType=${encodeURIComponent(type)}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      // Map backend fields to frontend expected format if necessary
      // Backend: { sessionId, title, createdAt, updatedAt }
      // Frontend expects: { sessionId, title, timestamp }
      return data.map(item => ({
        sessionId: item.sessionId,
        title: item.title || '未命名会话',
        timestamp: new Date(item.updatedAt || item.createdAt).getTime()
      }));
    } catch (e) {
      console.error('Failed to fetch sessions', e);
      return [];
    }
  },

  /**
   * Save session is handled by backend automatically when messages are sent.
   * This method is kept for compatibility but does nothing locally.
   */
  async saveSession(sessionId, title) {
    // Optional: Implement title update API if backend supports it
    // await fetch(`${API_BASE}/chat/session/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  },

  updateSessionTitle(sessionId, title) {
    // Optional: Implement title update API if backend supports it
  }
};
