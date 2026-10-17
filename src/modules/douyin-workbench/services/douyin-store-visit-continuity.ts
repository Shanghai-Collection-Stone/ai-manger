import type { DouyinStoreVisitSegment } from '../entities/douyin-workbench.entity.js';

/** @description 所有探店视频共享的实景与稳定镜头约束，追加在模型规划之后。 @keyword-cn 实景保真约束, 稳定镜头 @keyword-en real-scene-constraints, stable-camera */
export const STORE_VISIT_REAL_SCENE_RULES =
  '【实景硬约束】原始场景图是环境、产品和设施的唯一画面依据；说明和台词不授权扩展画面。保持原图布局、产品身份、招牌和可见文字，不新增图外空间、菜品、设施或路人；只在所给图片可见范围内拍摄。单段只有一个连续镜头，固定机位或极轻微缓慢推近，不切镜、不环绕、不快速摇移、不突然拉远、不穿门、不模拟走向图外区域；不得改变陈设布局、产品身份和设施结构，仅允许指定交互产生的自然动作和位移。不添加字幕、水印或新文字。';

/** @description 读取画面来源，兼容旧人物讲解段的合成首帧，其余默认原图。 @keyword-cn 探店画面来源, 旧数据兼容 @keyword-en store-visit-visual-source, legacy-visual-source */
export function storeVisitVisualSource(
  segment: DouyinStoreVisitSegment,
): 'original' | 'references' | 'generated' {
  if (segment.shot !== 'presenter' && segment.shot !== 'experience')
    return 'original';
  return (
    segment.visualSource ||
    (segment.shot === 'presenter' ? 'generated' : 'original')
  );
}

/** @description 仅原生支持多图参考的已接入型号允许分开传人物和场景。 @keyword-cn 探店多图能力, 人物场景分图 @keyword-en store-visit-multi-reference, separate-person-scene */
export function supportsStoreVisitReferences(model: string): boolean {
  return /seedance[-_.]?2|(?:minimax[-_.]?)?h3/i.test(model);
}

/** @description 场景、镜头用途或画面来源变化时直接切入所选素材，禁止人物自动出入画或虚构空间过渡。 @keyword-cn 实景镜头起点, 人物体验切换 @keyword-en real-scene-shot-start, experience-shot-boundary */
export function isStoreVisitVisualStart(
  segments: DouyinStoreVisitSegment[],
  index: number,
): boolean {
  const current = segments[index];
  const previous = segments[index - 1];
  return (
    !previous ||
    isStoreVisitSceneStart(segments, index) ||
    (current?.shot || 'broll') !== (previous.shot || 'broll') ||
    storeVisitVisualSource(current) !== storeVisitVisualSource(previous)
  );
}

/** @description 判断台词段是否为整条视频开头或真实场景切换，镜头类型变化不等于换场景。 @keyword-cn 场景起始判断, 台词场景分离 @keyword-en scene-start-check, dialogue-scene-separation */
export function isStoreVisitSceneStart(
  segments: DouyinStoreVisitSegment[],
  index: number,
): boolean {
  return (
    index === 0 ||
    segments[index]?.sceneImageId !== segments[index - 1]?.sceneImageId
  );
}

/** @description 读取当前场景已有的人物起始画面，同场景台词共享它，续段实际以视频尾帧起步。 @keyword-cn 共享场景首帧, 场景画面复用 @keyword-en shared-scene-keyframe, scene-frame-reuse */
export function readStoreVisitSceneKeyframe(
  segment: DouyinStoreVisitSegment,
  segments: DouyinStoreVisitSegment[],
) {
  if (storeVisitVisualSource(segment) !== 'generated') return undefined;
  return (
    segment.keyframe ||
    segments.find(
      (item) =>
        item.sceneImageId === segment.sceneImageId &&
        item.shot === segment.shot &&
        storeVisitVisualSource(item) === 'generated' &&
        item.keyframe,
    )?.keyframe
  );
}

/** @description 尾帧理解与下一段衔接规划的结构化结果。 @keyword-cn 尾帧衔接方案, 连续视频提示 @keyword-en tail-frame-plan, continuous-video-prompt */
export interface StoreVisitContinuityPlan {
  tailDescription: string;
  transition: string;
  videoPrompt: string;
}

/** @description 严格解析视觉模型的衔接方案，不接受空白或未分析尾帧的结果。 @keyword-cn 解析衔接方案, 视觉结果校验 @keyword-en parse-continuity-plan, vision-result-check */
export function parseStoreVisitContinuityPlan(
  text: string,
): StoreVisitContinuityPlan {
  const value = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  ) as Record<string, unknown>;
  const tailDescription = String(value.tailDescription || '').trim();
  const transition = String(value.transition || '').trim();
  const videoPrompt = String(value.videoPrompt || '').trim();
  if (!tailDescription || !transition || !videoPrompt)
    throw new Error('尾帧理解结果缺少画面分析或衔接方案');
  return {
    tailDescription: tailDescription.slice(0, 1500),
    transition: transition.slice(0, 1500),
    videoPrompt: videoPrompt.slice(0, 3000),
  };
}

/** @description 为视觉 LLM 写衔接任务，明确尾帧为真实起点、场景图为空间参考、台词段不触发重构画面。 @keyword-cn 尾帧理解要求, 场景衔接规划 @keyword-en tail-frame-analysis, scene-continuity-planning */
export function buildStoreVisitContinuityBrief(input: {
  title: string;
  previous: DouyinStoreVisitSegment;
  segment: DouyinStoreVisitSegment;
  sceneChanged: boolean;
  sceneDescription?: string;
}): string {
  return [
    `探店视频：${input.title}`,
    '图片1：上一段在最终成片中实际播放结束的尾帧。图片2：当前段的原始场景图。图片3（如有）：固定出镜人物的身份参考。',
    `上一段镜头：${input.previous.shot === 'presenter' ? '人物出镜' : '门店空镜'}；台词：${input.previous.lines}`,
    `下一段镜头：${input.segment.shot === 'presenter' ? '人物出镜' : '门店空镜'}；台词：${input.segment.lines}`,
    `下一段动作要求：${input.segment.action || '固定机位，自然延续当前画面，不新增动作和空间'}`,
    `场景说明：${input.sceneDescription || ''}`,
    input.sceneChanged
      ? '这里切换素材或镜头用途。直接切入图片2对应的画面，不生成走路、穿门、人物入画或空间变形的过渡。'
      : '场景没有变化。下一段必须从图片1的实际画面接续：保持人物位置、姿态、视线、构图、光线、运镜方向和空间关系。图片2只用于理解空间与原貌，禁止重新从图片2的构图开始。台词分段不是重新开镜或重新生图。',
    input.previous.shot !== input.segment.shot
      ? '镜头用途改变时直接切入所选素材，不生成让人物自动进出画面的过渡。'
      : '不要在段落边界突然改变人物、机位、景别或镜头类型。',
    '先描述图片1的可见画面，再决定衔接动作，最后结合下一段台词写实际生视频提示词。生成提示词要写可执行的镜头、动作和结束状态，明确第一帧的连续关系；台词只指导内容，禁止生成字幕、文字、水印、人声或音乐。',
    input.segment.shot === 'experience'
      ? '本段是人物体验：仅执行用户明确指定、原图可支持的一项轻微动作，配画外音；不要求正脸讲解或对口型，不擅自连续品尝、拿取和游玩。'
      : '',
    '如果尾帧已经偏离原始场景，不得把新增空间或物体当成下一段的事实继续扩展。',
    STORE_VISIT_REAL_SCENE_RULES,
    '只返回 JSON，三个非空字符串字段：tailDescription、transition、videoPrompt。',
  ].join('\n');
}
