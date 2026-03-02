
// Auto-detect: Astro dev (4322) → NestJS (3011), production → same origin
const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');

/**
 * @description Chat Service for AiCommander
 * @keyword-en ChatService
 */
export const chatService = {
  /**
   * Create a new chat session
   * @returns {Promise<{sessionId: string}>}
   */
  async createSession() {
    try {
      const res = await fetch(`${API_BASE}/chat/session`, { method: 'POST' });
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
  async streamChatPost(sessionId, input) {
    const payload = { sessionId, input };
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res;
  },

  /**
   * Fetch chat history
   * @param {string} sessionId 
   * @returns {Promise<Array>}
   */
  async fetchHistory(sessionId) {
    try {
      // Use the chat messages endpoint for full history
      const res = await fetch(`${API_BASE}/chat/messages/${sessionId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch {
      return [];
    }
  },

  // --- Remote Session Management ---

  /**
   * Get all chat sessions from backend
   * @returns {Promise<Array<{sessionId: string, title: string, timestamp: number}>>}
   */
  async getSessions() {
    try {
      const res = await fetch(`${API_BASE}/context/list`);
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
