
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

  /**
   * @description 鑾峰彇鍥惧簱鍥剧墖锛堜緵 Canvas 灏侀潰閲嶇敓鎴愬弬鑰冨浘閫夋嫨锛?   * @keyword-cn 封面重生成, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  async listGalleryImages({ userId, groupId, tag, includeCollage, imageType, cursorId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', String(userId));
      if (groupId !== undefined && groupId !== null && `${groupId}` !== '') {
        params.set('groupId', String(groupId));
      }
      if (tag) params.set('tag', String(tag));
      if (imageType) {
        params.set('imageType', String(imageType));
      } else if (typeof includeCollage === 'boolean') {
        params.set('includeCollage', includeCollage ? 'true' : 'false');
      }
      if (cursorId !== undefined && cursorId !== null && `${cursorId}` !== '') {
        params.set('cursorId', String(cursorId));
      }
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { images: [] };
      return await res.json();
    } catch {
      return { images: [] };
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
   * @description 触发图文 Canvas 指定文章封面重生成，仅替换首图。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en article-cover-only
   */
  async regenerateCanvasArticleCover(canvasId, articleId, payload) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/articles/${articleId}/cover/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 直接使用图库图片设为图文 Canvas 单篇文章封面。
   * @keyword-cn 直接设为封面, 图片选择
   * @keyword-en cover-select
   * @keyword-en article-cover-only
   */
  async selectCanvasArticleCover(canvasId, articleId, payload) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/articles/${articleId}/cover/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 触发图片组 Canvas 指定图组封面重生成，仅替换 role=cover 图片。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  async regenerateCanvasImageGroupCover(canvasId, groupId, payload) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/cover/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 直接使用图库图片设为图组 Canvas 指定图组封面。
   * @keyword-cn 直接设为封面, 图片选择
   * @keyword-en cover-select
   * @keyword-en image-group-cover-only
   */
  async selectCanvasImageGroupCover(canvasId, groupId, payload) {
    try {
      const res = await fetch(`${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/cover/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload ?? {}),
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
   * @keyword-en delete-canvas-group-image
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
