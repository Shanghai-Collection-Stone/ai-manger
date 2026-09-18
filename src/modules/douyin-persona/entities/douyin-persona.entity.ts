import { ObjectId } from 'mongodb';

/**
 * @description 预设人物的叙事视角：决定脚本以谁的身份、用什么立场讲，探店与测评是第一人称在场视角，
 *   讲解与种草是第一人称介绍视角，客户视角用于「我是用户」的口碑型内容。
 * @keyword-cn 人物叙事视角, 探店视角
 * @keyword-en persona-perspective, store-visit-perspective
 */
export const DOUYIN_PERSONA_PERSPECTIVES = {
  storeVisit: 'storeVisit',
  review: 'review',
  explainer: 'explainer',
  recommend: 'recommend',
  customer: 'customer',
} as const;

/**
 * @description 预设人物叙事视角类型。
 * @keyword-cn 视角类型, 人物视角枚举
 * @keyword-en perspective-type, persona-perspective-enum
 */
export type DouyinPersonaPerspective =
  (typeof DOUYIN_PERSONA_PERSPECTIVES)[keyof typeof DOUYIN_PERSONA_PERSPECTIVES];

/**
 * @description 各叙事视角写进提示词的中文说明，脚本生成与分镜拆解共用同一份措辞。
 * @keyword-cn 视角说明文案, 视角提示词
 * @keyword-en perspective-labels, perspective-prompt
 */
export const DOUYIN_PERSONA_PERSPECTIVE_LABELS: Record<
  DouyinPersonaPerspective,
  { label: string; instruction: string }
> = {
  storeVisit: {
    label: '探店打卡',
    instruction:
      '以第一人称亲自到店体验的口吻讲：进店动线、点了什么、真实感受、值不值得来，画面里人物始终在现场。',
  },
  review: {
    label: '实测测评',
    instruction:
      '以第一人称亲自上手实测的口吻讲：怎么测的、数据或直观对比、优点与劝退点，结论要明确不含糊。',
  },
  explainer: {
    label: '知识讲解',
    instruction:
      '以懂行的人讲给外行听的口吻讲：先抛出困惑，再拆成 2-4 个要点讲清楚，结尾给可执行建议。',
  },
  recommend: {
    label: '种草介绍',
    instruction:
      '以第一人称推荐的口吻讲：什么场景下需要、它解决了什么、为什么是它，克制不夸大、不作效果承诺。',
  },
  customer: {
    label: '用户口碑',
    instruction:
      '以真实使用者复盘的口吻讲：用之前的问题、用的过程、用之后的变化，像朋友聊天而不是广告。',
  },
};

/**
 * @description 预设人物的音色设置。这套链路没有独立 TTS 音色库，成片的人声由生视频模型按提示词
 *   【声音】段生成，因此音色是结构化的描述：性别、年龄感、语速与自由补充的音色特质。
 * @keyword-cn 人物音色设置, 提示词音色
 * @keyword-en persona-voice-setting, prompt-level-timbre
 */
export interface DouyinPersonaVoice {
  gender: 'female' | 'male' | 'neutral';
  age: 'young' | 'adult' | 'mature';
  pace: 'slow' | 'normal' | 'fast';
  /** @description 自由填写的音色特质，例如「清亮干脆、尾音略上扬」，为空时只用前三项描述 */
  timbre?: string;
}

/**
 * @description 预设人物的一张形象参考图。`view` 标明是三视图里的哪一张，`imageId` 指向租户图库记录，
 *   分镜出图时按 `url` 作为底图候选传给生图运行时。
 * @keyword-cn 人物形象参考图, 三视图
 * @keyword-en persona-reference-image, three-view-sheet
 */
export interface DouyinPersonaImage {
  view: 'front' | 'side' | 'closeup' | 'custom';
  imageId: number;
  url: string;
  coverUrl?: string;
}

/**
 * @description 预设人物持久化实体：租户内共享，工作台按脚本选用。`appearance` 约束长相与穿着，
 *   `persona` 约束性格语气，`voice` 约束成片人声，`referenceImages` 是保证跨镜头长相一致的底图来源。
 * @keyword-cn 预设人物实体, 租户共享人设
 * @keyword-en douyin-persona-entity, tenant-shared-persona
 */
export interface DouyinPersonaEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string;
  /** @description 创建人，用于审计；同租户其他用户同样可选用 */
  createdBy: string;
  name: string;
  summary?: string;
  appearance: string;
  persona?: string;
  perspective: DouyinPersonaPerspective;
  voice: DouyinPersonaVoice;
  referenceImages: DouyinPersonaImage[];
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 前端使用的预设人物视图，去掉 Mongo `_id`。
 * @keyword-cn 预设人物视图, 隐藏数据库ID
 * @keyword-en douyin-persona-view, hide-database-id
 */
export type DouyinPersonaView = Omit<DouyinPersonaEntity, '_id'>;

/**
 * @description 三视图各自的构图要求，AI 生成形象时逐张按这里的措辞出图，保证三张是同一个人。
 * @keyword-cn 三视图构图, 形象生成规格
 * @keyword-en three-view-composition, reference-sheet-spec
 */
export const DOUYIN_PERSONA_VIEW_SPECS: ReadonlyArray<{
  view: DouyinPersonaImage['view'];
  label: string;
  composition: string;
  size: string;
}> = [
  {
    view: 'front',
    label: '正面全身',
    composition:
      '正面全身站姿，双手自然下垂，平视镜头，完整露出发型、五官、上衣与下装',
    size: '1024x1792',
  },
  {
    view: 'side',
    label: '四分之三侧身',
    composition:
      '四分之三侧身半身，视线略偏离镜头，保持与正面图完全一致的发型、五官与服装',
    size: '1024x1792',
  },
  {
    view: 'closeup',
    label: '面部特写',
    composition:
      '面部特写，肩部以上，平视镜头，清晰呈现五官细节，保持与前两张完全一致的长相与发型',
    size: '1024x1024',
  },
];
