/**
 * @description AI 素材风格预设的静态注册表。每条预设只描述「视觉处理方式」——配色、
 * 笔触质感、描边方式和装饰元素语言，不描述版面结构，也不包含任何文字内容；因为
 * `ai-material` 入口生成的是单主体贴纸，排版由前端画布的文字图层与宫格模板负责。
 * 缩略图不在服务端存放，由前端 `material-lab/style-presets/{id}.jpg` 随包发布，
 * 双方仅靠 `id` 对齐。
 * @keyword-cn 素材风格预设, 风格注册表
 * @keyword-en material-style-preset, style-registry
 */

/**
 * @description 单条素材风格预设的结构。
 * @keyword-cn 风格预设结构
 * @keyword-en material-style-shape
 */
export type MaterialStylePreset = {
  /** 预设唯一标识，与前端随包缩略图文件名逐字一致。 */
  id: string;
  /** 中文展示名，用于素材面板的风格选择卡片。 */
  label: string;
  /** 风格分组，用于素材面板分区展示。 */
  group: MaterialStyleGroupId;
  /** 一句话气质概括，作为卡片副标题。 */
  summary: string;
  /** 拼进生图提示词的风格描述，只约束配色/笔触/描边/装饰语言。 */
  descriptor: string;
};

/**
 * @description 风格分组标识。
 * @keyword-cn 风格分组
 * @keyword-en material-style-group
 */
export type MaterialStyleGroupId =
  | 'pop'
  | 'handwrite'
  | 'collage'
  | 'guochao'
  | 'clean';

/**
 * @description 风格分组的展示名，供前端分区渲染。
 * @keyword-cn 风格分组, 分组展示名
 * @keyword-en material-style-group, group-label
 */
export const MATERIAL_STYLE_GROUPS: Array<{
  id: MaterialStyleGroupId;
  label: string;
}> = [
  { id: 'pop', label: '潮流大字' },
  { id: 'handwrite', label: '手写马克笔' },
  { id: 'collage', label: '拼贴手账' },
  { id: 'guochao', label: '国潮做旧' },
  { id: 'clean', label: '干净极简' },
];

/**
 * @description 全部素材风格预设。新增风格 = 在此追加一条 + 前端 `style-presets/`
 * 放一张同名 `.jpg` 缩略图，两处 `id` 必须逐字相同。
 * @keyword-cn 素材风格预设, 风格注册表
 * @keyword-en material-style-preset, style-registry
 */
export const MATERIAL_STYLE_PRESETS: MaterialStylePreset[] = [
  {
    id: 'pink-princess-brush',
    label: '粉黑公主风',
    group: 'handwrite',
    summary: '樱花粉撞纯白，梦幻少女感',
    descriptor:
      '配色为纯黑或深色底上的樱花粉(#F7A8C4)、亮玫粉与纯白双色撞色，只用这三种颜色；笔触是粗手写笔刷质感，起笔收笔带自然飞白与干刷缺口；主体边缘不加硬描边，靠与底色的高反差立形；装饰语言取线描皇冠、细线爱心、四角星芒、云朵状轮廓和圆角胶囊块；整体甜美、梦幻、有仪式感。',
  },
  {
    id: 'neon-rose-pop',
    label: '玫红潮流波普',
    group: 'pop',
    summary: '玫红压暖黄，热闹有活力',
    descriptor:
      '配色为纯黑底上的玫红(#F2385A)、暖黄(#FFC93C)与纯白三色；笔触厚重饱满、边缘干净利落，块面感强；主体常压在一块手刷玫红或暖黄色块上形成叠压关系；装饰语言取圆头对话气泡、描边圆角胶囊、实心爱心、短放射线和小圆点阵；整体热闹、年轻、有促销号召感。',
  },
  {
    id: 'guochao-brush-splash',
    label: '国潮毛笔撞色',
    group: 'guochao',
    summary: '正红明黄，毛笔飞白',
    descriptor:
      '配色为浅色或纯白底上的正红(#D93A2B)、明黄(#F5B324)与纯黑；笔触是毛笔横扫的飞白质感，墨色浓淡不均、边缘破碎；主体可叠一层空心细描边强化轮廓；装饰语言取半调网点、红色笔刷横扫色带、闪电、五角星、虚线路径和盾形徽章；整体张扬、有力量感、带国潮运动气质。',
  },
  {
    id: 'paper-collage-tape',
    label: '撕纸拼贴',
    group: 'collage',
    summary: '雾霾蓝奶黄，纸感胶带',
    descriptor:
      '配色为深底上的雾霾蓝、樱花粉、奶黄与米白低饱和四色；笔触圆润厚实，所有色块边缘做成手撕纸的毛边与轻微起翘；主体像剪纸一样一层层叠贴，层与层之间留白边；装饰语言取半透明胶带贴、手绘星星笑脸、派对帽、蝴蝶结和虚线缝合线；整体柔和、手作、有手账拼贴感。',
  },
  {
    id: 'bold-magazine-block',
    label: '杂志大字块',
    group: 'pop',
    summary: '米白玫红，色块压叠',
    descriptor:
      '配色为纯黑底上的米白、玫红(#F0325C)与柠檬黄；笔触是超粗实心块面配少量手写笔刷混排，粗细对比极大；主体压在纯色高亮方块上，方块边缘略带手撕不规则感；装饰语言取手绘箭头、对勾、波浪下划线和小色块碎片；整体直给、有编辑部杂志封面的信息张力。',
  },
  {
    id: 'marker-warm-doodle',
    label: '马克笔暖调',
    group: 'handwrite',
    summary: '奶黄珊瑚红，手绘涂鸦',
    descriptor:
      '配色为深底上的奶黄(#F7D98B)、珊瑚红(#F2705B)与薄荷绿柔和三色；笔触是马克笔手写质感，笔画中段有干刷断墨、末端带轻微拖尾；主体线条圆润不锐利；装饰语言取手绘蝴蝶结、单线蛋糕、星芒、圆角胶囊底和细点线；整体温柔、手绘、有小预算却精致的松弛感。',
  },
  {
    id: 'dopamine-neon-burst',
    label: '多巴胺荧光',
    group: 'pop',
    summary: '荧光黄撞亮青桃红',
    descriptor:
      '配色为纯黑底上的荧光黄(#F3EC1A)、亮青(#22C3E6)与桃红(#F5197F)高饱和三色，颜色互相硬碰不做过渡；笔触是极粗压缩块面，外面套一圈纯白硬描边；主体常嵌在爆炸锯齿状色块里；装饰语言取放射短线、半调点阵、锯齿爆炸框和斜切色条；整体刺激、高能、极强视觉冲击。',
  },
  {
    id: 'red-cream-poster',
    label: '红米白大字报',
    group: 'pop',
    summary: '正红配米白，粗犷有力',
    descriptor:
      '配色为纯黑底上的米白、正红(#F0403C)与明黄；笔触是手写感的超粗实心块面，字重极大、边缘略带手绘抖动；主体不加描边，靠色块体量取胜；装饰语言取手绘花括号、五角星、螺旋箭头、圆环圈注和成组的感叹短线；整体粗犷、直白、有街头大字报的号召力。',
  },
  {
    id: 'orange-clean-minimal',
    label: '橙白极简',
    group: 'clean',
    summary: '亮橙配纯黑，干净留白',
    descriptor:
      '配色为纯白底上的亮橙(#F1631A)、纯黑与奶油色高亮，只用这几种颜色且大面积留白；笔触硬朗利落、边缘干净无毛刺；主体下方可垫一道手刷奶油色高亮带；装饰语言取虚线描边圆角标签、四角星和短放射线，装饰克制稀疏；整体清爽、专业、偏商务可信感。',
  },
  {
    id: 'rose-sticker-outline',
    label: '玫粉厚描边贴纸',
    group: 'pop',
    summary: '玫粉包白边，贴纸质感',
    descriptor:
      '配色为纯黑底上的玫粉(#EE3D7F)与纯白双色；笔触是粗笔刷手写质感带轻微飞白；主体外面套一圈厚实的纯白描边、白边外再叠一层深色投影，形成明确的贴纸剥离感；装饰语言取手绘星星、爱心、双色波浪下划线、圆圈圈注和弯曲箭头；整体俏皮、突出、像可以直接撕下来的贴纸。',
  },
  {
    id: 'beige-journal-sticker',
    label: '米色手账',
    group: 'collage',
    summary: '米纸打底，荧光笔涂抹',
    descriptor:
      '配色为米白纸质底上的纯黑、正红(#D8231F)与暖黄高亮；笔触是手写马克笔的粗黑质感，边缘带纸面颗粒；主体做成圆角贴纸块并留一圈白边加淡投影；装饰语言取荧光笔涂抹色带、红黄双色下划线、手绘箭头和便签标签；整体像摊开的手账本，亲切、可信、适合攻略清单。',
  },
  {
    id: 'red-yellow-3d-shadow',
    label: '红黄立体投影',
    group: 'pop',
    summary: '硬边偏移投影，撞色描边',
    descriptor:
      '配色为纯黑底上的纯白、明黄(#FFD400)与玫红(#F0325C)；笔触是极粗实心块面，主体带一层硬边等距偏移的立体投影而不是模糊阴影；主体外再套一圈撞色粗描边框；装饰语言取警告三角、云朵对话框、胶带贴、四角星芒和短放射线；整体醒目、有厚度、像立体印刷贴。',
  },
  {
    id: 'neon-graffiti-tape',
    label: '荧光涂鸦拼贴',
    group: 'collage',
    summary: '柠檬黄桃红宝蓝乱撞',
    descriptor:
      '配色为纯黑底上的柠檬黄、桃红与宝蓝三色乱撞；笔触是粗笔刷手写带飞白，外沿套一圈白描边；主体旁散布随手涂鸦；装饰语言取胶带贴标签、涂鸦螺旋、爆炸星、手绘箭头和抖动波浪线，装饰密度高、位置随意；整体街头、随性、有涂鸦墙的躁动感。',
  },
  {
    id: 'lemon-grunge-burst',
    label: '柠檬黄做旧',
    group: 'guochao',
    summary: '颗粒磨损，柠檬黄爆冲',
    descriptor:
      '配色为纯黑底上的柠檬黄(#EDE81E)、桃红与亮蓝；笔触是做旧颗粒质感的粗块面，边缘有磨损缺口和噪点侵蚀；主体不加白边，靠颗粒边缘和高亮黄自然浮出；装饰语言取手绘圆环围绕、螺旋箭头、四角星芒、胶带标签和抖动波浪线；整体做旧、燥、有复古印刷的粗粝感。',
  },
];
