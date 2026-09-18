import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 音色三个维度的中文选项，取值与后端 `DouyinPersonaVoice` 逐字对应。
 * @keyword-cn 音色选项, 音色维度
 * @keyword-en voice-options, voice-dimensions
 */
const VOICE_OPTIONS = {
  gender: [
    { value: 'female', label: '女声' },
    { value: 'male', label: '男声' },
    { value: 'neutral', label: '中性声线' },
  ],
  age: [
    { value: 'young', label: '年轻' },
    { value: 'adult', label: '成熟稳重' },
    { value: 'mature', label: '有阅历的年长' },
  ],
  pace: [
    { value: 'slow', label: '语速偏慢' },
    { value: 'normal', label: '语速自然' },
    { value: 'fast', label: '语速偏快利落' },
  ],
};

/**
 * @description 三视图位次的中文名，与后端 `DOUYIN_PERSONA_VIEW_SPECS` 的 label 一致，灯箱标题按它显示。
 * @keyword-cn 三视图位次文案, 形象图标题
 * @keyword-en persona-view-labels, reference-sheet-caption
 */
const VIEW_LABELS = {
  front: '正面全身',
  side: '四分之三侧身',
  closeup: '面部特写',
  custom: '自定义',
};

/** @type {object} 新建人物表单初始值，与后端 CreateDouyinPersonaDto 字段一一对应。 */
const EMPTY_FORM = {
  id: null,
  name: '',
  summary: '',
  appearance: '',
  persona: '',
  perspective: 'recommend',
  voice: { gender: 'female', age: 'young', pace: 'normal', timbre: '' },
  status: 'active',
};

/**
 * @description 把后端人物实体铺平成表单值，编辑时直接回填。
 * @param {object} row - 人物实体。
 * @returns {object} 表单值。
 * @keyword-cn 人物转表单, 编辑回填
 * @keyword-en persona-to-form, edit-prefill
 */
const personaToForm = (row) => ({
  id: row.id,
  name: row.name || '',
  summary: row.summary || '',
  appearance: row.appearance || '',
  persona: row.persona || '',
  perspective: row.perspective || 'recommend',
  voice: {
    gender: row.voice?.gender || 'neutral',
    age: row.voice?.age || 'adult',
    pace: row.voice?.pace || 'normal',
    timbre: row.voice?.timbre || '',
  },
  status: row.status || 'active',
});

/**
 * @description 把结构化音色拼成一句中文，与后端 `describePersonaVoice` 说法保持一致。
 * @param {object} voice - 音色设置。
 * @returns {string} 例如「年轻女声 · 语速偏快利落 · 清亮干脆」。
 * @keyword-cn 音色短文案, 音色一句话
 * @keyword-en voice-label, timbre-one-liner
 */
const describeVoice = (voice) => {
  if (!voice) return '未设置音色';
  const pick = (key) =>
    VOICE_OPTIONS[key].find((item) => item.value === voice[key])?.label || '';
  return [`${pick('age')}${pick('gender')}`, pick('pace'), voice.timbre]
    .filter(Boolean)
    .join(' · ');
};

/**
 * @description 形象图灯箱：点列表里的三视图缩略图后全屏放大看原图，可左右切换同一个人物的三张，
 *   Esc 或点背景关闭。三视图是用来核对「三张是不是同一个人」的，缩略图那点尺寸根本看不出五官差异，
 *   所以必须能放大。
 * @keyword-cn 形象图灯箱, 三视图放大
 * @keyword-en persona-image-lightbox, reference-sheet-zoom
 * @param {{images: object[], index: number, name: string, onIndexChange: Function, onClose: Function}} props - 图组、当前位次、人物名与回调。
 * @returns {JSX.Element} 全屏灯箱。
 */
function PersonaImageLightbox({ images, index, name, onIndexChange, onClose }) {
  const image = images[index];
  useEffect(() => {
    /** @description 键盘左右切图、Esc 关闭。 @keyword-cn 灯箱键盘操作, 左右切图 @keyword-en lightbox-keyboard, arrow-navigation */
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + images.length) % images.length);
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % images.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, images.length, onIndexChange, onClose]);

  if (!image) return null;
  return (
    <div
      data-persona-lightbox
      className="fixed inset-0 z-[1400] flex flex-col items-center justify-center bg-slate-950/85 p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex w-full max-w-5xl items-center gap-3 pb-3 text-white">
        <strong className="text-sm">{name}</strong>
        <span className="rounded bg-white/15 px-2 py-0.5 text-xs">{VIEW_LABELS[image.view] || image.view}</span>
        <span className="text-xs text-white/60">{index + 1}/{images.length}</span>
        <a
          href={image.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
        >
          在新标签打开原图
        </a>
        <button type="button" aria-label="关闭" onClick={onClose} className="rounded border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10">
          关闭
        </button>
      </div>
      <div className="flex min-h-0 w-full max-w-5xl flex-1 items-center gap-3">
        {images.length > 1 ? (
          <button
            type="button"
            aria-label="上一张"
            onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
            className="shrink-0 rounded-full bg-white/15 px-3 py-4 text-lg text-white hover:bg-white/25"
          >
            ‹
          </button>
        ) : null}
        <img
          src={image.url}
          alt={VIEW_LABELS[image.view] || image.view}
          className="mx-auto max-h-full min-h-0 w-auto max-w-full rounded-lg object-contain shadow-2xl"
        />
        {images.length > 1 ? (
          <button
            type="button"
            aria-label="下一张"
            onClick={() => onIndexChange((index + 1) % images.length)}
            className="shrink-0 rounded-full bg-white/15 px-3 py-4 text-lg text-white hover:bg-white/25"
          >
            ›
          </button>
        ) : null}
      </div>
      <div className="flex gap-2 pt-3">
        {images.map((item, order) => (
          <button
            key={item.imageId}
            type="button"
            onClick={() => onIndexChange(order)}
            className={`h-14 w-10 overflow-hidden rounded border-2 ${order === index ? 'border-violet-400' : 'border-transparent opacity-60 hover:opacity-100'}`}
          >
            <img src={item.coverUrl || item.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * @description 抖音预设人物管理页：维护租户内共享的人设（外貌、性格语气、叙事视角、音色），
 *   支持按一句话需求让 AI 写出人设草稿，以及为人物串行生成正面 / 侧身 / 特写三视图形象图。
 *   形象图是工作台分镜出图时的底图来源，决定同一条视频里人物长相是否一致。
 * @keyword-cn 预设人物管理页, 三视图生成, 人物音色
 * @keyword-en douyin-persona-panel, reference-sheet-generation, persona-voice
 * @param {{onNotice: Function, onError: Function}} props - 顶层提示回调。
 * @returns {JSX.Element} 管理面板。
 */
export default function DouyinPersonaPanel({ onNotice, onError }) {
  const [personas, setPersonas] = useState([]);
  const [perspectives, setPerspectives] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sheetBusyId, setSheetBusyId] = useState(null);
  /* 打开中的形象图灯箱：{ personaId, index }，null 表示没打开 */
  const [preview, setPreview] = useState(null);

  const editing = Boolean(form.id);
  const perspectiveLabel = useMemo(
    () =>
      Object.fromEntries(perspectives.map((item) => [item.key, item.label])),
    [perspectives],
  );

  /**
   * @description 拉取人物列表与视角登记表。
   * @keyword-cn 加载预设人物, 视角登记表
   * @keyword-en load-personas, perspective-registry
   */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, options] = await Promise.all([
        adminApi.listDouyinPersonas(),
        adminApi.getDouyinPersonaOptions(),
      ]);
      setPersonas(list?.personas || []);
      setPerspectives(options?.perspectives || []);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * @description 按一句话需求让 AI 写出人设草稿并回填表单，管理员可再改后保存。
   * @keyword-cn AI生成人设, 草稿回填
   * @keyword-en ai-draft-persona, hydrate-form
   */
  const draftPersona = async () => {
    if (brief.trim().length < 4) {
      onError?.('先写一句人物需求，例如「25 岁成都本地探店女生，接地气爱吐槽」');
      return;
    }
    setDrafting(true);
    try {
      const result = await adminApi.draftDouyinPersona(brief.trim());
      const draft = result?.draft;
      if (!draft) throw new Error('AI 没有返回可用人设');
      setForm((current) => ({
        ...current,
        name: draft.name || current.name,
        summary: draft.summary || '',
        appearance: draft.appearance || '',
        persona: draft.persona || '',
        perspective: draft.perspective || current.perspective,
        voice: { ...current.voice, ...(draft.voice || {}) },
      }));
      onNotice?.('AI 已写好人设草稿，确认或修改后保存');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setDrafting(false);
    }
  };

  /**
   * @description 新建或更新人物；外貌设定是形象图与分镜一致性的唯一依据，必须写够。
   * @keyword-cn 保存预设人物, 外貌必填
   * @keyword-en save-persona, appearance-required
   */
  const submit = async () => {
    if (form.name.trim().length < 2) return onError?.('人物名至少 2 个字');
    if (form.appearance.trim().length < 20) {
      return onError?.('外貌设定至少 20 个字，写清长相、发型、体型与常穿服装');
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        summary: form.summary.trim() || undefined,
        appearance: form.appearance.trim(),
        persona: form.persona.trim() || undefined,
        perspective: form.perspective,
        voice: {
          gender: form.voice.gender,
          age: form.voice.age,
          pace: form.voice.pace,
          timbre: form.voice.timbre.trim() || undefined,
        },
      };
      if (editing) {
        await adminApi.updateDouyinPersona(form.id, {
          ...payload,
          status: form.status,
        });
        onNotice?.('人设已更新。改了外貌就重新生成一次三视图，否则分镜还会按旧形象出图');
      } else {
        await adminApi.createDouyinPersona(payload);
        onNotice?.('人物已创建，接着点「生成三视图」出形象图');
      }
      setForm(EMPTY_FORM);
      setBrief('');
      await reload();
    } catch (error) {
      onError?.(error.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * @description 串行生成三视图形象图，耗时较长，期间禁用该行按钮。
   * @keyword-cn 生成人物三视图, 形象一致
   * @keyword-en generate-reference-sheet, identity-consistency
   */
  const generateSheet = async (row) => {
    setSheetBusyId(row.id);
    try {
      await adminApi.generateDouyinPersonaSheet(row.id);
      onNotice?.(`「${row.name}」的三视图已生成`);
      await reload();
    } catch (error) {
      onError?.(error.message);
    } finally {
      setSheetBusyId(null);
    }
  };

  /**
   * @description 删除人物；已经选用它的脚本会退回为不指定出镜人物。
   * @keyword-cn 删除预设人物, 引用降级
   * @keyword-en delete-persona, dangling-reference
   */
  const remove = async (row) => {
    if (
      !window.confirm(
        `删除「${row.name}」？已经选用它的脚本会退回为不指定出镜人物，已生成的画面不受影响。`,
      )
    ) {
      return;
    }
    try {
      await adminApi.deleteDouyinPersona(row.id);
      if (form.id === row.id) setForm(EMPTY_FORM);
      onNotice?.('人物已删除');
      await reload();
    } catch (error) {
      onError?.(error.message);
    }
  };

  /* 按 id 现查而不是缓存图组：重新生成三视图后列表会刷新，灯箱要跟着换成新图 */
  const previewPersona = preview
    ? personas.find((item) => item.id === preview.personaId)
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">预设人物</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              租户内共享。工作台在每条脚本上选一个人物后，脚本按 TA 的视角写，分镜按 TA 的形象图出图，成片按 TA 的音色配音。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-50"
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>

        {!personas.length ? (
          <p className="mt-6 rounded border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-xs text-slate-400">
            还没有预设人物。右侧填人设，或写一句需求让 AI 起草。
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {personas.map((row) => (
              <li
                key={row.id}
                className={`rounded-lg border p-3 ${row.status === 'archived' ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex gap-3">
                  <div className="flex shrink-0 gap-1">
                    {row.referenceImages?.length ? (
                      row.referenceImages.map((image, order) => (
                        <button
                          key={image.imageId}
                          type="button"
                          title={`点击放大 · ${VIEW_LABELS[image.view] || image.view}`}
                          onClick={() => setPreview({ personaId: row.id, index: order })}
                          className="h-20 w-14 overflow-hidden rounded border border-slate-200 transition hover:border-violet-400 hover:ring-2 hover:ring-violet-200"
                        >
                          <img
                            src={image.coverUrl || image.url}
                            alt={VIEW_LABELS[image.view] || image.view}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))
                    ) : (
                      <span className="grid h-20 w-14 place-items-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                        缺形象图
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm text-slate-800">
                        {row.name}
                      </strong>
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                        {perspectiveLabel[row.perspective] || row.perspective}
                      </span>
                      {row.status === 'archived' ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          已归档
                        </span>
                      ) : null}
                    </div>
                    {row.summary ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.summary}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-400">
                      音色：{describeVoice(row.voice)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                      {row.appearance}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setForm(personaToForm(row))}
                    className="rounded border border-slate-200 px-2.5 py-1 text-slate-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateSheet(row)}
                    disabled={sheetBusyId === row.id}
                    className="rounded border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-700 disabled:opacity-50"
                  >
                    {sheetBusyId === row.id
                      ? '正在出图，三张要一会儿…'
                      : row.referenceImages?.length
                        ? '重新生成三视图'
                        : '生成三视图'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    className="rounded border border-rose-200 px-2.5 py-1 text-rose-600"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {editing ? `编辑「${form.name || '人物'}」` : '新建人物'}
        </h3>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          一句话需求（可选，让 AI 起草人设）
          <textarea
            value={brief}
            maxLength={500}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="例如：25 岁成都本地探店女生，接地气爱吐槽，主打苍蝇馆子"
            className="mt-1 h-16 w-full resize-none rounded border border-slate-200 p-2 text-xs font-normal"
          />
        </label>
        <button
          type="button"
          onClick={() => void draftPersona()}
          disabled={drafting}
          className="mt-2 w-full rounded bg-violet-600 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {drafting ? 'AI 正在写人设…' : 'AI 起草人设'}
        </button>

        <label className="mt-4 block text-xs font-medium text-slate-600">
          人物名
          <input
            value={form.name}
            maxLength={40}
            onChange={(event) =>
              setForm((c) => ({ ...c, name: event.target.value }))
            }
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-normal"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          一句话简介
          <input
            value={form.summary}
            maxLength={120}
            onChange={(event) =>
              setForm((c) => ({ ...c, summary: event.target.value }))
            }
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-normal"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          外貌与穿着设定
          <span className="ml-1 font-normal text-slate-400">
            形象图与每一镜画面都照它出，写得越具体越稳
          </span>
          <textarea
            value={form.appearance}
            maxLength={1000}
            onChange={(event) =>
              setForm((c) => ({ ...c, appearance: event.target.value }))
            }
            placeholder="性别、年龄感、脸型五官、发型发色、体型、常穿服装与配饰、整体气质"
            className="mt-1 h-28 w-full resize-none rounded border border-slate-200 p-2 text-xs font-normal leading-5"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          性格与说话语气
          <textarea
            value={form.persona}
            maxLength={1000}
            onChange={(event) =>
              setForm((c) => ({ ...c, persona: event.target.value }))
            }
            className="mt-1 h-20 w-full resize-none rounded border border-slate-200 p-2 text-xs font-normal leading-5"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          叙事视角
          <select
            value={form.perspective}
            onChange={(event) =>
              setForm((c) => ({ ...c, perspective: event.target.value }))
            }
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-normal"
          >
            {perspectives.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-[11px] leading-4 text-slate-400">
            {perspectives.find((item) => item.key === form.perspective)
              ?.instruction || ''}
          </span>
        </label>

        <fieldset className="mt-3 rounded border border-slate-200 p-2">
          <legend className="px-1 text-xs font-medium text-slate-600">
            音色
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {['gender', 'age', 'pace'].map((key) => (
              <select
                key={key}
                value={form.voice[key]}
                onChange={(event) =>
                  setForm((c) => ({
                    ...c,
                    voice: { ...c.voice, [key]: event.target.value },
                  }))
                }
                className="rounded border border-slate-200 px-1.5 py-1 text-xs"
              >
                {VOICE_OPTIONS[key].map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <input
            value={form.voice.timbre}
            maxLength={120}
            onChange={(event) =>
              setForm((c) => ({
                ...c,
                voice: { ...c.voice, timbre: event.target.value },
              }))
            }
            placeholder="音色特质，例如：清亮干脆、尾音略上扬"
            className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
          />
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            成片人声由生视频模型按提示词生成，这里是写进【声音】段的描述，不是固定音色 ID。
          </p>
        </fieldset>

        {editing ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={form.status === 'archived'}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  status: event.target.checked ? 'archived' : 'active',
                }))
              }
            />
            归档（工作台不再显示，已选用的脚本不受影响）
          </label>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex-1 rounded bg-slate-800 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : editing ? '保存修改' : '创建人物'}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setBrief('');
              }}
              className="rounded border border-slate-200 px-3 py-2 text-xs text-slate-600"
            >
              取消
            </button>
          ) : null}
        </div>
      </section>

      {previewPersona?.referenceImages?.length ? (
        <PersonaImageLightbox
          images={previewPersona.referenceImages}
          index={Math.min(preview.index, previewPersona.referenceImages.length - 1)}
          name={previewPersona.name}
          onIndexChange={(index) => setPreview((current) => ({ ...current, index }))}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
