import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Sparkles, Zap, History, Plus, MessageSquare, X, 
  AlertCircle, Loader2, BrainCircuit, Images, Download
} from 'lucide-react';
import { chatService } from './chatService';
import { $currentSessionId } from './store';
import CanvasFeedView from './CanvasFeedView';
import ImageGroupCanvasView from './ImageGroupCanvasView';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked to handle AI output better
marked.setOptions({ breaks: true, gfm: true });
const renderer = new marked.Renderer();
// Override code block rendering: if it looks like plain text (no language specified
// and no code-like patterns), render as a styled paragraph instead of <pre><code>
const _origCode = renderer.code.bind(renderer);
renderer.code = function({ text, lang }) {
  if (lang === 'canvas-it') {
    try {
      const parsed = JSON.parse(text);
      const canvasId = Number(parsed?.canvasId);
      const canvasType = typeof parsed?.type === 'string' ? parsed.type : 'article';
      const isImageGroup = canvasType === 'image-group';
      const status = typeof parsed?.status === 'string' ? parsed.status : '';
      const platform = typeof parsed?.platform === 'string' ? parsed.platform : '';
      const topic = typeof parsed?.topic === 'string' ? parsed.topic : '';
      const articleCount = Number(parsed?.articleCount);
      const needFields = Array.isArray(parsed?.needFields)
        ? parsed.needFields.filter((x) => typeof x === 'string').slice(0, 6)
        : [];
      const esc = (v) =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      // 状态文案
      const statusLabel = status === 'generating' ? '生成中…' : status;
      const lines = [
        Number.isFinite(canvasId) ? `Canvas#${canvasId}` : 'Canvas',
        platform ? `平台：${platform}` : '',
        Number.isFinite(articleCount) ? `篇数：${articleCount}` : '',
        statusLabel ? `状态：${esc(statusLabel)}` : '',
      ].filter((x) => x.length > 0);
      const needFieldsHtml =
        needFields.length > 0
          ? `<p class="text-[11px] text-amber-600 mt-2">待补充：${needFields.map((x) => esc(x)).join('、')}</p>`
          : '';
      // 版式差异：图组看板 vs 内容看板
      const labelText = isImageGroup ? '图组看板' : '内容看板';
      const btnText = isImageGroup ? '查看图组详情' : '查看文章详情';
      const borderColor = isImageGroup ? 'border-violet-100' : 'border-sky-100';
      const bgColor = isImageGroup ? 'bg-violet-50/50' : 'bg-sky-50/50';
      const tagBorderColor = isImageGroup ? 'border-violet-200' : 'border-sky-200';
      const tagTextColor = isImageGroup ? 'text-violet-600' : 'text-sky-600';
      const btnBgColor = isImageGroup ? 'bg-violet-600 hover:bg-violet-700' : 'bg-sky-600 hover:bg-sky-700';
      const hintText = isImageGroup
        ? '图组生成后可选择下载，每组图片对应一篇文章。'
        : '先在 Canvas 看板确认与修改内容，再决定是否发布。';
      return `<section class="my-3 rounded-xl border ${borderColor} ${bgColor} p-3 pb-4">
<div class="text-[10px] inline-flex px-2 py-0.5 rounded-full border ${tagBorderColor} ${tagTextColor} bg-white">${labelText}</div>
<h4 class="mt-2 mb-1 text-sm font-semibold text-slate-800">${esc(lines.join(' | '))}</h4>
${topic ? `<p class="text-xs text-slate-600">${esc(topic)}</p>` : ''}
<p class="text-xs text-slate-500 mt-1">${hintText}</p>
${Number.isFinite(canvasId) ? `<button type="button" data-canvas-id="${encodeURIComponent(String(canvasId))}" data-canvas-type="${esc(canvasType)}" class="js-open-canvas-card mt-3 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${btnBgColor} text-white">${btnText}</button>` : ''}
${needFieldsHtml}
</section>`;
    } catch {
      return _origCode({ text, lang });
    }
  }
  if (lang === 'decision-it') {
    try {
      const parsed = JSON.parse(text);
      const cardId = typeof parsed?.cardId === 'string' ? parsed.cardId : '';
      const title = typeof parsed?.title === 'string' ? parsed.title : '决策卡';
      const summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
      const recommendation =
        typeof parsed?.recommendation === 'string' ? parsed.recommendation : '';
      const actions = Array.isArray(parsed?.actions)
        ? parsed.actions.filter((x) => typeof x === 'string').slice(0, 6)
        : [];
      const risks = Array.isArray(parsed?.risks)
        ? parsed.risks.filter((x) => typeof x === 'string').slice(0, 4)
        : [];
      const status = typeof parsed?.status === 'string' ? parsed.status : 'generated';
      const esc = (v) =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      const actionsHtml = actions.map((x) => `<li>${esc(x)}</li>`).join('');
      const risksHtml = risks.map((x) => `<li>${esc(x)}</li>`).join('');
      return `<section class="my-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
<div class="text-[10px] inline-flex px-2 py-0.5 rounded-full border border-indigo-200 text-indigo-600 bg-white">${esc(status)}</div>
<h4 class="mt-2 mb-1 text-sm font-semibold text-slate-800">${esc(title)}</h4>
${summary ? `<p class="text-xs text-slate-600 mb-2">${esc(summary)}</p>` : ''}
${recommendation ? `<p class="text-xs text-indigo-700 mb-2"><strong>建议：</strong>${esc(recommendation)}</p>` : ''}
${actions.length > 0 ? `<div class="mb-2"><div class="text-[11px] text-slate-500 mb-1">执行动作</div><ul class="text-xs text-slate-700 list-disc pl-4">${actionsHtml}</ul></div>` : ''}
${risks.length > 0 ? `<div><div class="text-[11px] text-slate-500 mb-1">风险提示</div><ul class="text-xs text-slate-700 list-disc pl-4">${risksHtml}</ul></div>` : ''}
${cardId ? `<button type="button" data-decision-card-id="${encodeURIComponent(cardId)}" class="js-open-decision-card mt-3 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700">查看决策详情</button>` : ''}
${cardId ? `<div class="mt-2 text-[10px] text-slate-400">cardId: ${esc(cardId)}</div>` : ''}
</section>`;
    } catch {
      return _origCode({ text, lang });
    }
  }
  if (lang) return _origCode({ text, lang });
  // Heuristic: if text has no typical code patterns, treat as plain text
  const looksLikeCode = /[{}[\];=<>]|function |const |let |var |import |class |=>|\.map\(|console\.|return /.test(text);
  if (!looksLikeCode) {
    // Render as normal text paragraph, preserving line breaks
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<p style="white-space:pre-wrap">${escaped}</p>`;
  }
  return _origCode({ text, lang });
};
marked.use({ renderer });

/* ─── SSE Line Parser ─── */

/**
 * Parse raw SSE text buffer into individual JSON event payloads.
 * Returns { events: parsed[], remainder: unparsed tail }
 */
function parseSSEChunk(buffer) {
  const events = [];
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() || '';
  for (const part of parts) {
    for (const line of part.split('\n')) {
      const prefix = line.startsWith('data: ') ? 6 : line.startsWith('data:') ? 5 : 0;
      if (prefix) {
        try { events.push(JSON.parse(line.slice(prefix))); } catch { /* skip */ }
      }
    }
  }
  return { events, remainder };
}

function appendCanvasItIfNeeded(text, toolResults) {
  const inputText = typeof text === 'string' ? text : '';
  if (inputText.includes('```canvas-it') || inputText.includes('```canvas_it')) return inputText;
  if (!Array.isArray(toolResults)) return inputText;
  for (const tr of toolResults) {
    const out = tr && typeof tr === 'object' ? tr.output : undefined;
    const obj = out && typeof out === 'object' ? out : undefined;
    const canvasIdRaw = obj?.canvasId;
    const canvasId =
      typeof canvasIdRaw === 'number'
        ? canvasIdRaw
        : typeof canvasIdRaw === 'string'
          ? Number(canvasIdRaw)
          : NaN;
    if (!Number.isFinite(canvasId)) continue;
    const payload = {
      canvasId: Number(canvasId),
      type: typeof obj?.type === 'string' ? obj.type : undefined,
      status: typeof obj?.status === 'string' ? obj.status : undefined,
      articleCount:
        typeof obj?.articleCount === 'number' ? obj.articleCount : undefined,
      platform: typeof obj?.platform === 'string' ? obj.platform : undefined,
      topic: typeof obj?.topic === 'string' ? obj.topic : undefined,
      needFields: Array.isArray(obj?.needFields)
        ? obj.needFields.filter((x) => typeof x === 'string').slice(0, 8)
        : [],
    };
    const block = `\n\n\`\`\`canvas-it\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    return `${inputText}${block}`;
  }
  return inputText;
}

function appendDecisionItIfNeeded(text, toolResults) {
  const inputText = typeof text === 'string' ? text : '';
  if (inputText.includes('```decision-it')) return inputText;
  if (!Array.isArray(toolResults)) return inputText;
  for (const tr of toolResults) {
    const out = tr && typeof tr === 'object' ? tr.output : undefined;
    const obj = out && typeof out === 'object' ? out : undefined;
    if (!obj) continue;
    const cardId =
      typeof obj.cardId === 'string'
        ? obj.cardId
        : typeof obj.decisionCardId === 'string'
          ? obj.decisionCardId
          : '';
    if (!cardId) continue;
    const payload = {
      cardId,
      title: typeof obj.title === 'string' ? obj.title : undefined,
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      recommendation:
        typeof obj.recommendation === 'string' ? obj.recommendation : undefined,
      actions: Array.isArray(obj.actions)
        ? obj.actions.filter((x) => typeof x === 'string').slice(0, 6)
        : [],
      risks: Array.isArray(obj.risks)
        ? obj.risks.filter((x) => typeof x === 'string').slice(0, 4)
        : [],
      status: typeof obj.status === 'string' ? obj.status : undefined,
    };
    const block = `\n\n\`\`\`decision-it\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    return `${inputText}${block}`;
  }
  return inputText;
}

/* ─── Canvas-it Block Extractor ─── */

/**
 * @description 从消息文本中提取所有 canvas-it JSON 块
 * @keyword-en extract canvas-it blocks
 */
function extractAllCanvasItBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const re = /```canvas-it\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const payload = JSON.parse(m[1].trim());
      const canvasId = Number(payload?.canvasId);
      if (Number.isFinite(canvasId)) blocks.push({ ...payload, canvasId });
    } catch { /* skip */ }
  }
  return blocks;
}

/* ─── Canvas-it Inline Card ─── */

/**
 * @description Canvas-it 内联卡片：自动加载 canvas 状态，展示图组缩略图和操作入口
 * @keyword-en CanvasItCard inline preview auto-load polling
 */
const CanvasItCard = React.memo(({ canvasId, initialPayload, onOpenFull }) => {
  const [canvas, setCanvas] = useState(null);
  const [loading, setLoading] = useState(true);

  /* 加载 canvas 数据 */
  const loadCanvas = useCallback(async () => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return null;
    try {
      const res = await chatService.getCanvas(cid);
      const c = res?.canvas && typeof res.canvas === 'object' ? res.canvas : null;
      setCanvas(c);
      return c;
    } catch {
      return null;
    }
  }, [canvasId]);

  /* 初始加载 */
  useEffect(() => {
    loadCanvas().finally(() => setLoading(false));
  }, [loadCanvas]);

  /* generating 时每 5 秒轮询一次 */
  useEffect(() => {
    if (canvas?.status !== 'generating') return;
    const timer = setInterval(async () => {
      const next = await loadCanvas();
      if (next?.status !== 'generating') clearInterval(timer);
    }, 5000);
    return () => clearInterval(timer);
  }, [canvas?.status, loadCanvas]);

  const isImageGroup = (canvas?.type || initialPayload?.type) === 'image-group';
  const status = canvas?.status || initialPayload?.status || '';
  const isGenerating = status === 'generating';
  const topic = canvas?.topic || initialPayload?.topic || '';
  const groups = Array.isArray(canvas?.imageGroups) ? canvas.imageGroups : [];
  const groupTotal = groups.length || Number(initialPayload?.articleCount || 0);
  const groupDone = groups.filter((g) => g.status === 'done').length;
  const groupFailed = groups.filter((g) => g.status === 'failed').length;

  /* article 类型进度统计 */
  const articleList = !isImageGroup ? (Array.isArray(canvas?.articles) ? canvas.articles : []) : [];
  const articleTotal = articleList.length || initialPayload?.articleCount || 0;
  const articleDone = articleList.filter(a => a.status === 'done' || a.status === 'requires_human').length;
  const articleFailed = articleList.filter(a => a.status === 'failed').length;
  /* 已完成文章的第一张封面图 */
  const doneArticleThumbs = articleList
    .filter(a => (a.status === 'done' || a.status === 'requires_human') && Array.isArray(a.imageUrls) && a.imageUrls[0])
    .map(a => a.imageUrls[0])
    .slice(0, 6);

  /* ── 加载中：中性骨架，不预设颜色 ── */
  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-slate-150 bg-white overflow-hidden animate-pulse">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
          <div className="h-4 w-14 rounded-full bg-slate-200" />
          <div className="h-4 flex-1 rounded bg-slate-200" />
          <Loader2 size={13} className="animate-spin text-slate-300 shrink-0" />
        </div>
        <div className="flex gap-1.5 px-3 py-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-14 w-14 rounded-lg bg-slate-100 shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  return (
    /* 卡片外层容器 */
    <div className={`mt-3 rounded-xl border overflow-hidden ${isImageGroup ? 'border-violet-100' : 'border-sky-100'}`}>
      {/* 头部：类型标签 + 标题 + 状态 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100">
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium bg-white ${
          isImageGroup ? 'border-violet-200 text-violet-600' : 'border-sky-200 text-sky-600'
        }`}>
          {isImageGroup ? '图组看板' : '内容看板'}
        </span>
        <span className="text-xs font-semibold text-slate-800 flex-1 truncate">
          Canvas#{canvasId}{topic ? ` · ${topic}` : ''}
        </span>
        {/* 状态指示 */}
        {isGenerating ? (
          <span className="flex items-center gap-1 text-[11px] text-amber-600 shrink-0">
            <Loader2 size={11} className="animate-spin" />
            {isImageGroup
              ? `${groupDone}/${groupTotal || groupDone || 0} 组${groupFailed > 0 ? ` · ${groupFailed}失败` : ''}`
              : articleTotal > 0
                ? `${articleDone}/${articleTotal} 篇${articleFailed > 0 ? ` · ${articleFailed}失败` : ''}`
                : '生成中...'}
          </span>
        ) : (
          <span className="text-[11px] text-green-600 shrink-0">
            {isImageGroup
              ? `${groupTotal || groupDone || 0}组${groupFailed > 0 ? ` · ${groupFailed}失败` : ''}`
              : `${articleDone || articleTotal || ''}篇完成`}
          </span>
        )}
      </div>

      {/* 图组封面缩略图列 */}
      {!isGenerating && isImageGroup && groups.length > 0 && (
        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto bg-slate-50/50">
          {groups.slice(0, 6).map((g, i) => {
            const imgs = Array.isArray(g.images) ? g.images : [];
            const cover = imgs.find((img) => img.role === 'cover') || imgs[0];
            const coverUrl = cover?.thumbUrl || cover?.url || '';
            return coverUrl ? (
              <img key={g.id ?? i} src={coverUrl} className="h-16 w-16 object-cover rounded-lg shrink-0" alt="" />
            ) : (
              <div key={g.id ?? i} className="h-16 w-16 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <Images size={14} className="text-slate-400" />
              </div>
            );
          })}
          {groups.length > 6 && (
            <div className="h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 text-[11px] text-slate-500 font-medium">
              +{groups.length - 6}
            </div>
          )}
        </div>
      )}

      {/* 生成中缩略图区：有已完成图时展示，否则骨架 */}
      {isGenerating && (
        <div className="flex gap-1.5 px-3 py-2 bg-slate-50/30">
          {doneArticleThumbs.length > 0
            ? doneArticleThumbs.map((url, i) => (
                <img key={i} src={url} className="h-16 w-16 object-cover rounded-lg shrink-0" alt="" />
              ))
            : [1,2,3,4].map(i => (
                <div key={i} className="h-16 w-16 rounded-lg bg-slate-200/60 animate-pulse shrink-0" />
              ))}
          {/* 剩余待生成格子 */}
          {doneArticleThumbs.length > 0 && doneArticleThumbs.length < articleTotal &&
            Array.from({ length: Math.min(4, articleTotal - doneArticleThumbs.length) }).map((_, i) => (
              <div key={`pending-${i}`} className="h-16 w-16 rounded-lg bg-slate-200/60 animate-pulse shrink-0" />
            ))}
        </div>
      )}

      {/* 操作按鈕区 */}
      {!isGenerating && (
        <div className="px-3 pb-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenFull && onOpenFull(Number(canvasId), canvas?.type || initialPayload?.type || 'article')}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium text-white ${
              isImageGroup ? 'bg-violet-600 hover:bg-violet-700' : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            <Download size={11} />
            {isImageGroup ? '选择/下载图组' : '查看文章详情'}
          </button>
        </div>
      )}
    </div>
  );
});

/* ─── Thinking Indicator (replaces tool call cards) ─── */

const ThinkingBubble = ({ toolCount, subagentCount }) => {
  const parts = [];
  if (toolCount > 0) parts.push(`工具 ${toolCount}`);
  if (subagentCount > 0) parts.push(`子代理 ${subagentCount}`);
  const hint = parts.length > 0 ? `（${parts.join(' · ')}）` : '...';
  return (
  <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50/70 border border-indigo-100 rounded-2xl rounded-tl-sm mb-1 animate-pulse">
    <BrainCircuit size={16} className="text-indigo-500" />
    <span className="text-xs text-indigo-600 font-medium">
      思考中{hint}
    </span>
    <Loader2 size={12} className="animate-spin text-indigo-400" />
  </div>
  );
};

/* ─── AI Message Component ─── */

const AIMessage = React.memo(({ msg, onOpenCanvas, onOpenDecision }) => {
  // 提取 canvas-it 块，渲染为 React 卡片
  const canvasItBlocks = useMemo(() => extractAllCanvasItBlocks(msg.content), [msg.content]);
  const strippedText = useMemo(() => {
    const raw = typeof msg.content === 'string' ? msg.content : '';
    return raw
      .replace(/```canvas-it[\s\S]*?```/gi, '')
      .trim();
  }, [msg.content]);
  const hasRenderableText = strippedText.length > 0;

  // Parse markdown securely with URL→image conversion
  const htmlContent = React.useMemo(() => {
    if (!msg.content) return { __html: '' };
    const imgPattern = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)/gi;
    // 移除 canvas-it 块（已由 CanvasItCard 渲染）
    const stripped = String(msg.content).replace(/```canvas-it[\s\S]*?```/gi, '').trim();
    // 1. 把纯 URL 转成 markdown 图片语法
    let converted = stripped.replace(imgPattern, (url) => `![](${url})`);
    let rawMarkup = marked.parse(converted);
    // 2. 把 <a href="图片url"> 链接转成 <img>
    rawMarkup = String(rawMarkup).replace(
      /<a[^>]+href="(https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp))"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, url, inner) => `<img src="${url}" alt="${inner.trim()}" />`,
    );
    // 3. 为所有 <img> 添加样式和点击事件
    rawMarkup = rawMarkup.replace(
      /<img([^>]+)>/g,
      (match, attrs) => `<img${attrs} style="max-height:220px;max-width:100%;width:auto;height:auto;object-fit:contain;cursor:pointer;border-radius:10px;display:block;" onclick="window.__galleryImageClick(this)" />`,
    );
    // 4. 把连续 <img> 用 flex 容器包裹实现并排
    rawMarkup = rawMarkup.replace(
      /((?:<img[^>]+>\s*)+)/g,
      (match) => `<div class="img-flex-row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0;">${match.replace(/<img([^>]+)>/g, '<img$1 style="flex:1 1 200px;max-height:220px;min-width:0;height:auto;object-fit:contain;cursor:pointer;border-radius:10px;">')}</div>`,
    );
    // Wrap each <table> in a scrollable container
    rawMarkup = rawMarkup.replace(/<table/g, '<div class="ai-table-scroll"><table');
    rawMarkup = rawMarkup.replace(/<\/table>/g, '</table></div>');
    return { __html: DOMPurify.sanitize(rawMarkup, { ADD_ATTR: ['onclick', 'style'] }) };
  }, [msg.content]);

  return (
    <div className="flex flex-col space-y-1 max-w-[90%] overflow-hidden">
      {/* Thinking indicator — show when streaming and tools are being called */}
      {msg.isStreaming && (msg.toolCount > 0 || msg.subagentCount > 0) && (
        <ThinkingBubble
          toolCount={msg.toolCount}
          subagentCount={msg.subagentCount}
        />
      )}

    {/* Text content */}
      {(hasRenderableText || msg.isStreaming) && (
        <div className="bg-white border border-slate-100 rounded-3xl rounded-tl-sm p-4 px-5 shadow-[0_2px_15px_rgba(0,0,0,0.04)] overflow-x-hidden">
          {hasRenderableText ? (
            <div 
              className="prose prose-sm prose-indigo max-w-none text-slate-700 leading-relaxed break-words
                         prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5
                         [&_pre]:overflow-x-auto [&_pre]:overflow-y-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:bg-slate-50 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:my-2 [&_pre]:max-h-64
                         [&_code]:break-all [&_code]:text-xs
                         [&_p]:[overflow-wrap:anywhere]
                         [&_.ai-table-scroll]:overflow-x-auto [&_.ai-table-scroll]:rounded-lg [&_.ai-table-scroll]:my-2
                         [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:w-max [&_table]:min-w-full
                         [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap
                         [&_table]:border-collapse [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5
                         [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5"
              dangerouslySetInnerHTML={htmlContent}
              onClick={(e) => {
                const target = e.target instanceof Element ? e.target : null;
                if (!target) return;
                const canvasBtn = target.closest('button[data-canvas-id]');
                if (canvasBtn) {
                  const raw = decodeURIComponent(
                    String(canvasBtn.getAttribute('data-canvas-id') || '').trim(),
                  );
                  const id = Number(raw);
                  const canvasType = String(canvasBtn.getAttribute('data-canvas-type') || 'article');
                  if (Number.isFinite(id) && typeof onOpenCanvas === 'function') {
                    onOpenCanvas(id, canvasType);
                  }
                  return;
                }
                const decisionBtn = target.closest('button[data-decision-card-id]');
                if (decisionBtn) {
                  const cardId = decodeURIComponent(
                    String(
                      decisionBtn.getAttribute('data-decision-card-id') || '',
                    ).trim(),
                  );
                  if (cardId && typeof onOpenDecision === 'function') {
                    onOpenDecision(cardId);
                  }
                }
              }}
            />
          ) : (
            msg.isStreaming && (
              <span className="animate-pulse flex items-center text-slate-400 text-sm font-medium">
                <Sparkles size={14} className="mr-1" /> 思考中...
              </span>
            )
          )}
        </div>
      )}

      {/* Canvas-it 内联卡片（自动加载 + 实时状态） */}
      {canvasItBlocks.map(payload => (
        <CanvasItCard
          key={payload.canvasId}
          canvasId={payload.canvasId}
          initialPayload={payload}
          onOpenFull={onOpenCanvas}
        />
      ))}

    {/* Show empty placeholder while loading, no content yet, no error */}
    {!hasRenderableText && !msg.isStreaming && !msg.errorText && canvasItBlocks.length === 0 && (
      <div className="bg-white border border-slate-100 rounded-3xl rounded-tl-sm p-5 shadow-[0_2px_15px_rgba(0,0,0,0.04)]">
        <span className="text-sm text-slate-400">（无内容）</span>
      </div>
    )}

    {/* Error message */}
    {msg.errorText && (
      <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="text-xs text-red-600 font-medium flex items-center gap-1.5">
          <AlertCircle size={14} />
          <span>{msg.errorText}</span>
        </div>
      </div>
    )}
  </div>
  );
});

const DecisionCardModal = ({ cardId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState(null);

  useEffect(() => {
    if (!cardId) return;
    setLoading(true);
    chatService
      .getDecisionCard(cardId)
      .then((res) => {
        setCard(res?.card || null);
      })
      .finally(() => setLoading(false));
  }, [cardId]);

  const renderListBlock = (title, items) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className="text-sm text-slate-700 flex items-start gap-2">
              <span className="text-slate-400">{idx + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">决策详情</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-slate-400" />
            </div>
          )}
          {!loading && card && (
            <>
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-slate-900">
                  {card.title || '决策卡'}
                </h4>
                <p className="text-sm text-slate-600">{card.summary || '暂无摘要'}</p>
              </div>
              {card.recommendation && (
                <div className="bg-indigo-50/60 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-500 mb-1">核心建议</p>
                  <p className="text-sm text-indigo-700">{card.recommendation}</p>
                </div>
              )}
              {renderListBlock('决策依据', card.reasoning)}
              {renderListBlock('可选方案', card.options)}
              {renderListBlock('行动计划', card.actions)}
              {renderListBlock('风险提示', card.risks)}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * @description AI中枢对话视图组件，支持SSE流式解析，工具调用隐藏在思考状态中
 * @keyword-en ChatBIView
 */
const ChatBIView = ({
  isDrawerOpen,
  onDrawerToggle,
  sessionType = 'default',
  sessionStorageKey = 'ai_commander_session_id',
  welcomeTitle = 'AI 主脑中枢',
  welcomeDesc = '我是您的智能业务助手。您可以问我关于营收、客流的分析，或者下达运营指令。',
  quickPrompts = ['本月客流趋势如何？', '分析一下Top5商铺的销售额'],
  inputPlaceholder = '问问数据，或者下达指令...',
  showInlineSessionPicker = false,
}) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false);
  const [activeCanvasId, setActiveCanvasId] = useState(null);
  /** @type {'article'|'image-group'|null} */
  const [activeCanvasType, setActiveCanvasType] = useState(null);
  const [activeDecisionCardId, setActiveDecisionCardId] = useState('');
  /** @description generating 状态 canvas id->type 映射，用于后台轮询 */
  const generatingCanvasRef = React.useRef(new Map());
  const pollingTimerRef = React.useRef(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // 注册全局图片点击弹窗函数
  useEffect(() => {
    Object.defineProperty(window, '__galleryImageClick', {
      configurable: true,
      value: (imgEl) => {
        const src = imgEl?.src || '';
        if (src) setLightboxImage(src);
      },
    });
    return () => {
      delete window.__galleryImageClick;
    };
  }, []);

  // Auto-resize textarea: grow with content up to MAX_HEIGHT, then scroll
  const MAX_LINES = 4;
  const LINE_HEIGHT = 24; // approximate px per line
  const MAX_HEIGHT = MAX_LINES * LINE_HEIGHT;

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    // Auto-resize textarea
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, MAX_HEIGHT) + 'px';
    }
  };

  useEffect(() => {
    const init = async () => {
      const loadedSessions = await chatService.getSessions({ sessionType });
      setSessions(loadedSessions);
      
      const savedSessionId = localStorage.getItem(sessionStorageKey);
      
      if (savedSessionId && savedSessionId.startsWith('local-')) {
        setSessionId(savedSessionId);
        $currentSessionId.set(null);
      } else if (savedSessionId && loadedSessions.some(s => s.sessionId === savedSessionId)) {
        handleSwitchSession({ sessionId: savedSessionId }, loadedSessions);
      } else {
        const newLocalId = 'local-' + Date.now();
        setSessionId(newLocalId);
        localStorage.setItem(sessionStorageKey, newLocalId);
        $currentSessionId.set(null);
      }
    };
    init();
  }, [sessionStorageKey, sessionType]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- 轮询 generating canvas 状态 ---
  // 扫描消息提取生成中的 canvas id
  const scanGeneratingCanvases = React.useCallback((msgs) => {
    const map = generatingCanvasRef.current;
    map.clear();
    for (const msg of msgs) {
      if (msg.role !== 'assistant' || !msg.content) continue;
      const matches = [...msg.content.matchAll(/```canvas-it\n([\s\S]*?)```/g)];
      for (const m of matches) {
        try {
          const p = JSON.parse(m[1]);
          const id = Number(p?.canvasId);
          if (Number.isFinite(id) && p?.status === 'generating') {
            map.set(id, typeof p.type === 'string' ? p.type : 'article');
          }
        } catch { /* skip */ }
      }
    }
  }, []);

  // 每次 messages 变化时重新扫描
  useEffect(() => {
    scanGeneratingCanvases(messages);
  }, [messages, scanGeneratingCanvases]);

  // 轮询 effect：每 5s 检查一次 generating canvases
  useEffect(() => {
    const run = async () => {
      const map = generatingCanvasRef.current;
      if (map.size === 0) return;
      for (const [id] of Array.from(map.entries())) {
        try {
          const res = await chatService.getCanvas(id);
          const status = res?.canvas?.status;
          if (status && status !== 'generating') {
            map.delete(id);
          }
        } catch { /* ignore */ }
      }
    };
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    pollingTimerRef.current = setInterval(run, 5000);
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [sessionId]); // sessionId 变化时重启轮询

  const handleNewSession = () => {
    const newId = 'local-' + Date.now();
    setSessionId(newId);
    setMessages([]);
    generatingCanvasRef.current.clear();
    localStorage.setItem(sessionStorageKey, newId);
    $currentSessionId.set(null);
    if (onDrawerToggle) onDrawerToggle(false);
  };

  // added a loadedSessions parameter for the initial load case where state might not be updated yet
  const handleSwitchSession = async (sess, currentSessions = sessions) => {
    if (sess.sessionId === sessionId) {
      if (onDrawerToggle) onDrawerToggle(false);
      return;
    }
    setIsLoading(true);
    setSessionId(sess.sessionId);
    localStorage.setItem(sessionStorageKey, sess.sessionId);
    $currentSessionId.set(sess.sessionId);
    if (onDrawerToggle) onDrawerToggle(false);
    try {
      const history = await chatService.fetchHistory(sess.sessionId, {
        sessionType,
      });
      const msgs = Array.isArray(history) ? history : (history.messages || []);
      setMessages(msgs.map(m => ({
        ...m,
        id: m.id || Date.now() + Math.random(),
        role: m.role === 'assistant' ? 'ai' : m.role,
        content:
          m.role === 'assistant'
            ? appendDecisionItIfNeeded(
                appendCanvasItIfNeeded(
                  typeof m.content === 'string' ? m.content : '',
                  Array.isArray(m.tool_results) ? m.tool_results : [],
                ),
                Array.isArray(m.tool_results) ? m.tool_results : [],
              )
            : m.content,
        toolCount: 0,
        subagentCount: 0,
      })));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  /* ─── Send message with SSE streaming ─── */
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setInputValue('');

    // 1. Ensure remote session exists
    let currentSessionId = sessionId;
    if (currentSessionId.startsWith('local-')) {
      try {
        const session = await chatService.createSession({ sessionType });
        currentSessionId = session.sessionId;
        setSessionId(currentSessionId);
        $currentSessionId.set(currentSessionId);
        localStorage.setItem(sessionStorageKey, currentSessionId);
      } catch (e) {
        console.error('Failed to create session', e);
        return;
      }
    }

    // 2. Add user message
    const userMsg = { id: Date.now(), role: 'user', content: userText };

    // 3. Immediately create an empty AI placeholder (early-refresh protection)
    //    Content is empty = shows "思考中..." placeholder
    //    This msg is "on-record" so even if user refreshes, it exists
    const aiMsgId = Date.now() + 1;
    const aiMsg = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      toolCount: 0,
      subagentCount: 0,
      isStreaming: true,
      errorText: null,
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setIsLoading(true);  // Blocks input field

    try {
      const response = await chatService.streamChatPost(currentSessionId, userText, {
        sessionType,
      });
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let textContent = '';
      let toolCount = 0;
      let subagentCount = 0;

      const updateAiMsg = (overrides) => {
        setMessages(prev => prev.map(msg =>
          msg.id === aiMsgId
            ? { ...msg, content: textContent, toolCount, subagentCount, ...overrides }
            : msg
        ));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSSEChunk(sseBuffer);
        sseBuffer = remainder;

        for (const evt of events) {
          switch (evt.type) {
            case 'token': {
              const text = evt.data?.text ?? '';
              if (text) {
                textContent += text;
                updateAiMsg();
              }
              break;
            }
            case 'tool_start': {
              break;
            }
            case 'tool_chunk':
            case 'reasoning':
            case 'log':
            case 'ping':
              break;
            case 'tool_end': {
              toolCount++;
              updateAiMsg();
              break;
            }
            case 'subagent': {
              subagentCount++;
              updateAiMsg();
              break;
            }
            case 'error': {
              const errMsg = evt.data?.message || '未知错误';
              updateAiMsg({ errorText: errMsg, isStreaming: false });
              break;
            }
            case 'end': {
              // 使用后端后处理后的最终文本（含 canvas-it / task-it 等代码块）
              const endText = evt.data?.text ?? '';
              if (endText) textContent = endText;
              updateAiMsg({ isStreaming: false });
              break;
            }
            default:
              break;
          }
        }
      }

      // Finalize
      updateAiMsg({ isStreaming: false });

      // Refresh session list
      const updatedSessions = await chatService.getSessions({ sessionType });
      setSessions(updatedSessions);

    } catch (error) {
      console.error('Chat error:', error);
      const reason =
        error && typeof error === 'object' && typeof error.message === 'string'
          ? error.message
          : '未知错误';
      // Record error in the already-created AI message (not a new one)
      setMessages(prev => prev.map(msg =>
        msg.id === aiMsgId
          ? { ...msg, errorText: `抱歉，我现在无法回答。请稍后再试。(${reason})`, isStreaming: false }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in relative overflow-hidden">

      {/* 历史会话 Drawer */}
      <div
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        className={`absolute top-0 right-0 h-full w-64 bg-white z-30 transform transition-all duration-300 ease-in-out border-l border-slate-100 flex flex-col ${
          isDrawerOpen
            ? 'translate-x-0 opacity-100 pointer-events-auto shadow-xl'
            : 'translate-x-full opacity-0 pointer-events-none shadow-none'
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-bold text-slate-700 text-sm">历史会话</h3>
          <button onClick={() => onDrawerToggle && onDrawerToggle(false)} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={handleNewSession}
            className="w-full flex items-center justify-center space-x-2 bg-indigo-50 text-indigo-600 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors border border-indigo-100"
          >
            <Plus size={16} />
            <span>新会话</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {sessions.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">暂无历史会话</div>
          ) : (
            sessions.map(sess => (
              <button
                key={sess.sessionId}
                onClick={() => handleSwitchSession(sess)}
                className={`w-full text-left p-3 rounded-lg text-xs transition-all border ${
                  sessionId === sess.sessionId
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                    : 'bg-white text-slate-600 border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-medium truncate mb-1 flex items-center">
                  <MessageSquare size={12} className="mr-2 opacity-70" />
                  <span className="truncate">{sess.title || '未命名会话'}</span>
                </div>
                <div className="text-[10px] opacity-60">
                  {new Date(sess.timestamp).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 遮罩层 */}
      {isDrawerOpen && (
        <div
          className="absolute inset-0 bg-black/20 z-10 backdrop-blur-[1px]"
          onClick={() => onDrawerToggle && onDrawerToggle(false)}
        />
      )}

      {isSessionPickerOpen && (
        <div className="absolute inset-0 z-20 bg-black/25 backdrop-blur-[1px] flex items-end justify-center p-3">
          <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">会话历史</h3>
              <button
                onClick={() => setIsSessionPickerOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <button
                onClick={() => {
                  handleNewSession();
                  setIsSessionPickerOpen(false);
                }}
                className="w-full flex items-center justify-center space-x-2 bg-indigo-50 text-indigo-600 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors border border-indigo-100"
              >
                <Plus size={15} />
                <span>新会话</span>
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {sessions.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-8">暂无历史会话</div>
              ) : (
                sessions.map((sess) => (
                  <button
                    key={sess.sessionId}
                    onClick={() => {
                      handleSwitchSession(sess);
                      setIsSessionPickerOpen(false);
                    }}
                    className={`w-full text-left p-3 rounded-lg text-xs transition-all border ${
                      sessionId === sess.sessionId
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                        : 'bg-white text-slate-600 border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-medium truncate mb-1 flex items-center">
                      <MessageSquare size={12} className="mr-2 opacity-70" />
                      <span className="truncate">{sess.title || '未命名会话'}</span>
                    </div>
                    <div className="text-[10px] opacity-60">
                      {new Date(sess.timestamp).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 消息列表区域 */}
      <div 
        className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-24 pt-4"
        onTouchStart={(e) => {
          // 如果点击的是代码块、表格或任何可能横向滚动的容器，阻止冒泡
          const isScrollable = e.target.closest('pre, table, .ai-table-scroll, .overflow-x-auto');
          if (isScrollable) {
            e.stopPropagation();
          }
        }}
        onTouchEnd={(e) => {
          const isScrollable = e.target.closest('pre, table, .ai-table-scroll, .overflow-x-auto');
          if (isScrollable) {
            e.stopPropagation();
          }
        }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center pb-20 opacity-80 animate-fade-in-up">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-white ring-4 ring-indigo-50/50">
              <Sparkles size={32} className="text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{welcomeTitle}</h2>
            <p className="text-sm text-slate-500 max-w-xs text-center leading-relaxed">
              {welcomeDesc}
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-md px-4">
              <button
                onClick={() => setInputValue(quickPrompts[0] || '')}
                className="text-xs bg-white border border-slate-200 p-3 rounded-xl text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm transition-all text-left"
              >
                📈 {quickPrompts[0] || '了解数据结构'}
              </button>
              <button
                onClick={() => setInputValue(quickPrompts[1] || '')}
                className="text-xs bg-white border border-slate-200 p-3 rounded-xl text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm transition-all text-left"
              >
                💰 {quickPrompts[1] || '生成一条思维链'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
                {msg.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-sm shadow-sm font-medium leading-relaxed break-words overflow-hidden">
                    {msg.content}
                  </div>
                ) : (
                  <AIMessage
                    msg={msg}
                    onOpenCanvas={(id, type) => {
                      setActiveCanvasId(id);
                      setActiveCanvasType(type || 'article');
                    }}
                    onOpenDecision={(id) => setActiveDecisionCardId(id)}
                  />
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 底部输入框区域 */}
      <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#F7F9FC] via-[#F7F9FC] to-transparent pt-6 pb-4 px-4">
        {showInlineSessionPicker && (
          <div className="max-w-2xl mx-auto mb-2 flex justify-end">
            <button
              onClick={() => setIsSessionPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
            >
              <History size={14} />
              <span>会话历史</span>
            </button>
          </div>
        )}
        <div className={`flex items-end bg-white border shadow-lg shadow-slate-200/50 rounded-2xl p-1.5 px-4 transition-all max-w-2xl mx-auto ${
          isLoading
            ? 'border-indigo-200 bg-indigo-50/30'
            : 'border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500/20'
        }`}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'AI 正在回复中，请稍候...' : inputPlaceholder}
            rows={1}
            style={{ height: 'auto', maxHeight: MAX_HEIGHT + 'px', overflowY: 'auto' }}
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder-slate-400 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 resize-none leading-relaxed"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-sm ${
              inputValue.trim() && !isLoading
                ? 'bg-slate-900 text-white hover:bg-slate-800 scale-100'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed scale-95'
            }`}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          </button>
        </div>
      </div>

      {/* canvas 详情弹层：根据类型显示不同视图 */}
      {Number.isFinite(activeCanvasId) && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col h-[100dvh]">
          {activeCanvasType === 'image-group' ? (
            <ImageGroupCanvasView
              canvasId={activeCanvasId}
              onClose={() => { setActiveCanvasId(null); setActiveCanvasType(null); }}
            />
          ) : (
            <CanvasFeedView
              canvasId={activeCanvasId}
              onClose={() => { setActiveCanvasId(null); setActiveCanvasType(null); }}
            />
          )}
        </div>
      )}
      {activeDecisionCardId ? (
        <DecisionCardModal
          cardId={activeDecisionCardId}
          onClose={() => setActiveDecisionCardId('')}
        />
      ) : null}

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-5xl w-full flex flex-col items-center">
            <div className="flex items-center gap-3 mb-4 w-full justify-center">
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition border border-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  const a = document.createElement('a');
                  a.href = lightboxImage;
                  a.download = lightboxImage.split('/').pop() || 'image';
                  a.target = '_blank';
                  a.click();
                }}
              >
                保存图片
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition border border-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  const win = window.open(lightboxImage, '_blank');
                  if (win) win.focus();
                }}
              >
                新窗口打开
              </button>
              <button
                className="text-white/70 hover:text-white text-3xl font-light w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxImage(null);
                }}
              >
                ×
              </button>
            </div>
            <img
              src={lightboxImage}
              alt=""
              className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default ChatBIView;
