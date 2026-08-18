// Auto-detect: Astro dev (4322) → NestJS (3011), production → same origin
const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4322'
    ? 'http://localhost:3011'
    : typeof window !== 'undefined'
      ? window.location.origin
      : '';
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
      const res = await fetch(`${API_BASE}${path}`, {
        headers: getAuthHeaders(),
      });
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
  async listGalleryImages({
    userId,
    groupId,
    tag,
    includeCollage,
    imageType,
    cursorId,
    limit,
  } = {}) {
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

  /**
   * @description 上传本地素材图片到图库，走 gallery/upload 的 multipart 接口，返回入库记录。
   * @keyword-cn 素材上传
   * @keyword-en material-upload
   * @param {{ files: File[], tags?: string[] }} input - 待上传文件与标签。
   * @returns {Promise<{ images: object[] }>} 入库后的图片列表。
   */
  async uploadGalleryImages({ files, tags } = {}) {
    const list = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!list.length) return { images: [] };
    const form = new FormData();
    list.forEach((file) => form.append('files', file));
    if (Array.isArray(tags) && tags.length) form.append('tags', tags.join(','));
    const res = await fetch(`${API_BASE}/gallery/upload`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(`UPLOAD_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 让 AI 生成一张贴纸素材并入图库，服务端会强制纯色背景便于前端 GPU 去底。
   * @keyword-cn AI素材生成
   * @keyword-en ai-material-generate
   * @param {{ prompt: string, size?: string, tags?: string[], referenceImageUrl?: string }} input - 生成参数；参考图只用于视觉风格。
   * @returns {Promise<{ image: object }>} 入库后的素材记录。
   */
  async generateAiMaterial({ prompt, size, tags, referenceImageUrl } = {}) {
    const res = await fetch(`${API_BASE}/gallery/ai-material`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        prompt,
        size,
        tags: Array.isArray(tags) ? tags.join(',') : undefined,
        referenceImageUrl,
      }),
    });
    if (!res.ok) throw new Error(`AI_MATERIAL_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 通过后端选题 Agent 生成母选题或子选题，结果由 Todo taskResult 持久化后返回。
   * @keyword-cn AI选题生成, 待办结果
   * @keyword-en xhs-topic-generation, todo-result
   * @param {{ kind: 'mother'|'child', prompt?: string, parentTopic?: string, count?: number, useSearch?: boolean }} input - 选题生成参数。
   * @returns {Promise<{ todo: object }>} taskResult 中包含候选结果的 Todo。
   */
  async generateXhsTopicCandidates({
    kind,
    prompt,
    parentTopic,
    count,
    useSearch,
  } = {}) {
    const res = await fetch(`${API_BASE}/api/xhs-topic/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ kind, prompt, parentTopic, count, useSearch }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        detail = '';
      }
      throw new Error(
        `XHS_TOPIC_GENERATION_FAILED_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }
    return await res.json();
  },

  /**
   * @description 根据当前母题请求 AI 推荐一条可编辑的子选题生成提示词。
   * @keyword-cn 子选题提示词推荐, 母题上下文
   * @keyword-en child-topic-prompt-recommendation, parent-topic-context
   * @param {string} parentTopic - 当前母题标题。
   * @returns {Promise<{ prompt: string }>} 推荐提示词。
   */
  async recommendXhsChildTopicPrompt(parentTopic) {
    const res = await fetch(`${API_BASE}/api/xhs-topic/prompt/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ parentTopic }),
    });
    if (!res.ok) {
      throw new Error(`XHS_TOPIC_PROMPT_RECOMMEND_FAILED_${res.status}`);
    }
    return await res.json();
  },

  /**
   * @description 读取当前用户已持久化的真实母选题和子选题工作台数据。
   * @keyword-cn 真实选题列表, 数据库存储
   * @keyword-en persisted-topic-list, database-storage
   * @returns {Promise<{ groups: object[] }>} 母子选题聚合列表。
   */
  async listXhsTopics() {
    const res = await fetch(`${API_BASE}/api/xhs-topic`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`XHS_TOPIC_LIST_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 批量保存用户从 AI 候选中确认的母选题或子选题。
   * @keyword-cn 保存真实选题, 批量入库
   * @keyword-en persist-selected-topics, bulk-persistence
   * @param {{ kind: 'mother'|'child', parentId?: number, sourceTodoId?: number, candidates: Array<{ title: string, topicType: string }> }} input - 入库参数。
   * @returns {Promise<{ created: object[], groups: object[] }>} 新增项和刷新后的工作台。
   */
  async createXhsTopics({ kind, parentId, sourceTodoId, candidates } = {}) {
    const res = await fetch(`${API_BASE}/api/xhs-topic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ kind, parentId, sourceTodoId, candidates }),
    });
    if (!res.ok) throw new Error(`XHS_TOPIC_CREATE_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 批量删除当前用户的真实选题，母题由服务端级联删除子题。
   * @keyword-cn 删除真实选题, 级联删除
   * @keyword-en delete-persisted-topics, cascade-delete
   * @param {{ ids: number[] }} input - 选题业务 ID。
   * @returns {Promise<{ deletedCount: number, groups: object[] }>} 删除数量和刷新后的工作台。
   */
  async deleteXhsTopics({ ids } = {}) {
    const res = await fetch(`${API_BASE}/api/xhs-topic`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`XHS_TOPIC_DELETE_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 修改真实选题的标题、题目类型或发布状态。
   * @keyword-cn 更新真实选题, 发布状态
   * @keyword-en update-persisted-topic, publish-status
   * @param {number} id - 选题业务 ID。
   * @param {{ title?: string, topicType?: string, status?: string }} patch - 修改内容。
   * @returns {Promise<{ topic: object, groups: object[] }>} 修改后的选题和工作台。
   */
  async updateXhsTopic(id, patch = {}) {
    const res = await fetch(`${API_BASE}/api/xhs-topic/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`XHS_TOPIC_UPDATE_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 异步启动指定子选题的文章生成，立即返回 in_progress 的 Todo；进度与失败原因由 listXhsArticleGenerations 轮询。
   * @keyword-cn 生成真实文章, 读取当前文章, 文章改写, 异步生成文章
   * @keyword-en generate-persisted-article, read-current-article, article-rewrite, start-article-generation
   * @param {number} topicId - 子选题业务 ID。
   * @param {{ prompt?: string, useSearch?: boolean }} input - 可选文章要求。
   * @returns {Promise<{ todo: object }>} 已置为 in_progress 的生成 Todo。
   * @throws {Error} 启动失败时抛出带 code 与中文 message 的错误，供界面直接展示。
   */
  async generateXhsArticle(topicId, input = {}) {
    const res = await fetch(
      `${API_BASE}/api/xhs-topic/${topicId}/article/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const error = new Error(
        payload?.message || `文章生成失败（HTTP ${res.status}）。`,
      );
      error.code =
        payload?.code || `XHS_ARTICLE_GENERATION_FAILED_${res.status}`;
      if (payload?.todoId) error.todoId = payload.todoId;
      throw error;
    }
    return await res.json();
  },

  /**
   * @description 拉取当前用户每个子选题最近一次文章生成任务的状态，用于并发生成时逐条展示进度与失败原因。
   * @keyword-cn 文章生成状态, 逐条进度
   * @keyword-en article-generation-state, per-topic-progress
   * @returns {Promise<{ generations: Array<{ topicId: number, todoId: number, status: string, error?: string, errorMessage?: string, updatedAt: string }> }>} 按子选题去重的最近一次生成状态。
   */
  async listXhsArticleGenerations() {
    const res = await fetch(`${API_BASE}/api/xhs-topic/article/generations`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`XHS_ARTICLE_GENERATIONS_FAILED_${res.status}`);
    return await res.json();
  },

  /**
   * @description 保存用户对真实文章正文、标签、配图或发布形式的编辑。
   * @keyword-cn 更新真实文章, 真实配图
   * @keyword-en update-persisted-article, persisted-images
   * @param {number} topicId - 子选题业务 ID。
   * @param {object} patch - 文章字段补丁。
   * @returns {Promise<{ groups: object[] }>} 更新后的真实工作台。
   */
  async updateXhsArticle(topicId, patch = {}) {
    const res = await fetch(`${API_BASE}/api/xhs-topic/${topicId}/article`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`XHS_ARTICLE_UPDATE_FAILED_${res.status}`);
    return await res.json();
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(patch),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}/cover/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}/cover/select`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 触发图文 Canvas 指定文章图片下标重生成，成功响应会让 Canvas 进入 generating。
   * @keyword-cn 图文内页重生成 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  async regenerateCanvasArticleImage(canvasId, articleId, imageIndex, payload) {
    try {
      const safeIndex = encodeURIComponent(String(imageIndex ?? 0));
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}/images/${safeIndex}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 直接使用图库图片替换图文 Canvas 指定文章图片下标。
   * @keyword-cn 图文内页选择 图片槽位替换
   * @keyword-en article-image-select
   * @keyword-en image-slot-select
   */
  async selectCanvasArticleImage(canvasId, articleId, imageIndex, payload) {
    try {
      const safeIndex = encodeURIComponent(String(imageIndex ?? 0));
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/articles/${articleId}/images/${safeIndex}/select`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/cover/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/cover/select`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 触发图片组 Canvas 指定 role 图片槽位重生成，成功响应会让 Canvas 进入 generating。
   * @keyword-cn 内页重生成 图片槽位重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en image-group-image-slot
   */
  async regenerateCanvasImageGroupImage(canvasId, groupId, role, payload) {
    try {
      const safeRole = encodeURIComponent(String(role ?? ''));
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/images/${safeRole}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
      if (!res.ok) return { canvas: null };
      return await res.json();
    } catch {
      return { canvas: null };
    }
  },

  /**
   * @description 直接使用图库图片替换图片组 Canvas 指定 role 图片槽位。
   * @keyword-cn 图片槽位替换 内页选择
   * @keyword-en image-slot-select
   * @keyword-en image-group-image-slot
   */
  async selectCanvasImageGroupImage(canvasId, groupId, role, payload) {
    try {
      const safeRole = encodeURIComponent(String(role ?? ''));
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/images/${safeRole}/select`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload ?? {}),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/canvas/${canvasId}/image-groups/${groupId}/images/${imageId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        },
      );
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
      const res = await fetch(
        `${API_BASE}/context/list?sessionType=${encodeURIComponent(type)}`,
        {
          headers: getAuthHeaders(),
        },
      );
      if (!res.ok) return [];
      const data = await res.json();
      // Map backend fields to frontend expected format if necessary
      // Backend: { sessionId, title, createdAt, updatedAt }
      // Frontend expects: { sessionId, title, timestamp }
      return data.map((item) => ({
        sessionId: item.sessionId,
        title: item.title || '未命名会话',
        timestamp: new Date(item.updatedAt || item.createdAt).getTime(),
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
  },
};
