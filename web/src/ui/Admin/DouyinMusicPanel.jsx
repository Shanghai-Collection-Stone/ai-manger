import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 曲目表单初始值，字段与后端 `CreateDouyinMusicDto` 对应；`id` 有值时是编辑。
 * @keyword-cn 曲目表单初值, 表单字段
 * @keyword-en empty-music-form, form-fields
 */
const EMPTY_MUSIC_FORM = { id: null, name: '', category: 'other', licenseNote: '', isPublic: false };

/**
 * @description 选项没取到时的上传大小上限（30MB），与后端 `DOUYIN_MUSIC_MAX_BYTES` 一致。
 * @keyword-cn 曲目大小兜底, 上传限制
 * @keyword-en music-max-bytes-fallback, upload-limit
 */
const FALLBACK_MAX_BYTES = 30 * 1024 * 1024;

/**
 * @description 后台「背景音乐曲库」面板：上传已授权曲目（必须写授权来源）、试听、编辑、归档与删除；母平台可公开给所有租户，租户对平台曲目只读。
 * @keyword-cn 背景音乐曲库页, 曲目管理
 * @keyword-en douyin-music-panel, track-management
 * @param {{isPlatform: boolean, onNotice?: (message: string) => void, onError?: (message: string) => void}} props 是否母平台与提示回调。
 * @returns {JSX.Element} 面板。
 */
export default function DouyinMusicPanel({ isPlatform, onNotice, onError }) {
  const [tracks, setTracks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [maxBytes, setMaxBytes] = useState(FALLBACK_MAX_BYTES);
  const [form, setForm] = useState(EMPTY_MUSIC_FORM);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const editing = Boolean(form.id);
  const categoryLabel = useMemo(() => Object.fromEntries(categories.map((item) => [item.key, item.label])), [categories]);

  /**
   * @description 拉取曲目列表与分类选项。
   * @keyword-cn 加载曲库, 曲库分类
   * @keyword-en load-music-library, music-categories
   */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, options] = await Promise.all([adminApi.listDouyinMusicLibrary(), adminApi.getDouyinMusicOptions()]);
      setTracks(list?.tracks || []);
      setCategories(options?.categories || []);
      setMaxBytes(Number(options?.maxBytes) || FALLBACK_MAX_BYTES);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void reload(); }, [reload]);

  /**
   * @description 清空表单与已选文件，回到新增状态。
   * @keyword-cn 重置曲目表单, 清空文件
   * @keyword-en reset-music-form, clear-file
   */
  const resetForm = () => {
    setForm(EMPTY_MUSIC_FORM);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  /**
   * @description 校验并保存：新增时上传文件，编辑时只改曲目信息。
   * @keyword-cn 保存曲目, 授权来源校验
   * @keyword-en save-music-track, license-check
   */
  const save = async () => {
    const licenseNote = form.licenseNote.trim();
    if (!licenseNote) { onError?.('请填写这首曲目的授权来源'); return; }
    if (!editing && !file) { onError?.('请选择音乐文件'); return; }
    if (!editing && file.size > maxBytes) { onError?.(`音乐文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`); return; }
    if (editing && !form.name.trim()) { onError?.('曲名不能为空'); return; }
    setSaving(true);
    try {
      if (editing) {
        await adminApi.updateDouyinMusic(form.id, {
          name: form.name.trim(),
          category: form.category,
          licenseNote,
          ...(isPlatform ? { isPublic: form.isPublic } : {}),
        });
      } else {
        const body = new FormData();
        body.append('file', file);
        if (form.name.trim()) body.append('name', form.name.trim());
        body.append('category', form.category);
        body.append('licenseNote', licenseNote);
        if (isPlatform) body.append('isPublic', String(form.isPublic));
        await adminApi.createDouyinMusic(body);
      }
      onNotice?.(editing ? '曲目已更新' : '曲目已加入曲库');
      resetForm();
      await reload();
    } catch (error) {
      onError?.(error.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * @description 归档或恢复曲目：归档后工作台不再列出，已选用它的脚本继续可用。
   * @keyword-cn 归档曲目, 恢复曲目
   * @keyword-en archive-music-track, restore-music-track
   * @param {object} row 曲目。
   */
  const toggleArchive = async (row) => {
    try {
      await adminApi.updateDouyinMusic(row.id, { status: row.status === 'archived' ? 'active' : 'archived' });
      onNotice?.(row.status === 'archived' ? `「${row.name}」已恢复` : `「${row.name}」已归档`);
      await reload();
    } catch (error) {
      onError?.(error.message);
    }
  };

  /**
   * @description 母平台切换曲目公开；取消公开前确认，因为已选用它的租户脚本下次拼接会没有配乐。
   * @keyword-cn 切换曲目公开, 平台公开曲目
   * @keyword-en toggle-music-public, platform-public-track
   * @param {object} row 曲目。
   */
  const togglePublic = async (row) => {
    if (row.isPublic && !window.confirm(`取消公开「${row.name}」？已经选用它的租户脚本下次拼接时将没有配乐。`)) return;
    try {
      await adminApi.updateDouyinMusic(row.id, { isPublic: !row.isPublic });
      onNotice?.(row.isPublic ? `「${row.name}」已取消公开` : `「${row.name}」已公开给所有租户`);
      await reload();
    } catch (error) {
      onError?.(error.message);
    }
  };

  /**
   * @description 删除曲目与文件；已选用它的脚本下次拼接时没有配乐并提示重选，已生成的成片不受影响。
   * @keyword-cn 删除曲目, 引用降级
   * @keyword-en delete-music-track, dangling-reference
   * @param {object} row 曲目。
   */
  const remove = async (row) => {
    if (!window.confirm(`删除「${row.name}」？已经选用它的脚本下次拼接时将没有配乐，已生成的成片不受影响。`)) return;
    try {
      await adminApi.deleteDouyinMusic(row.id);
      if (form.id === row.id) resetForm();
      onNotice?.('曲目已删除');
      await reload();
    } catch (error) {
      onError?.(error.message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">背景音乐曲库</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isPlatform ? '平台曲目设为公开后，所有租户都能在工作台选用（只读）。' : '租户内共享，另含平台公开的曲目（只读）。'}
              工作台在「声音」步骤里选曲，拼接时混进成片。
            </p>
          </div>
          <button type="button" onClick={() => void reload()} disabled={loading} className="shrink-0 rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-50">{loading ? '加载中…' : '刷新'}</button>
        </div>
        {!tracks.length ? (
          <p className="mt-6 rounded border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-xs text-slate-400">{loading ? '正在读取曲库…' : '曲库还是空的。在右侧上传第一首已授权的音乐。'}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {tracks.map((row) => (
              <li key={row.id} data-music-track={row.id} className={`rounded-lg border border-slate-200 p-3 ${row.status === 'archived' ? 'bg-slate-50 opacity-70' : 'bg-white'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-800">{row.name}</p>
                  <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">{categoryLabel[row.category] || row.category}</span>
                  {row.status === 'archived' ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">已归档</span> : null}
                  {row.fromPlatform ? <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">平台公开</span> : null}
                  {!row.fromPlatform && row.isPublic ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">已公开</span> : null}
                </div>
                <p className="mt-1 break-words text-[11px] text-slate-500">授权来源：{row.licenseNote || '未填写'}</p>
                <audio controls preload="none" src={row.url} aria-label={`试听 ${row.name}`} className="mt-2 h-8 w-full" />
                {row.fromPlatform ? <p className="mt-2 text-[11px] text-slate-400">平台公开曲目，只能在工作台选用，不能修改。</p> : (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button type="button" onClick={() => { setFile(null); setForm({ id: row.id, name: row.name, category: row.category, licenseNote: row.licenseNote || '', isPublic: Boolean(row.isPublic) }); }} className="rounded border border-slate-200 px-2.5 py-1 text-slate-600">编辑</button>
                    {isPlatform ? <button type="button" onClick={() => void togglePublic(row)} className={`rounded border px-2.5 py-1 ${row.isPublic ? 'border-slate-200 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{row.isPublic ? '取消公开' : '公开给租户'}</button> : null}
                    <button type="button" onClick={() => void toggleArchive(row)} className="rounded border border-slate-200 px-2.5 py-1 text-slate-600">{row.status === 'archived' ? '恢复' : '归档'}</button>
                    <button type="button" onClick={() => void remove(row)} className="rounded border border-rose-200 px-2.5 py-1 text-rose-600">删除</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="h-fit rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">{editing ? `编辑「${form.name || '曲目'}」` : '上传曲目'}</h3>
        {!editing ? (
          <label className="mt-3 block text-xs font-medium text-slate-600">
            音乐文件（MP3、WAV、M4A，不超过 {Math.round(maxBytes / 1024 / 1024)}MB）
            <input ref={fileInput} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-xs font-normal" />
          </label>
        ) : null}
        <label className="mt-3 block text-xs font-medium text-slate-600">
          曲名{editing ? '' : '（留空用文件名）'}
          <input value={form.name} maxLength={60} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-normal" />
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-600">
          分类
          <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-normal">
            {categories.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-600">
          授权来源（必填）
          <textarea value={form.licenseNote} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, licenseNote: event.target.value }))} placeholder="例如：某音乐平台商用授权，订单号 123456，有效期至 2027-12" className="mt-1 h-16 w-full resize-none rounded border border-slate-200 p-2 text-xs font-normal" />
        </label>
        {isPlatform ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.isPublic} onChange={(event) => setForm((current) => ({ ...current, isPublic: event.target.checked }))} />
            公开给所有租户
          </label>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void save()} disabled={saving} className="flex-1 rounded bg-violet-600 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? '保存中…' : editing ? '保存修改' : '上传到曲库'}</button>
          {editing ? <button type="button" onClick={resetForm} className="rounded border border-slate-200 px-3 py-2 text-xs text-slate-600">取消</button> : null}
        </div>
      </section>
    </div>
  );
}
