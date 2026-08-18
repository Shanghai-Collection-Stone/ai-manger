import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { chatService } from '../../chatService';
import ImageEffectDialog from './ImageEffectDialog';

/** 上传素材统一打的标签，「我的上传」页签按它筛。 */
export const UPLOAD_MATERIAL_TAG = '我的素材';
/** 后端 AI 素材接口写入的固定标签，与 gallery.controller 的 AI_MATERIAL_TAG 保持一致。 */
export const AI_MATERIAL_TAG = 'ai素材';

const TABS = [
  { id: 'builtin', label: '内置' },
  { id: 'ai', label: 'AI 生成' },
  { id: 'upload', label: '我的上传' },
];

/**
 * @description 读取图库图片可展示地址。
 * @keyword-cn 素材地址
 * @keyword-en material image url
 * @param {object} image - 图库图片实体。
 * @returns {string} 图片地址。
 */
const readImageUrl = (image) =>
  String(image?.url || image?.thumbUrl || '').trim();

/**
 * @description 素材面板：内置 emoji/色块、AI 生成素材、我的上传三个页签。
 *   上传和 AI 生成的图片都会先进「图片特效」弹窗做 GPU 去底/描边/投影，再落到画布。
 * @keyword-cn 素材面板
 * @keyword-cn 素材页签
 * @keyword-en material-panel
 * @keyword-en material-tabs
 * @param {{ stickerGroups: object[], shapePresets: object[], onAddSticker: Function, onAddShape: Function, onAddProcessedImage: Function }} props - 内置素材数据与落图回调。
 * @returns {JSX.Element} 素材面板。
 */
const MaterialPanel = ({
  stickerGroups,
  shapePresets,
  onAddSticker,
  onAddShape,
  onAddProcessedImage,
}) => {
  const [tab, setTab] = useState('builtin');
  const [images, setImages] = useState({ ai: [], upload: [] });
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [effectSource, setEffectSource] = useState(null);
  const [styleReference, setStyleReference] = useState(null);
  const fileInputRef = useRef(null);
  const referenceInputRef = useRef(null);
  const tagOfTab = useMemo(
    () => ({ ai: AI_MATERIAL_TAG, upload: UPLOAD_MATERIAL_TAG }),
    [],
  );

  /** @description 按页签标签拉取该类素材。 @keyword-cn 素材列表 @keyword-en load materials @param {string} key - 页签标识。 @returns {Promise<void>} 加载流程。 */
  const loadMaterials = useCallback(
    async (key) => {
      const tag = tagOfTab[key];
      if (!tag) return;
      setLoading(true);
      try {
        const res = await chatService.listGalleryImages({
          tag,
          imageType: 'all',
          limit: 120,
        });
        const list = (Array.isArray(res?.images) ? res.images : []).filter(
          (image) => readImageUrl(image),
        );
        setImages((current) => ({ ...current, [key]: list }));
      } finally {
        setLoading(false);
      }
    },
    [tagOfTab],
  );

  /** @description 切到 AI / 上传页签时按需拉列表。 @keyword-cn 素材列表 @keyword-en load on tab change */
  useEffect(() => {
    if (tab !== 'builtin') void loadMaterials(tab);
  }, [tab, loadMaterials]);

  /** @description 上传本地素材到图库，成功后刷新「我的上传」并直接弹出特效面板。 @keyword-cn 素材上传 @keyword-en upload material @param {FileList} fileList - 选中的文件。 @returns {Promise<void>} 上传流程。 */
  const handleUpload = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (!files.length) return;
      setLoading(true);
      setNotice('');
      try {
        const res = await chatService.uploadGalleryImages({
          files,
          tags: [UPLOAD_MATERIAL_TAG],
        });
        const uploaded = Array.isArray(res?.images) ? res.images : [];
        await loadMaterials('upload');
        setTab('upload');
        const first = uploaded.find((image) => readImageUrl(image));
        if (first)
          setEffectSource({
            url: readImageUrl(first),
            name: first.originalName || '上传素材',
          });
      } catch {
        setNotice('上传失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [loadMaterials],
  );

  /** @description 上传一张可选风格参考图；它只指导配色、字体气质与装饰构成，不会作为素材主体。 @keyword-cn 风格参考图 @keyword-en style-reference-image @param {FileList} fileList - 单张参考图。 @returns {Promise<void>} 上传流程。 */
  const handleReferenceUpload = useCallback(async (fileList) => {
    const file = Array.from(fileList || []).find((item) =>
      item.type.startsWith('image/'),
    );
    if (!file) return;
    setLoading(true);
    setNotice('');
    try {
      const res = await chatService.uploadGalleryImages({
        files: [file],
        tags: [UPLOAD_MATERIAL_TAG, '风格参考'],
      });
      const uploaded = (Array.isArray(res?.images) ? res.images : []).find(
        (image) => readImageUrl(image),
      );
      if (!uploaded) throw new Error('REFERENCE_IMAGE_EMPTY');
      setStyleReference({
        url: readImageUrl(uploaded),
        name: uploaded.originalName || file.name || '风格参考图',
      });
    } catch {
      setNotice('参考图上传失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  /** @description 让 AI 生成一张素材，服务端强制纯色背景，回来后直接进特效面板去底。 @keyword-cn AI素材生成 @keyword-en generate ai material @returns {Promise<void>} 生成流程。 */
  const handleGenerate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || generating) return;
    setGenerating(true);
    setNotice('');
    try {
      const res = await chatService.generateAiMaterial({
        prompt: text,
        referenceImageUrl: styleReference?.url,
      });
      const url = readImageUrl(res?.image);
      await loadMaterials('ai');
      if (url) setEffectSource({ url, name: text.slice(0, 20) });
      else setNotice('生成结果为空，请换个描述重试');
    } catch {
      setNotice('生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, loadMaterials, styleReference]);

  const list = tab === 'builtin' ? [] : images[tab] || [];

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`py-1.5 rounded-lg text-xs font-medium transition ${tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
          {notice}
        </p>
      )}

      {tab === 'builtin' && (
        <div className="space-y-4">
          {stickerGroups.map((group) => (
            <div key={group.id}>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                {group.label}
              </p>
              <div className="grid grid-cols-6 gap-1">
                {group.items.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => onAddSticker(emoji)}
                    title={`添加 ${emoji}`}
                    className="h-9 rounded-lg text-[19px] leading-none hover:bg-slate-100"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">
              形状色块
            </p>
            <div className="grid grid-cols-2 gap-2">
              {shapePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onAddShape(preset)}
                  className="rounded-lg border border-slate-200 px-2 py-2 hover:border-[#775cf0] hover:bg-[#faf9ff] flex items-center gap-2"
                >
                  <span className="shrink-0 h-6 w-6 flex items-center justify-center">
                    <span
                      style={{
                        display: 'block',
                        width: preset.layer.height <= 6 ? 22 : 20,
                        height:
                          preset.layer.height <= 6
                            ? 3
                            : preset.layer.width > preset.layer.height
                              ? 13
                              : 20,
                        borderRadius: preset.layer.radius,
                        backgroundColor: preset.layer.color,
                        border: preset.layer.border,
                      }}
                    />
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="space-y-2">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你要的贴纸，例如：一只戴生日帽的柯基，卡通贴纸风"
            className="w-full h-20 p-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#dcd5ff]"
          />
          <input
            ref={referenceInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleReferenceUpload(event.target.files);
              event.target.value = '';
            }}
          />
          {styleReference ? (
            <div className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/60 p-2">
              <img
                src={styleReference.url}
                alt="风格参考"
                className="h-12 w-12 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-slate-700">
                  {styleReference.name}
                </p>
                <p className="text-[10px] text-slate-400">
                  只参考色彩、字体气质与构成
                </p>
              </div>
              <button
                title="移除参考图"
                onClick={() => setStyleReference(null)}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-500"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => referenceInputRef.current?.click()}
              className="w-full py-2 rounded-lg border border-dashed border-violet-200 text-xs text-violet-500 hover:border-violet-400 hover:bg-violet-50 flex items-center justify-center gap-1.5"
            >
              <ImagePlus size={14} />
              添加风格参考图（可选）
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full py-2 rounded-lg bg-[#6f55ed] hover:bg-[#5e45dd] text-white text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {generating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wand2 size={14} />
            )}
            {generating ? '生成中，约需 1-2 分钟' : '生成素材'}
          </button>
          <p className="text-[11px] text-slate-400">
            文字描述决定内容；参考图只决定视觉语言。生成时强制纯色背景，回来后自动去底。
          </p>
        </div>
      )}

      {tab === 'upload' && (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleUpload(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-[#775cf0] hover:text-[#6045de] flex items-center justify-center gap-1.5"
          >
            <Upload size={14} />
            上传素材图片
          </button>
          <p className="text-[11px] text-slate-400">
            上传后可做去底、按形状描边和投影，处理在本机 GPU 上跑。
          </p>
        </div>
      )}

      {tab !== 'builtin' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-medium text-slate-500">
              {tab === 'ai' ? '已生成' : '已上传'}
            </p>
            <button
              title="刷新"
              onClick={() => loadMaterials(tab)}
              className="p-1 rounded text-slate-400 hover:bg-slate-100"
            >
              <RefreshCw
                size={13}
                className={loading ? 'animate-spin' : undefined}
              />
            </button>
          </div>
          {loading && !list.length ? (
            <div className="py-8 text-center text-xs text-slate-400">
              加载中…
            </div>
          ) : !list.length ? (
            <div className="py-8 text-center text-xs text-slate-400">
              还没有素材
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {list.map((image) => (
                <div key={image.id} className="group relative">
                  <img
                    src={image.thumbUrl || image.url}
                    alt={image.originalName || '素材'}
                    crossOrigin="anonymous"
                    loading="lazy"
                    className="h-24 w-full rounded-xl object-cover bg-slate-100"
                  />
                  <div className="absolute inset-0 rounded-xl bg-slate-900/45 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5">
                    <button
                      title="做特效后加入画布"
                      onClick={() =>
                        setEffectSource({
                          url: readImageUrl(image),
                          name: image.originalName || '素材',
                        })
                      }
                      className="h-7 w-7 rounded-full bg-white text-[#6f55ed] flex items-center justify-center"
                    >
                      <Sparkles size={14} />
                    </button>
                    <button
                      title="不做处理直接加入画布"
                      onClick={() =>
                        onAddProcessedImage({
                          src: readImageUrl(image),
                          name: image.originalName || '素材',
                          materialSrc: readImageUrl(image),
                        })
                      }
                      className="h-7 w-7 rounded-full bg-white text-slate-600 flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {effectSource && (
        <ImageEffectDialog
          source={effectSource.url}
          title={`图片特效 · ${effectSource.name}`}
          onClose={() => setEffectSource(null)}
          onApply={({ dataUrl, width, height, effect }) => {
            // 把原图地址和这次的参数一起带上，图层之后可以重新打开特效面板接着改
            onAddProcessedImage({
              src: dataUrl,
              name: effectSource.name,
              width,
              height,
              materialSrc: effectSource.url,
              effect,
            });
            setEffectSource(null);
          }}
        />
      )}
    </div>
  );
};

export default MaterialPanel;
