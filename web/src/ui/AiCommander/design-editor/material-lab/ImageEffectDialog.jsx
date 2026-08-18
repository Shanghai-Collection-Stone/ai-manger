import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Check, Eraser, Pipette, RotateCcw, Undo2 } from 'lucide-react';
import { DEFAULT_CUTOUT, EFFECT_GROUPS, presetsOfGroup } from './effectPresets';
import { decodeImageSource, isGpuEffectsSupported, renderImageEffect, renderEffectToDataUrl } from './gpuImageEffects';

/** 预设缩略图的工作分辨率，小一点让整屏预设几十毫秒内铺满。 */
const THUMB_SIZE = 168;
/** 大预览的工作分辨率。 */
const PREVIEW_SIZE = 560;
/** 应用到画布时的工作分辨率。 */
const EXPORT_SIZE = 1024;
/** 缩略图统一用同一套去底参数渲染，避免右侧调参时整屏预设反复重算。 */
const THUMB_CUTOUT = DEFAULT_CUTOUT;

/**
 * @description 读取特效配置里某条路径的数值，缺失时给默认值。
 * @keyword-cn 参数读取
 * @keyword-en read effect value
 * @param {object} effect - 特效配置。
 * @param {string} section - 分组名，如 cutout / shadow / glow。
 * @param {string} key - 字段名。
 * @param {number|string} fallback - 缺省值。
 * @returns {number|string} 当前值。
 */
const readValue = (effect, section, key, fallback) => {
  const value = effect?.[section]?.[key];
  return value === undefined || value === null ? fallback : value;
};

/**
 * @description 不可变地改写特效配置里某个分组的字段。
 * @keyword-cn 参数改写
 * @keyword-en patch effect section
 * @param {object} effect - 原配置。
 * @param {string} section - 分组名。
 * @param {object} patch - 要合并的字段。
 * @returns {object} 新配置。
 */
const patchSection = (effect, section, patch) => ({ ...effect, [section]: { ...(effect?.[section] || {}), ...patch } });

/**
 * @description 改写描边数组里第 index 层的字段，层不存在时按需补齐。
 * @keyword-cn 描边层改写
 * @keyword-en patch outline layer
 * @param {object} effect - 原配置。
 * @param {number} index - 描边层下标。
 * @param {object|null} patch - 要合并的字段，null 表示删除该层。
 * @returns {object} 新配置。
 */
const patchOutline = (effect, index, patch) => {
  const list = Array.isArray(effect?.outline) ? [...effect.outline] : [];
  if (patch === null) list.splice(index, 1);
  else {
    while (list.length <= index) list.push({ width: 8, color: '#ffffff' });
    list[index] = { ...list[index], ...patch };
  }
  return { ...effect, outline: list };
};

/**
 * @description 带数值回显的滑杆。
 * @keyword-cn 参数滑杆
 * @keyword-en slider field
 * @param {{ label: string, value: number, min: number, max: number, step: number, suffix?: string, onChange: Function }} props - 滑杆属性。
 * @returns {JSX.Element} 滑杆控件。
 */
const Slider = ({ label, value, min, max, step, suffix = '', onChange }) => <label className="block">
  <span className="flex items-center justify-between text-[11px] text-slate-500"><span>{label}</span><span className="text-slate-400">{Number(value).toFixed(step < 1 ? 2 : 0)}{suffix}</span></span>
  <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full accent-[#7257ed]" />
</label>;

/**
 * @description 颜色选择行。
 * @keyword-cn 颜色选择
 * @keyword-en color field
 * @param {{ label: string, value: string, onChange: Function }} props - 控件属性。
 * @returns {JSX.Element} 颜色控件。
 */
const ColorField = ({ label, value, onChange }) => <label className="flex items-center justify-between text-[11px] text-slate-500">
  {label}<input type="color" value={/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#ffffff'} onChange={(event) => onChange(event.target.value)} className="h-6 w-10 rounded border border-slate-200 bg-white" />
</label>;

/**
 * @description 分组开关标题。
 * @keyword-cn 分组开关
 * @keyword-en section toggle
 * @param {{ label: string, enabled: boolean, onToggle: Function }} props - 控件属性。
 * @returns {JSX.Element} 标题行。
 */
const SectionHead = ({ label, enabled, onToggle }) => <div className="flex items-center justify-between">
  <span className="text-xs font-medium text-slate-700">{label}</span>
  <button onClick={onToggle} className={`h-5 w-9 rounded-full transition relative ${enabled ? 'bg-[#6f55ed]' : 'bg-slate-200'}`} aria-label={`${enabled ? '关闭' : '开启'}${label}`}>
    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
  </button>
</div>;

/**
 * @description 将预览坐标归一化为 0~1，供取样和笔刷在预览、导出分辨率之间一致复用。
 * @keyword-cn 归一化坐标
 * @keyword-en normalized-point
 * @param {PointerEvent} event - 预览图片的指针事件。
 * @returns {{ x: number, y: number }} 归一化坐标。
 */
const normalizedPoint = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
};

/**
 * @description 从原始图片读取点击处附近的平均 RGB，用作精确的背景取样色。
 * @keyword-cn 背景取样
 * @keyword-en sample-background-color
 * @param {TexImageSource} source - 已解码的原始图片。
 * @param {{ x: number, y: number }} point - 点击的归一化坐标。
 * @returns {number[]|null} 0~1 RGB；跨域读取失败时返回 null。
 */
const sampleBackgroundColor = (source, point) => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, size, size);
  try {
    const x = Math.min(size - 1, Math.max(0, Math.round(point.x * (size - 1))));
    const y = Math.min(size - 1, Math.max(0, Math.round(point.y * (size - 1))));
    const { data } = context.getImageData(Math.max(0, x - 1), Math.max(0, y - 1), Math.min(3, size - Math.max(0, x - 1)), Math.min(3, size - Math.max(0, y - 1)));
    const sum = [0, 0, 0];
    for (let index = 0; index < data.length; index += 4) {
      sum[0] += data[index]; sum[1] += data[index + 1]; sum[2] += data[index + 2];
    }
    const count = data.length / 4;
    return sum.map((value) => value / count / 255);
  } catch { return null; }
};

/**
 * @description 将非破坏式擦除/恢复笔画应用到渲染结果，恢复笔只撤销人工擦除，不改变自动去底结果。
 * @keyword-cn 清理笔刷
 * @keyword-en apply-cleanup-strokes
 * @param {HTMLCanvasElement} source - GPU 渲染后的基础结果。
 * @param {Array<{ mode: string, radius: number, points: Array<{ x: number, y: number }> }>} strokes - 归一化笔画列表。
 * @returns {HTMLCanvasElement} 叠加笔刷遮罩后的结果。
 */
const applyCleanupStrokes = (source, strokes) => {
  const result = document.createElement('canvas');
  result.width = source.width;
  result.height = source.height;
  const resultContext = result.getContext('2d');
  resultContext.drawImage(source, 0, 0);
  if (!strokes?.length) return result;
  const mask = document.createElement('canvas');
  mask.width = source.width;
  mask.height = source.height;
  const maskContext = mask.getContext('2d');
  strokes.forEach((stroke) => {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) return;
    maskContext.globalCompositeOperation = stroke.mode === 'restore' ? 'destination-out' : 'source-over';
    maskContext.strokeStyle = '#fff';
    maskContext.fillStyle = '#fff';
    maskContext.lineCap = 'round';
    maskContext.lineJoin = 'round';
    maskContext.lineWidth = Math.max(1, Number(stroke.radius) * Math.max(mask.width, mask.height));
    maskContext.beginPath();
    maskContext.moveTo(points[0].x * mask.width, points[0].y * mask.height);
    points.slice(1).forEach((point) => maskContext.lineTo(point.x * mask.width, point.y * mask.height));
    maskContext.stroke();
    if (points.length === 1) {
      maskContext.beginPath();
      maskContext.arc(points[0].x * mask.width, points[0].y * mask.height, maskContext.lineWidth / 2, 0, Math.PI * 2);
      maskContext.fill();
    }
  });
  resultContext.globalCompositeOperation = 'destination-out';
  resultContext.drawImage(mask, 0, 0);
  return result;
};

/**
 * @description 图片特效弹窗：左侧分类、中间预设作为起点、右侧是完整参数设置面板。
 *   预设只负责给一组初值，之后所有调整都在右侧实时改；确认时若带 layerId 则原地更新该图层，
 *   不再每次都往画布上堆一张新图。
 * @keyword-cn 图片特效
 * @keyword-cn 特效弹窗
 * @keyword-en image-effect-dialog
 * @param {{ source: string|File, title?: string, initialEffect?: object, layerId?: string, onApply: Function, onClose: Function }} props - 素材来源、初始参数与回调。
 * @returns {JSX.Element} 弹窗。
 */
const ImageEffectDialog = ({ source, title = '图片特效', initialEffect = null, layerId = null, onApply, onClose }) => {
  const [bitmap, setBitmap] = useState(null);
  const [group, setGroup] = useState('hot');
  const [effect, setEffect] = useState(() => initialEffect || { cutout: { ...DEFAULT_CUTOUT } });
  const [presetId, setPresetId] = useState(initialEffect ? '' : 'cutout');
  const [thumbs, setThumbs] = useState({});
  const [previewBase, setPreviewBase] = useState(null);
  const [preview, setPreview] = useState('');
  const [cleanupMode, setCleanupMode] = useState('sample');
  const [brushSize, setBrushSize] = useState(22);
  const [manualStrokes, setManualStrokes] = useState(() => initialEffect?.cutout?.manualStrokes || []);
  const [draftStroke, setDraftStroke] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const renderedRef = useRef(new Set());
  const activeStrokeRef = useRef(null);
  const supported = useMemo(() => isGpuEffectsSupported(), []);
  const presets = useMemo(() => presetsOfGroup(group), [group]);
  const cutoutOn = effect?.cutout?.enabled !== false;
  const outlines = Array.isArray(effect?.outline) ? effect.outline : [];
  const shadowOn = Number(effect?.shadow?.opacity) > 0;
  const glowOn = Number(effect?.glow?.radius) > 0 && Number(effect?.glow?.strength) > 0;
  const pickedBackgrounds = Array.isArray(effect?.cutout?.backgroundColors) ? effect.cutout.backgroundColors : [];

  /** @description 解码素材原图，只做一次，后续所有预览复用同一张位图。 @keyword-cn 图像解码 @keyword-en decode source */
  useEffect(() => {
    let cancelled = false;
    setError('');
    decodeImageSource(source)
      .then((image) => { if (!cancelled) setBitmap(image); })
      .catch(() => { if (!cancelled) setError('图片读取失败，可能是跨域限制'); });
    return () => { cancelled = true; };
  }, [source]);

  /** @description 逐个渲染当前分类的预设缩略图，切片执行避免一次性阻塞主线程。 @keyword-cn 特效预览 @keyword-en render preset thumbs */
  useEffect(() => {
    if (!bitmap || !supported) return undefined;
    let cancelled = false;
    const pending = presets.filter((preset) => !renderedRef.current.has(preset.id));
    if (!pending.length) return undefined;
    const step = (index) => {
      if (cancelled || index >= pending.length) return;
      const preset = pending[index];
      renderedRef.current.add(preset.id);
      try {
        const base = preset.effect.cutout?.enabled === false ? preset.effect : { ...preset.effect, cutout: { ...preset.effect.cutout, ...THUMB_CUTOUT } };
        const url = renderEffectToDataUrl(bitmap, base, { maxSize: THUMB_SIZE });
        if (!cancelled && url) setThumbs((current) => ({ ...current, [preset.id]: url }));
      } catch (thumbError) { console.error(`[material-lab] 预设 ${preset.id} 缩略图渲染失败`, thumbError); }
      requestAnimationFrame(() => step(index + 1));
    };
    requestAnimationFrame(() => step(0));
    return () => { cancelled = true; };
  }, [bitmap, supported, presets]);

  /** @description 参数一变就重渲大预览，所见即所得。 @keyword-cn 特效预览 @keyword-en render live preview */
  useEffect(() => {
    if (!bitmap || !supported) return;
    try {
      setPreviewBase(renderImageEffect(bitmap, effect, { maxSize: PREVIEW_SIZE }));
      setError('');
    } catch (renderError) {
      // 把真实原因带出来：着色器编译失败、跨域污染、参数越界的表现都是"渲染失败"，
      // 吞成一句笼统提示会让人完全无从下手
      console.error('[material-lab] 特效渲染失败', renderError);
      setError(`特效渲染失败：${renderError?.message || renderError}`);
    }
  }, [bitmap, supported, effect]);

  /** @description 将基础预览与人工擦除遮罩合成；笔刷更新不重复执行 GPU 管线。 @keyword-cn 笔刷预览 @keyword-en cleanup-preview */
  useEffect(() => {
    if (!previewBase) return;
    setPreview(applyCleanupStrokes(previewBase, [...manualStrokes, ...(draftStroke ? [draftStroke] : [])]).toDataURL('image/png'));
  }, [previewBase, manualStrokes, draftStroke]);

  /**
   * @description 套用预设：只换描边/投影/发光这些装饰参数，**完整保留已经调好的去底成果**（取样色、去底强度、抠洞开关、擦除笔画）。
   *   预设表里所有预设的 cutout 都等于 `DEFAULT_CUTOUT`，本来就没带自己的去底调校，切预设时重置它只会逼人重新取样一遍。
   *   预设显式关掉去底（原图）时只翻 `enabled`，取样数据留着，再开回来立刻恢复原来的抠图效果。
   * @keyword-cn 特效预设
   * @keyword-cn 去底保留
   * @keyword-en apply preset
   * @keyword-en keep-cutout
   * @param {object} preset - 特效预设。
   */
  const handlePickPreset = useCallback((preset) => {
    setPresetId(preset.id);
    setDraftStroke(null);
    setEffect((current) => {
      const disabled = preset.effect.cutout?.enabled === false;
      const cutout = { ...DEFAULT_CUTOUT, ...(current?.cutout || {}), enabled: !disabled };
      return disabled ? { cutout } : { ...preset.effect, cutout };
    });
  }, []);

  /** @description 将点击到的残留颜色加入背景样本，最多保留四种不同颜色。 @keyword-cn 背景取样 @keyword-en add-background-sample */
  const handleSampleBackground = useCallback((event) => {
    if (!bitmap) return;
    const point = normalizedPoint(event);
    const sourceWidth = bitmap.width || bitmap.naturalWidth || 1;
    const sourceHeight = bitmap.height || bitmap.naturalHeight || 1;
    const fit = Math.min(1, PREVIEW_SIZE / Math.max(sourceWidth, sourceHeight));
    const innerWidth = Math.max(1, Math.round(sourceWidth * fit));
    const innerHeight = Math.max(1, Math.round(sourceHeight * fit));
    const padX = previewBase ? Math.max(0, (previewBase.width - innerWidth) / 2) : 0;
    const padY = previewBase ? Math.max(0, (previewBase.height - innerHeight) / 2) : 0;
    const sourcePoint = {
      x: Math.min(1, Math.max(0, (point.x * (previewBase?.width || innerWidth) - padX) / innerWidth)),
      y: Math.min(1, Math.max(0, (point.y * (previewBase?.height || innerHeight) - padY) / innerHeight)),
    };
    const color = sampleBackgroundColor(bitmap, sourcePoint);
    if (!color) { setError('该图片无法读取像素，暂不能取样背景色'); return; }
    setEffect((current) => {
      const existing = Array.isArray(current?.cutout?.backgroundColors) ? current.cutout.backgroundColors : [];
      const duplicate = existing.some((item) => Math.hypot(item[0] - color[0], item[1] - color[1], item[2] - color[2]) < 0.035);
      return duplicate || existing.length >= 4 ? current : patchSection(current, 'cutout', { backgroundColors: [...existing, color] });
    });
  }, [bitmap, previewBase]);

  /** @description 开始记录非破坏式擦除或恢复笔画。 @keyword-cn 清理笔刷 @keyword-en begin-cleanup-stroke */
  const handleBrushStart = useCallback((event) => {
    if (cleanupMode === 'sample') { handleSampleBackground(event); return; }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const stroke = { mode: cleanupMode, radius: brushSize / 560, points: [normalizedPoint(event)] };
    activeStrokeRef.current = stroke;
    setDraftStroke(stroke);
  }, [brushSize, cleanupMode, handleSampleBackground]);

  /** @description 追加当前笔刷轨迹并即时合成轻量预览。 @keyword-cn 清理笔刷 @keyword-en extend-cleanup-stroke */
  const handleBrushMove = useCallback((event) => {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    const next = { ...stroke, points: [...stroke.points, normalizedPoint(event)] };
    activeStrokeRef.current = next;
    setDraftStroke(next);
  }, []);

  /** @description 提交当前笔刷轨迹，使其成为可恢复和可撤销的特效参数。 @keyword-cn 清理笔刷 @keyword-en commit-cleanup-stroke */
  const handleBrushEnd = useCallback(() => {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    activeStrokeRef.current = null;
    setDraftStroke(null);
    setManualStrokes((current) => [...current, stroke]);
  }, []);

  /** @description 用导出分辨率重跑一遍并回传结果，带 layerId 时由父组件原地更新图层。 @keyword-cn 应用特效 @keyword-en apply effect */
  const handleApply = useCallback(() => {
    if (!bitmap) return;
    setBusy(true);
    requestAnimationFrame(() => {
      try {
        const savedEffect = patchSection(effect, 'cutout', { manualStrokes });
        const base = renderImageEffect(bitmap, savedEffect, { maxSize: EXPORT_SIZE });
        const canvas = base && applyCleanupStrokes(base, manualStrokes);
        if (canvas) onApply({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, effect: savedEffect, layerId });
      } finally {
        setBusy(false);
      }
    });
  }, [bitmap, effect, layerId, manualStrokes, onApply]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={onClose}>
    <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
      <header className="h-16 shrink-0 px-6 flex items-center justify-between border-b border-slate-100">
        <h2 className="text-lg font-semibold truncate">{title}</h2>
        <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="关闭"><X size={20} /></button>
      </header>
      {!supported ? <div className="p-10 text-center text-sm text-slate-500">当前浏览器不支持 WebGL2，无法运行 GPU 特效。</div>
        : <div className="flex-1 min-h-0 flex">
          <nav className="w-24 shrink-0 border-r border-slate-100 p-3 space-y-1 overflow-y-auto">
            {EFFECT_GROUPS.map((item) => <button key={item.id} onClick={() => setGroup(item.id)} className={`w-full py-2.5 rounded-xl text-sm font-medium transition ${group === item.id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>{item.label}</button>)}
          </nav>

          <div className="w-52 shrink-0 border-r border-slate-100 p-3 overflow-y-auto">
            <p className="mb-2 text-[11px] text-slate-400">预设只给一组初值，选完可在右侧继续调</p>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => <button key={preset.id} onClick={() => handlePickPreset(preset)} title={preset.label} className={`relative aspect-square rounded-lg bg-slate-100 overflow-hidden border-2 transition ${presetId === preset.id ? 'border-[#775cf0]' : 'border-transparent hover:border-slate-200'}`}>
                {thumbs[preset.id] ? <img src={thumbs[preset.id]} alt={preset.label} className="absolute inset-0 h-full w-full object-contain p-1" />
                  : <Loader2 size={14} className="absolute inset-0 m-auto animate-spin text-slate-300" />}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1 py-0.5 text-[10px] text-white truncate">{preset.label}</span>
              </button>)}
            </div>
          </div>

          <div className="flex-1 min-w-0 p-4 flex flex-col gap-3">
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
            <div className="flex-1 min-h-0 rounded-xl bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0] flex items-center justify-center overflow-hidden">
              {preview ? <img
                src={preview}
                alt="预览"
                onPointerDown={handleBrushStart}
                onPointerMove={handleBrushMove}
                onPointerUp={handleBrushEnd}
                onPointerCancel={handleBrushEnd}
                className={`max-h-full max-w-full object-contain touch-none ${cleanupMode === 'sample' ? 'cursor-crosshair' : cleanupMode === 'erase' ? 'cursor-cell' : 'cursor-copy'}`}
              /> : <Loader2 size={22} className="animate-spin text-slate-300" />}
            </div>
            <button onClick={handleApply} disabled={busy || !bitmap} className="shrink-0 w-full py-2.5 rounded-lg bg-[#6f55ed] hover:bg-[#5e45dd] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{busy ? '渲染中' : layerId ? '保存修改' : '加入画布'}
            </button>
          </div>

          <aside className="w-72 shrink-0 border-l border-slate-100 p-4 space-y-5 overflow-y-auto">
            <div className="space-y-2">
              <SectionHead label="去底" enabled={cutoutOn} onToggle={() => setEffect((c) => patchSection(c, 'cutout', { enabled: !cutoutOn }))} />
              {cutoutOn && <div className="space-y-2">
                <Slider label="去底强度" value={readValue(effect, 'cutout', 'strength', 0.5)} min={0} max={1} step={0.02} onChange={(v) => setEffect((c) => patchSection(c, 'cutout', { strength: v }))} />
                <label className="flex items-center gap-2 text-[11px] text-slate-500">
                  <input type="checkbox" checked={readValue(effect, 'cutout', 'holeFill', true) !== false} onChange={(event) => setEffect((c) => patchSection(c, 'cutout', { holeFill: event.target.checked }))} className="accent-[#7257ed]" />
                  去除封闭区域（字腔、笔画缝隙）
                </label>
                <p className="text-[11px] leading-relaxed text-slate-400">背景没去净就往右调，主体被啃掉就往左调。若主体本身大量用了和底色一样的颜色（如黑底黑描边），关掉上面这项。</p>
                <div className="pt-1 space-y-1.5">
                  <p className="text-[11px] font-medium text-slate-600">背景取样</p>
                  <p className="text-[11px] leading-relaxed text-slate-400">选择“取样”后点击预览中的残留格子；系统会优先删除这类颜色且只沿外部背景扩散。</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pickedBackgrounds.map((color, index) => <button key={`${color.join('-')}-${index}`} title="移除此取样色" onClick={() => setEffect((current) => patchSection(current, 'cutout', { backgroundColors: pickedBackgrounds.filter((_, itemIndex) => itemIndex !== index) }))} className="h-5 w-5 rounded border border-slate-300 shadow-sm" style={{ backgroundColor: `rgb(${color.map((value) => Math.round(value * 255)).join(',')})` }} />)}
                    {pickedBackgrounds.length > 0 && <button onClick={() => setEffect((current) => patchSection(current, 'cutout', { backgroundColors: [] }))} className="text-[11px] text-slate-400 hover:text-rose-500">清除取样</button>}
                  </div>
                </div>
              </div>}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">残留清理</span>
                {manualStrokes.length > 0 && <button title="撤销上一笔" onClick={() => setManualStrokes((current) => current.slice(0, -1))} className="p-1 text-slate-400 hover:text-[#6045de]"><Undo2 size={14} /></button>}
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button onClick={() => setCleanupMode('sample')} className={`py-1.5 rounded-md text-[11px] border ${cleanupMode === 'sample' ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-500'}`}><Pipette size={12} className="inline mr-1" />取样</button>
                <button onClick={() => setCleanupMode('erase')} className={`py-1.5 rounded-md text-[11px] border ${cleanupMode === 'erase' ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-500'}`}><Eraser size={12} className="inline mr-1" />擦除</button>
                <button onClick={() => setCleanupMode('restore')} className={`py-1.5 rounded-md text-[11px] border ${cleanupMode === 'restore' ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-500'}`}><RotateCcw size={12} className="inline mr-1" />恢复</button>
              </div>
              {cleanupMode !== 'sample' && <Slider label="笔刷大小" value={brushSize} min={4} max={100} step={1} suffix="px" onChange={setBrushSize} />}
              <p className="text-[11px] leading-relaxed text-slate-400">擦除只覆盖自动结果；恢复只撤回已擦除区域。两者都会随特效一同保存，重新编辑后仍可继续修改。</p>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <SectionHead label="描边" enabled={outlines.length > 0} onToggle={() => setEffect((c) => (outlines.length ? { ...c, outline: [] } : patchOutline(c, 0, { width: 10, color: '#ffffff' })))} />
              {outlines.map((layer, index) => <div key={index} className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{index === 0 ? '内层' : '外层'}</span>
                  <button onClick={() => setEffect((c) => patchOutline(c, index, null))} className="text-slate-400 hover:text-rose-500">移除</button>
                </div>
                <Slider label="宽度" value={Number(layer.width) || 0} min={1} max={40} step={1} suffix="px" onChange={(v) => setEffect((c) => patchOutline(c, index, { width: v }))} />
                <ColorField label="颜色" value={layer.color} onChange={(v) => setEffect((c) => patchOutline(c, index, { color: v }))} />
              </div>)}
              {outlines.length === 1 && <button onClick={() => setEffect((c) => patchOutline(c, 1, { width: 18, color: '#20222b' }))} className="w-full py-1.5 rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-500 hover:border-[#775cf0] hover:text-[#6045de]">加一层外描边</button>}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <SectionHead label="投影" enabled={shadowOn} onToggle={() => setEffect((c) => patchSection(c, 'shadow', shadowOn ? { opacity: 0 } : { dx: 6, dy: 9, spread: 2, blur: 12, color: '#20222b', opacity: 0.32 }))} />
              {shadowOn && <div className="space-y-1.5">
                <Slider label="横向偏移" value={readValue(effect, 'shadow', 'dx', 6)} min={-40} max={40} step={1} suffix="px" onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { dx: v }))} />
                <Slider label="纵向偏移" value={readValue(effect, 'shadow', 'dy', 9)} min={-40} max={40} step={1} suffix="px" onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { dy: v }))} />
                <Slider label="扩散" value={readValue(effect, 'shadow', 'spread', 2)} min={0} max={20} step={1} suffix="px" onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { spread: v }))} />
                <Slider label="模糊" value={readValue(effect, 'shadow', 'blur', 12)} min={0} max={40} step={1} suffix="px" onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { blur: v }))} />
                <Slider label="不透明度" value={readValue(effect, 'shadow', 'opacity', 0.32)} min={0.05} max={1} step={0.05} onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { opacity: v }))} />
                <ColorField label="颜色" value={readValue(effect, 'shadow', 'color', '#20222b')} onChange={(v) => setEffect((c) => patchSection(c, 'shadow', { color: v }))} />
              </div>}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <SectionHead label="发光" enabled={glowOn} onToggle={() => setEffect((c) => patchSection(c, 'glow', glowOn ? { radius: 0, strength: 0 } : { radius: 28, color: '#22d3ee', strength: 0.9, falloff: 1.6 }))} />
              {glowOn && <div className="space-y-1.5">
                <Slider label="半径" value={readValue(effect, 'glow', 'radius', 28)} min={4} max={60} step={1} suffix="px" onChange={(v) => setEffect((c) => patchSection(c, 'glow', { radius: v }))} />
                <Slider label="强度" value={readValue(effect, 'glow', 'strength', 0.9)} min={0.1} max={1} step={0.05} onChange={(v) => setEffect((c) => patchSection(c, 'glow', { strength: v }))} />
                <Slider label="衰减" value={readValue(effect, 'glow', 'falloff', 1.6)} min={0.5} max={4} step={0.1} onChange={(v) => setEffect((c) => patchSection(c, 'glow', { falloff: v }))} />
                <ColorField label="颜色" value={readValue(effect, 'glow', 'color', '#22d3ee')} onChange={(v) => setEffect((c) => patchSection(c, 'glow', { color: v }))} />
              </div>}
            </div>
          </aside>
        </div>}
    </div>
  </div>;
};

export default ImageEffectDialog;
