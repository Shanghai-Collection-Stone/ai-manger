import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { chatService } from '../chatService';
import MaterialPanel from './material-lab/MaterialPanel';
import ImageEffectDialog from './material-lab/ImageEffectDialog';
import {
  AlignCenter,
  ArrowDownToLine,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Frame,
  GripVertical,
  ImagePlus,
  Keyboard,
  Layers3,
  LockKeyhole,
  Maximize,
  MousePointer2,
  Plus,
  Ratio,
  RefreshCw,
  Redo2,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  Undo2,
  UnlockKeyhole,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

/** 模板版式的设计基准画布（3:4 小红书内页），画板尺寸变化时按它等比缩放模板图层。 */
const CANVAS = { width: 540, height: 720 };
const MIN_LAYER_SIZE = 24;
/** 图层移出画板时至少要留在画板内的像素，保证还能被看见和拖回来。 */
const MIN_VISIBLE_SIZE = 24;
const MIN_CANVAS_SIZE = 120;
const MAX_CANVAS_SIZE = 1600;
/** 画板尺寸预设，编辑单位是导出像素的一半（导出固定 scale 2），默认小红书内页 3:4。 */
const CANVAS_PRESETS = [
  {
    key: 'xhs-page',
    label: '小红书内页',
    ratio: '3:4',
    width: 540,
    height: 720,
  },
  {
    key: 'xhs-square',
    label: '小红书方图',
    ratio: '1:1',
    width: 600,
    height: 600,
  },
  {
    key: 'xhs-tall',
    label: '小红书竖版',
    ratio: '9:16',
    width: 450,
    height: 800,
  },
  { key: 'wide', label: '横版封面', ratio: '16:9', width: 800, height: 450 },
];
const DEFAULT_CANVAS_PRESET = CANVAS_PRESETS[0];
const MAX_HISTORY = 60;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** 每次点缩放按钮的倍率，滚轮按滚动距离连续换算。 */
const ZOOM_STEP = 1.2;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
/** 快捷键说明弹窗的展示数据，和 `handleEditorKeyDown` / `handleEditorPaste` 的实现一一对应，改键位要一起改。 */
const SHORTCUT_GROUPS = [
  {
    id: 'selection',
    label: '选择与删除',
    items: [
      { keys: ['Esc'], desc: '退出选中；弹窗或尺寸面板打开时先关闭它们' },
      {
        keys: ['Delete'],
        alt: ['Backspace'],
        desc: '删除选中图层（锁定的图层不会被删）',
      },
      { keys: ['↑', '↓', '←', '→'], desc: '按 1px 微调选中图层位置' },
      { keys: ['Shift', '↑↓←→'], desc: '按 10px 微调选中图层位置' },
    ],
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { keys: ['Ctrl', 'Z'], desc: '撤销' },
      { keys: ['Ctrl', 'Shift', 'Z'], alt: ['Ctrl', 'Y'], desc: '重做' },
      { keys: ['Ctrl', 'C'], desc: '复制选中图层' },
      { keys: ['Ctrl', 'X'], desc: '剪切选中图层' },
      {
        keys: ['Ctrl', 'V'],
        desc: '粘贴：外部截图/复制的图片直接落成图层，否则粘贴复制的图层（可跨画板）',
      },
      { keys: ['Ctrl', 'D'], desc: '原地复用选中图层' },
    ],
  },
  {
    id: 'canvas',
    label: '画布操作',
    items: [
      { keys: ['拖动'], desc: '移动图层，靠近中心线和相邻图层时自动吸附' },
      { keys: ['Shift', '拖控制点'], desc: '等比缩放图层' },
      { keys: ['Ctrl', '滚轮'], desc: '放大 / 缩小画板' },
      {
        keys: ['Ctrl', '+'],
        alt: ['Ctrl', '-'],
        desc: '按 20% 一档放大 / 缩小画板',
      },
      { keys: ['Ctrl', '0'], desc: '画板缩放回到自动适应窗口' },
      { keys: ['?'], desc: '打开/关闭这份快捷键说明' },
    ],
  },
];
const RADIUS_PRESETS = [
  { key: 'square', label: '直角', value: 0 },
  { key: 'rounded', label: '圆角', value: 24 },
  { key: 'pill', label: '胶囊', value: 999 },
  { key: 'ellipse', label: '椭圆', value: '50%' },
];
/**
 * @description 用多重 text-shadow 模拟文字描边，避免使用 html2canvas 无法导出的 text-stroke。
 * @keyword-cn 艺术字
 * @keyword-en art-text
 * @param {string} color - 描边颜色。
 * @param {number} [size] - 描边粗细像素。
 * @returns {string} text-shadow 值。
 */
const outlineShadow = (color, size = 2) =>
  [
    `${size}px 0 0 ${color}`,
    `-${size}px 0 0 ${color}`,
    `0 ${size}px 0 ${color}`,
    `0 -${size}px 0 ${color}`,
    `${size * 0.75}px ${size * 0.75}px 0 ${color}`,
    `-${size * 0.75}px ${size * 0.75}px 0 ${color}`,
    `${size * 0.75}px -${size * 0.75}px 0 ${color}`,
    `-${size * 0.75}px -${size * 0.75}px 0 ${color}`,
  ].join(', ');
/** 压在照片上的封面大标题描边＋硬投影，保证白字在任何底图上都读得清。 */
const POSTER_TITLE_SHADOW = `${outlineShadow('#20222b', 4)}, 7px 8px 0 rgba(32,34,43,.30)`;

/**
 * @description 构建文章封面进入灵感画布时的默认可编辑主副标题图层。
 * @keyword-cn 可编辑封面, 封面文字图层
 * @keyword-en editable-cover, cover-text-layers
 * @param {{ title?: string, subtitle?: string }} board - 文章画板元数据。
 * @returns {Array<object>} 可叠加在无字封面底图上的文字图层。
 */
const createArticleCoverTextLayers = (board = {}) => {
  const title = String(board?.title ?? '').trim();
  const subtitle = String(board?.subtitle ?? '').trim();
  if (!title && !subtitle) return [];
  return [
    ...(title
      ? [
          {
            id: 'title',
            type: 'text',
            name: '封面主标题',
            x: 30,
            y: subtitle ? 270 : 302,
            width: 480,
            height: subtitle ? 170 : 150,
            text: title,
            color: '#ffffff',
            size: 58,
            weight: 900,
            tracking: '-.04em',
            textAlign: 'center',
            shadow: POSTER_TITLE_SHADOW,
            visible: true,
            locked: false,
          },
        ]
      : []),
    ...(subtitle
      ? [
          {
            id: 'subtitle',
            type: 'text',
            name: '封面副标题',
            x: 42,
            y: 464,
            width: 456,
            height: 60,
            text: subtitle,
            color: '#ffffff',
            size: 20,
            weight: 800,
            tracking: '.04em',
            textAlign: 'center',
            shadow: outlineShadow('#20222b', 3),
            visible: true,
            locked: false,
          },
        ]
      : []),
  ];
};
const TEXT_PRESETS = [
  {
    id: 'headline',
    label: '粗体大标题',
    preview: '大标题',
    layer: {
      text: '输入你的标题',
      color: '#20222b',
      size: 46,
      weight: 900,
      tracking: '-.06em',
      width: 400,
      height: 62,
    },
  },
  {
    id: 'outline',
    label: '描边空心字',
    preview: '空心字',
    layer: {
      text: 'OUTLINE',
      color: '#ffffff',
      size: 46,
      weight: 900,
      tracking: '-.02em',
      shadow: outlineShadow('#20222b', 2),
      width: 400,
      height: 62,
    },
  },
  {
    id: 'sticker',
    label: '贴纸厚描边',
    preview: '厚描边',
    layer: {
      text: 'STICKER',
      color: '#ffd93d',
      size: 46,
      weight: 900,
      tracking: '-.02em',
      shadow: `${outlineShadow('#20222b', 3)}, 5px 6px 0 rgba(32,34,43,.35)`,
      width: 400,
      height: 64,
    },
  },
  {
    id: 'pixel',
    label: '像素冒险',
    preview: 'PIXEL',
    layer: {
      text: 'LEVEL UP!',
      color: '#ffd93d',
      size: 34,
      weight: 900,
      tracking: '.06em',
      font: '"Courier New", ui-monospace, monospace',
      shadow: `${outlineShadow('#23262f', 2)}, 4px 4px 0 #e5484d`,
      textTransform: 'uppercase',
      width: 360,
      height: 50,
    },
  },
  {
    id: 'magic',
    label: '魔法学院',
    preview: '魔法感',
    layer: {
      text: '魔法与信件',
      color: '#f2cf87',
      size: 40,
      weight: 800,
      tracking: '.03em',
      font: 'Georgia, "Songti SC", "Times New Roman", serif',
      shadow: '0 2px 12px rgba(52,26,84,.55), 0 1px 0 rgba(255,255,255,.25)',
      width: 400,
      height: 56,
    },
  },
  {
    id: 'arcade',
    label: '复古街机',
    preview: 'ARCADE',
    layer: {
      text: 'GAME START',
      color: '#fff6f0',
      size: 38,
      weight: 900,
      tracking: '.10em',
      font: '"Courier New", ui-monospace, monospace',
      shadow: '3px 0 0 #ff2e63, -3px 0 0 #08d9d6',
      textTransform: 'uppercase',
      width: 400,
      height: 52,
    },
  },
  {
    id: 'neon',
    label: '霓虹发光',
    preview: '霓虹',
    layer: {
      text: 'NEON NIGHT',
      color: '#ffffff',
      size: 38,
      weight: 800,
      tracking: '.06em',
      shadow: '0 0 6px #22d3ee, 0 0 18px #06b6d4, 0 0 34px #0891b2',
      width: 400,
      height: 54,
    },
  },
  {
    id: 'emboss',
    label: '立体投影',
    preview: '立体',
    layer: {
      text: '立体标题',
      color: '#ff5c8a',
      size: 44,
      weight: 900,
      tracking: '-.04em',
      shadow: '4px 4px 0 #20222b',
      width: 400,
      height: 60,
    },
  },
  {
    id: 'quote',
    label: '优雅斜体',
    preview: '斜体',
    layer: {
      text: 'Stay curious.',
      color: '#3a3a3a',
      size: 30,
      weight: 600,
      tracking: '0',
      italic: true,
      font: 'Georgia, "Songti SC", serif',
      width: 380,
      height: 44,
    },
  },
  {
    id: 'caption',
    label: '说明小字',
    preview: '说明文字',
    layer: {
      text: '在这里补充时间、地点和标签',
      color: '#585858',
      size: 14,
      weight: 700,
      tracking: '.10em',
      width: 360,
      height: 24,
    },
  },
];
const STICKER_GROUPS = [
  {
    id: 'game',
    label: '像素冒险',
    items: [
      '🍄',
      '⭐',
      '🪙',
      '👾',
      '🎮',
      '🕹️',
      '🧱',
      '🏁',
      '🔥',
      '💎',
      '🚩',
      '🏆',
    ],
  },
  {
    id: 'magic',
    label: '魔法学院',
    items: [
      '⚡',
      '🪄',
      '🧙',
      '🦉',
      '🏰',
      '📜',
      '🔮',
      '🧹',
      '🕯️',
      '🐍',
      '🗝️',
      '📖',
    ],
  },
  {
    id: 'deco',
    label: '通用装饰',
    items: [
      '✨',
      '❤️',
      '☀️',
      '🌙',
      '🌈',
      '☁️',
      '🎈',
      '🎀',
      '📌',
      '✔️',
      '💬',
      '🌿',
    ],
  },
];
const SHAPE_PRESETS = [
  {
    id: 'circle',
    label: '圆形色块',
    layer: { width: 120, height: 120, radius: 999, color: '#ff5c8a' },
  },
  {
    id: 'square',
    label: '方形色块',
    layer: { width: 140, height: 100, radius: 6, color: '#ffd93d' },
  },
  {
    id: 'pill',
    label: '胶囊标签',
    layer: { width: 170, height: 46, radius: 999, color: '#20222b' },
  },
  {
    id: 'ring',
    label: '空心圆环',
    layer: {
      width: 130,
      height: 130,
      radius: 999,
      color: 'transparent',
      border: '4px solid #20222b',
    },
  },
  {
    id: 'rule',
    label: '分隔细线',
    layer: { width: 240, height: 3, radius: 2, color: '#20222b' },
  },
  {
    id: 'panel',
    label: '半透底板',
    layer: {
      width: 300,
      height: 90,
      radius: 10,
      color: 'rgba(255,255,255,.6)',
      border: '1px solid rgba(255,255,255,.85)',
    },
  },
];
const RESIZE_HANDLES = [
  { key: 'nw', style: { left: '0%', top: '0%' }, cursor: 'cursor-nwse-resize' },
  { key: 'n', style: { left: '50%', top: '0%' }, cursor: 'cursor-ns-resize' },
  {
    key: 'ne',
    style: { left: '100%', top: '0%' },
    cursor: 'cursor-nesw-resize',
  },
  { key: 'e', style: { left: '100%', top: '50%' }, cursor: 'cursor-ew-resize' },
  {
    key: 'se',
    style: { left: '100%', top: '100%' },
    cursor: 'cursor-nwse-resize',
  },
  { key: 's', style: { left: '50%', top: '100%' }, cursor: 'cursor-ns-resize' },
  {
    key: 'sw',
    style: { left: '0%', top: '100%' },
    cursor: 'cursor-nesw-resize',
  },
  { key: 'w', style: { left: '0%', top: '50%' }, cursor: 'cursor-ew-resize' },
];
const TEMPLATE_GROUPS = [
  { id: 'cover', label: '小红书封面' },
  { id: 'grid', label: '拼图内页' },
];
/**
 * @description 从文章进入灵感画布时使用的无模板原图画板配置。
 * @keyword-cn 原图画板, 无模板初始化
 * @keyword-en original-image-board, template-free-initialization
 */
const ORIGINAL_IMAGE_TEMPLATE = {
  id: 'original-image',
  label: '原图',
  color: '#ffffff',
  bg: '#ffffff',
  title: '',
  subtitle: '',
};
const templates = [
  {
    id: 'cover-big-title',
    group: 'cover',
    label: '大字封面',
    color: '#ff4d6d',
    bg: 'linear-gradient(145deg, #fff1f4 0%, #ffd9e1 100%)',
    title: '上海遛娃\n这一家真的\n可以闭眼冲',
    subtitle: '亲测 3 次 · 附避坑清单',
  },
  {
    id: 'cover-split',
    group: 'cover',
    label: '上图下文',
    color: '#ff7a45',
    bg: 'linear-gradient(145deg, #fff4ec 0%, #ffe0cd 100%)',
    title: '周末去哪儿\n这份清单收好',
    subtitle: 'CITY WALK · 10 个宝藏点位',
  },
  {
    id: 'cover-duo',
    group: 'cover',
    label: '左右对比',
    color: '#4f7cf7',
    bg: 'linear-gradient(145deg, #eef3ff 0%, #d7e2fc 100%)',
    title: '改造前\nVS 改造后',
    subtitle: '3 天完工 · 成本不到 800',
  },
  {
    id: 'photo-three',
    group: 'cover',
    label: '三图满版',
    color: '#7d5cf0',
    bg: 'linear-gradient(145deg, #f4f0ff 0%, #ded4fb 100%)',
    title: '周末\n遛娃指南',
    subtitle: '一大两小 · 满版出片',
  },
  {
    id: 'photo-five',
    group: 'cover',
    label: '五图满版',
    color: '#ff4d6d',
    bg: 'linear-gradient(145deg, #ffffff 0%, #ecebf1 100%)',
    title: '省心\n生日派对',
    subtitle: '孩子玩嗨 · 爸妈轻松 · 一站式',
  },
  {
    id: 'grid-hero',
    group: 'grid',
    label: '一大三小',
    color: '#2fb37e',
    bg: 'linear-gradient(145deg, #edfaf4 0%, #cdeee0 100%)',
    title: '现场实拍',
    subtitle: '',
  },
  {
    id: 'grid-four',
    group: 'grid',
    label: '四宫格',
    color: '#f0a92b',
    bg: 'linear-gradient(145deg, #fff8ea 0%, #ffe8bf 100%)',
    title: '细节合集',
    subtitle: '',
  },
  {
    id: 'grid-nine',
    group: 'grid',
    label: '九宫格',
    color: '#4f7cf7',
    bg: 'linear-gradient(145deg, #eef3ff 0%, #d7e2fc 100%)',
    title: '全部记录',
    subtitle: '',
  },
];
const templateLayouts = {
  'original-image': {
    images: [
      // 画板是一块空白底，图片是摆在上面的普通图层：初始按画板宽度铺满、
      // 高度随原图比例（`autoFit`，装载后由 measureImageSize 量出真实比例再改框），
      // 因此可以自由拖动和缩放，而不是被钉死成整块画板。
      {
        x: 0,
        y: 0,
        width: 540,
        height: 720,
        radius: 0,
        objectFit: 'cover',
        autoFit: true,
      },
    ],
    imageIndex: 0,
    imageDecor: 'none',
    chrome: 'none',
  },
  'cover-big-title': {
    images: [{ x: 0, y: 0, width: 540, height: 720, radius: 0 }],
    title: { x: 36, y: 296, width: 468, size: 58, height: 190 },
    subtitle: { x: 36, y: 640, width: 468, size: 17, height: 26 },
    tag: '亲测推荐',
    imageIndex: 0,
    imageDecor: 'none',
    chrome: 'badge',
  },
  'cover-split': {
    images: [{ x: 0, y: 0, width: 540, height: 480, radius: 0 }],
    title: { x: 40, y: 542, width: 460, size: 44, height: 104 },
    subtitle: { x: 40, y: 662, width: 460, size: 15, height: 24 },
    imageIndex: 1,
    ink: '#20222b',
    imageDecor: 'none',
    chrome: 'split',
  },
  'cover-duo': {
    images: [
      { x: 0, y: 0, width: 267, height: 720, radius: 0 },
      { x: 273, y: 0, width: 267, height: 720, radius: 0 },
    ],
    title: { x: 30, y: 274, width: 480, size: 64, height: 148 },
    subtitle: { x: 30, y: 444, width: 480, size: 17, height: 26 },
    imageIndex: 2,
    imageDecor: 'none',
    chrome: 'poster',
  },
  'photo-three': {
    images: [
      { x: 0, y: 0, width: 540, height: 442, radius: 0 },
      { x: 0, y: 448, width: 267, height: 272, radius: 0 },
      { x: 273, y: 448, width: 267, height: 272, radius: 0 },
    ],
    title: { x: 30, y: 224, width: 480, size: 68, height: 156 },
    subtitle: { x: 30, y: 396, width: 480, size: 17, height: 26 },
    imageIndex: 2,
    imageDecor: 'none',
    chrome: 'poster',
  },
  'photo-five': {
    images: [
      { x: 0, y: 0, width: 540, height: 310, radius: 0 },
      { x: 0, y: 316, width: 267, height: 199, radius: 0 },
      { x: 273, y: 316, width: 267, height: 199, radius: 0 },
      { x: 0, y: 521, width: 267, height: 199, radius: 0 },
      { x: 273, y: 521, width: 267, height: 199, radius: 0 },
    ],
    title: { x: 30, y: 250, width: 480, size: 70, height: 160 },
    subtitle: { x: 30, y: 426, width: 480, size: 17, height: 26 },
    imageIndex: 0,
    imageDecor: 'none',
    chrome: 'poster',
  },
  'grid-hero': {
    images: [
      { x: 0, y: 0, width: 540, height: 540, radius: 0 },
      { x: 0, y: 546, width: 176, height: 174, radius: 0 },
      { x: 182, y: 546, width: 176, height: 174, radius: 0 },
      { x: 364, y: 546, width: 176, height: 174, radius: 0 },
    ],
    title: { x: 30, y: 322, width: 480, size: 60, height: 76 },
    imageIndex: 0,
    imageDecor: 'none',
    chrome: 'grid',
  },
  'grid-four': {
    images: [
      { x: 0, y: 0, width: 267, height: 357, radius: 0 },
      { x: 273, y: 0, width: 267, height: 357, radius: 0 },
      { x: 0, y: 363, width: 267, height: 357, radius: 0 },
      { x: 273, y: 363, width: 267, height: 357, radius: 0 },
    ],
    title: { x: 30, y: 322, width: 480, size: 60, height: 76 },
    imageIndex: 1,
    imageDecor: 'none',
    chrome: 'grid',
  },
  'grid-nine': {
    images: [
      { x: 0, y: 0, width: 176, height: 236, radius: 0 },
      { x: 182, y: 0, width: 176, height: 236, radius: 0 },
      { x: 364, y: 0, width: 176, height: 236, radius: 0 },
      { x: 0, y: 242, width: 176, height: 236, radius: 0 },
      { x: 182, y: 242, width: 176, height: 236, radius: 0 },
      { x: 364, y: 242, width: 176, height: 236, radius: 0 },
      { x: 0, y: 484, width: 176, height: 236, radius: 0 },
      { x: 182, y: 484, width: 176, height: 236, radius: 0 },
      { x: 364, y: 484, width: 176, height: 236, radius: 0 },
    ],
    title: { x: 30, y: 322, width: 480, size: 60, height: 76 },
    imageIndex: 3,
    imageDecor: 'none',
    chrome: 'grid',
  },
};
/**
 * @description 读取图库图片可展示的缩略图或原图地址。
 * @keyword-cn 图库选图
 * @keyword-en gallery-image-select
 * @param {object} image - 图库图片实体。
 * @returns {string} 图片地址。
 */
const readGalleryImageUrl = (image) =>
  String(image?.url || image?.thumbUrl || '').trim();

/**
 * @description 读取图库图片在画布上的展示名称。
 * @keyword-cn 图库选图
 * @keyword-en gallery-image-select
 * @param {object} image - 图库图片实体。
 * @returns {string} 图层名称。
 */
const readGalleryImageLabel = (image) =>
  String(
    image?.originalName ||
      (Array.isArray(image?.tags) ? image.tags[0] : '') ||
      '图库图片',
  ).trim();

/**
 * @description 规整图库图片列表，过滤没有可用地址的记录。
 * @keyword-cn 图库选图
 * @keyword-en gallery-image-select
 * @param {unknown} value - 后端返回的图片列表。
 * @returns {object[]} 可展示图片列表。
 */
const normalizeGalleryImages = (value) =>
  (Array.isArray(value) ? value : []).filter(
    (image) => readGalleryImageUrl(image).length > 0,
  );

/**
 * @description 规整图库标签列表，兼容字符串和带 count 的对象结构。
 * @keyword-cn 标签筛选
 * @keyword-en image-tag-filter
 * @param {unknown} value - 后端返回的标签列表。
 * @returns {string[]} 标签名列表。
 */
const normalizeGalleryTags = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) =>
      String(
        typeof item === 'string'
          ? item
          : (item?.tag ?? item?.name ?? item?.value ?? ''),
      ).trim(),
    )
    .filter(Boolean);

/**
 * @description 读取模板对应的版式配置，模板 id 缺失时回落到列表首个模板。
 * @keyword-cn 模板版式
 * @keyword-en template-layout
 * @param {object} template - 模板数据。
 * @returns {object} 版式配置。
 */
const readTemplateLayout = (template) =>
  templateLayouts[template?.id] || templateLayouts[templates[0].id];

/**
 * @description 按模板预设下标从图库中挑选默认主视觉图片地址。
 * @keyword-cn 图库选图
 * @keyword-en gallery-image-select
 * @param {object} template - 当前模板。
 * @param {object[]} images - 已加载的图库图片。
 * @returns {string} 图片地址，图库为空时返回空串。
 */
const resolveTemplateImageSrcs = (template, images) => {
  const layout = readTemplateLayout(template);
  if (!images.length) return layout.images.map(() => '');
  return layout.images.map((_, index) =>
    readGalleryImageUrl(images[(layout.imageIndex + index) % images.length]),
  );
};

/**
 * @description 读取模板的图片槽位数量。
 * @keyword-cn 多图模板
 * @keyword-en multi-image-template
 * @param {object} template - 模板数据。
 * @returns {number} 图片槽位数量。
 */
const readTemplateImageCount = (template) =>
  readTemplateLayout(template).images.length;

/**
 * @description 构建单个图片槽位的投影、图片和边框图层。
 * @keyword-cn 多图模板
 * @keyword-cn 模板图层
 * @keyword-en multi-image-template
 * @keyword-en template-layers
 * @param {object} slot - 槽位版式。
 * @param {number} index - 槽位下标。
 * @param {number} total - 槽位总数。
 * @param {string} src - 图片地址，为空时渲染占位图层。
 * @param {string} decor - 装饰模式：full 含投影与边框、frame 仅边框、none 无装饰。
 * @returns {Array<object>} 该槽位的图层集合。
 */
const createImageSlotLayers = (slot, index, total, src, decor) => {
  const id = index === 0 ? 'image-main' : `image-${index + 1}`;
  const suffix = total > 1 ? ` ${index + 1}` : '';
  const layers = [];
  if (decor === 'full')
    layers.push({
      id: `${id}-shadow`,
      type: 'shape',
      name: `图片投影${suffix}`,
      frameFor: id,
      x: slot.x + 14,
      y: slot.y + 15,
      width: slot.width,
      height: slot.height,
      color: 'rgba(50, 36, 30, .20)',
      radius: slot.radius,
      rotate: -2,
      visible: true,
      locked: false,
    });
  layers.push({
    id,
    type: 'image',
    name: `主视觉图片${suffix}`,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    src,
    radius: slot.radius,
    filter: slot.filter,
    objectFit: slot.objectFit,
    ...(slot.autoFit ? { autoFit: true } : {}),
    visible: true,
    locked: false,
  });
  const inset = decor === 'full' ? 8 : 0;
  if (decor !== 'none')
    layers.push({
      id: `${id}-frame`,
      type: 'shape',
      name: `图片边框${suffix}`,
      frameFor: id,
      x: slot.x - inset,
      y: slot.y - inset,
      width: slot.width + inset * 2,
      height: slot.height + inset * 2,
      color: 'transparent',
      border: '1px solid rgba(48, 35, 29, .32)',
      radius: slot.radius,
      visible: true,
      locked: false,
    });
  return layers;
};

/**
 * @description 构建模板图片之外的文字/装饰图层，按 chrome 版式区分：poster 满版大字、badge 标签+大字、split 上图下文、grid 拼图内页。
 * @keyword-cn 模板装饰层
 * @keyword-cn 模板图层
 * @keyword-en template-chrome
 * @keyword-en template-layers
 * @param {object} template - 当前模板。
 * @param {object} layout - 模板版式配置。
 * @returns {Array<object>} 装饰图层集合。
 */
const createChromeLayers = (template, layout) => {
  const { title, subtitle } = layout;
  if (layout.chrome === 'none') return [];
  if (layout.chrome === 'poster')
    return [
      {
        id: 'title',
        type: 'text',
        name: '主标题',
        x: title.x,
        y: title.y,
        width: title.width,
        height: title.height,
        text: template.title,
        color: '#ffffff',
        size: title.size,
        weight: 900,
        tracking: '-.05em',
        textAlign: 'center',
        shadow: POSTER_TITLE_SHADOW,
        visible: true,
        locked: false,
      },
      {
        id: 'subtitle',
        type: 'text',
        name: '副标题',
        x: subtitle.x,
        y: subtitle.y,
        width: subtitle.width,
        height: subtitle.height,
        text: template.subtitle,
        color: '#ffffff',
        size: subtitle.size,
        weight: 800,
        tracking: '.08em',
        textAlign: 'center',
        shadow: outlineShadow('#20222b', 3),
        visible: true,
        locked: false,
      },
    ];
  if (layout.chrome === 'badge')
    return [
      {
        id: 'tag-chip',
        type: 'shape',
        name: '左上标签底',
        x: 36,
        y: 44,
        width: layout.tag.length * 19 + 30,
        height: 40,
        color: template.color,
        radius: 999,
        visible: true,
        locked: false,
      },
      {
        id: 'tag-text',
        type: 'text',
        name: '左上标签文字',
        x: 36,
        y: 54,
        width: layout.tag.length * 19 + 30,
        height: 22,
        text: layout.tag,
        color: '#ffffff',
        size: 16,
        weight: 800,
        tracking: '.02em',
        textAlign: 'center',
        visible: true,
        locked: false,
      },
      {
        id: 'title',
        type: 'text',
        name: '主标题',
        x: title.x,
        y: title.y,
        width: title.width,
        height: title.height,
        text: template.title,
        color: '#ffffff',
        size: title.size,
        weight: 900,
        tracking: '-.04em',
        shadow: POSTER_TITLE_SHADOW,
        visible: true,
        locked: false,
      },
      {
        id: 'subtitle',
        type: 'text',
        name: '底部小字',
        x: subtitle.x,
        y: subtitle.y,
        width: subtitle.width,
        height: subtitle.height,
        text: template.subtitle,
        color: '#ffffff',
        size: subtitle.size,
        weight: 800,
        tracking: '.06em',
        shadow: outlineShadow('#20222b', 3),
        visible: true,
        locked: false,
      },
    ];
  if (layout.chrome === 'split')
    return [
      {
        id: 'text-panel',
        type: 'shape',
        name: '底部文字底板',
        x: 0,
        y: layout.images[0].height,
        width: CANVAS.width,
        height: CANVAS.height - layout.images[0].height,
        color: '#ffffff',
        radius: 0,
        visible: true,
        locked: false,
      },
      {
        id: 'accent-bar',
        type: 'shape',
        name: '标题装饰条',
        x: 40,
        y: layout.images[0].height + 34,
        width: 72,
        height: 8,
        color: template.color,
        radius: 999,
        visible: true,
        locked: false,
      },
      {
        id: 'title',
        type: 'text',
        name: '主标题',
        x: title.x,
        y: title.y,
        width: title.width,
        height: title.height,
        text: template.title,
        color: layout.ink,
        size: title.size,
        weight: 900,
        tracking: '-.06em',
        visible: true,
        locked: false,
      },
      {
        id: 'subtitle',
        type: 'text',
        name: '副标题',
        x: subtitle.x,
        y: subtitle.y,
        width: subtitle.width,
        height: subtitle.height,
        text: template.subtitle,
        color: '#9a9aa6',
        size: subtitle.size,
        weight: 700,
        tracking: '.08em',
        visible: true,
        locked: false,
      },
    ];
  return [
    {
      id: 'title',
      type: 'text',
      name: '主标题',
      x: title.x,
      y: title.y,
      width: title.width,
      height: title.height,
      text: template.title,
      color: '#ffffff',
      size: title.size,
      weight: 900,
      tracking: '-.04em',
      textAlign: 'center',
      shadow: POSTER_TITLE_SHADOW,
      visible: true,
      locked: false,
    },
  ];
};

/**
 * @description 构建当前模板的初始图层集合，支持 1～5 图版式。
 * @keyword-cn 模板图层
 * @keyword-cn 多图模板
 * @keyword-en template-layers
 * @keyword-en multi-image-template
 * @param {object} template - 当前模板。
 * @param {string[]} [imageSrcs] - 各图片槽位的地址，来自图库；为空时渲染占位图层。
 * @returns {Array<object>} 可编辑图层。
 */
const createTemplateLayers = (template, imageSrcs = []) => {
  const layout = readTemplateLayout(template);
  return [
    ...layout.images.flatMap((slot, index) =>
      createImageSlotLayers(
        slot,
        index,
        layout.images.length,
        imageSrcs[index] || '',
        layout.imageDecor,
      ),
    ),
    ...createChromeLayers(template, layout),
  ];
};

/**
 * @description 将值限制在指定范围内。
 * @keyword-cn 数值限制
 * @keyword-en clamp
 * @param {number} value - 原始值。
 * @param {number} min - 最小值。
 * @param {number} max - 最大值。
 * @returns {number} 安全值。
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @description 把图层坐标限制在「可以移出画板、但至少留 MIN_VISIBLE_SIZE 在画板内」的范围。
 *   钉死在画板内会让铺满宽度的图片一动不能动，所以这里刻意允许溢出。
 * @keyword-cn 图层拖拽, 溢出边界
 * @keyword-en layer-drag, overflow-bounds
 * @param {number} value - 目标坐标。
 * @param {number} size - 图层在该轴上的尺寸。
 * @param {number} bound - 画板在该轴上的尺寸。
 * @returns {number} 限制后的坐标。
 */
const clampLayerPos = (value, size, bound) =>
  clamp(value, MIN_VISIBLE_SIZE - size, bound - MIN_VISIBLE_SIZE);

/** 已量过的图片自然尺寸缓存，同一张图换画板/改尺寸时不重复解码。 */
const naturalSizeCache = new Map();

/**
 * @description 量出图片的自然宽高，用于把图层框换算成原图比例；量不到时返回 null 保持原框。
 * @keyword-cn 原图比例, 自适应铺满
 * @keyword-en natural-size, auto-fit
 * @param {string} src - 图片地址。
 * @returns {Promise<{ width: number, height: number }|null>} 自然尺寸。
 */
const measureImageSize = (src) => {
  const key = String(src ?? '').trim();
  if (!key) return Promise.resolve(null);
  if (naturalSizeCache.has(key))
    return Promise.resolve(naturalSizeCache.get(key));
  return new Promise((resolve) => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      const size =
        probe.naturalWidth > 0 && probe.naturalHeight > 0
          ? { width: probe.naturalWidth, height: probe.naturalHeight }
          : null;
      naturalSizeCache.set(key, size);
      resolve(size);
    };
    probe.onerror = () => {
      naturalSizeCache.set(key, null);
      resolve(null);
    };
    probe.src = key;
  });
};

/**
 * @description 按「占满画板宽度、高度随原图比例」算图层框，纵向居中。
 *   **一律铺满宽度，不因为算出的高度超过画板就缩回去**：长竖图宁可上下溢出画板
 *   （溢出部分被画板裁掉），也不要左右露白边；图层本来就能拖能缩，画面由用户自己定。
 * @keyword-cn 自适应铺满, 原图比例
 * @keyword-en auto-fit, natural-size
 * @param {{ width: number, height: number }} natural - 图片自然尺寸。
 * @param {{ width: number, height: number }} size - 画板尺寸。
 * @returns {{ x: number, y: number, width: number, height: number }} 纵向居中的图层框。
 */
const fitWidthBox = (natural, size) => {
  const height = size.width / (natural.width / natural.height);
  return {
    x: 0,
    y: (size.height - height) / 2,
    width: size.width,
    height: Math.max(height, MIN_LAYER_SIZE),
  };
};

/**
 * @description 读取图层圆角在滑杆上的等效像素值，椭圆按短边一半折算。
 * @keyword-cn 圆角形状
 * @keyword-en layer-radius
 * @param {object} layer - 图层数据。
 * @returns {number} 圆角像素值。
 */
const readRadiusValue = (layer) => {
  const max = Math.round(Math.min(layer.width, layer.height) / 2);
  if (layer.radius === '50%') return max;
  return clamp(Number(layer.radius) || 0, 0, Math.max(max, 0));
};

/**
 * @description 按控制点方向计算缩放后的图层外框，并限制在画布内。
 * @keyword-cn 图层缩放
 * @keyword-en layer-resize
 * @param {{ x: number, y: number, width: number, height: number }} box - 缩放前的外框。
 * @param {string} handle - 控制点方向，如 nw / n / e。
 * @param {number} dx - 画布坐标下的横向位移。
 * @param {number} dy - 画布坐标下的纵向位移。
 * @param {boolean} keepRatio - 是否保持原始宽高比。
 * @param {{ width: number, height: number }} [bounds] - 画板边界，默认基准画布。
 * @returns {{ x: number, y: number, width: number, height: number }} 缩放后的外框。
 */
const resizeBox = (box, handle, dx, dy, keepRatio, bounds = CANVAS) => {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  // 允许往画板外各多拉一个画板的量：图片要能放大到超出画板再裁，
  // 夹死在画板内的话铺满宽度的图连放大都做不到。
  const maxWidth =
    (handle.includes('w') ? right : bounds.width - box.x) + bounds.width;
  const maxHeight =
    (handle.includes('n') ? bottom : bounds.height - box.y) + bounds.height;
  let width = box.width;
  let height = box.height;
  if (handle.includes('e')) width = box.width + dx;
  if (handle.includes('w')) width = box.width - dx;
  if (handle.includes('s')) height = box.height + dy;
  if (handle.includes('n')) height = box.height - dy;
  width = clamp(width, MIN_LAYER_SIZE, maxWidth);
  height = clamp(height, MIN_LAYER_SIZE, maxHeight);
  if (keepRatio && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    if (handle === 'n' || handle === 's') width = height * ratio;
    width = clamp(width, MIN_LAYER_SIZE, maxWidth);
    height = clamp(width / ratio, MIN_LAYER_SIZE, maxHeight);
    width = clamp(height * ratio, MIN_LAYER_SIZE, maxWidth);
  }
  return {
    x: handle.includes('w') ? right - width : box.x,
    y: handle.includes('n') ? bottom - height : box.y,
    width,
    height,
  };
};

/**
 * @description 规整画板尺寸，越界值夹回可用范围并取整。
 * @keyword-cn 画板尺寸
 * @keyword-en canvas-size
 * @param {{ width: number, height: number }} size - 待规整尺寸。
 * @returns {{ width: number, height: number }} 合法画板尺寸。
 */
const normalizeCanvasSize = (size) => ({
  width: Math.round(
    clamp(
      Number(size?.width) || DEFAULT_CANVAS_PRESET.width,
      MIN_CANVAS_SIZE,
      MAX_CANVAS_SIZE,
    ),
  ),
  height: Math.round(
    clamp(
      Number(size?.height) || DEFAULT_CANVAS_PRESET.height,
      MIN_CANVAS_SIZE,
      MAX_CANVAS_SIZE,
    ),
  ),
});

/**
 * @description 把图层按新旧画板尺寸等比换算，字号与圆角取长短边缩放的较小值以免变形。
 * @keyword-cn 画板尺寸
 * @keyword-cn 图层缩放
 * @keyword-en canvas-size
 * @keyword-en layer-resize
 * @param {object[]} layers - 原始图层。
 * @param {{ width: number, height: number }} from - 原画板尺寸。
 * @param {{ width: number, height: number }} to - 目标画板尺寸。
 * @returns {object[]} 换算后的图层。
 */
const rescaleLayers = (layers, from, to) => {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (sx === 1 && sy === 1) return layers;
  const su = Math.min(sx, sy);
  return layers.map((layer) => ({
    ...layer,
    x: layer.x * sx,
    y: layer.y * sy,
    width: Math.max(layer.width * sx, MIN_LAYER_SIZE),
    height: Math.max(layer.height * sy, MIN_LAYER_SIZE),
    size:
      typeof layer.size === 'number'
        ? Math.max(Math.round(layer.size * su), 8)
        : layer.size,
    radius:
      typeof layer.radius === 'number'
        ? Math.round(layer.radius * su)
        : layer.radius,
    baseWidth:
      typeof layer.baseWidth === 'number'
        ? layer.baseWidth * sx
        : layer.baseWidth,
    baseHeight:
      typeof layer.baseHeight === 'number'
        ? layer.baseHeight * sy
        : layer.baseHeight,
  }));
};

/**
 * @description 新建一个画板，模板图层按画板尺寸从基准画布换算过来。
 * @keyword-cn 多画板
 * @keyword-en artboard
 * @param {object} template - 模板数据。
 * @param {{ width: number, height: number }} size - 画板尺寸。
 * @param {string[]} [imageSrcs] - 图片槽位默认图地址。
 * @returns {object} 画板数据。
 */
const createBoard = (template, size, imageSrcs) => {
  const canvasSize = normalizeCanvasSize(size);
  return {
    id: `board-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    template,
    size: canvasSize,
    layers: rescaleLayers(
      createTemplateLayers(template, imageSrcs),
      CANVAS,
      canvasSize,
    ),
  };
};

/**
 * @description 把拼图的画布格式按格子还原成一组独立图片图层，拼图里的每张源图都能单独选中替换。
 * @keyword-cn 拼图画布格式, 可换图拼图
 * @keyword-en collage-canvas-format, swappable-collage
 * @param {{ width?: number, height?: number, cells?: object[] }} collage - 拼图画布格式元数据。
 * @param {{ width: number, height: number }} size - 目标画板尺寸。
 * @returns {Array<object>} 逐格图片图层；不是拼图时返回空数组。
 */
const createCollageImageLayers = (collage, size) => {
  const cells = (Array.isArray(collage?.cells) ? collage.cells : [])
    .slice(0, 4)
    .filter((cell) => String(cell?.src ?? '').trim());
  if (cells.length < 2) return [];
  const sx = size.width / (Number(collage?.width) || size.width);
  const sy = size.height / (Number(collage?.height) || size.height);
  return cells.map((cell, index) => ({
    id: index === 0 ? 'image-main' : `image-${index + 1}`,
    type: 'image',
    name: `拼图 ${index + 1}`,
    x: Number(cell.x) * sx,
    y: Number(cell.y) * sy,
    width: Math.max(Number(cell.width) * sx, MIN_LAYER_SIZE),
    height: Math.max(Number(cell.height) * sy, MIN_LAYER_SIZE),
    src: String(cell.src).trim(),
    imageId: cell.imageId,
    radius: 0,
    objectFit: cell.objectFit === 'contain' ? 'contain' : 'cover',
    visible: true,
    locked: false,
  }));
};

/**
 * @description 把文章画板元数据里的海报素材还原为独立图片图层，保留原绿幕素材、文字融合标记与特效参数供重新编辑。
 * @keyword-cn 可编辑装饰素材, 图层分离
 * @keyword-en editable-decoration-material, separated-layers
 * @param {Array<object>} materials - 画板素材层元数据。
 * @param {{ width: number, height: number }} size - 目标画板尺寸。
 * @returns {Array<object>} 可直接加入画板的素材图片图层。
 */
const createArticleMaterialLayers = (materials, size) =>
  (Array.isArray(materials) ? materials : [])
    .slice(0, 8)
    .filter((material) => String(material?.src ?? '').trim())
    .map((material, index) => {
      const sourceWidth = Number(material.canvasWidth) || CANVAS.width;
      const sourceHeight = Number(material.canvasHeight) || CANVAS.height;
      return {
        id: String(material.id || `article-material-${index + 1}`),
        type: 'image',
        name: String(material.name || `装饰素材 ${index + 1}`),
        x: Number(material.x) * (size.width / sourceWidth),
        y: Number(material.y) * (size.height / sourceHeight),
        width: Math.max(
          Number(material.width) * (size.width / sourceWidth),
          MIN_LAYER_SIZE,
        ),
        height: Math.max(
          Number(material.height) * (size.height / sourceHeight),
          MIN_LAYER_SIZE,
        ),
        src: String(material.src).trim(),
        materialSrc: String(material.materialSrc || material.src).trim(),
        includesText: material.includesText === true,
        effect: material.effect,
        radius: 0,
        objectFit: 'contain',
        visible: true,
        locked: false,
      };
    });

/**
 * @description 将文章图片和结构化画板元数据转换为灵感画布画板；封面优先还原原照片和独立素材，含字素材不重复创建文字层，旧数据仍兼容，拼图按格子拆成可换图层。
 * @keyword-cn 文章画板, 可编辑封面, 拼图画布格式
 * @keyword-en article-canvas-board, editable-cover, collage-canvas-format
 * @param {string} src - 文章图片地址。
 * @param {object} board - 对应图片的结构化画板元数据。
 * @returns {object} 可直接放入编辑器状态的画板。
 */
const createArticleBoard = (src, board = {}) => {
  const imageBoard = createBoard(
    ORIGINAL_IMAGE_TEMPLATE,
    DEFAULT_CANVAS_PRESET,
    [String(board?.baseSrc || src)],
  );
  const collageLayers = createCollageImageLayers(
    board?.collage,
    imageBoard.size,
  );
  const baseBoard =
    collageLayers.length > 0
      ? { ...imageBoard, layers: collageLayers }
      : imageBoard;
  if (board?.kind !== 'cover') return baseBoard;
  const materialLayers = createArticleMaterialLayers(
    board?.materials,
    imageBoard.size,
  );
  const materialIncludesText = materialLayers.some(
    (material) => material.includesText === true,
  );
  return {
    ...baseBoard,
    layers: [
      ...baseBoard.layers,
      ...materialLayers,
      ...(materialIncludesText ? [] : createArticleCoverTextLayers(board)),
    ],
  };
};

/**
 * @description 判断剪贴板事件是否发生在输入框里，用于放行文字粘贴。
 * @keyword-cn 复制粘贴
 * @keyword-en clipboard-paste
 * @param {EventTarget|null} target - 事件目标。
 * @returns {boolean} 是否处于可编辑元素中。
 */
const isEditableTarget = (target) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  Boolean(target?.isContentEditable);

/**
 * @description 把剪贴板里的图片文件读成 dataURL 并量出原始宽高，供粘贴落图使用。
 * @keyword-cn 复制粘贴
 * @keyword-en clipboard-paste
 * @param {File} file - 剪贴板图片文件。
 * @returns {Promise<{ src: string, width: number, height: number }>} 图片数据。
 */
const readClipboardImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'));
    reader.onload = () => {
      const src = String(reader.result || '');
      const probe = new Image();
      probe.onload = () =>
        resolve({
          src,
          width: probe.naturalWidth || 240,
          height: probe.naturalHeight || 240,
        });
      probe.onerror = () => resolve({ src, width: 240, height: 240 });
      probe.src = src;
    };
    reader.readAsDataURL(file);
  });

/**
 * @description 渲染快捷键说明里的一个键帽。
 * @keyword-cn 快捷键
 * @keyword-en editor-shortcut
 * @param {string} key - 键名文案。
 * @param {string} [scope] - 同一行里区分主键位与备用键位的前缀，避免 React key 重复。
 * @returns {JSX.Element} 键帽元素。
 */
const renderShortcutKey = (key, scope = '') => (
  <kbd
    key={`${scope}${key}`}
    className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]"
  >
    {key}
  </kbd>
);

/**
 * @description 设计编辑器主视图，提供模板、素材、拖拽画布和图层管理。
 * @keyword-cn 设计编辑器
 * @keyword-cn 图层管理
 * @keyword-en design-editor
 * @keyword-en layer-management
 * @param {{ onBack: Function, initialImageUrls?: string[], initialBoards?: object[] }} props - 返回工具入口的回调、文章图组图片与结构化画板元数据。
 * @returns {JSX.Element} 编辑器页面。
 */
const DesignEditorView = ({
  onBack,
  initialImageUrls = [],
  initialBoards = [],
}) => {
  const articleBoards = Array.isArray(initialBoards) ? initialBoards : [];
  const firstArticleBoard = articleBoards.find(
    (board) => Number(board?.imageIndex) === 0,
  );
  const integratedCoverMaterial = firstArticleBoard?.materials?.find(
    (material) => material?.includesText === true,
  );
  const hasEditableCover =
    firstArticleBoard?.kind === 'cover' &&
    !integratedCoverMaterial &&
    Boolean(firstArticleBoard?.title || firstArticleBoard?.subtitle);
  const [boards, setBoards] = useState(() => {
    const imageGroups = initialImageUrls.filter(Boolean);
    return imageGroups.length > 0
      ? imageGroups.map((src, index) =>
          createArticleBoard(
            src,
            articleBoards.find((board) => Number(board?.imageIndex) === index),
          ),
        )
      : [createBoard(templates[0], DEFAULT_CANVAS_PRESET)];
  });
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [selectedId, setSelectedId] = useState(() =>
    integratedCoverMaterial
      ? String(integratedCoverMaterial.id || 'ai-decoration-1')
      : hasEditableCover
        ? firstArticleBoard?.title
          ? 'title'
          : 'subtitle'
        : initialImageUrls.some(Boolean)
          ? 'image-main'
          : 'title',
  );
  const [activePanel, setActivePanel] = useState(() =>
    integratedCoverMaterial
      ? 'stickers'
      : hasEditableCover
        ? 'text'
        : initialImageUrls.some(Boolean)
          ? 'images'
          : 'templates',
  );
  const [guides, setGuides] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sizePanelOpen, setSizePanelOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState({
    width: DEFAULT_CANVAS_PRESET.width,
    height: DEFAULT_CANVAS_PRESET.height,
  });
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(null);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [dragLayerId, setDragLayerId] = useState(null);
  const [dropLayerId, setDropLayerId] = useState(null);
  const [galleryImages, setGalleryImages] = useState([]);
  const [galleryTags, setGalleryTags] = useState([]);
  const [galleryTag, setGalleryTag] = useState('');
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [effectLayer, setEffectLayer] = useState(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const clipboardRef = useRef(null);
  const historyRef = useRef({
    past: [],
    future: [],
    last: null,
    lock: 0,
    at: 0,
  });
  const keyHandlerRef = useRef(null);
  const pasteHandlerRef = useRef(null);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) || boards[0],
    [boards, activeBoardId],
  );
  const activeBoardIndex = useMemo(
    () =>
      Math.max(
        0,
        boards.findIndex((board) => board.id === activeBoard.id),
      ),
    [boards, activeBoard],
  );
  const activeTemplate = activeBoard.template;
  const canvasSize = activeBoard.size;
  const layers = activeBoard.layers;
  /** @description 更新指定画板。 @keyword-cn 多画板 @keyword-en artboard @param {string} boardId - 画板标识。 @param {Function} updater - 更新方法。 */
  const patchBoard = useCallback(
    (boardId, updater) =>
      setBoards((current) =>
        current.map((board) => (board.id === boardId ? updater(board) : board)),
      ),
    [],
  );
  /** @description 写入当前画板的图层，签名与原 setLayers 一致（支持函数式更新）。 @keyword-cn 图层更新 @keyword-en layer-update @param {object[]|Function} updater - 新图层或更新方法。 */
  const setLayers = useCallback(
    (updater) =>
      patchBoard(activeBoard.id, (board) => ({
        ...board,
        layers: typeof updater === 'function' ? updater(board.layers) : updater,
      })),
    [patchBoard, activeBoard.id],
  );
  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedId) || null,
    [layers, selectedId],
  );
  const imageLayers = useMemo(
    () => layers.filter((layer) => layer.type === 'image'),
    [layers],
  );
  const activeImageLayer = useMemo(
    () =>
      selectedLayer?.type === 'image' ? selectedLayer : imageLayers[0] || null,
    [selectedLayer, imageLayers],
  );

  /** @description 更新指定图层。 @keyword-cn 图层更新 @keyword-en layer-update @param {string} layerId - 图层标识。 @param {Function} updater - 更新方法。 */
  const updateLayer = (layerId, updater) =>
    setLayers((current) =>
      current.map((layer) => (layer.id === layerId ? updater(layer) : layer)),
    );
  /** @description 把撤销/重做栈深度同步给按钮的禁用态。 @keyword-cn 撤销重做 @keyword-en undo-redo */
  const syncHistoryState = useCallback(() => {
    const h = historyRef.current;
    setHistoryState((current) =>
      current.undo === h.past.length && current.redo === h.future.length
        ? current
        : { undo: h.past.length, redo: h.future.length },
    );
  }, []);
  /**
   * @description 开启一次手势事务：先压入手势前快照，事务期间的连续变更（拖拽、缩放）不再入栈，保证一次拖拽只对应一次撤销。
   * @keyword-cn 撤销重做
   * @keyword-en undo-redo
   */
  const beginHistory = useCallback(() => {
    const h = historyRef.current;
    if (!h.lock && h.last) {
      h.past = [...h.past, h.last].slice(-MAX_HISTORY);
      h.future = [];
      h.at = Date.now();
    }
    h.lock += 1;
    syncHistoryState();
  }, [syncHistoryState]);
  /** @description 结束手势事务，手势没有真正改动画板时撤回刚压入的快照。 @keyword-cn 撤销重做 @keyword-en undo-redo */
  const endHistory = useCallback(() => {
    const h = historyRef.current;
    if (!h.lock) return;
    h.lock -= 1;
    if (h.lock) return;
    if (h.past.length && h.past[h.past.length - 1] === h.last)
      h.past = h.past.slice(0, -1);
    syncHistoryState();
  }, [syncHistoryState]);
  /**
   * @description 监听画板变更并入栈：手势事务期间跳过，350ms 内的连续变更（输入文字、拖滑杆）合并成一条记录。
   * @keyword-cn 撤销重做
   * @keyword-en undo-redo
   */
  useEffect(() => {
    const h = historyRef.current;
    if (h.last === null) {
      h.last = boards;
      return;
    }
    if (h.last === boards) return;
    const previous = h.last;
    h.last = boards;
    if (h.skip) {
      h.skip = false;
      return;
    }
    if (h.lock) return;
    const now = Date.now();
    if (now - h.at < 350) {
      h.at = now;
      return;
    }
    h.past = [...h.past, previous].slice(-MAX_HISTORY);
    h.future = [];
    h.at = now;
    syncHistoryState();
  }, [boards, syncHistoryState]);
  /** @description 撤销上一步编辑。 @keyword-cn 撤销重做 @keyword-en undo-redo */
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.lock || !h.past.length) return;
    const previous = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [h.last, ...h.future].slice(0, MAX_HISTORY);
    h.last = previous;
    h.at = 0;
    setBoards(previous);
    syncHistoryState();
  }, [syncHistoryState]);
  /** @description 重做被撤销的编辑。 @keyword-cn 撤销重做 @keyword-en undo-redo */
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.lock || !h.future.length) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past, h.last].slice(-MAX_HISTORY);
    h.last = next;
    h.at = 0;
    setBoards(next);
    syncHistoryState();
  }, [syncHistoryState]);
  /** @description 拉取图库图片供画布选图。 @keyword-cn 图库选图 @keyword-en gallery-image-select @param {string} [tag] - 标签筛选值。 @returns {Promise<void>} 加载流程。 */
  const loadGalleryImages = useCallback(async (tag) => {
    setGalleryLoading(true);
    try {
      const res = await chatService.listGalleryImages({
        imageType: 'regular',
        tag: String(tag || '').trim() || undefined,
        limit: 120,
      });
      setGalleryImages(normalizeGalleryImages(res?.images));
    } finally {
      setGalleryLoading(false);
    }
  }, []);
  /** @description 拉取图库标签用于选图筛选。 @keyword-cn 标签筛选 @keyword-en image-tag-filter @returns {Promise<void>} 加载流程。 */
  const loadGalleryTags = useCallback(async () => {
    const res = await chatService.listGalleryTags({ limit: 2000 });
    setGalleryTags(normalizeGalleryTags(res?.tags));
  }, []);
  /** @description 进入编辑器时加载图库标签。 @keyword-cn 标签筛选 @keyword-en image-tag-filter */
  useEffect(() => {
    void loadGalleryTags();
  }, [loadGalleryTags]);
  /** @description 按当前标签加载图库图片。 @keyword-cn 图库选图 @keyword-en gallery-image-select */
  useEffect(() => {
    void loadGalleryImages(galleryTag);
  }, [galleryTag, loadGalleryImages]);
  /** @description 图库就绪后按槽位顺序为占位的图片图层补上默认图。 @keyword-cn 图库选图 @keyword-cn 多图模板 @keyword-en gallery-image-select @keyword-en multi-image-template */
  useEffect(() => {
    if (!galleryImages.length) return;
    const srcs = resolveTemplateImageSrcs(activeTemplate, galleryImages);
    historyRef.current.skip = true;
    setLayers((current) => {
      if (!current.some((layer) => layer.type === 'image' && !layer.src))
        return current;
      let slot = -1;
      return current.map((layer) => {
        if (layer.type !== 'image') return layer;
        slot += 1;
        return layer.src
          ? layer
          : {
              ...layer,
              src:
                srcs[slot] ||
                readGalleryImageUrl(galleryImages[slot % galleryImages.length]),
            };
      });
    });
  }, [activeTemplate, galleryImages]);
  /** @description 把标了 autoFit 的图片图层按原图真实比例换成铺满画板宽度的框并居中，量完清掉标记，不占撤销步数。 @keyword-cn 自适应铺满 @keyword-en auto-fit */
  useEffect(() => {
    const pending = [];
    boards.forEach((board) => {
      board.layers.forEach((layer) => {
        if (layer.type === 'image' && layer.autoFit && layer.src)
          pending.push({ boardId: board.id, layer, size: board.size });
      });
    });
    if (!pending.length) return undefined;
    let alive = true;
    void (async () => {
      const measured = await Promise.all(
        pending.map(async (item) => ({
          ...item,
          natural: await measureImageSize(item.layer.src),
        })),
      );
      if (!alive) return;
      historyRef.current.skip = true;
      setBoards((current) =>
        current.map((board) => {
          const hits = measured.filter((item) => item.boardId === board.id);
          if (!hits.length) return board;
          return {
            ...board,
            layers: board.layers.map((layer) => {
              const hit = hits.find((item) => item.layer.id === layer.id);
              if (!hit || !layer.autoFit) return layer;
              const { autoFit, ...rest } = layer;
              return hit.natural
                ? { ...rest, ...fitWidthBox(hit.natural, board.size) }
                : rest;
            }),
          };
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [boards]);
  /** @description 应用模板并重置当前画板的图层，模板按画板尺寸等比换算。 @keyword-cn 选择模板 @keyword-en select-template @param {object} template - 模板数据。 */
  const handleSelectTemplate = (template) => {
    patchBoard(activeBoard.id, (board) => ({
      ...board,
      template,
      layers: rescaleLayers(
        createTemplateLayers(
          template,
          resolveTemplateImageSrcs(template, galleryImages),
        ),
        CANVAS,
        board.size,
      ),
    }));
    setSelectedId('title');
  };
  /** @description 切换当前画板并清空选中态。 @keyword-cn 多画板 @keyword-en artboard @param {string} boardId - 画板标识。 */
  const selectBoard = (boardId) => {
    if (boardId === activeBoard.id) return;
    setActiveBoardId(boardId);
    setSelectedId(null);
    setGuides([]);
  };
  /** @description 在当前画板后面追加一个同尺寸空白画板。 @keyword-cn 多画板 @keyword-en artboard */
  const addBoard = () => {
    const board = createBoard(
      activeTemplate,
      canvasSize,
      resolveTemplateImageSrcs(activeTemplate, galleryImages),
    );
    setBoards((current) => {
      const next = [...current];
      next.splice(activeBoardIndex + 1, 0, board);
      return next;
    });
    setActiveBoardId(board.id);
    setSelectedId(null);
  };
  /** @description 复制当前画板（含全部图层）。 @keyword-cn 多画板 @keyword-en artboard @param {string} boardId - 画板标识。 */
  const duplicateBoard = (boardId) => {
    const source = boards.find((board) => board.id === boardId);
    if (!source) return;
    const copy = {
      ...source,
      id: `board-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      layers: source.layers.map((layer) => ({ ...layer })),
    };
    setBoards((current) => {
      const next = [...current];
      next.splice(
        current.findIndex((board) => board.id === boardId) + 1,
        0,
        copy,
      );
      return next;
    });
    setActiveBoardId(copy.id);
    setSelectedId(null);
  };
  /** @description 删除指定画板，只剩一个时不允许删除。 @keyword-cn 多画板 @keyword-en artboard @param {string} boardId - 画板标识。 */
  const deleteBoard = (boardId) => {
    if (boards.length === 1) return;
    const index = boards.findIndex((board) => board.id === boardId);
    if (index < 0) return;
    const next = boards.filter((board) => board.id !== boardId);
    setBoards(next);
    if (boardId === activeBoard.id) {
      setActiveBoardId(next[Math.min(index, next.length - 1)].id);
      setSelectedId(null);
    }
  };
  /** @description 设置当前画板的宽高，已有图层按新旧尺寸等比换算。 @keyword-cn 画板尺寸 @keyword-en canvas-size @param {{ width: number, height: number }} size - 目标尺寸。 */
  const applyCanvasSize = (size) => {
    const nextSize = normalizeCanvasSize(size);
    setSizeDraft(nextSize);
    setZoom(null);
    patchBoard(activeBoard.id, (board) =>
      board.size.width === nextSize.width &&
      board.size.height === nextSize.height
        ? board
        : {
            ...board,
            size: nextSize,
            layers: rescaleLayers(board.layers, board.size, nextSize),
          },
    );
  };
  /** @description 打开画板尺寸面板并把当前尺寸灌进输入框。 @keyword-cn 画板尺寸 @keyword-en canvas-size */
  const openSizePanel = () => {
    setSizeDraft({ width: canvasSize.width, height: canvasSize.height });
    setSizePanelOpen((open) => !open);
  };
  /** @description 把选中的图库图片填入当前图片槽位，填完自动跳到下一个空槽位；没有图片图层时新建一个。 @keyword-cn 图库选图 @keyword-cn 图片槽位 @keyword-en gallery-image-select @keyword-en image-slot @param {object} image - 图库图片实体。 */
  const handleSelectImage = (image) => {
    const src = readGalleryImageUrl(image);
    if (!src) return;
    const name = readGalleryImageLabel(image);
    const target = activeImageLayer;
    if (!target) {
      const id = `image-${Date.now()}`;
      setLayers((current) => [
        ...current,
        {
          id,
          type: 'image',
          name,
          imageId: image?.id,
          x: 80,
          y: 300,
          width: 400,
          height: 240,
          src,
          visible: true,
          locked: false,
        },
      ]);
      setSelectedId(id);
      return;
    }
    updateLayer(target.id, (layer) => ({
      ...layer,
      src,
      name,
      imageId: image?.id,
    }));
    const nextEmpty = imageLayers.find(
      (layer) => layer.id !== target.id && !layer.src,
    );
    setSelectedId(nextEmpty ? nextEmpty.id : target.id);
  };
  /** @description 开始拖拽图层。 @keyword-cn 拖拽图层 @keyword-en layer-drag @param {React.PointerEvent} event - 指针事件。 @param {object} layer - 图层数据。 */
  const handlePointerDown = (event, layer) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginHistory();
    dragRef.current = {
      id: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      x: layer.x,
      y: layer.y,
    };
    setSelectedId(layer.id);
  };
  /** @description 选择图层并阻止事件冒泡至画布空白区。 @keyword-cn 图层选择 @keyword-en layer-selection @param {React.MouseEvent} event - 点击事件。 @param {string} layerId - 图层标识。 */
  const handleLayerClick = (event, layerId) => {
    event.stopPropagation();
    setSelectedId(layerId);
  };
  /**
   * @description 编辑器快捷键：Esc 退出选中、Delete/Backspace 删除图层、Ctrl+Z / Ctrl+Shift+Z 撤销重做、Ctrl+C/X/D 复制剪切复用，方向键像素级微调（Shift 十像素）。粘贴走 paste 事件，这里不处理 Ctrl+V。
   * @keyword-cn 快捷键
   * @keyword-cn 键盘微调
   * @keyword-en editor-shortcut
   * @keyword-en keyboard-nudge
   * @param {KeyboardEvent} event - 键盘事件。
   */
  const handleEditorKeyDown = (event) => {
    const editable = isEditableTarget(event.target);
    const combo = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      if (editable) {
        event.target.blur?.();
        return;
      }
      event.preventDefault();
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (effectLayer) {
        setEffectLayer(null);
        return;
      }
      if (sizePanelOpen) {
        setSizePanelOpen(false);
        return;
      }
      if (zoomMenuOpen) {
        setZoomMenuOpen(false);
        return;
      }
      if (dragRef.current || resizeRef.current) endHistory();
      dragRef.current = null;
      resizeRef.current = null;
      setGuides([]);
      setSelectedId(null);
      return;
    }
    if (combo && ['=', '+', '-', '_', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') resetZoom();
      else
        zoomBy(
          event.key === '-' || event.key === '_' ? 1 / ZOOM_STEP : ZOOM_STEP,
        );
      return;
    }
    if (combo && ['z', 'y'].includes(event.key.toLowerCase())) {
      if (editable) return;
      event.preventDefault();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redo();
      else undo();
      return;
    }
    if (editable) return;
    if (
      !combo &&
      (event.key === '?' || (event.key === '/' && event.shiftKey))
    ) {
      event.preventDefault();
      setShortcutsOpen((open) => !open);
      return;
    }
    if (combo && event.key.toLowerCase() === 'c') {
      if (copySelectedLayer()) event.preventDefault();
      return;
    }
    if (combo && event.key.toLowerCase() === 'x') {
      if (copySelectedLayer()) {
        event.preventDefault();
        deleteLayer();
      }
      return;
    }
    if (combo && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateLayer();
      return;
    }
    if (['Delete', 'Backspace'].includes(event.key)) {
      if (!selectedLayer || selectedLayer.locked) return;
      event.preventDefault();
      deleteLayer();
      return;
    }
    if (
      !selectedLayer ||
      selectedLayer.locked ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, -distance],
      ArrowDown: [0, distance],
    }[event.key];
    updateLayer(selectedLayer.id, (layer) => ({
      ...layer,
      x: clampLayerPos(layer.x + delta[0], layer.width, canvasSize.width),
      y: clampLayerPos(layer.y + delta[1], layer.height, canvasSize.height),
    }));
  };
  /**
   * @description 处理粘贴：剪贴板里有图片文件就落成新图层（外部截图、微信/系统复制的图都走这里），有图片直链文本同理，否则粘贴编辑器内部复制的图层。
   * @keyword-cn 复制粘贴
   * @keyword-en clipboard-paste
   * @param {ClipboardEvent} event - 粘贴事件。
   * @returns {Promise<void>} 粘贴流程。
   */
  const handleEditorPaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    );
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      const image = await readClipboardImage(file);
      pasteImageLayer(image, '粘贴图片');
      return;
    }
    if (isEditableTarget(event.target)) return;
    const text = String(
      event.clipboardData?.getData('text/plain') || '',
    ).trim();
    if (
      /^data:image\//i.test(text) ||
      /^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)(\?\S*)?$/i.test(text)
    ) {
      event.preventDefault();
      pasteImageLayer({ src: text, width: 240, height: 240 }, '粘贴图片');
      return;
    }
    if (clipboardRef.current) {
      event.preventDefault();
      pasteCopiedLayer();
    }
  };
  /** @description 注册编辑器快捷键与粘贴监听，转发到最新的处理函数以免闭包读到旧状态。 @keyword-cn 快捷键 @keyword-cn 复制粘贴 @keyword-en editor-shortcut @keyword-en clipboard-paste */
  keyHandlerRef.current = handleEditorKeyDown;
  pasteHandlerRef.current = handleEditorPaste;
  useEffect(() => {
    const onKeyDown = (event) => keyHandlerRef.current?.(event);
    const onPaste = (event) => {
      void pasteHandlerRef.current?.(event);
    };
    // 指针在画布外抬起时补一次收尾，避免手势事务没关掉把撤销栈锁死
    const onPointerRelease = () => {
      if (dragRef.current || resizeRef.current) {
        dragRef.current = null;
        resizeRef.current = null;
        setGuides([]);
      }
      endHistory();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    window.addEventListener('pointerup', onPointerRelease);
    window.addEventListener('pointercancel', onPointerRelease);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('pointerup', onPointerRelease);
      window.removeEventListener('pointercancel', onPointerRelease);
    };
  }, [endHistory]);
  /** @description 按下控制点开始缩放图层。 @keyword-cn 图层缩放 @keyword-en layer-resize @param {React.PointerEvent} event - 指针事件。 @param {object} layer - 图层数据。 @param {string} handle - 控制点方向。 */
  const handleResizePointerDown = (event, layer, handle) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginHistory();
    resizeRef.current = {
      id: layer.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      box: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
    };
    setSelectedId(layer.id);
  };
  /** @description 跟随指针缩放图层，按住 Shift 保持宽高比。 @keyword-cn 图层缩放 @keyword-en layer-resize @param {React.PointerEvent} event - 移动事件。 */
  const handleResizeMove = (event) => {
    const resize = resizeRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!resize || !rect) return;
    const factor = canvasSize.width / rect.width;
    const next = resizeBox(
      resize.box,
      resize.handle,
      (event.clientX - resize.startX) * factor,
      (event.clientY - resize.startY) * factor,
      event.shiftKey,
      canvasSize,
    );
    updateLayer(resize.id, (layer) => ({ ...layer, ...next }));
  };
  /** @description 移动图层并吸附到画布中心及相邻图层边线、中心线和基线。 @keyword-cn 基线对齐 @keyword-cn 相邻对齐 @keyword-en baseline-snap @keyword-en neighbour-snap @param {React.PointerEvent} event - 移动事件。 */
  const handlePointerMove = (event) => {
    if (resizeRef.current) {
      handleResizeMove(event);
      return;
    }
    const drag = dragRef.current;
    const layer = layers.find((item) => item.id === drag?.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !layer || !rect) return;
    const factor = canvasSize.width / rect.width;
    let x = clampLayerPos(
      drag.x + (event.clientX - drag.startX) * factor,
      layer.width,
      canvasSize.width,
    );
    let y = clampLayerPos(
      drag.y + (event.clientY - drag.startY) * factor,
      layer.height,
      canvasSize.height,
    );
    const tolerance = 11;
    const xCandidates = [
      {
        value: canvasSize.width / 2 - layer.width / 2,
        guide: canvasSize.width / 2,
        source: '画布中心',
      },
    ];
    const yCandidates = [
      {
        value: canvasSize.height / 2 - layer.height,
        guide: canvasSize.height / 2,
        source: '画布基线',
      },
    ];
    layers
      .filter((item) => item.id !== layer.id && item.visible)
      .forEach((item) => {
        xCandidates.push(
          { value: item.x, guide: item.x, source: item.name },
          {
            value: item.x + item.width - layer.width,
            guide: item.x + item.width,
            source: item.name,
          },
          {
            value: item.x + item.width / 2 - layer.width / 2,
            guide: item.x + item.width / 2,
            source: item.name,
          },
        );
        yCandidates.push(
          { value: item.y, guide: item.y, source: item.name },
          {
            value: item.y + item.height - layer.height,
            guide: item.y + item.height,
            source: item.name,
          },
          {
            value: item.y + item.height / 2 - layer.height / 2,
            guide: item.y + item.height / 2,
            source: item.name,
          },
        );
      });
    const xSnap = xCandidates.reduce((best, candidate) =>
      Math.abs(candidate.value - x) < Math.abs(best.value - x)
        ? candidate
        : best,
    );
    const ySnap = yCandidates.reduce((best, candidate) =>
      Math.abs(candidate.value - y) < Math.abs(best.value - y)
        ? candidate
        : best,
    );
    const nextGuides = [];
    if (Math.abs(xSnap.value - x) < tolerance) {
      x = xSnap.value;
      nextGuides.push({
        axis: 'vertical',
        position: xSnap.guide,
        source: xSnap.source,
      });
    }
    if (Math.abs(ySnap.value - y) < tolerance) {
      y = ySnap.value;
      nextGuides.push({
        axis: 'horizontal',
        position: ySnap.guide,
        source: ySnap.source,
      });
    }
    setGuides(nextGuides);
    updateLayer(drag.id, (current) => ({ ...current, x, y }));
  };
  /** @description 结束当前拖拽或缩放并收束这一步的撤销记录。 @keyword-cn 拖拽结束 @keyword-en drag-end */
  const handlePointerUp = () => {
    if (dragRef.current || resizeRef.current) endHistory();
    dragRef.current = null;
    resizeRef.current = null;
    setGuides([]);
  };
  /** @description 调整指定图层的叠放顺序。 @keyword-cn 图层排序 @keyword-en layer-order @param {string} layerId - 图层标识。 @param {number} direction - 1 为上移，-1 为下移。 */
  const moveLayerById = (layerId, direction) =>
    setLayers((current) => {
      const from = current.findIndex((layer) => layer.id === layerId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  /** @description 调整选中图层顺序。 @keyword-cn 图层排序 @keyword-en layer-order @param {number} direction - 1 为上移，-1 为下移。 */
  const moveLayer = (direction) => {
    if (selectedId) moveLayerById(selectedId, direction);
  };
  /** @description 将拖拽图层插入到目标图层所在位置。 @keyword-cn 图层拖拽排序 @keyword-en layer-reorder @param {string} sourceId - 被拖拽图层标识。 @param {string} targetId - 目标图层标识。 */
  const reorderLayer = (sourceId, targetId) =>
    setLayers((current) => {
      const from = current.findIndex((layer) => layer.id === sourceId);
      const to = current.findIndex((layer) => layer.id === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  /** @description 开始拖拽图层列表项。 @keyword-cn 图层拖拽排序 @keyword-en layer-reorder @param {React.DragEvent} event - 拖拽事件。 @param {string} layerId - 图层标识。 */
  const handleLayerDragStart = (event, layerId) => {
    setDragLayerId(layerId);
    setSelectedId(layerId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', layerId);
  };
  /** @description 拖拽经过目标图层时记录落点。 @keyword-cn 图层拖拽排序 @keyword-en layer-reorder @param {React.DragEvent} event - 拖拽事件。 @param {string} layerId - 目标图层标识。 */
  const handleLayerDragOver = (event, layerId) => {
    if (!dragLayerId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropLayerId !== layerId) setDropLayerId(layerId);
  };
  /** @description 在目标图层上释放并完成排序。 @keyword-cn 图层拖拽排序 @keyword-en layer-reorder @param {React.DragEvent} event - 拖拽事件。 @param {string} layerId - 目标图层标识。 */
  const handleLayerDrop = (event, layerId) => {
    event.preventDefault();
    const sourceId = dragLayerId || event.dataTransfer.getData('text/plain');
    if (sourceId) reorderLayer(sourceId, layerId);
    setDragLayerId(null);
    setDropLayerId(null);
  };
  /** @description 结束图层拖拽并清理落点提示。 @keyword-cn 图层拖拽排序 @keyword-en layer-reorder */
  const handleLayerDragEnd = () => {
    setDragLayerId(null);
    setDropLayerId(null);
  };
  /** @description 计算列表项的拖拽落点样式。 @keyword-cn 落点提示 @keyword-en drop-indicator @param {string} layerId - 图层标识。 @returns {string} 样式类名。 */
  const dropIndicatorClass = (layerId) => {
    if (dragLayerId === layerId) return 'opacity-40';
    if (!dragLayerId || dropLayerId !== layerId) return '';
    const from = layers.findIndex((layer) => layer.id === dragLayerId);
    const to = layers.findIndex((layer) => layer.id === layerId);
    return to > from
      ? 'shadow-[inset_0_2px_0_0_#6f55ed]'
      : 'shadow-[inset_0_-2px_0_0_#6f55ed]';
  };
  /** @description 计算新元素在画布中的默认摆放位置，连续添加时逐个错开。 @keyword-cn 新增元素 @keyword-en add-element @param {number} width - 元素宽度。 @param {number} height - 元素高度。 @returns {{ x: number, y: number }} 摆放坐标。 */
  const nextLayerSpot = (width, height) => {
    const offset = (layers.length % 6) * 16;
    return {
      x: clamp(
        Math.round(canvasSize.width / 2 - width / 2 + offset),
        0,
        Math.max(canvasSize.width - width, 0),
      ),
      y: clamp(
        Math.round(canvasSize.height / 2 - height / 2 + offset),
        0,
        Math.max(canvasSize.height - height, 0),
      ),
    };
  };
  /** @description 按艺术字预设新增文字图层。 @keyword-cn 艺术字 @keyword-en art-text @param {object} preset - 艺术字预设。 */
  const addTextPreset = (preset) => {
    const id = `text-${Date.now()}`;
    const { width, height, ...style } = preset.layer;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'text',
        name: preset.label,
        width,
        height,
        ...nextLayerSpot(width, height),
        ...style,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 把艺术字预设的排版样式套用到选中文字图层，保留原有文案与位置。 @keyword-cn 艺术字 @keyword-en art-text @param {object} preset - 艺术字预设。 */
  const applyTextPreset = (preset) => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const { width, height, text, ...style } = preset.layer;
    updateLayer(selectedLayer.id, (layer) => ({ ...layer, ...style }));
  };
  /** @description 新增 emoji 贴纸图层。 @keyword-cn 贴纸素材 @keyword-en sticker @param {string} emoji - 贴纸字符。 */
  const addSticker = (emoji) => {
    const id = `sticker-${Date.now()}`;
    const size = 76;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'text',
        name: `贴纸 ${emoji}`,
        text: emoji,
        color: '#000',
        size: 62,
        weight: 400,
        tracking: 'normal',
        textAlign: 'center',
        width: size,
        height: size,
        ...nextLayerSpot(size, size),
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 按形状预设新增色块图层。 @keyword-cn 贴纸素材 @keyword-en sticker @param {object} preset - 形状预设。 */
  const addShapePreset = (preset) => {
    const id = `shape-${Date.now()}`;
    const { width, height, ...style } = preset.layer;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'shape',
        name: preset.label,
        width,
        height,
        ...nextLayerSpot(width, height),
        ...style,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 把图库图片作为独立贴纸新增到画布，不替换已有槽位。 @keyword-cn 贴纸素材 @keyword-cn 图库选图 @keyword-en sticker @keyword-en gallery-image-select @param {object} image - 图库图片实体。 */
  const addImageLayer = (image) => {
    const src = readGalleryImageUrl(image);
    if (!src) return;
    const id = `image-${Date.now()}`;
    const width = 240;
    const height = 180;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'image',
        name: readGalleryImageLabel(image),
        imageId: image?.id,
        width,
        height,
        ...nextLayerSpot(width, height),
        src,
        radius: 8,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 把素材面板处理好的图片（含 GPU 去底/描边/投影结果）落到画布。图层会记住原图地址 `materialSrc` 和特效参数 `effect`，之后可以重开特效面板继续改而不是再堆一张新图。 @keyword-cn 素材落图 @keyword-en add material layer @param {{ src: string, name?: string, width?: number, height?: number, materialSrc?: string, effect?: object }} material - 处理后的素材。 */
  const addMaterialLayer = (material) => {
    const src = String(material?.src || '');
    if (!src) return;
    const ratio =
      Number(material?.width) > 0 && Number(material?.height) > 0
        ? material.width / material.height
        : 1;
    const width = ratio >= 1 ? 240 : Math.round(240 * ratio);
    const height = ratio >= 1 ? Math.round(240 / ratio) : 240;
    const id = `material-${Date.now()}`;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'image',
        name: material?.name || '素材',
        width,
        height,
        ...nextLayerSpot(width, height),
        src,
        materialSrc: material?.materialSrc,
        effect: material?.effect,
        radius: 0,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 特效面板确认时的落点：带 layerId 就原地替换该图层的图和参数（保留位置与尺寸），否则新增一个素材图层。 @keyword-cn 素材落图 @keyword-cn 特效编辑 @keyword-en apply material effect @param {{ dataUrl?: string, src?: string, layerId?: string|null, effect?: object }} result - 特效面板结果。 */
  const applyMaterialEffect = (result) => {
    const src = String(result?.src || result?.dataUrl || '');
    if (!src) return;
    if (!result?.layerId) {
      addMaterialLayer({ ...result, src });
      return;
    }
    updateLayer(result.layerId, (layer) => ({
      ...layer,
      src,
      effect: result.effect,
    }));
    setEffectLayer(null);
  };
  /** @description 设置图层圆角形状，并同步依附于它的边框与投影图层。 @keyword-cn 圆角形状 @keyword-en layer-radius @param {string} layerId - 图层标识。 @param {number|string} radius - 圆角像素值或 '50%' 椭圆。 */
  const applyLayerRadius = (layerId, radius) =>
    setLayers((current) =>
      current.map((layer) =>
        layer.id === layerId || layer.frameFor === layerId
          ? { ...layer, radius }
          : layer,
      ),
    );
  /** @description 为选中图片生成同形状的描边框图层，圆角随图片联动。 @keyword-cn 图片描边框 @keyword-en image-frame @param {number} [inset] - 边框相对图片的外扩像素。 */
  const addImageFrame = (inset = 8) => {
    if (!selectedLayer || selectedLayer.type !== 'image') return;
    const id = `frame-${Date.now()}`;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'shape',
        name: `${selectedLayer.name} 边框`,
        frameFor: selectedLayer.id,
        x: clamp(selectedLayer.x - inset, 0, canvasSize.width - MIN_LAYER_SIZE),
        y: clamp(
          selectedLayer.y - inset,
          0,
          canvasSize.height - MIN_LAYER_SIZE,
        ),
        width: selectedLayer.width + inset * 2,
        height: selectedLayer.height + inset * 2,
        color: 'transparent',
        border: '1px solid rgba(48, 35, 29, .32)',
        radius: selectedLayer.radius ?? 0,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 复制当前图层。 @keyword-cn 复制图层 @keyword-en duplicate-layer */
  const duplicateLayer = () => {
    if (!selectedLayer) return;
    const copy = {
      ...selectedLayer,
      id: `${selectedLayer.id}-${Date.now()}`,
      name: `${selectedLayer.name} 副本`,
      x: clamp(selectedLayer.x + 18, 0, canvasSize.width - selectedLayer.width),
      y: clamp(
        selectedLayer.y + 18,
        0,
        canvasSize.height - selectedLayer.height,
      ),
    };
    setLayers((current) => [...current, copy]);
    setSelectedId(copy.id);
  };
  /** @description 把选中图层存进编辑器内部剪贴板，供 Ctrl+V 粘贴（可跨画板）。 @keyword-cn 复制粘贴 @keyword-en clipboard-paste @returns {boolean} 是否复制成功。 */
  const copySelectedLayer = () => {
    if (!selectedLayer) return false;
    clipboardRef.current = { ...selectedLayer };
    return true;
  };
  /** @description 粘贴内部剪贴板里的图层，落在原位置偏移 18px 处并选中。 @keyword-cn 复制粘贴 @keyword-en clipboard-paste */
  const pasteCopiedLayer = () => {
    const source = clipboardRef.current;
    if (!source) return;
    const width = Math.min(source.width, canvasSize.width);
    const height = Math.min(source.height, canvasSize.height);
    const copy = {
      ...source,
      id: `${String(source.id).split('-')[0]}-${Date.now()}`,
      width,
      height,
      x: clamp(source.x + 18, 0, canvasSize.width - width),
      y: clamp(source.y + 18, 0, canvasSize.height - height),
      locked: false,
      visible: true,
    };
    setLayers((current) => [...current, copy]);
    setSelectedId(copy.id);
  };
  /** @description 把外部粘贴进来的图片落成图层，超出画板时按最长边收进画板的 70%。 @keyword-cn 复制粘贴 @keyword-en clipboard-paste @param {{ src: string, width: number, height: number }} image - 图片数据。 @param {string} [name] - 图层名称。 */
  const pasteImageLayer = (image, name = '粘贴图片') => {
    const src = String(image?.src || '');
    if (!src) return;
    const scale = Math.min(
      1,
      (canvasSize.width * 0.7) / (image.width || 1),
      (canvasSize.height * 0.7) / (image.height || 1),
    );
    const width = Math.max(
      Math.round((image.width || 240) * scale),
      MIN_LAYER_SIZE,
    );
    const height = Math.max(
      Math.round((image.height || 240) * scale),
      MIN_LAYER_SIZE,
    );
    const id = `image-${Date.now()}`;
    setLayers((current) => [
      ...current,
      {
        id,
        type: 'image',
        name,
        width,
        height,
        ...nextLayerSpot(width, height),
        src,
        radius: 0,
        visible: true,
        locked: false,
      },
    ]);
    setSelectedId(id);
  };
  /** @description 删除指定图层并在需要时切换选中项。 @keyword-cn 删除图层 @keyword-en delete-layer @param {string} layerId - 图层标识。 */
  const deleteLayerById = (layerId) => {
    if (layers.length === 1) return;
    const next = layers.filter((layer) => layer.id !== layerId);
    setLayers(next);
    if (selectedId === layerId)
      setSelectedId(next[next.length - 1]?.id || null);
  };
  /** @description 删除当前图层。 @keyword-cn 删除图层 @keyword-en delete-layer */
  const deleteLayer = () => {
    if (selectedLayer) deleteLayerById(selectedLayer.id);
  };
  /** @description 等待浏览器把状态变更真正画到屏幕上，导出前用来确保选中框、参考线已经撤掉且画布已恢复 100% 缩放。 @keyword-cn 导出图片 @keyword-en export-image @returns {Promise<void>} 两帧之后的 Promise。 */
  const nextPaint = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  /** @description 触发一次 PNG 下载。 @keyword-cn 导出图片 @keyword-en export-image @param {HTMLCanvasElement} snapshot - html2canvas 快照。 @param {string} fileName - 文件名。 */
  const downloadSnapshot = (snapshot, fileName) => {
    const link = document.createElement('a');
    link.download = fileName;
    link.href = snapshot.toDataURL('image/png');
    link.click();
  };
  /**
   * @description 导出画板为 PNG：导出前清掉选中态、参考线并把画布恢复到 100% 显示，避免紫色选中框、控制点和缩放比例被截进图里；多画板时逐个切换画板等重绘完再截图。html2canvas 点击导出时才动态加载，不进首屏包。
   * @keyword-cn 导出图片
   * @keyword-cn 按需加载
   * @keyword-en export-image
   * @keyword-en lazy-import
   * @param {boolean} [all] - 是否导出全部画板。
   * @returns {Promise<void>} 导出流程。
   */
  const handleExport = async (all = false) => {
    if (!canvasRef.current || isExporting) return;
    const targets = all ? boards : [activeBoard];
    const restoreBoardId = activeBoard.id;
    const restoreSelectedId = selectedId;
    setIsExporting(true);
    setCapturing(true);
    setSelectedId(null);
    setGuides([]);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const stamp = Date.now();
      for (let index = 0; index < targets.length; index += 1) {
        setActiveBoardId(targets[index].id);
        await nextPaint();
        if (!canvasRef.current) break;
        const snapshot = await html2canvas(canvasRef.current, {
          useCORS: true,
          scale: 2,
          backgroundColor: null,
        });
        downloadSnapshot(
          snapshot,
          targets.length > 1
            ? `canvas-design-${stamp}-${index + 1}.png`
            : `canvas-design-${stamp}.png`,
        );
      }
    } finally {
      setActiveBoardId(restoreBoardId);
      setSelectedId(restoreSelectedId);
      setCapturing(false);
      setIsExporting(false);
    }
  };
  /** @description 画板尺寸或窗口变化时重算显示缩放，让整块画板始终看得全；导出时强制回到 100%。 @keyword-cn 画板缩放 @keyword-en canvas-zoom */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => {
      const width = stage.clientWidth - 56;
      const height = stage.clientHeight - 56;
      if (width <= 0 || height <= 0) return;
      setFitScale(
        Math.min(1, width / canvasSize.width, height / canvasSize.height),
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasSize.width, canvasSize.height]);
  // zoom 为 null 表示跟随窗口自动适应，手动缩放后才固定成具体倍率；导出时一律按 100% 截图
  const viewScale = capturing ? 1 : (zoom ?? fitScale);
  /** @description 设定画板显示倍率并夹回 10%~400%。 @keyword-cn 画板缩放 @keyword-en canvas-zoom @param {number} value - 目标倍率。 */
  const applyZoom = useCallback(
    (value) => setZoom(clamp(value, MIN_ZOOM, MAX_ZOOM)),
    [],
  );
  /** @description 在当前倍率上按倍数放大或缩小画板。 @keyword-cn 画板缩放 @keyword-en canvas-zoom @param {number} factor - 缩放倍数，大于 1 为放大。 */
  const zoomBy = useCallback(
    (factor) =>
      setZoom((current) =>
        clamp((current ?? fitScale) * factor, MIN_ZOOM, MAX_ZOOM),
      ),
    [fitScale],
  );
  /** @description 画板缩放回到自动适应窗口。 @keyword-cn 画板缩放 @keyword-en canvas-zoom */
  const resetZoom = useCallback(() => {
    setZoom(null);
    setZoomMenuOpen(false);
  }, []);
  /**
   * @description 在舞台上监听 Ctrl/⌘ + 滚轮缩放画板。必须用原生非被动监听器：React 的 onWheel 挂在根节点上是 passive 的，里面 preventDefault 拦不住浏览器整页缩放。
   * @keyword-cn 画板缩放
   * @keyword-en canvas-zoom
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY / 320));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomBy]);
  /** @description 渲染可拖动图层。 @keyword-cn 画布图层 @keyword-en canvas-layer @param {object} layer - 图层数据。 @returns {JSX.Element|null} 图层元素。 */
  const renderLayer = (layer) => {
    if (!layer.visible) return null;
    const base = {
      left: layer.x,
      top: layer.y,
      width: layer.width,
      height: layer.height,
    };
    const selected =
      selectedId === layer.id
        ? 'ring-2 ring-[#7c5cff] ring-offset-2 ring-offset-transparent'
        : '';
    if (layer.type === 'image' && !layer.src)
      return (
        <div
          key={layer.id}
          onClick={(event) => handleLayerClick(event, layer.id)}
          onPointerDown={(event) => handlePointerDown(event, layer)}
          className={`absolute cursor-move select-none flex flex-col items-center justify-center gap-1 border border-dashed border-slate-400/70 bg-white/45 text-[11px] text-slate-500 ${selected}`}
          style={{ ...base, borderRadius: layer.radius || 0 }}
        >
          <ImagePlus size={18} />
          <span>点击左侧图库选择图片</span>
        </div>
      );
    // 去底后的素材带透明通道，CSS 阴影会沿外框画出一圈矩形，只有模板槽位里的实心图才加
    if (layer.type === 'image')
      return (
        <img
          key={layer.id}
          draggable={false}
          onClick={(event) => handleLayerClick(event, layer.id)}
          onPointerDown={(event) => handlePointerDown(event, layer)}
          className={`absolute cursor-move select-none ${layer.materialSrc || layer.objectFit === 'contain' ? 'object-contain' : 'object-cover shadow-lg'} ${selected}`}
          style={{
            ...base,
            borderRadius: layer.radius || 0,
            filter: layer.filter,
            transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
          }}
          src={layer.src}
          alt={layer.name}
          crossOrigin="anonymous"
        />
      );
    if (layer.type === 'shape')
      return (
        <div
          key={layer.id}
          onClick={(event) => handleLayerClick(event, layer.id)}
          onPointerDown={(event) => handlePointerDown(event, layer)}
          className={`absolute cursor-move ${selected}`}
          style={{
            ...base,
            backgroundColor: layer.color,
            borderRadius: layer.radius || 0,
            border: layer.border,
            opacity: layer.opacity,
            transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
          }}
        />
      );
    return (
      <div
        key={layer.id}
        onClick={(event) => handleLayerClick(event, layer.id)}
        onPointerDown={(event) => handlePointerDown(event, layer)}
        className={`absolute whitespace-pre-line cursor-move select-none leading-[.98] ${selected}`}
        style={{
          ...base,
          color: layer.color,
          fontSize: layer.size,
          fontWeight: layer.weight || 900,
          fontFamily: layer.font,
          fontStyle: layer.italic ? 'italic' : undefined,
          letterSpacing: layer.tracking || '-.07em',
          textAlign: layer.textAlign,
          textTransform: layer.textTransform,
          textShadow: layer.shadow,
        }}
      >
        <span>{layer.text}</span>
      </div>
    );
  };
  /** @description 渲染选中图层的八个缩放控制点。 @keyword-cn 缩放控制点 @keyword-en resize-handle @param {object|null} layer - 选中图层。 @returns {JSX.Element|null} 控制点外框。 */
  const renderResizeHandles = (layer) => {
    if (!layer || !layer.visible || layer.locked) return null;
    return (
      <div
        className="absolute pointer-events-none border border-[#7c5cff]/50"
        style={{
          left: layer.x,
          top: layer.y,
          width: layer.width,
          height: layer.height,
          transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
        }}
      >
        {RESIZE_HANDLES.map((handle) => (
          <span
            key={handle.key}
            title="拖动缩放，按住 Shift 等比"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) =>
              handleResizePointerDown(event, layer, handle.key)
            }
            className={`pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-[#7c5cff] bg-white shadow-sm ${handle.cursor}`}
            style={handle.style}
          />
        ))}
      </div>
    );
  };
  /** @description 渲染画板缩略图里的静态图层，不带任何交互与选中态。 @keyword-cn 多画板 @keyword-en artboard @param {object} layer - 图层数据。 @returns {JSX.Element|null} 缩略图层。 */
  const renderThumbLayer = (layer) => {
    if (!layer.visible) return null;
    const base = {
      position: 'absolute',
      left: layer.x,
      top: layer.y,
      width: layer.width,
      height: layer.height,
      borderRadius: layer.radius || 0,
    };
    if (layer.type === 'image')
      return layer.src ? (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          draggable={false}
          className={
            layer.materialSrc || layer.objectFit === 'contain'
              ? 'object-contain'
              : 'object-cover'
          }
          style={base}
        />
      ) : (
        <span
          key={layer.id}
          style={{ ...base, background: 'rgba(148,163,184,.35)' }}
        />
      );
    if (layer.type === 'shape')
      return (
        <span
          key={layer.id}
          style={{
            ...base,
            backgroundColor: layer.color,
            border: layer.border,
            opacity: layer.opacity,
          }}
        />
      );
    return (
      <span
        key={layer.id}
        className="whitespace-pre-line leading-[.98] block"
        style={{
          ...base,
          color: layer.color,
          fontSize: layer.size,
          fontWeight: layer.weight || 900,
          fontFamily: layer.font,
          letterSpacing: layer.tracking || '-.07em',
          textAlign: layer.textAlign,
          textShadow: layer.shadow,
        }}
      >
        {layer.text}
      </span>
    );
  };
  /** @description 渲染底部画板栏里的单个画板缩略图。 @keyword-cn 多画板 @keyword-en artboard @param {object} board - 画板数据。 @param {number} index - 画板序号。 @returns {JSX.Element} 缩略卡片。 */
  const renderBoardCard = (board, index) => {
    const scale = Math.min(64 / board.size.width, 64 / board.size.height);
    const active = board.id === activeBoard.id;
    return (
      <div key={board.id} className="group relative shrink-0">
        <button
          onClick={() => selectBoard(board.id)}
          title={`画板 ${index + 1} · ${board.size.width}×${board.size.height}`}
          className={`relative block overflow-hidden rounded-lg border-2 bg-white transition ${active ? 'border-[#6f55ed]' : 'border-slate-200 hover:border-slate-300'}`}
          style={{
            width: Math.max(board.size.width * scale, 26),
            height: Math.max(board.size.height * scale, 26),
          }}
        >
          <span
            className="absolute inset-0 overflow-hidden"
            style={{ background: board.template.bg }}
          >
            <span
              className="absolute top-0 left-0 origin-top-left block"
              style={{
                width: board.size.width,
                height: board.size.height,
                transform: `scale(${scale})`,
              }}
            >
              {board.layers.map(renderThumbLayer)}
            </span>
          </span>
          <span
            className={`absolute bottom-0.5 left-0.5 rounded px-1 text-[9px] leading-[13px] ${active ? 'bg-[#6f55ed] text-white' : 'bg-slate-900/55 text-white'}`}
          >
            {index + 1}
          </span>
        </button>
        {boards.length > 1 && (
          <button
            onClick={() => deleteBoard(board.id)}
            title="删除画板"
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white text-slate-400 shadow border border-slate-200 opacity-0 group-hover:opacity-100 hover:text-rose-500 flex items-center justify-center transition"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          onClick={() => duplicateBoard(board.id)}
          title="复制画板"
          className="absolute -bottom-1.5 -right-1.5 h-5 w-5 rounded-full bg-white text-slate-400 shadow border border-slate-200 opacity-0 group-hover:opacity-100 hover:text-[#6f55ed] flex items-center justify-center transition"
        >
          <Copy size={11} />
        </button>
      </div>
    );
  };
  /** @description 渲染模板卡片里的图片槽位缩略示意。 @keyword-cn 多图模板 @keyword-en multi-image-template @param {object} template - 模板数据。 @returns {JSX.Element} 槽位示意层。 */
  const renderTemplateThumb = (template) => (
    <span className="absolute inset-0 pointer-events-none">
      {readTemplateLayout(template).images.map((slot, index) => (
        <span
          key={index}
          className="absolute rounded-[2px] bg-white/75 border border-white/90 shadow-sm"
          style={{
            left: `${(slot.x / CANVAS.width) * 100}%`,
            top: `${(slot.y / CANVAS.height) * 100}%`,
            width: `${(slot.width / CANVAS.width) * 100}%`,
            height: `${(slot.height / CANVAS.height) * 100}%`,
          }}
        />
      ))}
    </span>
  );
  /** @description 渲染单张模板卡片。 @keyword-cn 模板版式 @keyword-en template-layout @param {object} template - 模板数据。 @returns {JSX.Element} 模板卡片。 */
  const renderTemplateCard = (template) => (
    <button
      key={template.id}
      onClick={() => handleSelectTemplate(template)}
      className={`text-left rounded-xl overflow-hidden border-2 transition ${activeTemplate.id === template.id ? 'border-[#775cf0]' : 'border-transparent hover:border-slate-200'}`}
    >
      <div
        className="relative h-28 p-3 flex flex-col justify-between overflow-hidden"
        style={{ background: template.bg }}
      >
        <span className="relative z-10 text-[13px] font-black leading-none whitespace-pre-line tracking-tight">
          {template.title}
        </span>
        {renderTemplateThumb(template)}
        <span
          className="relative z-10 h-1.5 w-10"
          style={{ backgroundColor: template.color }}
        />
      </div>
      <span className="flex items-center justify-between px-2.5 py-2 text-xs font-medium">
        <span className="truncate">{template.label}</span>
        <span className="shrink-0 ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
          {readTemplateImageCount(template)} 图
        </span>
      </span>
    </button>
  );
  /** @description 渲染左侧工具按钮。 @keyword-cn 编辑工具 @keyword-en editor-tool @param {string} key - 面板标识。 @param {string} label - 按钮文案。 @param {React.ComponentType} Icon - 图标组件。 @returns {JSX.Element} 工具按钮。 */
  const toolButton = (key, label, Icon) => (
    <button
      onClick={() => setActivePanel(key)}
      className={`flex flex-col items-center gap-1.5 w-full py-3 rounded-xl text-[11px] transition ${activePanel === key ? 'bg-[#eeeaff] text-[#6f55ed]' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      <Icon size={19} strokeWidth={1.8} />
      {label}
    </button>
  );

  return (
    <div className="h-full min-h-0 bg-[#f7f7fb] flex flex-col text-slate-800 overflow-hidden">
      <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500"
          aria-label="返回工具页"
        >
          <ChevronLeft size={21} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#744ff2] to-[#ab70ff] flex items-center justify-center text-white">
            <Sparkles size={17} />
          </div>
          <span className="font-semibold tracking-tight">灵感画布</span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            未命名设计
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShortcutsOpen(true)}
            title="快捷键说明（?）"
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-slate-500 text-sm hover:bg-slate-100"
          >
            <Keyboard size={17} />
            <span className="hidden lg:inline">快捷键</span>
          </button>
          <span className="h-5 w-px bg-slate-200" />
          <button
            onClick={undo}
            disabled={!historyState.undo}
            title="撤销（Ctrl+Z）"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <Undo2 size={17} />
          </button>
          <button
            onClick={redo}
            disabled={!historyState.redo}
            title="重做（Ctrl+Shift+Z）"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <Redo2 size={17} />
          </button>
          <span className="h-5 w-px bg-slate-200" />
          {boards.length > 1 && (
            <button
              onClick={() => handleExport(true)}
              disabled={isExporting}
              className="hidden sm:flex px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 items-center gap-1.5 disabled:opacity-60"
            >
              <ArrowDownToLine size={15} />
              全部 {boards.length} 张
            </button>
          )}
          <button
            onClick={() => handleExport(false)}
            className="px-3.5 py-2 rounded-lg bg-[#6f55ed] hover:bg-[#5e45dd] text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
            disabled={isExporting}
          >
            <ArrowDownToLine size={16} />
            {isExporting ? '导出中' : '导出 PNG'}
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex">
        <aside className="w-[72px] shrink-0 bg-white border-r border-slate-200 p-2 flex flex-col gap-1">
          {toolButton('templates', '模板', Sparkles)}
          {toolButton('images', '图片', ImagePlus)}
          {toolButton('text', '文字', Type)}
          {toolButton('stickers', '素材', Sticker)}
          <div className="mt-auto border-t border-slate-100 pt-2">
            {toolButton('layers', '图层', Layers3)}
          </div>
        </aside>
        <aside className="w-[262px] shrink-0 bg-white border-r border-slate-200 overflow-y-auto hidden md:block">
          <div className="p-5 border-b border-slate-100">
            <h2 className="font-semibold text-sm">
              {activePanel === 'templates'
                ? '选择模板'
                : activePanel === 'images'
                  ? '选择图片'
                  : activePanel === 'text'
                    ? '艺术字'
                    : activePanel === 'stickers'
                      ? '贴纸素材'
                      : '图层设置'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {activePanel === 'templates'
                ? '从一个好看的起点开始'
                : activePanel === 'images'
                  ? '先选图片槽位，再点图库图片替换'
                  : activePanel === 'text'
                    ? '点样式即可添加，文案随后再改'
                    : activePanel === 'stickers'
                      ? '贴纸、色块随时往画布上加'
                      : '拖动条目可调整上下叠放顺序'}
            </p>
          </div>
          {activePanel === 'templates' && (
            <div className="p-4 space-y-4">
              {TEMPLATE_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className="text-[11px] font-medium text-slate-500 mb-2">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {templates
                      .filter((template) => template.group === group.id)
                      .map(renderTemplateCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {activePanel === 'images' && (
            <div className="p-4">
              <div className="flex items-center gap-2">
                <select
                  value={galleryTag}
                  onChange={(event) => setGalleryTag(event.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
                >
                  <option value="">全部标签</option>
                  {galleryTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <button
                  title="刷新图库"
                  onClick={() => loadGalleryImages(galleryTag)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <RefreshCw
                    size={14}
                    className={galleryLoading ? 'animate-spin' : undefined}
                  />
                </button>
              </div>
              {imageLayers.length > 0 && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {imageLayers.map((layer, index) => (
                      <button
                        key={layer.id}
                        title={layer.name}
                        onClick={() => setSelectedId(layer.id)}
                        className={`px-2 py-1 rounded-lg border text-[11px] transition ${activeImageLayer?.id === layer.id ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                      >
                        图 {index + 1}
                        {layer.src ? '' : ' · 空'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400 truncate">
                    正在替换：{activeImageLayer?.name || '未选择'}
                  </p>
                </div>
              )}
              {galleryLoading && galleryImages.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  图库加载中…
                </div>
              ) : galleryImages.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  图库暂无可用图片
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {galleryImages.map((image) => (
                    <div key={image.id} className="group relative">
                      <button
                        onClick={() => handleSelectImage(image)}
                        title="替换当前图片槽位"
                        className="w-full text-left"
                      >
                        <img
                          className="h-28 w-full rounded-xl object-cover shadow-sm bg-slate-100 group-hover:ring-2 group-hover:ring-[#775cf0] transition"
                          src={image.thumbUrl || image.url}
                          alt={readGalleryImageLabel(image)}
                          crossOrigin="anonymous"
                          loading="lazy"
                        />
                        <span className="block mt-1.5 text-xs text-slate-500 truncate">
                          {readGalleryImageLabel(image)}
                        </span>
                      </button>
                      <button
                        onClick={() => addImageLayer(image)}
                        title="作为独立贴纸新增图层"
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-white/90 text-slate-600 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-[#6f55ed] transition"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activePanel === 'text' && (
            <div className="p-4 space-y-2">
              {TEXT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => addTextPreset(preset)}
                  title={`添加「${preset.label}」`}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-[#775cf0] hover:bg-[#faf9ff] overflow-hidden"
                >
                  <span
                    className="block truncate"
                    style={{
                      color: preset.layer.color,
                      fontSize: 22,
                      fontWeight: preset.layer.weight,
                      fontFamily: preset.layer.font,
                      fontStyle: preset.layer.italic ? 'italic' : undefined,
                      letterSpacing: preset.layer.tracking,
                      textShadow: preset.layer.shadow,
                      textTransform: preset.layer.textTransform,
                    }}
                  >
                    {preset.preview}
                  </span>
                  <span className="block mt-1 text-[11px] text-slate-400">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          {activePanel === 'stickers' && (
            <MaterialPanel
              stickerGroups={STICKER_GROUPS}
              shapePresets={SHAPE_PRESETS}
              onAddSticker={addSticker}
              onAddShape={addShapePreset}
              onAddProcessedImage={applyMaterialEffect}
            />
          )}
          {activePanel === 'layers' && (
            <div className="p-4 space-y-1">
              {[...layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => handleLayerDragStart(event, layer.id)}
                  onDragOver={(event) => handleLayerDragOver(event, layer.id)}
                  onDrop={(event) => handleLayerDrop(event, layer.id)}
                  onDragEnd={handleLayerDragEnd}
                  onClick={() => setSelectedId(layer.id)}
                  className={`w-full flex items-center gap-0.5 p-1.5 rounded-lg text-left cursor-grab active:cursor-grabbing ${selectedId === layer.id ? 'bg-[#eeeaff] text-[#6045de]' : 'hover:bg-slate-50'} ${dropIndicatorClass(layer.id)}`}
                >
                  <GripVertical size={13} className="shrink-0 text-slate-300" />
                  <span className="h-7 w-7 shrink-0 rounded bg-slate-100 text-slate-500 flex items-center justify-center">
                    {layer.type === 'image' ? (
                      <ImagePlus size={13} />
                    ) : layer.type === 'text' ? (
                      <Type size={13} />
                    ) : (
                      <Plus size={13} />
                    )}
                  </span>
                  <span className="text-xs font-medium truncate flex-1 px-1">
                    {layer.name}
                  </span>
                  <button
                    title={layer.visible ? '隐藏图层' : '显示图层'}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateLayer(layer.id, (current) => ({
                        ...current,
                        visible: !current.visible,
                      }));
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700"
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    title="上移图层"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveLayerById(layer.id, 1);
                    }}
                    className="p-1 text-slate-400 hover:text-[#6f55ed]"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    title="下移图层"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveLayerById(layer.id, -1);
                    }}
                    className="p-1 text-slate-400 hover:text-[#6f55ed]"
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    title="删除图层"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteLayerById(layer.id);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
        <main className="relative flex-1 min-w-0 flex flex-col">
          <div
            ref={stageRef}
            className="flex-1 min-h-0 overflow-auto flex p-7 bg-[radial-gradient(#d7d6df_1px,transparent_1px)] [background-size:18px_18px]"
          >
            <div
              className="relative shrink-0 m-auto shadow-[0_24px_60px_rgba(47,38,75,.2)]"
              style={{
                width: canvasSize.width * viewScale,
                height: canvasSize.height * viewScale,
              }}
            >
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height,
                  transform: `scale(${viewScale})`,
                }}
              >
                <div
                  ref={canvasRef}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onClick={() => setSelectedId(null)}
                  className="relative overflow-hidden w-full h-full"
                  style={{ background: activeTemplate.bg }}
                >
                  {activeTemplate.id !== ORIGINAL_IMAGE_TEMPLATE.id && (
                    <>
                      <div
                        className="absolute inset-0 opacity-25"
                        style={{
                          backgroundImage:
                            'linear-gradient(120deg, rgba(255,255,255,.6), transparent 45%)',
                        }}
                      />
                      <div className="absolute top-8 left-12 text-[10px] tracking-[.25em] font-semibold text-slate-700/50">
                        CREATIVE STUDIO
                      </div>
                    </>
                  )}
                  {guides.map((guide) =>
                    guide.axis === 'vertical' ? (
                      <div
                        key={`${guide.axis}-${guide.position}`}
                        className="absolute top-0 bottom-0 border-l border-dashed border-[#7559ef] pointer-events-none"
                        style={{ left: guide.position }}
                      >
                        <span className="absolute top-2 left-1.5 whitespace-nowrap rounded bg-[#6f55ed] px-1.5 py-0.5 text-[9px] text-white">
                          对齐 {guide.source}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={`${guide.axis}-${guide.position}`}
                        className="absolute left-0 right-0 border-t border-dashed border-[#7559ef] pointer-events-none"
                        style={{ top: guide.position }}
                      >
                        <span className="absolute left-2 top-1.5 whitespace-nowrap rounded bg-[#6f55ed] px-1.5 py-0.5 text-[9px] text-white">
                          对齐 {guide.source}
                        </span>
                      </div>
                    ),
                  )}
                  {layers.map(renderLayer)}
                  {renderResizeHandles(selectedLayer)}
                  {selectedLayer && (
                    <div
                      className="absolute pointer-events-none text-[10px] text-[#6548e8] bg-white/90 shadow-sm rounded px-1.5 py-0.5"
                      style={{
                        left: clamp(
                          selectedLayer.x,
                          4,
                          Math.max(canvasSize.width - 240, 4),
                        ),
                        top: clamp(
                          selectedLayer.y - 24,
                          4,
                          Math.max(canvasSize.height - 20, 4),
                        ),
                      }}
                    >
                      拖动移动 · 拖控制点缩放（Shift 等比）· 自动对齐
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="relative shrink-0 border-t border-slate-200 bg-white px-3 py-2.5 flex items-center gap-3">
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={openSizePanel}
                title="设置画板宽高"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${sizePanelOpen ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <Ratio size={14} />
                {canvasSize.width} × {canvasSize.height}
              </button>
              <span className="hidden xl:inline text-[11px] text-slate-400">
                导出 {canvasSize.width * 2} × {canvasSize.height * 2}
              </span>
            </div>
            <div className="flex-1 min-w-0 overflow-x-auto">
              <div className="flex items-end gap-3 px-1 py-1.5">
                {boards.map(renderBoardCard)}
                <button
                  onClick={addBoard}
                  title="新增画板"
                  className="shrink-0 h-[70px] w-[54px] rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-[#775cf0] hover:text-[#6f55ed] flex items-center justify-center transition"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 text-xs text-slate-500">
              <span className="hidden sm:inline">
                画板 {activeBoardIndex + 1}/{boards.length}
              </span>
              <div className="relative flex items-center rounded-lg border border-slate-200">
                <button
                  onClick={() => zoomBy(1 / ZOOM_STEP)}
                  disabled={viewScale <= MIN_ZOOM + 0.001}
                  title="缩小（Ctrl -）"
                  className="p-1.5 text-slate-500 hover:text-[#6f55ed] disabled:opacity-35"
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  onClick={() => setZoomMenuOpen((open) => !open)}
                  title="选择缩放比例"
                  className={`px-1.5 py-1 tabular-nums min-w-[52px] ${zoomMenuOpen ? 'text-[#6045de]' : 'hover:text-[#6f55ed]'}`}
                >
                  {Math.round(viewScale * 100)}%
                </button>
                <button
                  onClick={() => zoomBy(ZOOM_STEP)}
                  disabled={viewScale >= MAX_ZOOM - 0.001}
                  title="放大（Ctrl +）"
                  className="p-1.5 text-slate-500 hover:text-[#6f55ed] disabled:opacity-35"
                >
                  <ZoomIn size={14} />
                </button>
                {zoomMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-2 z-20 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_16px_40px_rgba(47,38,75,.18)]">
                    <button
                      onClick={resetZoom}
                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-50 ${zoom === null ? 'text-[#6045de] font-medium' : 'text-slate-600'}`}
                    >
                      <Maximize size={13} />
                      适应窗口
                    </button>
                    <div className="my-1 h-px bg-slate-100" />
                    {ZOOM_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          applyZoom(preset);
                          setZoomMenuOpen(false);
                        }}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs tabular-nums hover:bg-slate-50 ${zoom === preset ? 'text-[#6045de] font-medium' : 'text-slate-600'}`}
                      >
                        {Math.round(preset * 100)}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {sizePanelOpen && (
              <div className="absolute bottom-full left-3 mb-2 z-20 w-[268px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(47,38,75,.18)]">
                <p className="text-xs font-semibold text-slate-700">画板尺寸</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  改尺寸时画布上的图层会等比跟着缩放
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                  {CANVAS_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => applyCanvasSize(preset)}
                      className={`rounded-lg border px-2 py-1.5 text-left transition ${canvasSize.width === preset.width && canvasSize.height === preset.height ? 'border-[#775cf0] bg-[#f4f1ff]' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                      <span className="block text-[11px] font-medium text-slate-700 truncate">
                        {preset.label}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {preset.ratio} · {preset.width}×{preset.height}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-slate-500">
                    宽
                    <input
                      type="number"
                      min={MIN_CANVAS_SIZE}
                      max={MAX_CANVAS_SIZE}
                      value={sizeDraft.width}
                      onChange={(event) =>
                        setSizeDraft((draft) => ({
                          ...draft,
                          width: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') applyCanvasSize(sizeDraft);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    高
                    <input
                      type="number"
                      min={MIN_CANVAS_SIZE}
                      max={MAX_CANVAS_SIZE}
                      value={sizeDraft.height}
                      onChange={(event) =>
                        setSizeDraft((draft) => ({
                          ...draft,
                          height: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') applyCanvasSize(sizeDraft);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => applyCanvasSize(sizeDraft)}
                    className="flex-1 rounded-lg bg-[#6f55ed] py-1.5 text-xs text-white hover:bg-[#5e45dd]"
                  >
                    应用尺寸
                  </button>
                  <button
                    onClick={() => setSizePanelOpen(false)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
        <aside className="w-[272px] shrink-0 bg-white border-l border-slate-200 overflow-y-auto hidden lg:block">
          <div className="p-5 border-b border-slate-100">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-sm">属性</h2>
              <span className="text-xs text-slate-400">
                {layers.length} 个对象
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              图层的排序与显隐在左侧「图层」工具里管理
            </p>
          </div>
          {selectedLayer ? (
            <div className="p-5 space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold">
                  编辑 {selectedLayer.name}
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    title="上移图层"
                    onClick={() => moveLayer(1)}
                    className="p-1.5 hover:bg-slate-100 rounded"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    title="下移图层"
                    onClick={() => moveLayer(-1)}
                    className="p-1.5 hover:bg-slate-100 rounded"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>
              {selectedLayer.type === 'text' && (
                <label className="block text-xs text-slate-500">
                  文字
                  <textarea
                    value={selectedLayer.text}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        text: event.target.value,
                      }))
                    }
                    className="mt-1.5 w-full h-20 p-2 rounded-lg border border-slate-200 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#dcd5ff]"
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">
                  X
                  <input
                    type="number"
                    value={Math.round(selectedLayer.x)}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        x: clamp(
                          Number(event.target.value),
                          0,
                          canvasSize.width - layer.width,
                        ),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Y
                  <input
                    type="number"
                    value={Math.round(selectedLayer.y)}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        y: clamp(
                          Number(event.target.value),
                          0,
                          canvasSize.height - layer.height,
                        ),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">
                  宽
                  <input
                    type="number"
                    min={MIN_LAYER_SIZE}
                    value={Math.round(selectedLayer.width)}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        width: clamp(
                          Number(event.target.value),
                          MIN_LAYER_SIZE,
                          canvasSize.width - layer.x,
                        ),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  高
                  <input
                    type="number"
                    min={MIN_LAYER_SIZE}
                    value={Math.round(selectedLayer.height)}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        height: clamp(
                          Number(event.target.value),
                          MIN_LAYER_SIZE,
                          canvasSize.height - layer.y,
                        ),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              {selectedLayer.type !== 'text' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>圆角形状</span>
                    <span className="text-slate-400">
                      {selectedLayer.radius === '50%'
                        ? '椭圆'
                        : `${readRadiusValue(selectedLayer)}px`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {RADIUS_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() =>
                          applyLayerRadius(selectedLayer.id, preset.value)
                        }
                        className={`py-1.5 text-[11px] rounded-lg border transition ${String(selectedLayer.radius ?? 0) === String(preset.value) ? 'border-[#775cf0] bg-[#f4f1ff] text-[#6045de]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(
                      Math.round(
                        Math.min(selectedLayer.width, selectedLayer.height) / 2,
                      ),
                      1,
                    )}
                    value={readRadiusValue(selectedLayer)}
                    onChange={(event) =>
                      applyLayerRadius(
                        selectedLayer.id,
                        Number(event.target.value),
                      )
                    }
                    className="w-full accent-[#7257ed]"
                  />
                </div>
              )}
              {selectedLayer.materialSrc && (
                <button
                  onClick={() => setEffectLayer(selectedLayer)}
                  className="w-full py-2 text-xs rounded-lg border border-[#d9d1ff] bg-[#faf9ff] text-[#6045de] hover:bg-[#f3f0ff] flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={14} />
                  编辑特效（去底/描边/投影）
                </button>
              )}
              {selectedLayer.type === 'image' && (
                <button
                  onClick={() => addImageFrame()}
                  className="w-full py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                >
                  <Frame size={14} />
                  添加同形状描边框
                </button>
              )}
              {selectedLayer.type === 'image' && (
                <label className="text-xs text-slate-500 block">
                  等比缩放
                  <input
                    type="range"
                    min="20"
                    max="200"
                    value={Math.round(
                      (selectedLayer.width /
                        (selectedLayer.baseWidth || selectedLayer.width)) *
                        100,
                    )}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => {
                        const baseWidth = layer.baseWidth || layer.width;
                        const baseHeight = layer.baseHeight || layer.height;
                        const maxScale = Math.min(
                          (canvasSize.width - layer.x) / baseWidth,
                          (canvasSize.height - layer.y) / baseHeight,
                        );
                        const scale = clamp(
                          Number(event.target.value) / 100,
                          MIN_LAYER_SIZE / Math.min(baseWidth, baseHeight),
                          maxScale,
                        );
                        return {
                          ...layer,
                          baseWidth,
                          baseHeight,
                          width: baseWidth * scale,
                          height: baseHeight * scale,
                        };
                      })
                    }
                    className="mt-2 w-full accent-[#7257ed]"
                  />
                </label>
              )}
              {selectedLayer.type === 'text' && (
                <div className="space-y-2">
                  <span className="block text-xs text-slate-500">文字样式</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TEXT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => applyTextPreset(preset)}
                        title={`套用「${preset.label}」`}
                        className="py-1.5 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:border-[#775cf0] hover:bg-[#faf9ff] truncate"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedLayer.type !== 'image' && (
                <label className="flex items-center justify-between text-xs text-slate-500">
                  {selectedLayer.type === 'text' ? '文字颜色' : '填充颜色'}
                  <input
                    type="color"
                    value={
                      /^#[0-9a-f]{6}$/i.test(String(selectedLayer.color || ''))
                        ? selectedLayer.color
                        : '#000000'
                    }
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        color: event.target.value,
                      }))
                    }
                    className="h-7 w-12 rounded border border-slate-200 bg-white"
                  />
                </label>
              )}
              {selectedLayer.type === 'text' && (
                <label className="text-xs text-slate-500 block">
                  字号
                  <input
                    type="range"
                    min="12"
                    max="120"
                    value={selectedLayer.size}
                    onChange={(event) =>
                      updateLayer(selectedLayer.id, (layer) => ({
                        ...layer,
                        size: Number(event.target.value),
                      }))
                    }
                    className="mt-2 w-full accent-[#7257ed]"
                  />
                </label>
              )}
              <div className="border-t border-slate-100 pt-4 flex gap-2">
                <button
                  onClick={() =>
                    updateLayer(selectedLayer.id, (layer) => ({
                      ...layer,
                      locked: !layer.locked,
                    }))
                  }
                  className="flex-1 py-2 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center gap-1"
                >
                  {selectedLayer.locked ? (
                    <LockKeyhole size={14} />
                  ) : (
                    <UnlockKeyhole size={14} />
                  )}
                  {selectedLayer.locked ? '已锁定' : '锁定'}
                </button>
                <button
                  title="复制图层"
                  onClick={duplicateLayer}
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Copy size={15} />
                </button>
                <button
                  title="删除图层"
                  onClick={deleteLayer}
                  className="p-2 border border-rose-100 text-rose-500 rounded-lg hover:bg-rose-50"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="rounded-lg bg-[#f6f4ff] p-3 flex gap-2 text-xs text-[#6953bf]">
                <AlignCenter size={16} className="shrink-0" />
                <span>拖动对象靠近画布中心线，自动显示基线对齐参考线。</span>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-400">
              <MousePointer2 size={22} className="mx-auto mb-2" />
              从画布或图层列表选择对象
            </div>
          )}
        </aside>
      </div>
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[86vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="h-16 shrink-0 px-6 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Keyboard size={18} className="text-[#6f55ed]" />
                <h2 className="text-lg font-semibold">快捷键</h2>
              </div>
              <button
                onClick={() => setShortcutsOpen(false)}
                className="p-2 -mr-2 rounded-lg text-slate-400 hover:bg-slate-100"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className="text-[11px] font-medium text-slate-400 mb-2">
                    {group.label}
                  </p>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <div
                        key={item.desc}
                        className="flex items-start gap-3 px-3.5 py-2.5"
                      >
                        <span className="shrink-0 flex flex-wrap items-center gap-1 w-[172px]">
                          {item.keys.map((key) => renderShortcutKey(key))}
                          {item.alt && (
                            <>
                              <span className="text-[11px] text-slate-400">
                                或
                              </span>
                              {item.alt.map((key) =>
                                renderShortcutKey(key, 'alt-'),
                              )}
                            </>
                          )}
                        </span>
                        <span className="text-xs text-slate-600 leading-5">
                          {item.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-slate-400">
                Mac 上把 Ctrl 换成 ⌘ 同样生效；焦点在输入框里时除 Esc
                外的快捷键都留给浏览器。
              </p>
            </div>
          </div>
        </div>
      )}
      {effectLayer && (
        <ImageEffectDialog
          source={effectLayer.materialSrc}
          title={`编辑特效 · ${effectLayer.name}`}
          initialEffect={effectLayer.effect}
          layerId={effectLayer.id}
          onClose={() => setEffectLayer(null)}
          onApply={applyMaterialEffect}
        />
      )}
    </div>
  );
};

export default DesignEditorView;
