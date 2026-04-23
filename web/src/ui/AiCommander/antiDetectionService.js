// 与 chatService 对齐的 API 环境探测
const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * @description 构建认证头
 * @keyword-en build auth header for anti detection api
 */
const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * @description 把选项转成 multipart form 字段
 * @keyword-en append options to form data
 */
const appendOptions = (form, options) => {
  if (!options) return;
  if (options.strength) form.append('strength', options.strength);
  if (options.outputFormat) form.append('outputFormat', options.outputFormat);
  if (options.jpegQualityMin != null) form.append('jpegQualityMin', String(options.jpegQualityMin));
  if (options.jpegQualityMax != null) form.append('jpegQualityMax', String(options.jpegQualityMax));
};

/**
 * @description 抗AI识别前端 API client
 * @keyword-en anti detection frontend api client
 */
export const antiDetectionService = {
  /**
   * @description 单张处理，返回 Blob（浏览器可直接下载/预览）
   * @keyword-en process single image blob
   */
  async processSingle(file, options) {
    const form = new FormData();
    form.append('file', file);
    appendOptions(form, options);
    const res = await fetch(`${API_BASE}/api/anti-detection/process`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: text || `HTTP_${res.status}` };
    }
    const blob = await res.blob();
    const processed = res.headers.get('x-antidetection-processed') === '1';
    const disposition = res.headers.get('content-disposition') || '';
    const nameMatch = /filename="?([^"]+)"?/i.exec(disposition);
    return {
      ok: true,
      blob,
      processed,
      outputName: nameMatch ? decodeURIComponent(nameMatch[1]) : 'image-clean.jpg',
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
    };
  },

  /**
   * @description 批量处理，返回 JSON：每张 base64 + 参数
   * @keyword-en process batch images return json
   */
  async processBatch(files, options) {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    appendOptions(form, options);
    try {
      const res = await fetch(`${API_BASE}/api/anti-detection/process-batch`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: form,
      });
      const raw = await res.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
      if (!res.ok) return { ok: false, status: res.status, message: data?.message || `HTTP_${res.status}` };
      return { ok: true, ...data };
    } catch (e) {
      return { ok: false, status: 0, message: e?.message || 'NETWORK_ERROR' };
    }
  },
};

/**
 * @description base64 → Blob（前端解包）
 * @keyword-en decode base64 to blob
 */
export const base64ToBlob = (base64, mimeType) => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
};

/**
 * @description 触发浏览器下载 Blob
 * @keyword-en trigger browser download for blob
 */
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
