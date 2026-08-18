/**
 * 图片特效预设表。纯数据，加一行即可扩一个特效，不需要动引擎和 UI。
 *
 * 字段含义（长度单位是 512px 工作分辨率下的像素，引擎会按实际尺寸等比换算）：
 *   cutout  { enabled, strength, holeFill }           — 去底，一条强度 + 一个抠洞开关
 *   outline [{ width, color, opacity }]               — 从内到外的描边层，最多两层
 *   shadow  { dx, dy, spread, blur, color, opacity }  — 按形状走的投影
 *   glow    { radius, color, strength, falloff }      — 按形状走的外发光
 *
 * 去底刻意只暴露 `strength` 一条 0~1 的参数，判定阈值、过渡带、收边、边缘软硬、
 * 去色溢出这些由引擎的 `deriveCutout` 统一推导——它们本来就该同向变化，
 * 拆开只会让人调不出好结果。
 */

/**
 * 去底默认参数。`holeFill` 默认开：贴纸/艺术字素材里，被笔画围住的字腔和缝隙
 * 和外面是同一片底色，绝大多数时候都该一起去掉。只有当主体本身大量使用了与底色
 * 相同的颜色（例如黑底 + 黑描边）时才需要关掉它。
 */
export const DEFAULT_CUTOUT = { enabled: true, strength: 0.5, holeFill: true };
const CUTOUT = DEFAULT_CUTOUT;

/**
 * @description 特效分类，对应弹窗左侧侧栏。
 * @keyword-cn 特效分类
 * @keyword-en effect group
 */
export const EFFECT_GROUPS = [
  { id: 'hot', label: '热门' },
  { id: 'outline', label: '描边' },
  { id: 'shadow', label: '投影' },
  { id: 'glow', label: '发光' },
  { id: 'fancy', label: '酷炫' },
];

/**
 * @description 全部特效预设。`group: 'hot'` 的会同时出现在热门页签里。
 * @keyword-cn 特效预设
 * @keyword-en effect preset
 */
export const EFFECT_PRESETS = [
  {
    id: 'none',
    label: '原图',
    groups: ['hot'],
    effect: { cutout: { ...CUTOUT, enabled: false } },
  },
  {
    id: 'cutout',
    label: '仅去底',
    groups: ['hot'],
    effect: { cutout: CUTOUT },
  },

  {
    id: 'sticker-white',
    label: '白色贴纸边',
    groups: ['hot', 'outline'],
    effect: { cutout: CUTOUT, outline: [{ width: 10, color: '#ffffff' }] },
  },
  {
    id: 'sticker-thick',
    label: '厚白边',
    groups: ['outline'],
    effect: { cutout: CUTOUT, outline: [{ width: 18, color: '#ffffff' }] },
  },
  {
    id: 'outline-ink',
    label: '墨线描边',
    groups: ['outline'],
    effect: { cutout: CUTOUT, outline: [{ width: 6, color: '#20222b' }] },
  },
  {
    id: 'outline-pink',
    label: '粉色描边',
    groups: ['outline'],
    effect: { cutout: CUTOUT, outline: [{ width: 9, color: '#ff5c8a' }] },
  },
  {
    id: 'outline-double',
    label: '双层描边',
    groups: ['hot', 'outline'],
    effect: {
      cutout: CUTOUT,
      outline: [
        { width: 8, color: '#ffffff' },
        { width: 15, color: '#20222b' },
      ],
    },
  },

  {
    id: 'shadow-soft',
    label: '柔和投影',
    groups: ['hot', 'shadow'],
    effect: {
      cutout: CUTOUT,
      shadow: {
        dx: 6,
        dy: 9,
        spread: 2,
        blur: 12,
        color: '#20222b',
        opacity: 0.32,
      },
    },
  },
  {
    id: 'shadow-hard',
    label: '硬投影',
    groups: ['shadow'],
    effect: {
      cutout: CUTOUT,
      shadow: {
        dx: 10,
        dy: 10,
        spread: 0,
        blur: 1,
        color: '#20222b',
        opacity: 0.55,
      },
    },
  },
  {
    id: 'shadow-long',
    label: '长投影',
    groups: ['shadow'],
    effect: {
      cutout: CUTOUT,
      shadow: {
        dx: 18,
        dy: 18,
        spread: 3,
        blur: 6,
        color: '#3a2a4d',
        opacity: 0.4,
      },
    },
  },
  {
    id: 'sticker-shadow',
    label: '贴纸+投影',
    groups: ['hot', 'shadow'],
    effect: {
      cutout: CUTOUT,
      outline: [{ width: 10, color: '#ffffff' }],
      shadow: {
        dx: 5,
        dy: 8,
        spread: 2,
        blur: 10,
        color: '#20222b',
        opacity: 0.3,
      },
    },
  },

  {
    id: 'glow-warm',
    label: '暖光晕',
    groups: ['glow'],
    effect: {
      cutout: CUTOUT,
      glow: { radius: 26, color: '#ffd93d', strength: 0.85, falloff: 1.8 },
    },
  },
  {
    id: 'glow-neon',
    label: '霓虹发光',
    groups: ['hot', 'glow'],
    effect: {
      cutout: CUTOUT,
      glow: { radius: 30, color: '#22d3ee', strength: 0.95, falloff: 1.5 },
    },
  },
  {
    id: 'glow-pink',
    label: '粉紫发光',
    groups: ['glow'],
    effect: {
      cutout: CUTOUT,
      glow: { radius: 28, color: '#ff5cf0', strength: 0.9, falloff: 1.6 },
    },
  },

  {
    id: 'fancy-neon-edge',
    label: '霓虹描边',
    groups: ['fancy'],
    effect: {
      cutout: CUTOUT,
      outline: [{ width: 5, color: '#ffffff' }],
      glow: { radius: 26, color: '#22d3ee', strength: 1, falloff: 1.4 },
    },
  },
  {
    id: 'fancy-pop',
    label: '波普三层',
    groups: ['fancy'],
    effect: {
      cutout: CUTOUT,
      outline: [
        { width: 8, color: '#ffffff' },
        { width: 16, color: '#ff4d6d' },
      ],
      shadow: {
        dx: 12,
        dy: 12,
        spread: 0,
        blur: 1,
        color: '#20222b',
        opacity: 0.85,
      },
    },
  },
  {
    id: 'fancy-gold',
    label: '烫金厚边',
    groups: ['fancy'],
    effect: {
      cutout: CUTOUT,
      outline: [{ width: 12, color: '#f2cf87' }],
      glow: { radius: 22, color: '#f2a13d', strength: 0.7, falloff: 2 },
      shadow: {
        dx: 4,
        dy: 6,
        spread: 1,
        blur: 8,
        color: '#3a2a12',
        opacity: 0.4,
      },
    },
  },
  {
    id: 'fancy-cyber',
    label: '赛博错位',
    groups: ['fancy'],
    effect: {
      cutout: CUTOUT,
      outline: [{ width: 6, color: '#08d9d6' }],
      shadow: {
        dx: -10,
        dy: 0,
        spread: 2,
        blur: 2,
        color: '#ff2e63',
        opacity: 0.75,
      },
    },
  },
];

/**
 * @description 按分类筛出该页签下要展示的预设。
 * @keyword-cn 特效分类
 * @keyword-en filter presets by group
 * @param {string} groupId - 分类标识。
 * @returns {object[]} 预设列表。
 */
export const presetsOfGroup = (groupId) =>
  EFFECT_PRESETS.filter((preset) => preset.groups.includes(groupId));
