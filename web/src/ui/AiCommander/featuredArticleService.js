const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * @description Build authenticated headers for featured article API requests.
 * @returns {Record<string, string>} Headers with Bearer token when present.
 * @keyword-en featured-article
 * @keyword-en api-client
 */
const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * @description Send JSON requests to the featured article backend.
 * @param {string} path Relative API path.
 * @param {object} [options] Fetch options.
 * @returns {Promise<{ok: boolean, status: number, data: any}>} Wrapped response.
 * @keyword-en featured-article
 * @keyword-en api-client
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
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: error?.message || 'NETWORK_ERROR' },
    };
  }
};

/**
 * @description Frontend API client for featured article workspaces and pages.
 * @keyword-en featured-article
 * @keyword-en api-client
 */
export const featuredArticleService = {
  /**
   * @description List featured article workspaces.
   * @param {{limit?: number, offset?: number}} [params] Query params.
   * @returns {Promise<{items: object[], total: number}>} Workspace list result.
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  async listWorkspaces(params = {}) {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    const { ok, data } = await request(`/api/featured-article/workspaces${qs ? `?${qs}` : ''}`);
    return ok ? data : { items: [], total: 0 };
  },

  /**
   * @description Create a featured article workspace.
   * @param {{name: string, pages?: object[]}} input Workspace input.
   * @returns {Promise<object|null>} Created workspace response.
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  async createWorkspace(input) {
    const { ok, data } = await request('/api/featured-article/workspaces', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return ok ? data : null;
  },

  /**
   * @description Get one featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @returns {Promise<object|null>} Workspace response.
   * @keyword-en featured-article
   * @keyword-en workspace-editor
   */
  async getWorkspace(workspaceId) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}`);
    return ok ? data : null;
  },

  /**
   * @description Update a featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @param {object} patch Workspace patch.
   * @returns {Promise<object|null>} Updated workspace response.
   * @keyword-en featured-article
   * @keyword-en workspace-editor
   */
  async updateWorkspace(workspaceId, patch) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });
    return ok ? data : null;
  },

  /**
   * @description Delete a featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @returns {Promise<boolean>} Whether deletion succeeded.
   * @keyword-en featured-article
   * @keyword-en workspace-editor
   */
  async deleteWorkspace(workspaceId) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}`, {
      method: 'DELETE',
    });
    return ok && data?.ok === true;
  },

  /**
   * @description Create a page inside a featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @param {object} [page] Optional page draft.
   * @returns {Promise<object|null>} Created page response.
   * @keyword-en featured-article
   * @keyword-en article-page
   */
  async createPage(workspaceId, page = {}) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}/pages`, {
      method: 'POST',
      body: JSON.stringify(page || {}),
    });
    return ok ? data : null;
  },

  /**
   * @description Update a page inside a featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @param {string} pageId Page id.
   * @param {object} patch Page patch.
   * @returns {Promise<object|null>} Updated page response.
   * @keyword-en featured-article
   * @keyword-en article-page
   */
  async updatePage(workspaceId, pageId, patch) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });
    return ok ? data : null;
  },

  /**
   * @description Delete a page from a featured article workspace.
   * @param {number|string} workspaceId Workspace id.
   * @param {string} pageId Page id.
   * @returns {Promise<object|null>} Updated workspace response.
   * @keyword-en featured-article
   * @keyword-en slide-page-list
   */
  async deletePage(workspaceId, pageId) {
    const { ok, data } = await request(`/api/featured-article/workspaces/${workspaceId}/pages/${pageId}`, {
      method: 'DELETE',
    });
    return ok ? data : null;
  },

  /**
   * @description Store a featured article page into an article library.
   * @param {number|string} workspaceId Workspace id.
   * @param {string} pageId Page id.
   * @param {number|string} libraryId Article library id.
   * @returns {Promise<object|null>} Store result.
   * @keyword-en featured-article
   * @keyword-en store-into-library
   */
  async storePageToLibrary(workspaceId, pageId, libraryId) {
    const { ok, data } = await request(
      `/api/featured-article/workspaces/${workspaceId}/pages/${pageId}/store-to-library`,
      {
        method: 'POST',
        body: JSON.stringify({ libraryId }),
      },
    );
    return ok ? data : null;
  },
};
