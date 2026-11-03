import sharp from 'sharp';
import type {
  DouyinTemplateAspect,
  DouyinVideoTemplate,
} from '../entities/douyin-workbench.entity.js';
import { readStoreVisitJson } from './douyin-store-visit-planner.service.js';

type TemplateWindow = DouyinVideoTemplate['window'];

/**
 * @description 版式模板画布：抖音竖屏 1080×1920，窗口坐标都按这个像素算。
 * @keyword-cn 模板画布尺寸, 竖屏画布
 * @keyword-en template-canvas-size, vertical-canvas
 */
export const DOUYIN_TEMPLATE_CANVAS = { width: 1080, height: 1920 } as const;

/**
 * @description 视频窗口可选比例与宽高比数值，与自建视频服务支持的 `aspect_ratio` 对齐（不含 21:9）。
 * @keyword-cn 窗口比例表, 视频画面比例
 * @keyword-en template-aspect-table, video-aspect-ratio
 */
export const DOUYIN_TEMPLATE_ASPECTS: Record<DouyinTemplateAspect, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
};

/** 窗口最高占画布 62%，上下要留出标题与卖点的位置 */
const TEMPLATE_WINDOW_MAX_HEIGHT = Math.round(
  DOUYIN_TEMPLATE_CANVAS.height * 0.62,
);
/** 抠窗时向外多抠几像素，吃掉绿块边缘的抗锯齿杂色；成片按 cover 铺满窗口 */
const TEMPLATE_HOLE_PADDING = 6;

/**
 * @description 版式规划结果：要不要套模板、原因、窗口比例与像素位置、文案与风格。
 * @keyword-cn 模板规划结果, 版式方案
 * @keyword-en template-plan-result, layout-plan
 */
export interface DouyinTemplatePlan {
  useTemplate: boolean;
  reason: string;
  aspectRatio: DouyinTemplateAspect;
  window: TemplateWindow;
  title: string;
  subtitle: string;
  sellingPoints: string[];
  cta: string;
  style: string;
}

/**
 * @description 取离给定宽高最近的窗口比例（按宽高比的对数差比较，横竖对称）。
 * @keyword-cn 最近窗口比例, 比例吸附
 * @keyword-en nearest-template-aspect, snap-aspect
 * @param width 宽度（任意单位）。
 * @param height 高度（同单位）。
 * @returns 最近的比例，宽高无效时为 4:3。
 */
export function pickTemplateAspect(
  width: number,
  height: number,
): DouyinTemplateAspect {
  if (!(width > 0) || !(height > 0)) return '4:3';
  const ratio = Math.log(width / height);
  let best: DouyinTemplateAspect = '4:3';
  let bestGap = Infinity;
  for (const [aspect, value] of Object.entries(DOUYIN_TEMPLATE_ASPECTS)) {
    const gap = Math.abs(Math.log(value) - ratio);
    if (gap < bestGap) {
      best = aspect as DouyinTemplateAspect;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * @description 判断是否为支持的窗口比例。
 * @keyword-cn 窗口比例校验, 比例白名单
 * @keyword-en is-template-aspect, aspect-whitelist
 * @param value 待判断的值。
 * @returns 是否为 `DOUYIN_TEMPLATE_ASPECTS` 里的比例。
 */
export function isTemplateAspect(
  value: unknown,
): value is DouyinTemplateAspect {
  return typeof value === 'string' && value in DOUYIN_TEMPLATE_ASPECTS;
}

/**
 * @description 按比例算出窗口像素位置：宽度取画布宽度的比例（缺省 92%，限 50%～100%），高度按比例推出、最高 62% 画布；
 *   左上角给了比例就按比例，没给就居中；最后夹进画布并取偶数像素（ffmpeg 缩放要求偶数）。
 * @keyword-cn 计算窗口位置, 窗口按比例
 * @keyword-en size-template-window, window-from-aspect
 * @param input 比例与可选的左上角、宽度（均为占画布的比例 0～1）。
 * @returns 1080×1920 画布上的窗口像素。
 */
export function sizeTemplateWindow(input: {
  aspect: DouyinTemplateAspect;
  x?: number;
  y?: number;
  width?: number;
}): TemplateWindow {
  const { width: canvasWidth, height: canvasHeight } = DOUYIN_TEMPLATE_CANVAS;
  const ratio = DOUYIN_TEMPLATE_ASPECTS[input.aspect];
  const widthShare = Number.isFinite(input.width)
    ? Math.min(1, Math.max(0.5, Number(input.width)))
    : 0.92;
  let width = canvasWidth * widthShare;
  let height = width / ratio;
  if (height > TEMPLATE_WINDOW_MAX_HEIGHT) {
    height = TEMPLATE_WINDOW_MAX_HEIGHT;
    width = height * ratio;
  }
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  width = even(width);
  height = even(height);
  // 画布与窗口宽高都是偶数，向下取偶不会越界
  const place = (share: number | undefined, size: number, total: number) => {
    const start = Number.isFinite(share)
      ? Number(share) * total
      : (total - size) / 2;
    return Math.floor(Math.min(total - size, Math.max(0, start)) / 2) * 2;
  };
  return {
    x: place(input.x, width, canvasWidth),
    y: place(input.y, height, canvasHeight),
    width,
    height,
  };
}

/**
 * @description 截断并清理一段模板文案（去换行与首尾空白）。
 * @keyword-cn 模板文案清理, 文案截断
 * @keyword-en clean-template-text, truncate-copy
 * @param value 原值。
 * @param max 最多字数。
 * @returns 清理后的文字，非字符串为空串。
 */
function cleanTemplateText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

/**
 * @description 整理模板文案：标题 ≤ 20 字、副标题 ≤ 24 字、卖点最多 4 个各 ≤ 10 字、行动引导 ≤ 20 字、风格 ≤ 300 字；
 *   规划结果与前端手改共用这一套上限。
 * @keyword-cn 整理模板文案, 文案上限
 * @keyword-en normalize-template-copy, copy-limits
 * @param raw 标题、副标题、卖点、行动引导与风格的原值。
 * @returns 整理后的文案。
 */
export function normalizeTemplateCopy(raw: {
  title?: unknown;
  subtitle?: unknown;
  sellingPoints?: unknown;
  cta?: unknown;
  style?: unknown;
}): Pick<
  DouyinTemplatePlan,
  'title' | 'subtitle' | 'sellingPoints' | 'cta' | 'style'
> {
  return {
    title: cleanTemplateText(raw.title, 20),
    subtitle: cleanTemplateText(raw.subtitle, 24),
    sellingPoints: (Array.isArray(raw.sellingPoints) ? raw.sellingPoints : [])
      .map((item) => cleanTemplateText(item, 10))
      .filter(Boolean)
      .slice(0, 4),
    cta: cleanTemplateText(raw.cta, 20),
    style: cleanTemplateText(raw.style, 300),
  };
}

/**
 * @description 解析思考节点返回的版式规划 JSON 原文，见 `readTemplatePlan`。
 * @keyword-cn 解析模板规划, 规划JSON
 * @keyword-en parse-template-plan, plan-json
 * @param text 模型原文（可带 ```json 包裹）。
 * @returns 规划结果。
 */
export function parseTemplatePlan(text: string): DouyinTemplatePlan {
  return readTemplatePlan(readStoreVisitJson(text));
}

/**
 * @description 读出版式规划（AI 导演 JSON 里的 `template` 部分）：比例不认识时按窗口宽高（再不行用 4:3）吸附，9:16 视为不套模板；
 *   没有标题也视为不套模板。窗口按 `sizeTemplateWindow` 算成像素。
 * @keyword-cn 读取模板规划, 模板规划字段
 * @keyword-en read-template-plan, template-plan-fields
 * @param raw 已解析的 JSON 对象。
 * @returns 规划结果。
 */
export function readTemplatePlan(
  raw: Record<string, unknown>,
): DouyinTemplatePlan {
  const rawWindow =
    raw.window && typeof raw.window === 'object'
      ? (raw.window as Record<string, unknown>)
      : {};
  const share = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 1
      ? number
      : undefined;
  };
  const windowWidth = share(rawWindow.width);
  const windowHeight = share(rawWindow.height);
  const aspectRatio = isTemplateAspect(raw.aspectRatio)
    ? raw.aspectRatio
    : windowWidth && windowHeight
      ? pickTemplateAspect(
          windowWidth * DOUYIN_TEMPLATE_CANVAS.width,
          windowHeight * DOUYIN_TEMPLATE_CANVAS.height,
        )
      : '4:3';
  const copy = normalizeTemplateCopy(raw);
  return {
    useTemplate:
      raw.useTemplate !== false &&
      aspectRatio !== '9:16' &&
      Boolean(copy.title),
    reason: cleanTemplateText(raw.reason, 120),
    aspectRatio,
    window: sizeTemplateWindow({
      aspect: aspectRatio,
      x: share(rawWindow.x),
      y: share(rawWindow.y),
      width: windowWidth,
    }),
    ...copy,
  };
}

/**
 * @description 改图模型编辑版式模板的提示词：以传入的实拍图为底图排成竖屏海报，背景只用这张图本身（放大、裁切、虚化、压暗或叠纯色块），
 *   不添加图里没有的任何物体、人物、商品、插画或图标；窗口位置画成纯绿 #00FF00 实心矩形（之后抠成透明放视频），引号里的文字逐字照写，不加别的文字、水印、二维码。
 * @keyword-cn 模板改图提示词, 只编辑实拍图, 绿幕窗口
 * @keyword-en template-edit-prompt, edit-real-photo-only, green-window
 * @param template 窗口、文案与配色字体风格。
 * @returns 改图提示词。
 */
export function buildTemplateEditPrompt(
  template: Pick<
    DouyinVideoTemplate,
    'window' | 'title' | 'subtitle' | 'sellingPoints' | 'cta' | 'style'
  >,
): string {
  const { width, height } = DOUYIN_TEMPLATE_CANVAS;
  const percent = (value: number, total: number) =>
    `${Math.round((value / total) * 100)}%`;
  const { window } = template;
  const points = template.sellingPoints.map((item) => `「${item}」`).join('');
  return [
    '把这张门店实拍图编辑成竖版 9:16 的抖音短视频版式海报。只做编辑排版，不新造画面内容。',
    '背景只能用这张图本身：可以放大、裁切、虚化、压暗，或叠半透明纯色块与渐变；不要添加图里没有的任何东西——物体、人物、食物、商品、家具、装修、场景、插画、贴纸、图标、气球、花朵、光效都不要加，也不要改动图里的招牌、商品和陈设。',
    `画面中有一块纯绿色（#00FF00）实心矩形：左边距约 ${percent(window.x, width)}，上边距约 ${percent(window.y, height)}，宽约 ${percent(window.width, width)}，高约 ${percent(window.height, height)}。这块绿色以后放视频，里面只能是均匀纯绿，不画任何东西、不写字、不渐变、不加阴影和纹理，四边笔直整齐；可以给它加简单的描边或圆角。`,
    `配色与字体风格：${template.style || '与照片色调协调的简洁商业排版'}（只指配色、字体和文字底板，不要据此画任何新东西）。`,
    `顶部醒目大标题「${template.title}」${template.subtitle ? `，下方副标题「${template.subtitle}」` : ''}。`,
    points ? `绿色区域下方并排卖点标签（纯色底板加文字）：${points}。` : '',
    template.cta ? `最下方一个按钮样式的行动引导「${template.cta}」。` : '',
    '所有文字与引号内完全一致，字清晰不变形；除此之外不要出现其他文字、水印、二维码或品牌标志。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 在模板图里找绿色窗口：缩到 270×480 做颜色掩码，取最大的连通绿块，面积不少于画布 6% 且填满外接框 80% 以上才算；
 *   找到时按 1080×1920 像素返回外接框。
 * @keyword-cn 识别绿幕窗口, 绿块定位
 * @keyword-en locate-green-window, chroma-detection
 * @param image 已缩放到 1080×1920 的模板图。
 * @returns 窗口像素，找不到为 null。
 */
export async function locateTemplateWindow(
  image: Buffer,
): Promise<TemplateWindow | null> {
  const scale = 4;
  const width = DOUYIN_TEMPLATE_CANVAS.width / scale;
  const height = DOUYIN_TEMPLATE_CANVAS.height / scale;
  const pixels = await sharp(image)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const green = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = pixels[index * 3];
    const g = pixels[index * 3 + 1];
    const b = pixels[index * 3 + 2];
    green[index] = g >= 150 && g - Math.max(r, b) >= 80 ? 1 : 0;
  }
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let best: { area: number; box: TemplateWindow } | null = null;
  for (let start = 0; start < width * height; start += 1) {
    if (!green[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = (current - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const next of [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ]) {
        if (next >= 0 && green[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (!best || tail > best.area) {
      best = {
        area: tail,
        box: {
          x: minX * scale,
          y: minY * scale,
          width: (maxX - minX + 1) * scale,
          height: (maxY - minY + 1) * scale,
        },
      };
    }
  }
  if (!best) return null;
  const boxArea = (best.box.width / scale) * (best.box.height / scale);
  if (best.area < width * height * 0.06 || best.area < boxArea * 0.8)
    return null;
  return best.box;
}

/**
 * @description 把窗口向外扩几像素并夹进画布，宽高取偶数。
 * @keyword-cn 扩展抠窗区域, 窗口外扩
 * @keyword-en pad-template-hole, expand-window
 * @param window 窗口像素。
 * @param padding 外扩像素。
 * @returns 扩展后的窗口。
 */
function padTemplateWindow(
  window: TemplateWindow,
  padding: number,
): TemplateWindow {
  const { width: canvasWidth, height: canvasHeight } = DOUYIN_TEMPLATE_CANVAS;
  const floorEven = (value: number) => Math.floor(value / 2) * 2;
  const x = Math.max(0, floorEven(window.x - padding));
  const y = Math.max(0, floorEven(window.y - padding));
  const right = Math.min(canvasWidth, window.x + window.width + padding);
  const bottom = Math.min(canvasHeight, window.y + window.height + padding);
  return {
    x,
    y,
    width: Math.max(2, floorEven(right - x)),
    height: Math.max(2, floorEven(bottom - y)),
  };
}

/**
 * @description 把生图结果做成可叠加的模板 PNG：铺满 1080×1920，找到绿块就用绿块的位置（找不到用规划的窗口），向外扩 6px 抠成透明，
 *   窗口周围 24px 内残留的绿色杂边也抠掉；窗口比例按实际窗口重新吸附。
 * @keyword-cn 生成模板透明图, 抠出视频窗口
 * @keyword-en punch-template-window, transparent-template
 * @param source 生图得到的原图。
 * @param planned 规划的窗口（找不到绿块时用）。
 * @returns 模板 PNG、实际窗口、窗口比例与是否识别到绿块。
 */
export async function punchTemplateWindow(
  source: Buffer,
  planned: TemplateWindow,
): Promise<{
  png: Buffer;
  window: TemplateWindow;
  aspectRatio: DouyinTemplateAspect;
  detected: boolean;
}> {
  const { width, height } = DOUYIN_TEMPLATE_CANVAS;
  const canvas = await sharp(source)
    .resize(width, height, { fit: 'cover' })
    .png()
    .toBuffer();
  const located = await locateTemplateWindow(canvas);
  const window = padTemplateWindow(located ?? planned, TEMPLATE_HOLE_PADDING);
  const pixels = await sharp(canvas).ensureAlpha().raw().toBuffer();
  const band = 24;
  for (
    let y = Math.max(0, window.y - band);
    y < Math.min(height, window.y + window.height + band);
    y += 1
  ) {
    for (
      let x = Math.max(0, window.x - band);
      x < Math.min(width, window.x + window.width + band);
      x += 1
    ) {
      const offset = (y * width + x) * 4;
      const inside =
        x >= window.x &&
        x < window.x + window.width &&
        y >= window.y &&
        y < window.y + window.height;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      if (inside || (g >= 120 && g - Math.max(r, b) >= 60))
        pixels[offset + 3] = 0;
    }
  }
  return {
    png: await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    window,
    aspectRatio: pickTemplateAspect(window.width, window.height),
    detected: Boolean(located),
  };
}

/**
 * @description 模板与首帧拼成封面：首帧按 cover 铺满窗口，底下垫黑底，模板叠在最上面，输出 JPEG。
 * @keyword-cn 模板首帧拼合, 模板封面
 * @keyword-en compose-template-cover, template-first-frame
 * @param template 透明窗口的模板 PNG（1080×1920）。
 * @param frame 首帧图片。
 * @param window 窗口像素。
 * @returns 封面 JPEG。
 */
export async function composeTemplateCover(
  template: Buffer,
  frame: Buffer,
  window: TemplateWindow,
): Promise<Buffer> {
  const fitted = await sharp(frame)
    .resize(window.width, window.height, { fit: 'cover' })
    .toBuffer();
  return await sharp({
    create: {
      width: DOUYIN_TEMPLATE_CANVAS.width,
      height: DOUYIN_TEMPLATE_CANVAS.height,
      channels: 3,
      background: '#000000',
    },
  })
    .composite([
      { input: fitted, left: window.x, top: window.y },
      { input: template, left: 0, top: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * @description 把首帧 / 尾帧按窗口比例居中裁切（不拉伸），给按模板比例出片的视频模型当首尾帧；比例已一致时原样返回。
 * @keyword-cn 首帧按比例裁切, 窗口比例首帧
 * @keyword-en crop-frame-to-aspect, aspect-first-frame
 * @param dataUrl 图片 data URL。
 * @param aspect 窗口比例。
 * @returns 裁切后的 JPEG data URL。
 */
export async function cropFrameToAspect(
  dataUrl: string,
  aspect: DouyinTemplateAspect,
): Promise<string> {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  if (!match) return dataUrl;
  const buffer = Buffer.from(match[1], 'base64');
  const meta = await sharp(buffer).metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!width || !height) return dataUrl;
  const ratio = DOUYIN_TEMPLATE_ASPECTS[aspect];
  if (Math.abs(width / height - ratio) / ratio < 0.01) return dataUrl;
  const cropWidth = width / height > ratio ? Math.round(height * ratio) : width;
  const cropHeight =
    width / height > ratio ? height : Math.round(width / ratio);
  const cropped = await sharp(buffer)
    .autoOrient()
    .extract({
      left: Math.floor((width - cropWidth) / 2),
      top: Math.floor((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${cropped.toString('base64')}`;
}

/**
 * @description 自建 MiniMax-H3 提示词里的画面比例说法（风格句用），缺省竖屏 9:16。
 * @keyword-cn H3画面比例说法, 提示词比例
 * @keyword-en describe-video-aspect, prompt-aspect
 * @param aspect 窗口比例。
 * @returns 英文比例短语。
 */
export function describeVideoAspect(aspect?: DouyinTemplateAspect): string {
  switch (aspect) {
    case '16:9':
      return 'horizontal 16:9';
    case '4:3':
      return 'horizontal 4:3';
    case '1:1':
      return 'square 1:1';
    case '3:4':
      return 'vertical 3:4';
    default:
      return 'vertical 9:16';
  }
}

/**
 * @description 选题当前生效的模板比例：模板启用且已有模板图时返回窗口比例，否则 undefined（按原来的 9:16 出片）。
 * @keyword-cn 生效模板比例, 模板出片比例
 * @keyword-en active-template-aspect, template-video-aspect
 * @param template 选题的版式模板。
 * @returns 比例或 undefined。
 */
export function activeTemplateAspect(
  template: DouyinVideoTemplate | undefined,
): DouyinTemplateAspect | undefined {
  return template?.enabled &&
    template.imageUrl &&
    isTemplateAspect(template.aspectRatio)
    ? template.aspectRatio
    : undefined;
}
