import {
  DOUYIN_PERSONA_PERSPECTIVE_LABELS,
  type DouyinPersonaView,
  type DouyinPersonaVoice,
} from '../entities/douyin-persona.entity.js';

/**
 * @description 音色三个结构化维度写进提示词时的中文措辞。
 * @keyword-cn 音色维度文案, 音色描述
 * @keyword-en voice-dimension-labels, timbre-wording
 */
export const DOUYIN_PERSONA_VOICE_LABELS = {
  gender: { female: '女声', male: '男声', neutral: '中性声线' },
  age: { young: '年轻', adult: '成熟稳重', mature: '有阅历的年长' },
  pace: { slow: '语速偏慢', normal: '语速自然', fast: '语速偏快利落' },
} as const;

/**
 * @description 把结构化音色拼成一句中文描述，UI 徽标与提示词共用，保证前后台说法一致。
 * @keyword-cn 音色短文案, 音色一句话
 * @keyword-en voice-label, timbre-one-liner
 * @param voice 人物音色。
 * @returns {string} 例如「年轻女声 · 语速偏快利落 · 清亮干脆」。
 */
export function describePersonaVoice(voice: DouyinPersonaVoice): string {
  const base = `${DOUYIN_PERSONA_VOICE_LABELS.age[voice.age]}${DOUYIN_PERSONA_VOICE_LABELS.gender[voice.gender]}`;
  return [base, DOUYIN_PERSONA_VOICE_LABELS.pace[voice.pace], voice.timbre]
    .filter(Boolean)
    .join(' · ');
}

/**
 * @description 生成写进生视频提示词【声音】段的音色补充句。没有选人物时返回空串，
 *   调用方直接拼在原有配音要求后面即可。
 * @keyword-cn 音色提示片段, 配音音色约束
 * @keyword-en voice-prompt-fragment, voiceover-timbre-rule
 * @param persona 选用的预设人物，可为空。
 * @returns {string} 音色补充句，未选人物时为空串。
 */
export function buildPersonaVoiceSection(
  persona?: DouyinPersonaView | null,
): string {
  if (!persona) return '';
  const { gender, age, pace, timbre } = persona.voice;
  return `旁白音色固定为${DOUYIN_PERSONA_VOICE_LABELS.age[age]}${DOUYIN_PERSONA_VOICE_LABELS.gender[gender]}，${DOUYIN_PERSONA_VOICE_LABELS.pace[pace]}${timbre ? `，${timbre}` : ''}；全片只有这一个人的声音，不要换音色、不要出现第二个旁白。`;
}

/**
 * @description 生成脚本创作用的人设段：身份、视角要求、性格语气。写脚本和拆分镜都用它，
 *   保证口播稿的人称和分镜里的人物是同一个人。
 * @keyword-cn 人设脚本段, 视角约束
 * @keyword-en persona-script-brief, perspective-constraint
 * @param persona 选用的预设人物，可为空。
 * @returns {string} 人设段落，未选人物时为空串。
 */
export function buildPersonaScriptBrief(
  persona?: DouyinPersonaView | null,
): string {
  if (!persona) return '';
  const perspective = DOUYIN_PERSONA_PERSPECTIVE_LABELS[persona.perspective];
  return [
    `【出镜人物】${persona.name}${persona.summary ? `（${persona.summary}）` : ''}`,
    `【叙事视角】${perspective.label}：${perspective.instruction}`,
    persona.persona ? `【性格语气】${persona.persona}` : '',
    `【人声】${describePersonaVoice(persona.voice)}，口播稿要贴合这个声线的说话习惯。`,
    '口播稿必须全程以这个人物的第一人称来写，不要出现旁观者解说或第二个说话人。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 生成分镜出图用的人物外貌段，叠加在每一镜的画面描述上，保证跨镜头长相与穿着一致。
 * @keyword-cn 人物外貌提示, 跨镜一致
 * @keyword-en persona-appearance-prompt, cross-shot-consistency
 * @param persona 选用的预设人物，可为空。
 * @returns {string} 外貌段落，未选人物时为空串。
 */
export function buildPersonaImageBrief(
  persona?: DouyinPersonaView | null,
): string {
  if (!persona) return '';
  return [
    `画面里的出镜人物固定为「${persona.name}」：${persona.appearance}`,
    persona.referenceImages.length
      ? '已给出该人物的形象参考图，必须保持参考图里的长相、发型、体型与服装完全一致，只改变动作、表情、景别与场景。'
      : '同一条视频的所有镜头里，这个人物的长相、发型、体型与服装必须完全一致。',
  ].join('\n');
}

/**
 * @description 取人物形象参考图的图片地址，按正面、侧面、特写的登记顺序返回，供生图作为底图候选。
 * @keyword-cn 人物底图候选, 形象图地址
 * @keyword-en persona-base-images, reference-image-urls
 * @param persona 选用的预设人物，可为空。
 * @returns {string[]} 图片地址列表，未选人物或没有形象图时为空数组。
 */
export function personaBaseImageUrls(
  persona?: DouyinPersonaView | null,
): string[] {
  return (persona?.referenceImages ?? [])
    .map((image) => String(image.url ?? '').trim())
    .filter(Boolean);
}
