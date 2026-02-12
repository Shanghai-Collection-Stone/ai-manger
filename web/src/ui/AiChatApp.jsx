import React from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import html2canvas from 'html2canvas';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

const toAbsoluteUrl = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) {
    const proto = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    return `${proto}${u}`;
  }
  if (!API_BASE) return u;
  if (u.startsWith('/')) return `${API_BASE}${u}`;
  return `${API_BASE}/${u}`;
};

const IconBase = ({ children, size = 24, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

const MessageSquare = (p) => (
  <IconBase {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </IconBase>
);
const Plus = (p) => (
  <IconBase {...p}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </IconBase>
);
const Layers = (p) => (
  <IconBase {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
    <polyline points="2 17 12 22 22 17"></polyline>
    <polyline points="2 12 12 17 22 12"></polyline>
  </IconBase>
);
const Send = (p) => (
  <IconBase {...p}>
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </IconBase>
);
const User = (p) => (
  <IconBase {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </IconBase>
);
const Bot = (p) => (
  <IconBase {...p}>
    <rect x="3" y="11" width="18" height="10" rx="2"></rect>
    <circle cx="12" cy="5" r="2"></circle>
    <path d="M12 7v4"></path>
    <line x1="8" y1="16" x2="8" y2="16"></line>
    <line x1="16" y1="16" x2="16" y2="16"></line>
  </IconBase>
);
const FileText = (p) => (
  <IconBase {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </IconBase>
);
const CheckCircle = (p) => (
  <IconBase {...p}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </IconBase>
);
const XCircle = (p) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="15" y1="9" x2="9" y2="15"></line>
    <line x1="9" y1="9" x2="15" y2="15"></line>
  </IconBase>
);
const Loader2 = (p) => (
  <IconBase {...p}>
    <line x1="12" y1="2" x2="12" y2="6"></line>
    <line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
    <line x1="2" y1="12" x2="6" y2="12"></line>
    <line x1="18" y1="12" x2="22" y2="12"></line>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
  </IconBase>
);
const Hash = (p) => (
  <IconBase {...p}>
    <line x1="4" y1="9" x2="20" y2="9"></line>
    <line x1="4" y1="15" x2="20" y2="15"></line>
    <line x1="10" y1="3" x2="8" y2="21"></line>
    <line x1="16" y1="3" x2="14" y2="21"></line>
  </IconBase>
);
const MoreHorizontal = (p) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="19" cy="12" r="1"></circle>
    <circle cx="5" cy="12" r="1"></circle>
  </IconBase>
);
const Copy = (p) => (
  <IconBase {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2"></rect>
    <rect x="3" y="3" width="13" height="13" rx="2"></rect>
  </IconBase>
);
const Camera = (p) => (
  <IconBase {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
    <circle cx="12" cy="13" r="4"></circle>
  </IconBase>
);
const Menu = (p) => (
  <IconBase {...p}>
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </IconBase>
);
const Trash2 = (p) => (
  <IconBase {...p}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </IconBase>
);
const Settings = (p) => (
  <IconBase {...p}>
    <path d="M12 1v2"></path>
    <path d="M12 21v2"></path>
    <path d="M4.22 4.22l1.42 1.42"></path>
    <path d="M18.36 18.36l1.42 1.42"></path>
    <path d="M1 12h2"></path>
    <path d="M21 12h2"></path>
    <path d="M4.22 19.78l1.42-1.42"></path>
    <path d="M18.36 5.64l1.42-1.42"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </IconBase>
);

const api = {
  async listSessions() {
    try {
      const res = await fetch(`${API_BASE}/context/list`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },
  async deleteSession(sessionId) {
    try {
      const res = await fetch(`${API_BASE}/chat/session/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  },
  async fetchHistory(sessionId) {
    try {
      const res = await fetch(`${API_BASE}/context/${sessionId}?limit=50`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },
  async createSession() {
    try {
      const res = await fetch(`${API_BASE}/chat/session`, { method: 'POST' });
      return await res.json();
    } catch {
      return { sessionId: 'local-' + Date.now() };
    }
  },
  async uploadImages(files) {
    try {
      const fd = new FormData();
      (Array.isArray(files) ? files : []).forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/chat/upload-images`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) return { files: [] };
      return await res.json();
    } catch {
      return { files: [] };
    }
  },
  async fetchContext(sessionId, keywords) {
    try {
      const params = new URLSearchParams({
        keywords: keywords || '',
        windowSize: '3',
        max: '20',
      });
      const res = await fetch(
        `${API_BASE}/context/retrieval/${sessionId}?${params}`,
      );
      if (!res.ok) throw new Error('Context fetch failed');
      return await res.json();
    } catch {
      return [];
    }
  },
  getStreamUrl(sessionId, input, opts) {
    let url = `${API_BASE}/chat/stream?sessionId=${sessionId}&input=${encodeURIComponent(input)}`;
    if (opts && typeof opts.recursionLimit === 'number') {
      url += `&recursionLimit=${opts.recursionLimit}`;
    }
    return url;
  },
  async streamChatPost(sessionId, input, opts) {
    const payload = { sessionId, input };
    if (opts && typeof opts.recursionLimit === 'number') {
      payload.recursionLimit = opts.recursionLimit;
    }
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res;
  },
  async sendChat(sessionId, input, opts) {
    try {
      const payload = { sessionId, input };
      if (opts && typeof opts.recursionLimit === 'number') {
        payload.recursionLimit = opts.recursionLimit;
      }
      const res = await fetch(`${API_BASE}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async listFrontendJobs(sessionId) {
    try {
      const res = await fetch(`${API_BASE}/fc/frontend/jobs/${sessionId}`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },
  async listCanvases(userId, limit) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/canvas${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { canvases: [] };
      return await res.json();
    } catch {
      return { canvases: [] };
    }
  },
  async getCanvas(id) {
    const cid = Number(id);
    if (!Number.isFinite(cid)) return null;
    try {
      const res = await fetch(`${API_BASE}/canvas/${cid}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async updateCanvasArticle(canvasId, articleId, patch) {
    const cid = Number(canvasId);
    const aid = Number(articleId);
    if (!Number.isFinite(cid) || !Number.isFinite(aid)) return null;
    try {
      const res = await fetch(`${API_BASE}/canvas/${cid}/articles/${aid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async getJob(hash) {
    try {
      const res = await fetch(`${API_BASE}/fc/frontend/job/${hash}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async listTodos(userId) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/todo${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { todos: [] };
      return await res.json();
    } catch {
      return { todos: [] };
    }
  },
  async createTodo(input) {
    try {
      const res = await fetch(`${API_BASE}/todo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async updateTodo(id, input) {
    try {
      const res = await fetch(`${API_BASE}/todo/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async deleteTodo(id) {
    try {
      const res = await fetch(`${API_BASE}/todo/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data?.ok;
    } catch {
      return false;
    }
  },
  async listGalleryGroups({ userId, tag, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (tag) params.set('tag', tag);
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/groups${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { groups: [] };
      return await res.json();
    } catch {
      return { groups: [] };
    }
  },
  async createGalleryGroup(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async updateGalleryGroup(id, input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
  async deleteGalleryGroup(id) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups/${id}/delete`, {
        method: 'POST',
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
      return { ok: false };
    }
  },
  async listGalleryImages({ userId, groupId, tag, cursorId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (groupId !== undefined && groupId !== null && `${groupId}` !== '') {
        params.set('groupId', String(groupId));
      }
      if (tag) params.set('tag', tag);
      if (cursorId !== undefined && cursorId !== null && `${cursorId}` !== '') {
        params.set('cursorId', String(cursorId));
      }
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { images: [] };
      return await res.json();
    } catch {
      return { images: [] };
    }
  },
  async uploadGalleryImages(files, body) {
    try {
      const fd = new FormData();
      (Array.isArray(files) ? files : []).forEach((f) => fd.append('files', f));
      Object.entries(body || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        fd.append(k, String(v));
      });
      const res = await fetch(`${API_BASE}/gallery/upload`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) return { images: [] };
      return await res.json();
    } catch {
      return { images: [] };
    }
  },
  async listGalleryTags({ userId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/tags${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { tags: [] };
      return await res.json();
    } catch {
      return { tags: [] };
    }
  },
  async batchUpdateGalleryImageTags(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/tags/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { matched: 0, modified: 0 };
      return await res.json();
    } catch {
      return { matched: 0, modified: 0 };
    }
  },
  async deleteGalleryImage(id, input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
      return { ok: false };
    }
  },
  async rebuildGalleryImageEmbeddings(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/embedding/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { updated: 0 };
      return await res.json();
    } catch {
      return { updated: 0 };
    }
  },
};

const splitReferenceBlock = (raw) => {
  const content = typeof raw === 'string' ? raw : '';
  if (!content) return { text: '', referenceUrls: [] };

  const marker = '[参考图]';
  const idx = content.indexOf(marker);
  if (idx < 0) return { text: content, referenceUrls: [] };

  const before = content.slice(0, idx).trimEnd();
  const after = content.slice(idx + marker.length);
  const urls = after
    .split(/\r?\n/)
    .map((s) => String(s || '').trim())
    .filter((s) => s.startsWith('http'));

  return { text: before.trim(), referenceUrls: urls };
};

const parseCanvasItBody = (body) => {
  const raw = String(body || '').trim();
  if (!raw) return [];

  const toItem = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return { canvasId: num };
  };

  let parsed = null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (Array.isArray(parsed)) {
    return parsed
      .flatMap((v) => {
        if (v == null) return [];
        if (typeof v === 'number' || typeof v === 'string') {
          const one = toItem(v);
          return one ? [one] : [];
        }
        if (typeof v === 'object') {
          const id = v.canvasId ?? v.canvas_id ?? v.id;
          const one = toItem(id);
          if (!one) return [];
          const needFields = Array.isArray(v.needFields)
            ? v.needFields
            : Array.isArray(v.missing)
              ? v.missing
              : undefined;
          const status = typeof v.status === 'string' ? v.status : undefined;
          return [{ ...one, status, needFields }];
        }
        return [];
      })
      .filter(Boolean);
  }

  if (parsed && typeof parsed === 'object') {
    const id = parsed.canvasId ?? parsed.canvas_id ?? parsed.id;
    const one = toItem(id);
    if (!one) return [];
    const needFields = Array.isArray(parsed.needFields)
      ? parsed.needFields
      : Array.isArray(parsed.missing)
        ? parsed.missing
        : undefined;
    const status = typeof parsed.status === 'string' ? parsed.status : undefined;
    return [{ ...one, status, needFields }];
  }

  const m1 = raw.match(/(?:canvasId|canvas_id|id)\s*[:=]\s*(\d+)/i);
  if (m1 && m1[1]) {
    const one = toItem(m1[1]);
    return one ? [one] : [];
  }

  const m2 = raw.match(/\b\d+\b/);
  if (m2 && m2[0]) {
    const one = toItem(m2[0]);
    return one ? [one] : [];
  }

  return [];
};

const extractCanvasItFromText = (raw) => {
  const text = typeof raw === 'string' ? raw : String(raw || '');
  if (!text || !text.includes('```canvas-it')) return { text, items: [] };

  const items = [];
  const re = /```canvas-it\s*([\s\S]*?)```/gi;
  const cleaned = text.replace(re, (full, body) => {
    const found = parseCanvasItBody(body);
    found.forEach((it) => items.push(it));
    return '';
  });
  const normalizedText = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return { text: normalizedText, items };
};

const mergeAdjacentTextSegments = (segments) => {
  const out = [];
  (Array.isArray(segments) ? segments : []).forEach((seg) => {
    if (!seg) return;
    if (seg.kind === 'text') {
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'text') {
        out[out.length - 1] = { kind: 'text', content: String(prev.content || '') + String(seg.content || '') };
      } else {
        out.push({ kind: 'text', content: seg.content || '' });
      }
      return;
    }
    out.push(seg);
  });
  return out;
};

const injectCanvasItIntoSegments = (segments) => {
  const existingIds = new Set(
    (Array.isArray(segments) ? segments : [])
      .filter((s) => s && s.kind === 'canvas')
      .map((s) => Number(s.canvasId))
      .filter((n) => Number.isFinite(n)),
  );

  const out = [];
  (Array.isArray(segments) ? segments : []).forEach((seg) => {
    if (!seg) return;
    if (seg.kind !== 'text') {
      out.push(seg);
      return;
    }
    const { text, items } = extractCanvasItFromText(seg.content || '');
    const normalized = String(text || '').trim();
    if (normalized) out.push({ kind: 'text', content: normalized });
    (Array.isArray(items) ? items : []).forEach((it) => {
      const cid = Number(it?.canvasId);
      if (!Number.isFinite(cid) || existingIds.has(cid)) return;
      existingIds.add(cid);
      out.push({ kind: 'canvas', canvasId: cid, status: it?.status, needFields: it?.needFields });
    });
  });

  return mergeAdjacentTextSegments(out);
};

const normalizeFrontendJobs = (rawJobs) => {
  const list = Array.isArray(rawJobs) ? rawJobs : [];
  const externals = [];
  list.forEach((job, idx) => {
    const j = job && typeof job === 'object' ? job : null;
    const url =
      typeof j?.url === 'string'
        ? j.url
        : typeof j?.result?.url === 'string'
          ? j.result.url
          : typeof j?.output?.url === 'string'
            ? j.output.url
            : '';
    if (!url) return;

    const hash = typeof j?.hash === 'string' ? j.hash : '';
    const status = typeof j?.status === 'string' ? j.status : '';
    const input = typeof j?.input === 'string' ? j.input : '';
    const title = input
      ? input.replace(/\s+/g, ' ').slice(0, 60)
      : hash
        ? `外链页面 ${hash.slice(0, 8)}`
        : '外链页面';

    externals.push({
      type: 'external',
      id: hash || idx + 1,
      title,
      content: url,
      status: status || 'pending',
      hash: hash || undefined,
    });
  });
  return externals;
};

const formatDebugBlock = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractKeywords = (text) => {
  if (!text) return '';
  const set = new Set();
  const lower = text.toLowerCase();

  const english = lower.match(/[a-z][a-z0-9-]{1,}/g) || [];
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'have',
    'has',
    'are',
    'was',
    'were',
    'is',
    'of',
    'to',
    'in',
    'on',
    'at',
    'by',
    'it',
    'but',
    'from',
  ]);
  english.forEach((w) => {
    if (w.length > 2 && !stopWords.has(w)) set.add(w);
  });

  const chinese = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  chinese.forEach((w) => set.add(w));

  return Array.from(set).join(',');
};

function CopyButton({ message }) {
  const [copied, setCopied] = useState(false);
  const getText = () => {
    let t = '';
    if (Array.isArray(message?.segments)) {
      t = message.segments
        .filter((s) => s && s.kind === 'text')
        .map((s) => s.content || '')
        .join('\n\n');
    }
    if (!t && typeof message?.content === 'string') t = message.content;
    return t || '';
  };
  const onCopy = async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      onClick={onCopy}
      className="ml-auto px-2 py-0.5 border rounded text-xs text-gray-600 hover:bg-gray-100 flex items-center gap-1"
    >
      <Copy size={12} />
      {copied ? '已复制' : '复制'}
    </button>
  );
}

const galleryImageBlobCache = (() => {
  const items = new Map();
  const inflight = new Map();

  const maxItems = 600;

  const touch = (key) => {
    const v = items.get(key);
    if (!v) return;
    items.delete(key);
    items.set(key, v);
  };

  const evict = () => {
    while (items.size > maxItems) {
      const firstKey = items.keys().next().value;
      if (!firstKey) break;
      items.delete(firstKey);
    }
  };

  const prime = async (url) => {
    const key = String(url || '');
    if (!key) return null;
    const cached = items.get(key);
    if (cached && cached.status === 'ok') {
      touch(key);
      return cached;
    }
    const existing = inflight.get(key);
    if (existing) return existing;

    const p = (async () => {
      try {
        const ok = await new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.loading = 'eager';
          const done = (v) => {
            img.onload = null;
            img.onerror = null;
            resolve(v);
          };
          img.onload = () => done(true);
          img.onerror = () => done(false);
          img.src = key;
        });
        const entry = ok ? { status: 'ok' } : { status: 'error' };
        items.set(key, entry);
        touch(key);
        evict();
        return entry;
      } catch (e) {
        const entry = { status: 'error', reason: String(e && e.message ? e.message : e) };
        items.set(key, entry);
        touch(key);
        evict();
        return entry;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };

  const get = (url) => {
    const key = String(url || '');
    if (!key) return null;
    const v = items.get(key);
    if (!v) return null;
    touch(key);
    return v;
  };

  return { get, prime };
})();

function CachedGalleryImg({ url, alt, className }) {
  const src = String(url || '');
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      draggable={false}
    />
  );
}

const galleryThumbPreloadQueue = (() => {
  const pending = [];
  let active = 0;
  let scheduled = false;
  const concurrency = 4;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      while (active < concurrency && pending.length > 0) {
        const url = String(pending.shift() || '');
        if (!url) continue;
        const hit = galleryImageBlobCache.get(url);
        if (hit && hit.status === 'ok') continue;
        active += 1;
        Promise.resolve(galleryImageBlobCache.prime(url)).finally(() => {
          active -= 1;
          schedule();
        });
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 500 });
    } else if (typeof window !== 'undefined') {
      window.setTimeout(run, 0);
    } else {
      run();
    }
  };

  const enqueue = (urls) => {
    const list = Array.isArray(urls) ? urls : [];
    for (const u of list) {
      const s = String(u || '');
      if (!s) continue;
      pending.push(s);
    }
    schedule();
  };

  return { enqueue };
})();

function VirtualizedGalleryGrid({
  images,
  scrollRef,
  selectedIds,
  onToggleSelect,
  onPreview,
  onDelete,
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
  const padding = 24;
  const gap = 16;
  const minCell = 150;
  const maxColumns = 6;
  const overscanRows = 3;

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    let rafId = 0;
    const sync = () => {
      rafId = 0;
      setViewport({ width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop });
    };
    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(sync);
    };
    sync();
    el.addEventListener('scroll', schedule, { passive: true });
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
    }
    window.addEventListener('resize', schedule);
    return () => {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (ro) ro.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [scrollRef]);

  const layout = useMemo(() => {
    const innerWidth = Math.max(0, viewport.width - padding * 2);
    const columns = Math.max(
      2,
      Math.min(maxColumns, Math.floor((innerWidth + gap) / (minCell + gap)) || 2),
    );
    const cell = innerWidth > 0
      ? Math.floor((innerWidth - gap * (columns - 1)) / columns)
      : minCell;
    const rowHeight = cell + gap;
    const totalRows = Math.ceil((Array.isArray(images) ? images.length : 0) / columns);
    const totalHeight = padding * 2 + Math.max(0, totalRows * rowHeight - gap);
    return { columns, cell, rowHeight, totalRows, totalHeight };
  }, [viewport.width, images]);

  const range = useMemo(() => {
    const total = Array.isArray(images) ? images.length : 0;
    if (total === 0) return { start: 0, end: -1 };
    const top = Math.max(0, viewport.scrollTop - padding);
    const bottom = Math.max(0, viewport.scrollTop + viewport.height - padding);
    const startRow = Math.max(0, Math.floor(top / layout.rowHeight) - overscanRows);
    const endRow = Math.min(
      Math.max(0, layout.totalRows - 1),
      Math.ceil(bottom / layout.rowHeight) + overscanRows,
    );
    const start = startRow * layout.columns;
    const end = Math.min(total - 1, (endRow + 1) * layout.columns - 1);
    return { start, end };
  }, [images, viewport.scrollTop, viewport.height, layout]);

  const items = useMemo(() => {
    const list = Array.isArray(images) ? images : [];
    if (range.end < range.start) return [];
    const arr = [];
    for (let i = range.start; i <= range.end; i += 1) {
      const img = list[i];
      if (!img) continue;
      const row = Math.floor(i / layout.columns);
      const col = i % layout.columns;
      const top = padding + row * layout.rowHeight;
      const left = padding + col * (layout.cell + gap);
      arr.push({ img, top, left, size: layout.cell });
    }
    return arr;
  }, [images, range, layout]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const urls = items
      .map((x) => {
        const im = x && x.img ? x.img : null;
        const u = (im && (im.thumbUrl || im.url)) || '';
        return String(u || '');
      })
      .filter(Boolean);
    if (urls.length === 0) return;
    galleryThumbPreloadQueue.enqueue(urls);
  }, [items]);

  return (
    <div style={{ position: 'relative', height: layout.totalHeight, width: '100%' }}>
      {items.map(({ img, top, left, size }) => (
        <div
          key={img.id}
          role="button"
          tabIndex={0}
          onClick={() => onPreview && onPreview(img)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPreview && onPreview(img);
            }
          }}
          className={`group absolute bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-black/10 ${
            selectedIds && selectedIds.has(img.id)
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-gray-200 hover:ring-2 hover:ring-black/5'
          }`}
          style={{ top, left, width: size, height: size, contain: 'content' }}
        >
          <CachedGalleryImg
            url={img.thumbUrl || img.url}
            alt={img.originalName || `img-${img.id}`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect && onToggleSelect(img.id);
            }}
            className={`absolute top-2 left-2 w-7 h-7 rounded-full border flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors ${
              selectedIds && selectedIds.has(img.id)
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white/80 border-gray-200 text-gray-600 hover:bg-white'
            }`}
            aria-label="toggle-select"
          >
            {selectedIds && selectedIds.has(img.id) ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span className="w-2 h-2 rounded-full bg-gray-300" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete && onDelete(img);
            }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full border border-red-200 bg-white/80 text-red-600 flex items-center justify-center shadow-sm backdrop-blur-sm hover:bg-white"
            aria-label="delete-image"
          >
            <Trash2 size={14} />
          </button>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
            <div className="text-white text-xs font-medium truncate">#{img.id}</div>
            {img.tags && img.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {img.tags.slice(0, 3).map((t) => (
                  <span key={t} className="px-1.5 py-0.5 bg-white/15 text-white/90 rounded text-[10px] max-w-[90%] truncate">
                    {t}
                  </span>
                ))}
                {img.tags.length > 3 && (
                  <span className="px-1.5 py-0.5 bg-white/15 text-white/80 rounded text-[10px]">
                    +{img.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TagPicker({
  label,
  value,
  onChange,
  allTags,
  placeholder,
  disabled,
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(0);

  const tags = Array.isArray(value) ? value : [];
  const known = Array.isArray(allTags) ? allTags : [];
  const selectedSet = useMemo(() => new Set(tags.map((t) => String(t))), [tags]);

  const suggestions = useMemo(() => {
    const q = String(input || '').trim().toLowerCase();
    const base = known
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .filter((t) => !selectedSet.has(t));
    const filtered = q
      ? base.filter((t) => t.toLowerCase().includes(q))
      : base;
    return filtered.slice(0, 10);
  }, [input, known, selectedSet]);

  const parseTokens = useCallback((raw) => {
    const s = String(raw || '').trim();
    if (!s) return [];
    return s
      .split(/[\s,]+/g)
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }, []);

  const addFromRaw = useCallback(
    (raw) => {
      if (disabled) return;
      const tokens = parseTokens(raw);
      if (tokens.length === 0) return;

      const next = [...tags];
      const nextSet = new Set(selectedSet);
      for (const t of tokens) {
        if (!t) continue;
        if (nextSet.has(t)) continue;
        nextSet.add(t);
        next.push(t);
      }
      if (next.length === tags.length) return;
      onChange && onChange(next);
      setInput('');
    },
    [disabled, onChange, parseTokens, selectedSet, tags],
  );

  const removeOne = useCallback(
    (t) => {
      if (disabled) return;
      const key = String(t || '').trim();
      if (!key) return;
      const next = tags.filter((x) => String(x) !== key);
      onChange && onChange(next);
    },
    [disabled, onChange, tags],
  );

  return (
    <div className="space-y-1">
      {label ? <div className="text-xs font-medium text-gray-600">{label}</div> : null}
      <div className={`relative rounded-lg border px-2 py-2 bg-white ${disabled ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap gap-1 mb-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
              <span className="max-w-[180px] truncate">{t}</span>
              <button
                type="button"
                onClick={() => removeOne(t)}
                className="text-gray-500 hover:text-gray-800"
                aria-label="remove-tag"
                disabled={disabled}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <input
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => {
            if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
            setOpen(true);
          }}
          onBlur={() => {
            if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addFromRaw(input);
            }
          }}
          placeholder={placeholder || '输入并回车添加'}
          className="w-full h-8 px-2 text-sm outline-none"
        />

        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20">
            {suggestions.map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addFromRaw(t);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModal({ open, onClose }) {
  // Global / User State
  const [userId, setUserId] = useState('default');
  
  // Navigation State
  // selectedGroupId: null = All Images, number = Specific Group
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [hasMoreImages, setHasMoreImages] = useState(true);
  const [allTags, setAllTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  
  // UI State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState(() => new Set());
  const [batchAddTags, setBatchAddTags] = useState([]);
  const [batchRemoveTags, setBatchRemoveTags] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewAddTags, setPreviewAddTags] = useState([]);
  const [previewRemoveTags, setPreviewRemoveTags] = useState([]);
  const [vectorDraft, setVectorDraft] = useState({ startId: '1', limit: '50' });
  const [vectorUpdating, setVectorUpdating] = useState(false);
  const [vectorUpdatedCount, setVectorUpdatedCount] = useState(0);
  
  // Filters & Drafts
  const [imageTagFilterInput, setImageTagFilterInput] = useState('');
  const [imageTagFilter, setImageTagFilter] = useState('');
  
  const [groupDraft, setGroupDraft] = useState({ name: '', description: '', tags: '' });
  const [editGroupDraft, setEditGroupDraft] = useState({ name: '', description: '', tags: '' });
  
  const [uploadDraft, setUploadDraft] = useState({ tags: '', description: '' });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const imagesScrollRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const groupsReqIdRef = useRef(0);
  const imagesReqIdRef = useRef(0);
  const imagesLoadingMoreRef = useRef(false);
  const pageSize = 60;

  const openRef = useRef(false);
  const imagesRef = useRef([]);
  const imagesLoadingRef = useRef(false);
  const hasMoreImagesRef = useRef(true);
  const userIdRef = useRef('default');
  const selectedGroupIdRef = useRef(null);
  const imageTagFilterRef = useRef('');

  useEffect(() => {
    openRef.current = Boolean(open);
  }, [open]);

  useEffect(() => {
    imagesRef.current = Array.isArray(images) ? images : [];
  }, [images]);

  useEffect(() => {
    imagesLoadingRef.current = Boolean(imagesLoading);
  }, [imagesLoading]);

  useEffect(() => {
    hasMoreImagesRef.current = Boolean(hasMoreImages);
  }, [hasMoreImages]);

  useEffect(() => {
    userIdRef.current = String(userId || '').trim() || 'default';
  }, [userId]);

  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId ?? null;
  }, [selectedGroupId]);

  useEffect(() => {
    imageTagFilterRef.current = String(imageTagFilter || '').trim();
  }, [imageTagFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setImageTagFilter(String(imageTagFilterInput || ''));
    }, 320);
    return () => window.clearTimeout(t);
  }, [imageTagFilterInput]);

  // --- Data Loading ---

  const loadGroups = async () => {
    const reqId = (groupsReqIdRef.current += 1);
    setGroupsLoading(true);
    try {
      const data = await api.listGalleryGroups({
        userId: String(userId || '').trim() || undefined,
        limit: 100,
      });
      if (reqId !== groupsReqIdRef.current) return;
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } finally {
      if (reqId === groupsReqIdRef.current) setGroupsLoading(false);
    }
  };

  const mergeUniqueStrings = useCallback((base, next) => {
    const out = [];
    const seen = new Set();
    const pushOne = (it) => {
      const s = String(it || '').trim();
      if (!s) return;
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    (Array.isArray(base) ? base : []).forEach(pushOne);
    (Array.isArray(next) ? next : []).forEach(pushOne);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, []);

  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const data = await api.listGalleryTags({
        userId: String(userIdRef.current || '').trim() || undefined,
        limit: 2000,
      });
      setAllTags((prev) => mergeUniqueStrings(prev, data?.tags));
    } finally {
      setTagsLoading(false);
    }
  }, [mergeUniqueStrings]);

  const mergeUnique = useCallback((base, next) => {
    const out = [];
    const seen = new Set();
    const pushOne = (it) => {
      const key = it && (it.id !== undefined ? `id:${it.id}` : it.url ? `url:${it.url}` : '');
      if (!key) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(it);
    };
    (Array.isArray(base) ? base : []).forEach(pushOne);
    (Array.isArray(next) ? next : []).forEach(pushOne);
    return out;
  }, []);

  const loadImages = useCallback(
    async ({ append = false } = {}) => {
      const reqId = (imagesReqIdRef.current += 1);
      setImagesLoading(true);
      try {
        const curImages = imagesRef.current;
        const cursorId = append && curImages.length > 0 ? curImages[curImages.length - 1]?.id : undefined;
        const data = await api.listGalleryImages({
          userId: userIdRef.current || undefined,
          groupId: selectedGroupIdRef.current ?? undefined,
          tag: imageTagFilterRef.current || undefined,
          cursorId,
          limit: pageSize,
        });
        if (reqId !== imagesReqIdRef.current) return;
        const list = Array.isArray(data?.images) ? data.images : [];
        setHasMoreImages(list.length >= pageSize);
        if (append) {
          setImages((prev) => mergeUnique(prev, list));
        } else {
          setImages(() => mergeUnique([], list));
        }
      } finally {
        if (reqId === imagesReqIdRef.current) setImagesLoading(false);
      }
    },
    [mergeUnique],
  );

  // --- Effects ---

  useEffect(() => {
    if (open) {
      void loadGroups();
      void loadTags();
      if (imagesScrollRef.current) imagesScrollRef.current.scrollTop = 0;
      setHasMoreImages(true);
      void loadImages({ append: false });
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      if (imagesScrollRef.current) imagesScrollRef.current.scrollTop = 0;
      setHasMoreImages(true);
      void loadImages({ append: false });
      void loadTags();
    }
  }, [selectedGroupId, imageTagFilter, userId]);

  useEffect(() => {
    const root = imagesScrollRef.current;
    const target = loadMoreSentinelRef.current;
    if (!open || !root || !target || typeof IntersectionObserver === 'undefined') return;

    const obs = new IntersectionObserver(
      (entries) => {
        const hit = (Array.isArray(entries) ? entries : []).some((e) => e && e.isIntersecting);
        if (!hit) return;
        if (!openRef.current) return;
        if (imagesLoadingMoreRef.current) return;
        if (imagesLoadingRef.current) return;
        if (!hasMoreImagesRef.current) return;
        imagesLoadingMoreRef.current = true;
        Promise.resolve(loadImages({ append: true })).finally(() => {
          imagesLoadingMoreRef.current = false;
        });
      },
      { root, rootMargin: '480px 0px', threshold: 0.01 },
    );

    obs.observe(target);
    return () => obs.disconnect();
  }, [open, loadImages]);

  useEffect(() => {
    const list = Array.isArray(images) ? images : [];
    if (list.length === 0) return;
    const tail = list.slice(Math.max(0, list.length - 24));
    const urls = tail
      .map((x) => (x && (x.thumbUrl || x.url) ? String(x.thumbUrl || x.url) : ''))
      .filter(Boolean);
    if (urls.length === 0) return;

    const schedule = (cb) => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(cb, { timeout: 800 });
      }
      return window.setTimeout(cb, 120);
    };
    const cancel = (id) => {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };

    const id = schedule(() => {
      galleryThumbPreloadQueue.enqueue(urls);
    });
    return () => cancel(id);
  }, [images]);

  // --- Handlers ---

  const onCreateGroup = async () => {
    const uid = String(userId || '').trim() || 'default';
    const name = String(groupDraft.name || '').trim();
    if (!name) return;
    
    const tags = String(groupDraft.tags || '').split(/[\s,]+/).filter(Boolean);
    const description = String(groupDraft.description || '').trim();
    
    const res = await api.createGalleryGroup({
      userId: uid,
      name,
      description: description || undefined,
      tags: tags.length > 0 ? tags.join(',') : undefined,
    });
    
    if (res?.group) {
      setGroupDraft({ name: '', description: '', tags: '' });
      setShowCreateGroup(false);
      await loadGroups();
      setSelectedGroupId(res.group.id);
    }
  };

  const onUpdateGroup = async () => {
    if (!selectedGroupId) return;
    const name = String(editGroupDraft.name || '').trim();
    if (!name) return;
    
    const tags = String(editGroupDraft.tags || '').split(/[\s,]+/).filter(Boolean);
    const description = String(editGroupDraft.description || '').trim();
    
    const res = await api.updateGalleryGroup(selectedGroupId, {
      name,
      description: description || undefined,
      tags: tags.length > 0 ? tags.join(',') : undefined,
    });
    
    if (res?.group) {
      await loadGroups();
      setIsEditingGroup(false);
    }
  };

  const onDeleteGroup = async (gid) => {
    if (!window.confirm('确认删除该图库组？(组内图片不会被删除)')) return;
    await api.deleteGalleryGroup(gid);
    await loadGroups();
    if (selectedGroupId === gid) setSelectedGroupId(null);
  };

  const onUploadFiles = async (e) => {
    const files = Array.from((e?.target?.files ?? []) || []);
    if (files.length === 0) return;
    const uid = String(userId || '').trim() || 'default';
    
    setUploading(true);
    try {
      const res = await api.uploadGalleryImages(files, {
        userId: uid,
        groupId: selectedGroupId ?? undefined,
        tags: String(uploadDraft.tags || '').trim() || undefined,
        description: String(uploadDraft.description || '').trim() || undefined,
      });
      if (res?.images) {
        setUploadDraft({ tags: '', description: '' });
        setHasMoreImages(true);
        await loadImages({ append: false });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleSelectImage = useCallback((id) => {
    const imageId = Number(id);
    if (!Number.isFinite(imageId)) return;
    setSelectedImageIds((prev) => {
      const next = new Set(prev || []);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }, []);

  const clearSelectedImages = useCallback(() => {
    setSelectedImageIds(new Set());
    setBatchAddTags([]);
    setBatchRemoveTags([]);
  }, []);

  const selectedCount = selectedImageIds ? selectedImageIds.size : 0;

  const selectedTagsUnion = useMemo(() => {
    const set = new Set();
    const ids = selectedImageIds || new Set();
    (Array.isArray(images) ? images : []).forEach((img) => {
      if (!img || !ids.has(img.id)) return;
      (Array.isArray(img.tags) ? img.tags : []).forEach((t) => {
        const s = String(t || '').trim();
        if (s) set.add(s);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [images, selectedImageIds]);

  const applyTagDelta = useCallback((baseTags, addTags, removeTags) => {
    const out = new Set();
    (Array.isArray(baseTags) ? baseTags : []).forEach((t) => {
      const s = String(t || '').trim();
      if (s) out.add(s);
    });
    (Array.isArray(addTags) ? addTags : []).forEach((t) => {
      const s = String(t || '').trim();
      if (s) out.add(s);
    });
    (Array.isArray(removeTags) ? removeTags : []).forEach((t) => {
      const s = String(t || '').trim();
      if (s) out.delete(s);
    });
    return Array.from(out);
  }, []);

  const updateLocalImagesTags = useCallback(
    ({ ids, addTags, removeTags }) => {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map((x) => Number(x)));
      setImages((prev) =>
        (Array.isArray(prev) ? prev : []).map((img) => {
          if (!img || !idSet.has(img.id)) return img;
          const nextTags = applyTagDelta(img.tags, addTags, removeTags);
          return { ...img, tags: nextTags };
        }),
      );
    },
    [applyTagDelta],
  );

  const onApplyBatchTags = useCallback(async () => {
    const uid = String(userId || '').trim() || 'default';
    const ids = Array.from(selectedImageIds || []).filter((x) => Number.isFinite(Number(x)));
    if (ids.length === 0) return;
    if ((!batchAddTags || batchAddTags.length === 0) && (!batchRemoveTags || batchRemoveTags.length === 0)) return;

    const res = await api.batchUpdateGalleryImageTags({
      userId: uid,
      ids,
      addTags: batchAddTags,
      removeTags: batchRemoveTags,
    });

    if (res && res.modified > 0) {
      updateLocalImagesTags({ ids, addTags: batchAddTags, removeTags: batchRemoveTags });
      setAllTags((prev) => mergeUniqueStrings(prev, batchAddTags));
      setBatchAddTags([]);
      setBatchRemoveTags([]);
    }
  }, [batchAddTags, batchRemoveTags, mergeUniqueStrings, selectedImageIds, updateLocalImagesTags, userId]);

  const onPreviewImage = useCallback((img) => {
    if (!img) return;
    setPreviewImage(img);
    setPreviewAddTags([]);
    setPreviewRemoveTags([]);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewImage(null);
    setPreviewAddTags([]);
    setPreviewRemoveTags([]);
  }, []);

  const onApplyPreviewTags = useCallback(async () => {
    const img = previewImage;
    if (!img) return;
    const uid = String(userId || '').trim() || 'default';
    const ids = [img.id];
    if ((!previewAddTags || previewAddTags.length === 0) && (!previewRemoveTags || previewRemoveTags.length === 0)) return;
    const res = await api.batchUpdateGalleryImageTags({
      userId: uid,
      ids,
      addTags: previewAddTags,
      removeTags: previewRemoveTags,
    });
    if (res && res.modified > 0) {
      updateLocalImagesTags({ ids, addTags: previewAddTags, removeTags: previewRemoveTags });
      setAllTags((prev) => mergeUniqueStrings(prev, previewAddTags));
      setPreviewAddTags([]);
      setPreviewRemoveTags([]);
    }
  }, [mergeUniqueStrings, previewAddTags, previewImage, previewRemoveTags, updateLocalImagesTags, userId]);

  const onDeleteImage = useCallback(async (img) => {
    if (!img) return;
    const ok = window.confirm('确认删除该图片？');
    if (!ok) return;
    const uid = String(userId || '').trim() || 'default';
    const res = await api.deleteGalleryImage(img.id, { userId: uid });
    if (res && res.ok) {
      setImages((prev) => (Array.isArray(prev) ? prev : []).filter((x) => x && x.id !== img.id));
      setSelectedImageIds((prev) => {
        const next = new Set(prev || []);
        next.delete(img.id);
        return next;
      });
      if (previewImage && previewImage.id === img.id) closePreview();
    }
  }, [closePreview, previewImage, userId]);

  const onRebuildEmbeddings = useCallback(async () => {
    const uid = String(userId || '').trim() || 'default';
    const startId = Number(vectorDraft?.startId ?? 1);
    const lim = Number(vectorDraft?.limit ?? 50);
    if (!Number.isFinite(startId) || !Number.isFinite(lim)) return;
    setVectorUpdating(true);
    try {
      const res = await api.rebuildGalleryImageEmbeddings({ userId: uid, startId, limit: lim });
      setVectorUpdatedCount(Number(res?.updated || 0));
    } finally {
      setVectorUpdating(false);
    }
  }, [userId, vectorDraft]);

  // --- Prep Edit State ---
  useEffect(() => {
    if (isEditingGroup && selectedGroupId) {
      const g = groups.find(x => x.id === selectedGroupId);
      if (g) {
        setEditGroupDraft({
          name: g.name || '',
          description: g.description || '',
          tags: Array.isArray(g.tags) ? g.tags.join(', ') : '',
        });
      }
    }
  }, [isEditingGroup, selectedGroupId, groups]);

  if (!open) return null;

  const currentGroup = groups.find(g => g.id === selectedGroupId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[95vw] max-w-6xl h-[85vh] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col md:flex-row">
        
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
            <h2 className="font-semibold text-gray-800">图库设置</h2>
            <button onClick={onClose} className="md:hidden p-1 hover:bg-gray-100 rounded">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          
          <div className="p-3 border-b border-gray-200 bg-white space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">User</span>
              <input 
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="flex-1 h-8 px-2 text-sm border border-gray-200 rounded focus:border-black focus:outline-none"
              />
            </div>
            <button 
              onClick={() => { void loadGroups(); void loadImages(); void loadTags(); }}
              className="w-full h-8 flex items-center justify-center gap-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              刷新数据
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-between group ${
                selectedGroupId === null ? 'bg-black text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>全部图片</span>
              <span className={`text-xs ${selectedGroupId === null ? 'text-gray-300' : 'text-gray-400'}`}>
                {imagesLoading && selectedGroupId === null ? '...' : ''}
              </span>
            </button>
            
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-1 flex items-center justify-between">
              <span>图库组</span>
              {groupsLoading && <Loader2 size={10} className="animate-spin" />}
            </div>
            
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between group ${
                  selectedGroupId === g.id ? 'bg-black text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className="truncate">{g.name}</span>
                {selectedGroupId !== g.id && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400">
                    #{g.id}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-gray-200 bg-white">
            {showCreateGroup ? (
              <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-200">
                <input
                  autoFocus
                  value={groupDraft.name}
                  onChange={e => setGroupDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="组名称"
                  className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:border-black focus:outline-none"
                />
                <input
                  value={groupDraft.tags}
                  onChange={e => setGroupDraft(d => ({ ...d, tags: e.target.value }))}
                  placeholder="标签 (逗号分隔)"
                  className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:border-black focus:outline-none"
                />
                <div className="flex gap-2">
                  <button 
                    onClick={onCreateGroup}
                    className="flex-1 h-8 bg-black text-white rounded text-xs hover:opacity-90"
                  >
                    创建
                  </button>
                  <button 
                    onClick={() => setShowCreateGroup(false)}
                    className="h-8 px-3 border border-gray-200 rounded text-xs hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setShowCreateGroup(true)}
                className="w-full h-9 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 flex items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                新建图库组
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-white min-w-0">
          {/* Header */}
          <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
            <div className="min-w-0 flex-1 mr-4">
              <h1 className="text-xl font-bold text-gray-900 truncate">
                {selectedGroupId ? (currentGroup?.name || `Group #${selectedGroupId}`) : '全部图片'}
              </h1>
              {selectedGroupId && currentGroup && (
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  {currentGroup.description && <span className="truncate max-w-[200px]">{currentGroup.description}</span>}
                  {currentGroup.tags?.length > 0 && (
                    <div className="flex gap-1">
                      {currentGroup.tags.map(t => (
                        <span key={t} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              {selectedGroupId && (
                <>
                  <button
                    onClick={() => setIsEditingGroup(true)}
                    className="h-9 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 text-gray-600 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    编辑
                  </button>
                  <button
                    onClick={() => onDeleteGroup(selectedGroupId)}
                    className="h-9 px-3 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    删除
                  </button>
                  <div className="w-px h-6 bg-gray-200 mx-1" />
                </>
              )}
              <button
                onClick={onClose}
                className="hidden md:flex h-9 px-4 rounded-lg bg-black text-white text-sm hover:opacity-90 items-center gap-2"
              >
                完成
              </button>
            </div>
          </div>

          {/* Edit Group Modal/Overlay */}
          {isEditingGroup && (
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 animate-in slide-in-from-top-2">
              <div className="max-w-3xl space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-gray-500">组名称</label>
                    <input
                      value={editGroupDraft.name}
                      onChange={e => setEditGroupDraft(d => ({ ...d, name: e.target.value }))}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-gray-500">标签</label>
                    <input
                      value={editGroupDraft.tags}
                      onChange={e => setEditGroupDraft(d => ({ ...d, tags: e.target.value }))}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">描述</label>
                  <input
                    value={editGroupDraft.description}
                    onChange={e => setEditGroupDraft(d => ({ ...d, description: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setIsEditingGroup(false)} className="h-8 px-4 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">取消</button>
                  <button onClick={onUpdateGroup} className="h-8 px-4 text-sm bg-black text-white rounded-lg hover:opacity-90">保存更改</button>
                </div>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shadow-sm transition-all hover:shadow-md"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              )}
              {uploading ? '上传中...' : '上传图片'}
            </button>
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              ref={fileRef} 
              className="hidden" 
              onChange={onUploadFiles} 
            />
            
            <div className="h-6 w-px bg-gray-200 mx-1" />
            
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                value={imageTagFilterInput}
                onChange={e => setImageTagFilterInput(e.target.value)}
                placeholder="按标签筛选图片..."
                className="h-9 flex-1 bg-transparent border-none text-sm focus:ring-0 p-0 placeholder-gray-400"
              />
            </div>

            {selectedCount > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full text-xs text-blue-700">
                <span>已选 {selectedCount}</span>
                <button onClick={clearSelectedImages} className="hover:text-blue-900">&times;</button>
              </div>
            )}

            {(uploadDraft.tags || uploadDraft.description) && (
               <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full text-xs text-blue-700">
                 <span>预设: {uploadDraft.tags || '-'}</span>
                 <button onClick={() => setUploadDraft({tags: '', description: ''})} className="hover:text-blue-900">&times;</button>
               </div>
            )}
            
            <div className="relative group">
              <button className="h-9 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 text-gray-600">
                上传设置
              </button>
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-4 hidden group-focus-within:block group-hover:block z-10">
                <h3 className="font-semibold text-xs text-gray-500 mb-2 uppercase">上传预设值</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">自动添加标签</label>
                    <input 
                      value={uploadDraft.tags}
                      onChange={e => setUploadDraft(d => ({ ...d, tags: e.target.value }))}
                      className="w-full h-8 px-2 text-sm border border-gray-200 rounded"
                      placeholder="tag1, tag2"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">自动添加描述</label>
                    <input 
                      value={uploadDraft.description}
                      onChange={e => setUploadDraft(d => ({ ...d, description: e.target.value }))}
                      className="w-full h-8 px-2 text-sm border border-gray-200 rounded"
                      placeholder="图片描述"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="relative group">
              <button
                disabled={selectedCount === 0}
                className="h-9 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 text-gray-600 disabled:opacity-50"
              >
                批量标签
              </button>
              {selectedCount > 0 && (
                <div className="absolute right-0 top-full mt-2 w-[520px] bg-white rounded-xl shadow-xl border border-gray-100 p-4 hidden group-focus-within:block group-hover:block z-10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-gray-700">已选 {selectedCount} 张</div>
                    <button
                      type="button"
                      onClick={clearSelectedImages}
                      className="text-xs text-gray-500 hover:text-gray-800"
                    >
                      清空选择
                    </button>
                  </div>

                  {selectedTagsUnion.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 mb-1">已选标签（并集）</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedTagsUnion.slice(0, 14).map((t) => (
                          <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                            {t}
                          </span>
                        ))}
                        {selectedTagsUnion.length > 14 && (
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">
                            +{selectedTagsUnion.length - 14}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <TagPicker
                      label="添加标签"
                      value={batchAddTags}
                      onChange={setBatchAddTags}
                      allTags={allTags}
                      placeholder="输入或选择，回车添加"
                      disabled={false}
                    />
                    <TagPicker
                      label="移除标签"
                      value={batchRemoveTags}
                      onChange={setBatchRemoveTags}
                      allTags={selectedTagsUnion}
                      placeholder="输入或选择，回车添加"
                      disabled={false}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setBatchAddTags([]);
                        setBatchRemoveTags([]);
                      }}
                      className="h-8 px-4 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      onClick={() => void onApplyBatchTags()}
                      disabled={
                        selectedCount === 0 ||
                        ((batchAddTags?.length || 0) === 0 && (batchRemoveTags?.length || 0) === 0)
                      }
                      className="h-8 px-4 text-sm bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      应用到已选
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative group">
              <button className="h-9 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 text-gray-600">
                重建向量
              </button>
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 p-4 hidden group-focus-within:block group-hover:block z-10">
                <div className="text-xs font-semibold text-gray-700 mb-3">批量重建图片向量</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">startId</div>
                    <input
                      value={vectorDraft.startId}
                      onChange={(e) => setVectorDraft((d) => ({ ...d, startId: e.target.value }))}
                      className="w-full h-8 px-2 text-sm border border-gray-200 rounded"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">limit</div>
                    <input
                      value={vectorDraft.limit}
                      onChange={(e) => setVectorDraft((d) => ({ ...d, limit: e.target.value }))}
                      className="w-full h-8 px-2 text-sm border border-gray-200 rounded"
                    />
                  </div>
                </div>

                {vectorUpdatedCount > 0 && (
                  <div className="mt-3 text-xs text-gray-500">上次更新：{vectorUpdatedCount} 条</div>
                )}

                <div className="flex justify-end pt-3">
                  <button
                    type="button"
                    onClick={() => void onRebuildEmbeddings()}
                    disabled={vectorUpdating}
                    className="h-8 px-4 text-sm bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {vectorUpdating ? <Loader2 size={14} className="animate-spin" /> : null}
                    {vectorUpdating ? '重建中...' : '开始重建'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Image Grid */}
          <div ref={imagesScrollRef} className="flex-1 overflow-y-auto bg-gray-50/50">
            {imagesLoading && images.length === 0 ? (
              <div className="p-6 flex items-center justify-center h-full text-gray-400 gap-2">
                <Loader2 className="animate-spin" />
                <span>加载图片中...</span>
              </div>
            ) : images.length === 0 ? (
              <div className="p-6 flex flex-col items-center justify-center h-full text-gray-400 gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <p>暂无图片数据</p>
                <button 
                  onClick={() => fileRef.current?.click()}
                  className="text-blue-600 hover:underline text-sm"
                >
                  点击上传首张图片
                </button>
              </div>
            ) : (
              <div>
                <VirtualizedGalleryGrid
                  images={images}
                  scrollRef={imagesScrollRef}
                  selectedIds={selectedImageIds}
                  onToggleSelect={toggleSelectImage}
                  onPreview={onPreviewImage}
                  onDelete={onDeleteImage}
                />

                <div className="px-6 pb-6 pt-2 flex items-center justify-center">
                  <button
                    onClick={() => void loadImages({ append: true })}
                    disabled={!hasMoreImages || imagesLoading}
                    className="h-9 px-4 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    {imagesLoading ? '加载中...' : hasMoreImages ? '加载更多' : '没有更多了'}
                  </button>
                </div>
                <div ref={loadMoreSentinelRef} className="h-px" />
              </div>
            )}
          </div>
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closePreview} />
          <div className="relative w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  #{previewImage.id} {previewImage.originalName || ''}
                </div>
                <div className="text-xs text-gray-500 truncate">{previewImage.fileName || ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onDeleteImage(previewImage)}
                  className="h-8 px-3 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                >
                  删除
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="h-8 px-3 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-black/5 p-4 flex items-center justify-center">
                <img
                  src={previewImage.url || previewImage.thumbUrl}
                  alt={previewImage.originalName || `img-${previewImage.id}`}
                  className="max-h-[70vh] w-full object-contain rounded-lg"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">原图路径</div>
                  <div className="text-xs break-all bg-gray-50 p-2 rounded border border-gray-200">
                    {previewImage.url || ''}
                  </div>
                </div>

                {previewImage.absPath ? (
                  <div>
                    <div className="text-xs font-medium text-gray-600 mb-1">本地路径</div>
                    <div className="text-xs break-all bg-gray-50 p-2 rounded border border-gray-200">
                      {previewImage.absPath}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(previewImage.tags) && previewImage.tags.length > 0 ? (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">当前标签</div>
                    <div className="flex flex-wrap gap-1">
                      {previewImage.tags.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3">
                  <TagPicker
                    label="添加标签"
                    value={previewAddTags}
                    onChange={setPreviewAddTags}
                    allTags={allTags}
                    placeholder="输入或选择，回车添加"
                    disabled={false}
                  />
                  <TagPicker
                    label="移除标签"
                    value={previewRemoveTags}
                    onChange={setPreviewRemoveTags}
                    allTags={Array.isArray(previewImage.tags) ? previewImage.tags : []}
                    placeholder="输入或选择，回车添加"
                    disabled={false}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewAddTags([]);
                      setPreviewRemoveTags([]);
                    }}
                    className="h-8 px-4 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    onClick={() => void onApplyPreviewTags()}
                    disabled={((previewAddTags?.length || 0) === 0 && (previewRemoveTags?.length || 0) === 0)}
                    className="h-8 px-4 text-sm bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    应用标签
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MessageBubble = ({
  message,
  onAction,
  onRetry,
  onHitl,
  onExecuteCanvas,
  onOpenCanvas,
  resources = [],
  onRefreshResources,
}) => {
  const isUser = message.role === 'user';
  const linkifyHashtags = (content) => {
    const externals = (Array.isArray(resources) ? resources : []).filter(
      (r) =>
        r &&
        r.type === 'external' &&
        typeof r.content === 'string' &&
        (r.content.startsWith('http') || r.content.startsWith('/')),
    );
    const byId = new Map(externals.map((r) => [String(r.id), r]));
    const replaceOne = (token) => {
      let res = null;
      if (/^\d+$/.test(token)) {
        const idx = Number(token) - 1;
        res = externals[idx];
      } else {
        res = byId.get(token);
      }
      if (res && res.content) {
        const text = res.title || res.content;
        const url = toAbsoluteUrl(res.content);
        const cls = 'text-blue-600 underline';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${cls}">${text}</a>`;
      }
      return `#${token}`;
    };
    return String(content || '').replace(
      /(^|\s)#([A-Za-z0-9_-]+)/g,
      (m, pre, token) => {
        return `${pre}${replaceOne(token)}`;
      },
    );
  };
  const rawMarkup = (content) => ({
    __html: DOMPurify.sanitize(marked.parse(linkifyHashtags(content || ''))),
  });
  const [collapsedMap, setCollapsedMap] = useState({});
  const [uiFrameworkSel, setUiFrameworkSel] = useState('antd');
  const [chartLibrarySel, setChartLibrarySel] = useState('echarts');
  const [layoutSel, setLayoutSel] = useState('dashboard');
  const isCollapsed = (toolId) => {
    if (!toolId) return true;
    const v = collapsedMap[toolId];
    return typeof v === 'boolean' ? v : true;
  };
  const toggleCollapsed = (toolId) => {
    if (!toolId) return;
    setCollapsedMap((prev) => {
      const cur = typeof prev[toolId] === 'boolean' ? prev[toolId] : true;
      return { ...prev, [toolId]: !cur };
    });
  };

  const baseSegments = Array.isArray(message.segments)
    ? message.segments
    : typeof message.content === 'string' && message.content.trim().length > 0
      ? [{ kind: 'text', content: message.content }]
      : [];
  const segments = useMemo(
    () => injectCanvasItIntoSegments(baseSegments),
    [baseSegments],
  );
  const hasSegments = segments.length > 0;

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const showAttachments = attachments.filter((a) => a && (a.url || a.preview)).length > 0;
  const hasText = typeof message.content === 'string' && message.content.trim().length > 0;

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} animate__animated animate__fadeInUp animate__faster`}
    >
      <div
        className={`
          flex w-full md:w-auto md:max-w-[90%] gap-3 p-2 rounded-xl transition-all
          ${isUser ? 'flex-row-reverse' : 'flex-row'}
          hover:bg-gray-50
        `}
      >
        <div
          className={`hidden md:flex w-8 h-8 rounded-full flex-shrink-0 items-center justify-center border ${isUser ? 'bg-black text-white' : 'bg-white border-gray-200'}`}
        >
          {isUser ? <User size={14} /> : <Bot size={16} />}
        </div>

        <div
          className={`flex flex-col gap-1 min-w-0 flex-1 ${
            isUser ? 'items-end' : ''
          }`}
        >
          <div
            className={`flex items-baseline gap-2 px-1 ${
              isUser ? 'justify-end' : ''
            }`}
          >
            <span className="text-xs font-bold text-gray-900">
              {isUser ? 'You' : 'AI'}
            </span>
            {!isUser && <CopyButton message={message} />}
          </div>

          {(() => {
            const isPh =
              typeof message.content === 'string' &&
              message.content.includes('##HITL_REQUIRED_FRONTEND##');
            if (isPh && !isUser) {
              return (
                <div className="mt-2 border border-gray-200 rounded p-2 bg-white">
                  <div className="text-xs text-gray-600 mb-2">
                    图表生成需要人工选择以下参数：
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">UI 框架</div>
                      <select
                        value={uiFrameworkSel}
                        onChange={(e) => setUiFrameworkSel(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                      >
                        <option value="antd">antd</option>
                        <option value="element-ui">element ui</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">图表库</div>
                      <select
                        value={chartLibrarySel}
                        onChange={(e) => setChartLibrarySel(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                      >
                        <option value="echarts">echarts</option>
                        <option value="acharts">acharts</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">布局</div>
                      <select
                        value={layoutSel}
                        onChange={(e) => setLayoutSel(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                      >
                        <option value="dashboard">dashboard</option>
                        <option value="grid">宫格</option>
                        <option value="masonry">瀑布流</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction && onAction(message.id, 'rejected');
                      }}
                      className="py-1 px-2 border rounded text-xs hover:bg-red-50 text-red-600"
                    >
                      拒绝
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const payload = {
                          uiFramework: uiFrameworkSel,
                          chartLibrary: chartLibrarySel,
                          layout: layoutSel,
                        };
                        onAction &&
                          onAction(message.id, 'approved', payload);
                      }}
                      className="py-1 px-2 bg-black text-white rounded text-xs hover:opacity-90"
                    >
                      确定
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                className={`py-3 px-4 rounded-2xl shadow-sm text-sm overflow-hidden break-words max-w-full md:max-w-[90ch] lg:max-w-[105ch] ${
                  isUser
                    ? 'bg-black text-white w-auto max-w-[90%]'
                    : 'bg-white border border-gray-100 w-full md:w-auto'
                }`}
                style={
                  isUser ? { backgroundColor: '#000', color: '#fff' } : undefined
                }
              >
                {showAttachments && (
                  <div className="mb-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                    {attachments
                      .filter((a) => a && (a.url || a.preview))
                      .map((a) => {
                        const src = a.url || a.preview;
                        const key = a.id || src;
                        const body = (
                          <img
                            src={src}
                            alt={a.name || 'ref'}
                            className="w-full h-28 md:h-32 object-cover rounded-xl border border-white/10"
                            loading="lazy"
                          />
                        );
                        return a.url ? (
                          <a
                            key={key}
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            {body}
                          </a>
                        ) : (
                          <div key={key}>{body}</div>
                        );
                      })}
                  </div>
                )}

                {hasSegments ? (
                  <div className="flex flex-col gap-2">
                    {segments.map((seg, i) =>
                      seg.kind === 'text' ? (
                        <div
                          key={`text-${i}`}
                          className={`markdown-body ${isUser ? '!text-white' : ''} overflow-x-auto`}
                          style={{
                            overflowWrap: 'break-word',
                            wordBreak: 'break-word',
                            backgroundColor: 'transparent',
                          }}
                          dangerouslySetInnerHTML={rawMarkup(seg.content || '')}
                        />
                      ) : seg.kind === 'error' ? (
                        <div
                          key={`err-${i}`}
                          className="text-xs bg-red-50 border border-red-200 rounded p-2 overflow-hidden"
                        >
                          <div className="font-semibold text-red-700">错误: {seg.code || 'UNKNOWN'}</div>
                          <div className="mt-1 text-red-600 break-words">{seg.message || ''}</div>
                          {seg.can_continue && !isUser && typeof onRetry === 'function' && (
                            <div className="mt-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const nextLimit = (message.usedRecursionLimit ?? 25) * 2;
                                  onRetry(message.id, nextLimit);
                                }}
                                className="py-1.5 px-2 bg-black text-white rounded text-xs hover:opacity-90"
                              >
                                继续
                              </button>
                            </div>
                          )}
                        </div>
                      ) : seg.kind === 'log' ? (
                        <div
                          key={`log-${i}`}
                          className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-hidden text-gray-600"
                        >
                          {seg.content}
                        </div>
                      ) : seg.kind === 'reasoning' ? (
                        <div
                          key={`reason-${i}`}
                          className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-hidden text-gray-600"
                        >
                          {seg.content}
                        </div>
                      ) : seg.kind === 'canvas' ? (
                        <div
                          key={`canvas-${i}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (typeof onOpenCanvas === 'function') onOpenCanvas(seg.canvasId);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (typeof onOpenCanvas === 'function') onOpenCanvas(seg.canvasId);
                            }
                          }}
                          className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-hidden cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="font-semibold text-gray-700">Canvas-it</div>
                          <div className="mt-1 text-gray-700 break-words">Canvas ID: {seg.canvasId}</div>
                          {seg.status ? (
                            <div className="mt-1 text-gray-700">状态: {seg.status}</div>
                          ) : null}
                          {Array.isArray(seg.needFields) && seg.needFields.length > 0 ? (
                            <div className="mt-1 text-gray-600">缺失: {seg.needFields.join(', ')}</div>
                          ) : null}
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (typeof onOpenCanvas === 'function') onOpenCanvas(seg.canvasId);
                              }}
                              className="px-2 py-1 border rounded text-xs text-gray-700 hover:bg-gray-200"
                            >
                              查看/编辑
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (typeof onExecuteCanvas === 'function') onExecuteCanvas(seg.canvasId);
                              }}
                              className="px-2 py-1 border rounded text-xs text-gray-700 hover:bg-gray-100"
                            >
                              执行
                            </button>
                          </div>
                        </div>
                      ) : seg.kind === 'external' ? (
                        <div
                          key={`ext-${i}`}
                          className="text-xs bg-blue-50 border border-blue-200 rounded p-2 overflow-hidden"
                        >
                          <div className="font-semibold text-blue-700">外链页面</div>
                          <div className="mt-1 text-blue-600 break-words">
                            <a
                              href={toAbsoluteUrl(seg.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {seg.url}
                            </a>
                          </div>
                          <div className="mt-1 text-blue-600">状态: {seg.status || 'pending'}</div>
                          <div className="mt-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (typeof onRefreshResources === 'function') onRefreshResources();
                              }}
                              className="px-2 py-1 border rounded text-xs text-blue-700 hover:bg-blue-50"
                            >
                              刷新
                            </button>
                          </div>
                          <div className="mt-1 text-gray-600">您可以打开外链查看生成进度与最终图表界面。</div>
                        </div>
                      ) : (
                        <div
                          key={`tool-${i}`}
                          className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-hidden"
                        >
                          <div className="font-semibold text-gray-700 flex items-center gap-2">
                            <Hash size={12} /> 调用工具: {seg.tool?.name}
                            {seg.tool?.status === 'running' && <Loader2 size={12} className="animate-spin" />}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed(seg.tool?.id || seg.tool?.name);
                              }}
                              className="ml-auto px-2 py-0.5 border rounded text-xs text-gray-600 hover:bg-gray-100"
                            >
                              {isCollapsed(seg.tool?.id || seg.tool?.name) ? '展开' : '收起'}
                            </button>
                          </div>
                          <div data-tool-id={seg.tool?.id || seg.tool?.name}>
                            <div
                              data-tool-body
                              style={{
                                display: isCollapsed(seg.tool?.id || seg.tool?.name) ? 'none' : '',
                              }}
                            >
                              <div className="mt-1 text-gray-500 font-mono break-all whitespace-pre-wrap max-h-24 overflow-y-auto">
                                Input:{' '}
                                {seg.tool?.input ? JSON.stringify(seg.tool.input) : seg.tool?.argsBuffer || ''}
                              </div>
                              {seg.tool?.streamingContent && (
                                <div className="mt-1 text-blue-600 font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                                  Stream: {seg.tool.streamingContent}
                                </div>
                              )}
                              {seg.tool?.output && (
                                <div className="mt-1 text-green-600 font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                                  Output:{' '}
                                  {typeof seg.tool.output === 'string'
                                    ? seg.tool.output
                                    : JSON.stringify(seg.tool.output)}
                                </div>
                              )}
                              {(() => {
                                const out = seg.tool?.output;
                                const obj = out && typeof out === 'object' ? out : undefined;
                                const hitl =
                                  obj &&
                                  (obj.requires_human === true || obj.hitl_required === true);
                                if (hitl && !isUser) {
                                  return (
                                    <div className="mt-2 border border-gray-200 rounded p-2 bg-white">
                                      <div className="text-xs text-gray-600 mb-2">图表生成需要人工选择以下参数：</div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <div className="text-xs text-gray-600 mb-1">UI 框架</div>
                                          <select
                                            value={uiFrameworkSel}
                                            onChange={(e) => setUiFrameworkSel(e.target.value)}
                                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                                          >
                                            <option value="antd">antd</option>
                                            <option value="element-ui">element ui</option>
                                          </select>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-600 mb-1">图表库</div>
                                          <select
                                            value={chartLibrarySel}
                                            onChange={(e) => setChartLibrarySel(e.target.value)}
                                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                                          >
                                            <option value="echarts">echarts</option>
                                            <option value="acharts">acharts</option>
                                          </select>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-600 mb-1">布局</div>
                                          <select
                                            value={layoutSel}
                                            onChange={(e) => setLayoutSel(e.target.value)}
                                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
                                          >
                                            <option value="dashboard">dashboard</option>
                                            <option value="grid">宫格</option>
                                            <option value="masonry">瀑布流</option>
                                          </select>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex gap-2">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onAction && onAction(message.id, 'rejected');
                                          }}
                                          className="py-1 px-2 border rounded text-xs hover:bg-red-50 text-red-600"
                                        >
                                          拒绝
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const payload = {
                                              uiFramework: uiFrameworkSel,
                                              chartLibrary: chartLibrarySel,
                                              layout: layoutSel,
                                            };
                                            onAction && onAction(message.id, 'approved', payload);
                                          }}
                                          className="py-1 px-2 bg-black text-white rounded text-xs hover:opacity-90"
                                        >
                                          确定
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <>
                    {hasText && (
                      <div
                        className={`markdown-body ${isUser ? '!text-white' : ''} overflow-x-auto`}
                        style={{
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word',
                          backgroundColor: 'transparent',
                        }}
                        dangerouslySetInnerHTML={rawMarkup(message.content)}
                      />
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default function AiChatApp() {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [isCanvasDrawerOpen, setIsCanvasDrawerOpen] = useState(false);
  const [canvasDrawerId, setCanvasDrawerId] = useState(null);
  const [canvasDrawerLoading, setCanvasDrawerLoading] = useState(false);
  const [canvasDrawerError, setCanvasDrawerError] = useState('');
  const [canvasDoc, setCanvasDoc] = useState(null);
  const [canvasDrawerView, setCanvasDrawerView] = useState('list');
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [articleDraft, setArticleDraft] = useState({
    title: '',
    tagsText: '',
    status: 'pending',
    doneNote: '',
    markdownText: '',
    imageUrls: [],
    contentJsonBase: {},
  });
  const [articleSaving, setArticleSaving] = useState(false);
  const articleDraftsRef = useRef(new Map());

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      content: '你好！我是你的 AI 助手。',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);

  const [todoUserId, setTodoUserId] = useState('default');
  const [todos, setTodos] = useState([]);
  const [todoLoading, setTodoLoading] = useState(false);
  const [todoDraft, setTodoDraft] = useState({
    title: '',
    description: '',
    aiConsideration: '',
    decisionReason: '',
    aiPlan: '',
  });

  const [showHashtagMenu, setShowHashtagMenu] = useState(false);
  const [hashtagQuery, setHashtagQuery] = useState('');
  const [hashtagIndex, setHashtagIndex] = useState(0);
  const [hashtagSuggestions, setHashtagSuggestions] = useState([]);
  const inputRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const fileInputRef = useRef(null);
  const [imageItems, setImageItems] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const messagesEndRef = useRef(null);

  const closeCanvasDrawer = () => {
    setIsCanvasDrawerOpen(false);
    setCanvasDrawerId(null);
    setCanvasDrawerLoading(false);
    setCanvasDrawerError('');
    setCanvasDoc(null);
    setCanvasDrawerView('list');
    setSelectedArticleId(null);
    setArticleDraft({
      title: '',
      tagsText: '',
      status: 'pending',
      doneNote: '',
      markdownText: '',
      imageUrls: [],
      contentJsonBase: {},
    });
    setArticleSaving(false);
    try {
      articleDraftsRef.current = new Map();
    } catch {}
  };

  const parseMarkdownForDraft = (md) => {
    const raw = String(md || '').replace(/\r\n/g, '\n');
    const lines = raw.split('\n');
    const imgs = [];
    let idx = 0;
    for (; idx < lines.length; idx++) {
      const line = String(lines[idx] || '').trim();
      if (!line) continue;
      const m = line.match(/^!\[[^\]]*\]\(([^)\s]+)\)\s*$/);
      if (m && m[1]) {
        imgs.push(m[1]);
        continue;
      }
      break;
    }
    const body = lines.slice(idx).join('\n').replace(/^\n+/, '').trimEnd();
    return { imageUrls: imgs, body };
  };

  const composeMarkdownForDraft = (imageUrls, body) => {
    const imgs = (Array.isArray(imageUrls) ? imageUrls : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const header = imgs.length > 0 ? imgs.map((u) => `![](${u})`).join('\n') : '';
    const b = String(body || '').trim();
    if (!header) return b;
    if (!b) return header;
    return `${header}\n\n${b}`;
  };

  const applyArticleToDraft = (article) => {
    if (!article || typeof article !== 'object') return;
    const aid = Number(article.id);
    if (!Number.isFinite(aid)) return;

    setSelectedArticleId(aid);

    const cached = articleDraftsRef.current?.get?.(aid);
    if (cached && typeof cached === 'object') {
      setArticleDraft({
        title: String(cached.title || ''),
        tagsText: String(cached.tagsText || ''),
        status: String(cached.status || 'pending') || 'pending',
        doneNote: String(cached.doneNote || ''),
        markdownText: String(cached.markdownText || ''),
        imageUrls: Array.isArray(cached.imageUrls) ? cached.imageUrls : [],
        contentJsonBase:
          cached.contentJsonBase && typeof cached.contentJsonBase === 'object'
            ? cached.contentJsonBase
            : {},
      });
      return;
    }

    const tagsArr = Array.isArray(article.tags) ? article.tags : [];
    const base =
      article.contentJson && typeof article.contentJson === 'object'
        ? article.contentJson
        : {};
    const md = typeof base.markdown === 'string' ? base.markdown : '';
    const parsed = parseMarkdownForDraft(md);
    const fallbackImgs = Array.isArray(article.imageUrls)
      ? article.imageUrls.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const imageUrls =
      Array.isArray(parsed.imageUrls) && parsed.imageUrls.length > 0
        ? parsed.imageUrls
        : fallbackImgs;
    setArticleDraft({
      title: String(article.title || ''),
      tagsText: tagsArr.map((t) => String(t || '').trim()).filter(Boolean).join(', '),
      status: String(article.status || 'pending') || 'pending',
      doneNote: String(article.doneNote || ''),
      markdownText: String(parsed.body || ''),
      imageUrls,
      contentJsonBase: base,
    });
  };

  const loadCanvasForDrawer = async (canvasId, nextArticleId) => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    setCanvasDrawerLoading(true);
    setCanvasDrawerError('');
    try {
      const res = await api.getCanvas(cid);
      const doc = res && typeof res === 'object' && res.canvas ? res.canvas : res;
      if (!doc || typeof doc !== 'object') {
        setCanvasDrawerError('无法获取 Canvas 内容');
        setCanvasDoc(null);
        return;
      }
      setCanvasDoc(doc);
      const arts = Array.isArray(doc.articles) ? doc.articles : [];
      let aid = Number(nextArticleId);
      if (!Number.isFinite(aid)) return;
      const chosen = arts.find((a) => Number(a?.id) === aid);
      if (chosen) applyArticleToDraft(chosen);
    } catch {
      setCanvasDrawerError('无法获取 Canvas 内容');
      setCanvasDoc(null);
    } finally {
      setCanvasDrawerLoading(false);
    }
  };

  const openCanvasDrawer = (canvasId) => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    setIsCanvasDrawerOpen(true);
    setCanvasDrawerId(cid);
    setCanvasDrawerView('list');
    setSelectedArticleId(null);
    void loadCanvasForDrawer(cid);
  };

  const persistCurrentDraft = () => {
    const aid = Number(selectedArticleId);
    if (!Number.isFinite(aid)) return;
    try {
      articleDraftsRef.current?.set?.(aid, {
        ...articleDraft,
        title: String(articleDraft.title || ''),
        tagsText: String(articleDraft.tagsText || ''),
        status: String(articleDraft.status || 'pending') || 'pending',
        doneNote: String(articleDraft.doneNote || ''),
        markdownText: String(articleDraft.markdownText || ''),
        imageUrls: Array.isArray(articleDraft.imageUrls) ? articleDraft.imageUrls : [],
        contentJsonBase:
          articleDraft.contentJsonBase && typeof articleDraft.contentJsonBase === 'object'
            ? articleDraft.contentJsonBase
            : {},
      });
    } catch {}
  };

  const selectDrawerArticle = (articleId) => {
    const cid = Number(canvasDrawerId);
    if (!Number.isFinite(cid)) return;
    const doc = canvasDoc;
    const arts = doc && typeof doc === 'object' && Array.isArray(doc.articles) ? doc.articles : [];
    const aid = Number(articleId);
    if (!Number.isFinite(aid)) return;
    const chosen = arts.find((a) => Number(a?.id) === aid);
    if (!chosen) return;
    persistCurrentDraft();
    applyArticleToDraft(chosen);
    setCanvasDrawerView('detail');
  };

  const saveDrawerArticle = async () => {
    const cid = Number(canvasDrawerId);
    const aid = Number(selectedArticleId);
    if (!Number.isFinite(cid) || !Number.isFinite(aid)) return;

    const title = String(articleDraft.title || '').trim();
    const tags = String(articleDraft.tagsText || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const status = String(articleDraft.status || '').trim() || 'pending';
    const doneNote = String(articleDraft.doneNote || '').trim();

    const imageUrls = Array.isArray(articleDraft.imageUrls)
      ? articleDraft.imageUrls.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const md = composeMarkdownForDraft(articleDraft.imageUrls, articleDraft.markdownText);

    const base =
      articleDraft.contentJsonBase && typeof articleDraft.contentJsonBase === 'object'
        ? articleDraft.contentJsonBase
        : {};
    const contentJson = { ...base, markdown: md };

    setArticleSaving(true);
    try {
      const res = await api.updateCanvasArticle(cid, aid, {
        title,
        tags,
        status,
        doneNote: doneNote || undefined,
        imageUrls,
        contentJson,
      });
      const nextDoc = res && typeof res === 'object' && res.canvas ? res.canvas : res;
      if (nextDoc && typeof nextDoc === 'object') {
        setCanvasDoc(nextDoc);
        persistCurrentDraft();
      }
      await loadCanvasForDrawer(cid, aid);
    } finally {
      setArticleSaving(false);
    }
  };

  const clearImages = () => {
    setImageItems((prev) => {
      (Array.isArray(prev) ? prev : []).forEach((it) => {
        if (it && it.preview) {
          try {
            URL.revokeObjectURL(it.preview);
          } catch {}
        }
      });
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePickImages = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleImageFiles = (e) => {
    const files = Array.from((e && e.target && e.target.files) || []);
    if (!files || files.length === 0) return;
    const next = files.map((f) => ({
      id: `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setImageItems((prev) => [...(Array.isArray(prev) ? prev : []), ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    const files = [];
    for (let i = 0; i < (items?.length || 0); i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) files.push(blob);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const next = files.map((f) => ({
        id: `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file: f,
        preview: URL.createObjectURL(f),
      }));
      setImageItems((prev) => [...(Array.isArray(prev) ? prev : []), ...next]);
    }
  };

  const removeImage = (id) => {
    const rid = String(id || '');
    if (!rid) return;
    setImageItems((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const found = arr.find((it) => it && it.id === rid);
      if (found && found.preview) {
        try {
          URL.revokeObjectURL(found.preview);
        } catch {}
      }
      return arr.filter((it) => it && it.id !== rid);
    });
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const loadSessions = async () => {
    const list = await api.listSessions();
    setSessions(list);
    if (!sessionId && list.length > 0) {
      void handleSelectSession(list[0].sessionId);
    } else if (!sessionId && list.length === 0) {
      void handleNewChat();
    }
  };

  const handleNewChat = async () => {
    setSessionId(null);
    setIsSidebarOpen(false);
    clearImages();
    setMessages([
      {
        id: 'welcome',
        role: 'ai',
        content: '你好！我是你的 AI 助手。',
        timestamp: Date.now(),
      },
    ]);
  };

  const handleSelectSession = async (sid) => {
    setSessionId(sid);
    setIsSidebarOpen(false);
    clearImages();
    const history = await api.fetchHistory(sid);
    const msgs = history.map((h, idx) => {
      const segs = [];
      const trs = Array.isArray(h.tool_results) ? h.tool_results : [];
      const tsum = Array.isArray(h.tool_summary) ? h.tool_summary : [];

      if (Array.isArray(h.parts) && h.parts.length > 0) {
        h.parts.forEach((part) => {
          if (part.type === 'text' && part.content) {
            segs.push({ kind: 'text', content: part.content });
          } else if (part.type === 'tool_call') {
            const tr = trs.find((r) => r.id === part.id);
            const raw = tr && tr.output ? tr.output : null;
            let obj = raw && typeof raw === 'object' ? raw : null;
            if (!obj && typeof raw === 'string') {
              try {
                obj = JSON.parse(raw);
              } catch {}
            }
            if (obj && obj.url) {
              segs.push({
                kind: 'external',
                url: obj.url,
                hash: obj.hash,
                status: obj.status || 'pending',
                title: '外链页面',
              });
            }
            segs.push({
              kind: 'tool',
              tool: {
                id: part.id,
                name: part.name || 'tool',
                input: part.input || null,
                output: raw,
                status: 'completed',
              },
            });
          }
        });
      } else {
        trs.forEach((tr) => {
          const name = tr && tr.name ? tr.name : 'tool';
          const raw = tr && tr.output ? tr.output : null;
          let obj = raw && typeof raw === 'object' ? raw : null;
          if (!obj && typeof raw === 'string') {
            try {
              obj = JSON.parse(raw);
            } catch {}
          }
          if (obj && obj.url) {
            segs.push({
              kind: 'external',
              url: obj.url,
              hash: obj.hash,
              status: obj.status || 'pending',
              title: '外链页面',
            });
          }
          segs.push({
            kind: 'tool',
            tool: {
              id: name,
              name,
              input: tr && tr.input ? tr.input : null,
              output: raw,
              status: 'completed',
            },
          });
        });
        if (h.content) {
          segs.push({ kind: 'text', content: h.content });
        }
      }

      const role = h.role === 'assistant' ? 'ai' : 'user';
      const parsed = role === 'user' ? splitReferenceBlock(h.content) : { text: h.content, referenceUrls: [] };

      return {
        id: `hist-${idx}-${Date.now()}`,
        role,
        content: typeof parsed.text === 'string' ? parsed.text : '',
        attachments: (Array.isArray(parsed.referenceUrls) ? parsed.referenceUrls : []).map((url) => ({
          id: url,
          url,
        })),
        segments: segs,
        tool_results: trs.length > 0 ? trs : undefined,
        tool_summary: tsum.length > 0 ? tsum : undefined,
        keywords: h.keywords,
        timestamp: new Date(h.timestamp).getTime(),
      };
    });
    if (msgs.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'ai',
          content: '你好！我是你的 AI 助手。',
          timestamp: Date.now(),
        },
      ]);
    } else {
      setMessages(msgs);
    }
  };

  const handleDeleteSession = async (sid) => {
    const targetSessionId = String(sid || '');
    if (!targetSessionId) return;
    const confirmed = window.confirm('确认删除该会话记录？此操作会清空会话历史。');
    if (!confirmed) return;

    const wasActive = sessionId === targetSessionId;
    if (wasActive) {
      setSessionId(null);
      setActiveTab('chat');
      setMessages([
        {
          id: 'welcome',
          role: 'ai',
          content: '你好！我是你的 AI 助手。',
          timestamp: Date.now(),
        },
      ]);
    }

    await api.deleteSession(targetSessionId);
    const list = await api.listSessions();
    setSessions(list);
    if (wasActive) {
      if (list.length > 0) {
        void handleSelectSession(list[0].sessionId);
      } else {
        void handleNewChat();
      }
    }
  };

  const loadTodos = async (userId) => {
    setTodoLoading(true);
    try {
      const data = await api.listTodos(userId);
      const rows = Array.isArray(data?.todos) ? data.todos : [];
      setTodos(rows);
    } finally {
      setTodoLoading(false);
    }
  };

  const handleScreenshot = async () => {
    try {
      const element = document.body;
      const canvas = await html2canvas(element, {
        useCORS: true,
        logging: false,
        ignoreElements: () => false,
      });
      const link = document.createElement('a');
      link.download = `chat-screenshot-${Date.now()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (err) {
      console.error('Screenshot failed', err);
    }
  };

  const handleInputChange = (e) => {
    const text = e.target.value;
    setInput(text);

    const match = /(^|\s)#([A-Za-z0-9_-]*)$/.exec(text.slice(0, e.target.selectionStart));
    if (match) {
      const query = match[2] || '';
      setHashtagQuery(query);
      const externals = (Array.isArray(resources) ? resources : []).filter(
        (r) =>
          r &&
          r.type === 'external' &&
          typeof r.content === 'string' &&
          (r.content.startsWith('http') || r.content.startsWith('/')),
      );
      const sug = externals
        .map((r, idx) => ({
          token: String(r.id || idx + 1),
          title: r.title || r.content,
        }))
        .filter((x) =>
          String(x.title || '')
            .toLowerCase()
            .includes(String(query || '').toLowerCase()),
        )
        .slice(0, 8);
      setHashtagSuggestions(sug);
      setHashtagIndex(0);
      setShowHashtagMenu(true);
    } else {
      setShowHashtagMenu(false);
    }
  };

  const insertHashtag = (item) => {
    if (!inputRef.current) return;
    const text = input;
    const pos = inputRef.current.selectionStart;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const newBefore = before.replace(/(^|\s)#[A-Za-z0-9_-]*$/, (m) => {
      const pre = /^\s/.test(m) ? ' ' : '';
      return `${pre}#${item.token} `;
    });
    const next = newBefore + after;
    setInput(next);
    setShowHashtagMenu(false);
    requestAnimationFrame(() => {
      try {
        const p = newBefore.length;
        inputRef.current.setSelectionRange(p, p);
      } catch {}
    });
  };

  const reloadResources = async () => {
    if (!sessionId) return;
    setLoadingResources(true);
    try {
      const jobs = await api.listFrontendJobs(sessionId);
      setResources(normalizeFrontendJobs(jobs));
    } finally {
      setLoadingResources(false);
    }
  };

  const sendMessage = async ({ text, imageItems: sendImageItems }) => {
    const safeText = String(text || '').trim();
    const hasImages = Array.isArray(sendImageItems) && sendImageItems.length > 0;
    if (!safeText && !hasImages) return;

    setIsTyping(true);
    setShowHashtagMenu(false);

    let sid = sessionId;
    if (!sid) {
      const created = await api.createSession();
      sid = created?.sessionId;
      setSessionId(sid);
      const provisional = String(safeText || (hasImages ? '图片会话' : '')).slice(0, 30);
      setSessions((prev) => {
        const exists = (Array.isArray(prev) ? prev : []).some((x) => x.sessionId === sid);
        if (exists) return prev;
        return [
          {
            sessionId: sid,
            title: provisional.length > 0 ? provisional : '新会话',
            updatedAt: Date.now(),
          },
          ...(Array.isArray(prev) ? prev : []),
        ];
      });
      void api.listSessions().then((list) => setSessions(list));
    }

    const userMsgId = `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticAttachments = hasImages
      ? (Array.isArray(sendImageItems) ? sendImageItems : [])
          .filter((x) => x && x.preview)
          .map((x) => ({ id: x.id, preview: x.preview, name: x.file?.name }))
      : [];

    const userMsg = {
      id: userMsgId,
      role: 'user',
      content: safeText,
      attachments: optimisticAttachments,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    let uploaded = { files: [] };
    if (hasImages) {
      setIsUploadingImages(true);
      uploaded = await api.uploadImages(
        (Array.isArray(sendImageItems) ? sendImageItems : []).map((x) => x.file),
      );
      setIsUploadingImages(false);
      clearImages();
    }

    const uploadedUrls = (uploaded?.files || [])
      .map((f) => f && (f.url || f.path))
      .filter(Boolean);

    if (hasImages) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== userMsgId) return m;
          const existing = Array.isArray(m.attachments) ? m.attachments : [];
          const merged = existing.map((a, idx) => ({
            ...a,
            url: uploadedUrls[idx] || a.url,
          }));
          const extras = uploadedUrls
            .slice(merged.length)
            .map((url) => ({ id: url, url }));
          return { ...m, attachments: [...merged, ...extras] };
        }),
      );
    }

    const payloadText = hasImages
      ? `${safeText}\n\n[参考图] ${uploadedUrls.join('\n')}`
      : safeText;

    const aiMsgId = `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        role: 'ai',
        content: '',
        segments: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      const res = await api.streamChatPost(sid, payloadText, {});
      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let acc = '';
      const currentTools = [];

      const appendDelta = (base, delta) => {
        const a = typeof base === 'string' ? base : String(base || '');
        const b = typeof delta === 'string' ? delta : String(delta || '');
        if (!b) return a;
        if (b.startsWith(a)) return b;
        let i = 0;
        const m = Math.min(a.length, b.length);
        while (i < m && a[i] === b[i]) i++;
        return a + b.slice(i);
      };

      const pushAiUpdate = (patch) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            const next = typeof patch === 'function' ? patch(m) : { ...m, ...patch };
            return next;
          }),
        );
      };

      const syncToolResults = () => {
        pushAiUpdate((m) => ({
          ...m,
          tools: currentTools.map((t) => ({ ...t })),
          tool_results: currentTools.map((t) => {
            const { argsBuffer, ...rest } = t || {};
            return rest;
          }),
        }));
      };

      const upsertToolSegment = (toolObj, prevId) => {
        if (!toolObj) return;
        const tid = String(toolObj.id || '');
        const pid = String(prevId || '');
        pushAiUpdate((m) => {
          const segs = Array.isArray(m.segments) ? [...m.segments] : [];
          let sidx = -1;
          if (tid) {
            sidx = segs
              .map((s) => (s && s.kind === 'tool' ? s.tool?.id : undefined))
              .lastIndexOf(tid);
          }
          if (sidx === -1 && pid) {
            sidx = segs
              .map((s) => (s && s.kind === 'tool' ? s.tool?.id : undefined))
              .lastIndexOf(pid);
          }
          if (sidx === -1) {
            segs.push({ kind: 'tool', tool: { ...toolObj } });
          } else {
            const seg = segs[sidx];
            segs[sidx] = { ...seg, tool: { ...toolObj } };
          }
          return { ...m, segments: segs };
        });
      };

      const maybeAddExternalSegment = (toolOutput) => {
        let obj = toolOutput && typeof toolOutput === 'object' ? toolOutput : null;
        if (!obj && typeof toolOutput === 'string') {
          try {
            obj = JSON.parse(toolOutput);
          } catch {
            obj = null;
          }
        }
        if (!obj || typeof obj !== 'object') return;

        const url = typeof obj.url === 'string' ? obj.url : '';
        if (!url) return;

        const prefaceExternal = '好的，我们已经为您生成了一个图表界面。';
        pushAiUpdate((m) => {
          const segs = Array.isArray(m.segments) ? [...m.segments] : [];
          const last = segs[segs.length - 1];
          const preface = prefaceExternal;
          if (preface.length > 0) {
            if (last && last.kind === 'text') {
              const merged = appendDelta(last.content || '', `\n\n${preface}\n`);
              segs[segs.length - 1] = { kind: 'text', content: merged };
            } else {
              segs.push({ kind: 'text', content: preface });
            }
          }

          if (url) {
            const exists = segs.some(
              (s) => s && s.kind === 'external' && (s.url === url || (obj.hash && s.hash === obj.hash)),
            );
            if (!exists) {
              segs.push({
                kind: 'external',
                url,
                hash: obj.hash,
                status: obj.status || 'pending',
                title: '外链页面',
              });
            }
          }

          return { ...m, segments: segs };
        });
      };

      const addToolSummaryLine = (line) => {
        const s = String(line || '').trim();
        if (!s) return;
        pushAiUpdate((m) => ({
          ...m,
          tool_summary: [...(Array.isArray(m.tool_summary) ? m.tool_summary : []), s].slice(-12),
        }));
      };
      const handleSsePayload = (payload) => {
        if (typeof payload === 'string') {
          addToolSummaryLine(payload);
          return;
        }
        if (!payload || typeof payload !== 'object') return;

        const type = payload.type;
        const data = payload.data;

        if (type === 'log') {
          addToolSummaryLine(data);
          const line = String(data || '').trim();
          if (line) {
            pushAiUpdate((m) => {
              const segs = Array.isArray(m.segments) ? [...m.segments] : [];
              segs.push({ kind: 'log', content: line });
              return { ...m, segments: segs };
            });
          }
          return;
        }

        if (type === 'token') {
          const tokenText = typeof data?.text === 'string' ? data.text : '';
          if (!tokenText) return;
          acc = appendDelta(acc, tokenText);
          pushAiUpdate((m) => ({ ...m, content: acc }));
          pushAiUpdate((m) => {
            const segs = Array.isArray(m.segments) ? [...m.segments] : [];
            const last = segs[segs.length - 1];
            if (last && last.kind === 'text') {
              const merged = appendDelta(last.content || '', tokenText);
              segs[segs.length - 1] = { kind: 'text', content: merged };
            } else {
              segs.push({ kind: 'text', content: tokenText });
            }
            return { ...m, segments: segs };
          });
          return;
        }

        if (type === 'custom') {
          const dd = data;
          const isObj = dd && typeof dd === 'object';
          const ttype = isObj ? dd.type : undefined;
          const text = isObj ? dd.text : typeof dd === 'string' ? dd : '';
          if (ttype === 'tool_thought' && text) {
            const isAnswerLike =
              (text && text.length >= 150) ||
              /(^#|\n#|\n##|\n\*\*)/.test(text) ||
              /报告|分析|结论|结果/.test(text);

            if (isAnswerLike) {
              acc = appendDelta(acc, text);
              pushAiUpdate((m) => ({ ...m, content: acc }));
              pushAiUpdate((m) => {
                const segs = Array.isArray(m.segments) ? [...m.segments] : [];
                const last = segs[segs.length - 1];
                if (last && last.kind === 'text') {
                  const merged = appendDelta(last.content || '', text);
                  segs[segs.length - 1] = { kind: 'text', content: merged };
                } else {
                  segs.push({ kind: 'text', content: text });
                }
                return { ...m, segments: segs };
              });
            } else {
              const tid = isObj ? dd.id : undefined;
              let idx = -1;
              if (typeof tid === 'string' && tid.length > 0) {
                idx = currentTools.findIndex((t) => t && t.id === tid);
              }
              if (idx === -1) {
                const lastName = currentTools
                  .filter((t) => t && t.status === 'running')
                  .map((t) => t.name)
                  .pop();
                if (lastName) {
                  idx = currentTools.findIndex(
                    (t) => t && t.name === lastName && t.status === 'running',
                  );
                }
              }
              if (idx !== -1) {
                const tool = currentTools[idx];
                const prevId = tool?.id;
                const nextTool = {
                  ...tool,
                  streamingContent: appendDelta(tool?.streamingContent || '', text),
                };
                currentTools[idx] = nextTool;
                upsertToolSegment(nextTool, prevId);
                syncToolResults();
              }
            }
          } else if (text) {
            pushAiUpdate((m) => {
              const segs = Array.isArray(m.segments) ? [...m.segments] : [];
              segs.push({ kind: 'log', content: text });
              return { ...m, segments: segs };
            });
          }
          return;
        }

        if (type === 'reasoning') {
          const text = typeof data?.text === 'string' ? data.text : '';
          if (!text) return;
          pushAiUpdate((m) => {
            const segs = Array.isArray(m.segments) ? [...m.segments] : [];
            segs.push({ kind: 'reasoning', content: text });
            return { ...m, segments: segs };
          });
          return;
        }

        if (type === 'end') {
          const endText = typeof data?.text === 'string' ? data.text : '';
          if (endText) {
            acc = endText;
            pushAiUpdate((m) => ({ ...m, content: acc }));
          }
          if (Array.isArray(data?.tool_results)) {
            pushAiUpdate((m) => ({
              ...m,
              tool_results: data.tool_results,
            }));
          }
          if (Array.isArray(data?.tool_summary)) {
            const lines = data.tool_summary
              .map((x) => (typeof x === 'string' ? x : formatDebugBlock(x)))
              .filter(Boolean);
            if (lines.length > 0) {
              pushAiUpdate((m) => ({
                ...m,
                tool_summary: [...(Array.isArray(m.tool_summary) ? m.tool_summary : []), ...lines].slice(-12),
              }));
            }
          }
          pushAiUpdate((m) => ({
            ...m,
            tools: [...currentTools],
            isStreaming: false,
          }));
          return;
        }

        if (type === 'tool_start') {
          const id = typeof data?.id === 'string' ? data.id : '';
          const name = typeof data?.name === 'string' ? data.name : 'tool';

          const existingIdx = id ? currentTools.findIndex((t) => t && t.id === id) : -1;
          if (existingIdx === -1) {
            const toolObj = {
              id: id || `tool-${Date.now()}`,
              name,
              input: data?.input ?? null,
              output: null,
              argsBuffer: '',
              streamingContent: '',
              status: 'running',
            };
            currentTools.push(toolObj);
            upsertToolSegment(toolObj);
            syncToolResults();
          } else {
            // 当 tool 已存在但 input 为 null 时，更新其 input
            const existing = currentTools[existingIdx];
            if (existing && existing.input == null && typeof data?.input !== 'undefined') {
              const prevId = existing.id;
              const nextTool = {
                ...existing,
                input: data.input,
                name: existing.name || name,
              };
              currentTools[existingIdx] = nextTool;
              upsertToolSegment(nextTool, prevId);
              syncToolResults();
            }
          }
          return;
        }

        if (type === 'tool_chunk') {
          const id = typeof data?.id === 'string' ? data.id : '';
          const name = typeof data?.name === 'string' ? data.name : '';
          const args = typeof data?.args === 'string' ? data.args : '';
          const index = data?.index;

          if (!id && !name) return;

          let idx = -1;
          if (id) idx = currentTools.findIndex((t) => t && t.id === id);
          if (idx === -1 && name) {
            idx = currentTools.findIndex((t) => t && t.name === name && t.status === 'running');
          }
          if (idx === -1) {
            idx = currentTools.map((t) => t?.status).lastIndexOf('running');
          }

          if (idx === -1) {
            const toolObj = {
              id: id || `tool-${Date.now()}-${index ?? 0}`,
              name: name || 'unknown',
              input: null,
              output: null,
              argsBuffer: args || '',
              streamingContent: '',
              status: 'running',
            };
            currentTools.push(toolObj);
            upsertToolSegment(toolObj);
            syncToolResults();
            return;
          }

          const tool = currentTools[idx];
          const prevId = tool?.id;
          const newArgs = appendDelta(tool?.argsBuffer || '', args || '');
          let newInput = tool?.input ?? null;
          try {
            newInput = JSON.parse(newArgs);
          } catch {
            void 0;
          }
          const nextTool = {
            ...tool,
            argsBuffer: newArgs,
            input: newInput,
            name: tool?.name === 'unknown' && name ? name : tool?.name,
            id: (!tool?.id || String(tool.id).startsWith('tool-')) && id ? id : tool?.id,
          };
          currentTools[idx] = nextTool;
          upsertToolSegment(nextTool, prevId);
          syncToolResults();
          return;
        }

        if (type === 'tool_end') {
          const id = typeof data?.id === 'string' ? data.id : '';
          const name = typeof data?.name === 'string' ? data.name : '';
          const output = data?.output ?? null;
          const input = typeof data?.input !== 'undefined' ? data.input : undefined;

          let idx = -1;
          if (id) idx = currentTools.findIndex((t) => t && t.id === id);
          if (idx === -1 && name) {
            const rev = currentTools
              .slice()
              .reverse()
              .findIndex((t) => t && t.name === name && t.status === 'running');
            if (rev !== -1) idx = currentTools.length - 1 - rev;
          }

          if (idx !== -1) {
            const prevId = currentTools[idx]?.id;
            const nextTool = {
              ...currentTools[idx],
              id: currentTools[idx]?.id || id || `tool-${Date.now()}`,
              name: currentTools[idx]?.name || name || 'tool',
              input:
                typeof input !== 'undefined' && (currentTools[idx]?.input == null)
                  ? input
                  : currentTools[idx]?.input,
              output,
              status: 'completed',
            };
            currentTools[idx] = nextTool;
            upsertToolSegment(nextTool, prevId);
            syncToolResults();
            maybeAddExternalSegment(output);
          }
          return;
        }

        if (type === 'error') {
          const msg = typeof data?.message === 'string' ? data.message : '未知错误';
          const code = typeof data?.code === 'string' ? data.code : undefined;
          const canContinue = Boolean(data?.can_continue);
          pushAiUpdate((m) => {
            const segs = Array.isArray(m.segments) ? [...m.segments] : [];
            segs.push({ kind: 'error', code, message: msg, can_continue: canContinue });
            return { ...m, segments: segs };
          });
          pushAiUpdate((m) => ({
            ...m,
            content: `请求失败：${msg}`,
          }));
        }
      };

      if (!reader) throw new Error('no reader');
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');

        while (true) {
          const idx = buffer.indexOf('\n\n');
          if (idx < 0) break;
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const dataLines = rawEvent
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');

          let parsed;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            parsed = dataStr;
          }
          handleSsePayload(parsed);
        }
      }

      const trailing = buffer.trim();
      if (trailing.startsWith('data:')) {
        const dataLines = trailing
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length > 0) {
          const dataStr = dataLines.join('\n');
          let parsed;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            parsed = dataStr;
          }
          handleSsePayload(parsed);
        }
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                content:
                  '请求失败：无法获取流式响应。请检查后端 /chat/stream。',
              }
            : m,
        ),
      );
    } finally {
      setIsTyping(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, isStreaming: false } : m)),
      );
      void reloadResources();
      void loadSessions();
    }
  };

  const handleSend = async () => {
    const text = String(input || '').trim();
    const hasImages = Array.isArray(imageItems) && imageItems.length > 0;
    if (!text && !hasImages) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    await sendMessage({ text, imageItems });
  };

  const handleExecuteCanvas = (canvasId) => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    void sendMessage({ text: `执行 canvas ${cid}`, imageItems: [] });
  };

  const handleCreateTodo = async () => {
    const title = String(todoDraft.title || '').trim();
    if (!title) return;
    const description = String(todoDraft.description || '').trim();
    const uid = String(todoUserId || '').trim() || 'default';
    const aiConsideration = String(todoDraft.aiConsideration || '').trim();
    const decisionReason = String(todoDraft.decisionReason || '').trim();
    const aiPlan = String(todoDraft.aiPlan || '').trim();
    const payload = {
      userId: uid,
      title,
      description: description || undefined,
      aiConsideration: aiConsideration || `基于标题“${title}”形成的待办事项。`,
      decisionReason: decisionReason || '由用户在待办池中手动创建。',
      aiPlan: aiPlan || '建议按步骤执行：拆分任务、设定截止时间、逐步完成。',
    };
    const res = await api.createTodo(payload);
    if (res) {
      setTodoDraft({
        title: '',
        description: '',
        aiConsideration: '',
        decisionReason: '',
        aiPlan: '',
      });
      await loadTodos(uid);
    }
  };

  const handleTodoStatus = async (id, status) => {
    const todoId = Number(id);
    const nextStatus = String(status || '').trim();
    if (!todoId || !nextStatus) return;

    setTodos((prev) =>
      (Array.isArray(prev) ? prev : []).map((t) =>
        Number(t?.id) === todoId ? { ...t, status: nextStatus } : t,
      ),
    );

    const res = await api.updateTodo(todoId, { status: nextStatus });
    if (res && res.todo && Number(res.todo.id) === todoId) {
      setTodos((prev) =>
        (Array.isArray(prev) ? prev : []).map((t) =>
          Number(t?.id) === todoId ? { ...t, ...res.todo } : t,
        ),
      );
      return;
    }

    await loadTodos(String(todoUserId || '').trim() || 'default');
  };

  const handleDeleteTodo = async (id) => {
    const ok = window.confirm('确认删除该待办？');
    if (!ok) return;
    await api.deleteTodo(id);
    await loadTodos(String(todoUserId || '').trim() || 'default');
  };

  useEffect(() => {
    if (activeTab === 'resources' && sessionId) {
      void reloadResources();
    }
    if (activeTab === 'todo') {
      void loadTodos(String(todoUserId || '').trim() || 'default');
    }
  }, [activeTab, sessionId]);

  const groupedResources = useMemo(() => {
    const list = Array.isArray(resources) ? resources : [];
    const externals = list
      .filter((r) => r && r.type === 'external')
      .map((r, idx) => ({ ...r, id: r.id || idx + 1 }));
    return { externals };
  }, [resources]);

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-50 border-r border-gray-200 flex flex-col h-full transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-gray-200 flex flex-col gap-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 bg-black text-white py-2 px-4 rounded hover:bg-gray-800 transition-colors"
          >
            <Plus size={16} />
            <span>新会话</span>
          </button>
          <button
            onClick={() => setActiveTab('todo')}
            className="w-full flex items-center justify-center gap-2 bg-white text-gray-800 py-2 px-4 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
          >
            <CheckCircle size={16} />
            <span>待办池</span>
          </button>
        </div>
        <div className="flex-1 p-2 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => void handleSelectSession(s.sessionId)}
              className={`group p-3 mb-2 rounded cursor-pointer transition-colors flex items-start gap-2 ${
                sessionId === s.sessionId ? 'bg-gray-200' : 'hover:bg-gray-100'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {s.title ? (
                    s.title
                  ) : (
                    <span className="text-gray-400 italic flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" />
                      生成标题中...
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(s.updatedAt || Date.now()).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                disabled={isTyping && sessionId === s.sessionId}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteSession(s.sessionId);
                }}
                className={`shrink-0 mt-0.5 h-7 w-7 rounded flex items-center justify-center border border-transparent transition-all ${
                  isTyping && sessionId === s.sessionId
                    ? 'opacity-30 cursor-not-allowed'
                    : 'opacity-0 group-hover:opacity-100 hover:bg-white hover:border-gray-200'
                }`}
                title="删除会话"
              >
                <Trash2 size={14} className="text-gray-500" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-xs text-center text-gray-400 mt-4">暂无历史记录</div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full relative bg-white w-full">
        <header className="relative h-16 border-b border-gray-100 flex items-center justify-center shrink-0 bg-white z-10">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute left-4 p-2 text-gray-500 hover:text-black transition-colors rounded-full hover:bg-gray-100 md:hidden"
            title="菜单"
          >
            <Menu size={20} />
          </button>
          <div className="flex p-1 bg-gray-100 rounded-full w-64 shadow-inner">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 px-4 text-sm font-medium rounded-full transition-all ${
                activeTab === 'chat'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              对话
            </button>
            <button
              onClick={() => setActiveTab('resources')}
              className={`flex-1 py-1.5 px-4 text-sm font-medium rounded-full transition-all ${
                activeTab === 'resources'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              资源预览
            </button>
          </div>
          <div className="absolute right-4 flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-gray-500 hover:text-black transition-colors rounded-full hover:bg-gray-100"
              title="设置"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={handleScreenshot}
              className="p-2 text-gray-500 hover:text-black transition-colors rounded-full hover:bg-gray-100"
              title="截图"
            >
              <Camera size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'chat' && (
            <div className="h-full flex flex-col animate__animated animate__fadeIn">
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    resources={resources}
                    onExecuteCanvas={handleExecuteCanvas}
                    onOpenCanvas={openCanvasDrawer}
                    onRefreshResources={reloadResources}
                  />
                ))}

                {isTyping && !messages.some((m) => m.isStreaming) && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm ml-2">
                    <Loader2 size={16} className="animate-spin" /> 思考中...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 bg-white/80 backdrop-blur-sm z-20">
                <div className="max-w-4xl mx-auto">
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-black/5 transition-all relative">
                    {Array.isArray(imageItems) && imageItems.length > 0 && (
                        <div className="px-4 pt-4 flex flex-wrap gap-2">
                          {imageItems.map((it) => (
                            <div key={it.id} className="relative group">
                              <img
                                src={it.preview}
                                className="h-16 w-16 rounded-lg object-cover ring-1 ring-gray-200"
                              />
                              <button
                                type="button"
                                onClick={() => removeImage(it.id)}
                                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-black text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={clearImages}
                            className="h-16 px-3 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700 bg-gray-50 flex items-center justify-center"
                          >
                            清空
                          </button>
                        </div>
                    )}

                    <textarea
                      value={input}
                      onPaste={handlePaste}
                      onChange={(e) => {
                        handleInputChange(e);
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (showHashtagMenu) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHashtagIndex((i) =>
                              Math.min(i + 1, hashtagSuggestions.length - 1),
                            );
                            return;
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHashtagIndex((i) => Math.max(i - 1, 0));
                            return;
                          } else if (e.key === 'Enter') {
                            e.preventDefault();
                            insertHashtag(hashtagSuggestions[hashtagIndex]);
                            return;
                          } else if (e.key === 'Escape') {
                            setShowHashtagMenu(false);
                            return;
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="输入消息...（可上传参考图；回车发送，Shift+Enter 换行）"
                      className="w-full bg-transparent border-0 px-4 py-3 text-sm focus:outline-none resize-none max-h-60 min-h-[56px]"
                      rows={1}
                      disabled={isTyping || isUploadingImages}
                      ref={inputRef}
                    />

                    <div className="flex items-center justify-between px-3 pb-3 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handlePickImages}
                          disabled={isTyping || isUploadingImages}
                          className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${
                            isTyping || isUploadingImages
                              ? 'opacity-40 cursor-not-allowed text-gray-300'
                              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                          }`}
                          title="上传图片"
                        >
                          <FileText size={18} />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleImageFiles}
                        />

                        <button
                          onClick={() => setAutoScroll((v) => !v)}
                          className={`h-8 px-2 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
                            autoScroll
                              ? 'bg-gray-100 text-gray-900 font-medium'
                              : 'text-gray-500 hover:bg-gray-50'
                          }`}
                          title="自动滚动"
                        >
                          <span>置底</span>
                          <span
                            className={`block w-1.5 h-1.5 rounded-full ${
                              autoScroll ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          ></span>
                        </button>
                      </div>

                      <button
                        onClick={() => void handleSend()}
                        disabled={
                          (!String(input || '').trim() &&
                            (!Array.isArray(imageItems) || imageItems.length === 0)) ||
                          isTyping ||
                          isUploadingImages
                        }
                        className="h-8 px-3 flex items-center gap-2 rounded-lg bg-black text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
                      >
                        {isTyping || isUploadingImages ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <>
                            <span>发送</span>
                            <Send size={14} />
                          </>
                        )}
                      </button>
                    </div>

                    {showHashtagMenu && (
                      <div className="absolute left-0 bottom-full mb-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-2 animate__animated animate__fadeInUp z-50">
                        <div className="text-xs text-gray-500 mb-1 px-2">
                          选择外链资源以插入到 # 后
                        </div>
                        <ul>
                          {hashtagSuggestions.map((item, idx) => (
                            <li
                              key={item.token}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertHashtag(item);
                              }}
                              className={`px-2 py-1 text-sm cursor-pointer rounded ${
                                idx === hashtagIndex ? 'bg-gray-100' : ''
                              }`}
                            >
                              <span className="font-medium">{item.title || '外链页面'}</span>
                              <span className="ml-2 text-xs text-gray-500">{item.status || 'pending'}</span>
                            </li>
                          ))}
                          {hashtagSuggestions.length === 0 && (
                            <li className="px-2 py-1 text-sm text-gray-400">无匹配资源</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="text-center mt-2">
                    <span className="text-xs text-gray-400">AI 内容仅供参考</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'resources' && (
            <div className="h-full p-6 overflow-y-auto animate__animated animate__fadeIn">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Layers className="text-black" /> 会话外链资源
                  </h2>
                  {loadingResources && <Loader2 className="animate-spin text-gray-400" />}
                </div>

                {!loadingResources && groupedResources.externals.length === 0 && (
                  <div className="text-center text-gray-400 py-10 border-2 border-dashed border-gray-100 rounded-xl">
                    暂无资源 (请进行更多对话)
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {groupedResources.externals.map((res) => (
                    <div
                      key={res.id}
                      className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
                          <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {res.title || '外链页面'}
                          </div>
                          <div className="mt-1 text-sm">
                            <a
                              href={toAbsoluteUrl(res.content)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline break-words"
                            >
                              {res.content}
                            </a>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            状态: {res.status || 'pending'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'todo' && (
            <div className="h-full p-6 overflow-y-auto animate__animated animate__fadeIn">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <CheckCircle className="text-black" /> 待办池
                  </h2>
                  <div className="flex items-center gap-2">
                    <input
                      value={todoUserId}
                      onChange={(e) => setTodoUserId(e.target.value)}
                      className="h-9 px-3 border border-gray-200 rounded text-sm bg-white"
                      placeholder="userId"
                    />
                    <button
                      onClick={() =>
                        void loadTodos(String(todoUserId || '').trim() || 'default')
                      }
                      className="h-9 px-3 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50"
                      disabled={todoLoading}
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-xl p-4 mb-6">
                  <div className="grid grid-cols-1 gap-3">
                    <input
                      value={todoDraft.title}
                      onChange={(e) =>
                        setTodoDraft((d) => ({
                          ...d,
                          title: e.target.value,
                        }))
                      }
                      className="h-10 px-3 border border-gray-200 rounded text-sm"
                      placeholder="待办标题"
                    />
                    <textarea
                      value={todoDraft.description}
                      onChange={(e) =>
                        setTodoDraft((d) => ({
                          ...d,
                          description: e.target.value,
                        }))
                      }
                      className="px-3 py-2 border border-gray-200 rounded text-sm"
                      rows={2}
                      placeholder="描述（可选）"
                    />
                    <textarea
                      value={todoDraft.aiConsideration}
                      onChange={(e) =>
                        setTodoDraft((d) => ({
                          ...d,
                          aiConsideration: e.target.value,
                        }))
                      }
                      className="px-3 py-2 border border-gray-200 rounded text-sm"
                      rows={2}
                      placeholder="AI 考量（可留空自动生成）"
                    />
                    <textarea
                      value={todoDraft.decisionReason}
                      onChange={(e) =>
                        setTodoDraft((d) => ({
                          ...d,
                          decisionReason: e.target.value,
                        }))
                      }
                      className="px-3 py-2 border border-gray-200 rounded text-sm"
                      rows={2}
                      placeholder="决策过程（可留空自动生成）"
                    />
                    <textarea
                      value={todoDraft.aiPlan}
                      onChange={(e) =>
                        setTodoDraft((d) => ({
                          ...d,
                          aiPlan: e.target.value,
                        }))
                      }
                      className="px-3 py-2 border border-gray-200 rounded text-sm"
                      rows={2}
                      placeholder="AI 计划（可留空自动生成）"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => void handleCreateTodo()}
                        className="h-9 px-4 bg-black text-white rounded text-sm hover:bg-gray-800"
                        disabled={!String(todoDraft.title || '').trim()}
                      >
                        新增待办
                      </button>
                    </div>
                  </div>
                </div>

                {!todoLoading && todos.length === 0 && (
                  <div className="text-center text-gray-400 py-10 border-2 border-dashed border-gray-100 rounded-xl">
                    暂无待办
                  </div>
                )}

                <div className="space-y-3">
                  {todos.map((t) => (
                    <div key={t.id} className="bg-white border border-gray-100 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            #{t.id} {t.title}
                          </div>
                          {t.description && (
                            <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                              {t.description}
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-2">状态: {t.status}</div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <select
                            value={t.status}
                            onChange={(e) => void handleTodoStatus(t.id, e.target.value)}
                            className="h-8 px-2 border border-gray-200 rounded text-sm bg-white"
                          >
                            <option value="pending">pending</option>
                            <option value="in_progress">in_progress</option>
                            <option value="done">done</option>
                            <option value="cancelled">cancelled</option>
                          </select>
                          <button
                            onClick={() => void handleDeleteTodo(t.id)}
                            className="h-8 w-8 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50"
                            title="删除"
                          >
                            <Trash2 size={14} className="text-gray-600" />
                          </button>
                        </div>
                      </div>
                      {(t.aiConsideration || t.decisionReason || t.aiPlan) && (
                        <div className="mt-3 space-y-2">
                          {t.aiConsideration && (
                            <div className="text-sm text-gray-700">
                              <div className="text-xs font-semibold text-gray-500 mb-0.5">AI 考量</div>
                              <div className="whitespace-pre-wrap">{t.aiConsideration}</div>
                            </div>
                          )}
                          {t.decisionReason && (
                            <div className="text-sm text-gray-700">
                              <div className="text-xs font-semibold text-gray-500 mb-0.5">决策过程</div>
                              <div className="whitespace-pre-wrap">{t.decisionReason}</div>
                            </div>
                          )}
                          {t.aiPlan && (
                            <div className="text-sm text-gray-700">
                              <div className="text-xs font-semibold text-gray-500 mb-0.5">AI 计划</div>
                              <div className="whitespace-pre-wrap">{t.aiPlan}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {isCanvasDrawerOpen && (
          <div className="absolute inset-0 z-40 flex justify-end">
            <div
              className="absolute inset-0 bg-black/20"
              onClick={closeCanvasDrawer}
            />
            <div className="relative w-full max-w-md h-full bg-white border-l border-gray-200 shadow-xl flex flex-col">
              <div className="h-14 px-4 border-b border-gray-100 flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-2">
                  {canvasDrawerView === 'detail' ? (
                    <button
                      type="button"
                      className="h-8 px-2 rounded border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        persistCurrentDraft();
                        setCanvasDrawerView('list');
                      }}
                    >
                      返回
                    </button>
                  ) : null}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
                      Canvas {Number.isFinite(Number(canvasDrawerId)) ? `#${canvasDrawerId}` : ''}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {canvasDrawerView === 'detail' ? '模拟页面编辑' : '文章模拟页'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="h-8 w-8 rounded flex items-center justify-center hover:bg-gray-100 text-gray-600"
                  onClick={closeCanvasDrawer}
                  title="关闭"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {canvasDrawerLoading && (
                  <div className="text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> 加载中...
                  </div>
                )}

                {!canvasDrawerLoading && canvasDrawerError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
                    {canvasDrawerError}
                  </div>
                )}

                {!canvasDrawerLoading && !canvasDrawerError && canvasDoc && (
                  <>
                    {canvasDrawerView === 'list' ? (
                      <>
                        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
                          <div>状态: {String(canvasDoc.status || '')}</div>
                          <div className="mt-1">userId: {String(canvasDoc.userId || '')}</div>
                          <div className="mt-1">
                            updatedAt:{' '}
                            {canvasDoc.updatedAt
                              ? new Date(canvasDoc.updatedAt).toLocaleString()
                              : ''}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {(Array.isArray(canvasDoc.articles) ? canvasDoc.articles : []).map((a) => {
                            const contentJson =
                              a && typeof a === 'object' && a.contentJson && typeof a.contentJson === 'object'
                                ? a.contentJson
                                : {};
                            const md = typeof contentJson.markdown === 'string' ? contentJson.markdown : '';
                            const parsed = parseMarkdownForDraft(md);
                            const snippet = String(parsed.body || '')
                              .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
                              .replace(/[#>*_~\[\]\(\)!]/g, '')
                              .replace(/\s+/g, ' ')
                              .trim()
                              .slice(0, 60);
                            const coverRaw =
                              (Array.isArray(parsed.imageUrls) && parsed.imageUrls.length > 0
                                ? parsed.imageUrls[0]
                                : Array.isArray(a.imageUrls) && a.imageUrls.length > 0
                                  ? a.imageUrls[0]
                                  : '') || '';
                            const cover = coverRaw ? toAbsoluteUrl(coverRaw) : '';

                            return (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => selectDrawerArticle(a.id)}
                                className="text-left rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow bg-white"
                              >
                                <div className="aspect-[3/4] bg-gray-100 overflow-hidden">
                                  {cover ? (
                                    <img src={cover} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">暂无封面</div>
                                  )}
                                </div>
                                <div className="p-2">
                                  <div className="text-xs font-semibold text-gray-900 line-clamp-2">{a.title || '(无标题)'}</div>
                                  <div className="mt-1 text-[11px] text-gray-500 line-clamp-2">{snippet || '（暂无正文）'}</div>
                                  <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
                                    <span>#{a.id}</span>
                                    <span>{String(a.status || '')}</span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-gray-500">文章：</span>
                              <span className="text-gray-900">#{selectedArticleId}</span>
                            </div>
                            <button
                              type="button"
                              className="h-7 px-2 rounded border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                const cid = Number(canvasDrawerId);
                                if (!Number.isFinite(cid)) return;
                                persistCurrentDraft();
                                void loadCanvasForDrawer(
                                  cid,
                                  Number.isFinite(Number(selectedArticleId))
                                    ? selectedArticleId
                                    : undefined,
                                );
                              }}
                              disabled={canvasDrawerLoading}
                            >
                              同步
                            </button>
                          </div>
                        </div>

                        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3">
                          <div className="rounded-2xl bg-white overflow-hidden border border-gray-200">
                            {(Array.isArray(articleDraft.imageUrls) ? articleDraft.imageUrls : []).filter(Boolean).length > 0 ? (
                              <div className="bg-black">
                                <img
                                  src={toAbsoluteUrl((Array.isArray(articleDraft.imageUrls) ? articleDraft.imageUrls : []).filter(Boolean)[0])}
                                  className="w-full h-64 object-cover"
                                />
                              </div>
                            ) : (
                              <div className="h-48 bg-gray-100 flex items-center justify-center text-xs text-gray-400">暂无图片</div>
                            )}
                            <div className="p-4">
                              <div className="text-sm font-semibold text-gray-900">{articleDraft.title || '(无标题)'}</div>
                              <div
                                className="mt-3 markdown-body text-sm"
                                style={{ backgroundColor: 'transparent' }}
                                dangerouslySetInnerHTML={{
                                  __html: DOMPurify.sanitize(
                                    marked.parse(
                                      composeMarkdownForDraft(
                                        articleDraft.imageUrls,
                                        articleDraft.markdownText,
                                      ),
                                    ),
                                  ),
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <div className="text-xs text-gray-600">文章状态</div>
                              <select
                                value={articleDraft.status}
                                onChange={(e) => {
                                  setArticleDraft((d) => ({ ...d, status: e.target.value }));
                                }}
                                className="w-full h-10 px-3 border border-gray-200 rounded text-sm bg-white"
                              >
                                <option value="pending">pending</option>
                                <option value="done">done</option>
                                <option value="requires_human">requires_human</option>
                                <option value="failed">failed</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-gray-600">doneNote</div>
                              <input
                                value={articleDraft.doneNote}
                                onChange={(e) => {
                                  setArticleDraft((d) => ({ ...d, doneNote: e.target.value }));
                                }}
                                className="w-full h-10 px-3 border border-gray-200 rounded text-sm"
                                placeholder="可选"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs text-gray-600">标题</div>
                            <input
                              value={articleDraft.title}
                              onChange={(e) => {
                                setArticleDraft((d) => ({ ...d, title: e.target.value }));
                              }}
                              className="w-full h-10 px-3 border border-gray-200 rounded text-sm"
                              placeholder="文章标题"
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs text-gray-600">标签（逗号分隔）</div>
                            <input
                              value={articleDraft.tagsText}
                              onChange={(e) => {
                                setArticleDraft((d) => ({ ...d, tagsText: e.target.value }));
                              }}
                              className="w-full h-10 px-3 border border-gray-200 rounded text-sm"
                              placeholder="tag1, tag2"
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-gray-600">图片</div>
                              <button
                                type="button"
                                className="h-7 px-2 rounded border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                  setArticleDraft((d) => ({
                                    ...d,
                                    imageUrls: [...(Array.isArray(d.imageUrls) ? d.imageUrls : []), ''],
                                  }));
                                }}
                              >
                                新增
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(Array.isArray(articleDraft.imageUrls) ? articleDraft.imageUrls : []).map((u, idx) => {
                                const url = String(u || '');
                                return (
                                  <div key={`img-${idx}`} className="flex items-start gap-2">
                                    <div className="h-12 w-12 rounded bg-gray-100 overflow-hidden border border-gray-200 shrink-0">
                                      {url.trim() ? (
                                        <img src={toAbsoluteUrl(url)} className="w-full h-full object-cover" />
                                      ) : null}
                                    </div>
                                    <input
                                      value={url}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        setArticleDraft((d) => {
                                          const arr = Array.isArray(d.imageUrls) ? [...d.imageUrls] : [];
                                          arr[idx] = next;
                                          return { ...d, imageUrls: arr };
                                        });
                                      }}
                                      className="flex-1 h-12 px-3 border border-gray-200 rounded text-xs"
                                      placeholder="图片 URL"
                                    />
                                    <button
                                      type="button"
                                      className="h-12 px-2 rounded border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
                                      onClick={() => {
                                        setArticleDraft((d) => {
                                          const arr = Array.isArray(d.imageUrls) ? [...d.imageUrls] : [];
                                          arr.splice(idx, 1);
                                          return { ...d, imageUrls: arr };
                                        });
                                      }}
                                    >
                                      删除
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs text-gray-600">正文（Markdown）</div>
                            <textarea
                              value={articleDraft.markdownText}
                              onChange={(e) => {
                                setArticleDraft((d) => ({ ...d, markdownText: e.target.value }));
                              }}
                              className="w-full min-h-56 px-3 py-2 border border-gray-200 rounded text-xs font-mono"
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="h-16 px-4 border-t border-gray-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="h-9 px-3 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50"
                  onClick={() => {
                    const cid = Number(canvasDrawerId);
                    if (!Number.isFinite(cid)) return;
                    persistCurrentDraft();
                    void loadCanvasForDrawer(
                      cid,
                      Number.isFinite(Number(selectedArticleId))
                        ? selectedArticleId
                        : undefined,
                    );
                  }}
                  disabled={canvasDrawerLoading}
                >
                  刷新
                </button>
                <button
                  type="button"
                  className="h-9 px-4 rounded text-sm bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => void saveDrawerArticle()}
                  disabled={
                    canvasDrawerLoading ||
                    articleSaving ||
                    !canvasDoc ||
                    canvasDrawerView !== 'detail' ||
                    !Number.isFinite(Number(selectedArticleId))
                  }
                >
                  {articleSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
