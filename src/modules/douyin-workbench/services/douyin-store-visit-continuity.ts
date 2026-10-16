import type { DouyinStoreVisitSegment } from '../entities/douyin-workbench.entity.js';

/** @description 判断台词段是否为整条视频开头或真实场景切换，镜头类型变化不等于换场景。 @keyword-cn 场景起始判断, 台词场景分离 @keyword-en scene-start-check, dialogue-scene-separation */
export function isStoreVisitSceneStart(segments: DouyinStoreVisitSegment[], index: number): boolean {
  return index === 0 || segments[index]?.sceneImageId !== segments[index - 1]?.sceneImageId;
}

/** @description 读取当前场景已有的人物起始画面，同场景台词共享它，续段实际以视频尾帧起步。 @keyword-cn 共享场景首帧, 场景画面复用 @keyword-en shared-scene-keyframe, scene-frame-reuse */
export function readStoreVisitSceneKeyframe(segment: DouyinStoreVisitSegment, segments: DouyinStoreVisitSegment[]) {
  return segment.keyframe || segments.find((item) => item.sceneImageId === segment.sceneImageId && item.keyframe)?.keyframe;
}

/** @description 尾帧理解与下一段衔接规划的结构化结果。 @keyword-cn 尾帧衔接方案, 连续视频提示 @keyword-en tail-frame-plan, continuous-video-prompt */
export interface StoreVisitContinuityPlan {
  tailDescription: string;
  transition: string;
  videoPrompt: string;
}

/** @description 严格解析视觉模型的衔接方案，不接受空白或未分析尾帧的结果。 @keyword-cn 解析衔接方案, 视觉结果校验 @keyword-en parse-continuity-plan, vision-result-check */
export function parseStoreVisitContinuityPlan(text: string): StoreVisitContinuityPlan {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, unknown>;
  const tailDescription = String(value.tailDescription || '').trim();
  const transition = String(value.transition || '').trim();
  const videoPrompt = String(value.videoPrompt || '').trim();
  if (!tailDescription || !transition || !videoPrompt) throw new Error('尾帧理解结果缺少画面分析或衔接方案');
  return { tailDescription: tailDescription.slice(0, 1500), transition: transition.slice(0, 1500), videoPrompt: videoPrompt.slice(0, 3000) };
}

/** @description 为视觉 LLM 写衔接任务，明确尾帧为真实起点、场景图为空间参考、台词段不触发重构画面。 @keyword-cn 尾帧理解要求, 场景衔接规划 @keyword-en tail-frame-analysis, scene-continuity-planning */
export function buildStoreVisitContinuityBrief(input: { title: string; previous: DouyinStoreVisitSegment; segment: DouyinStoreVisitSegment; sceneChanged: boolean; sceneDescription?: string }): string {
  return [
    `探店视频：${input.title}`,
    '图片1：上一段在最终成片中实际播放结束的尾帧。图片2：当前段的原始场景图。图片3（如有）：固定出镜人物的身份参考。',
    `上一段镜头：${input.previous.shot === 'presenter' ? '人物出镜' : '门店空镜'}；台词：${input.previous.lines}`,
    `下一段镜头：${input.segment.shot === 'presenter' ? '人物出镜' : '门店空镜'}；台词：${input.segment.lines}`,
    `下一段动作要求：${input.segment.action || '自然延续当前动作与运镜'}`,
    `场景说明：${input.sceneDescription || ''}`,
    input.sceneChanged
      ? '这里明确换了场景。允许切入图片2对应的新场景，规划符合前后台词的自然转场，不把旧场景强行变形为新场景。'
      : '场景没有变化。下一段必须从图片1的实际画面接续：保持人物位置、姿态、视线、构图、光线、运镜方向和空间关系。图片2只用于理解空间与原貌，禁止重新从图片2的构图开始。台词分段不是重新开镜或重新生图。',
    input.previous.shot !== input.segment.shot
      ? '保留首尾出镜的安排。人物转空镜时规划人物自然退出或镜头平滑转向产品/环境；空镜转人物时规划人物自然入画或镜头回到同一人物，不能突变服装、脸、店内陈设。'
      : '不要在段落边界突然改变人物、机位、景别或镜头类型。',
    '先描述图片1的可见画面，再决定衔接动作，最后结合下一段台词写实际生视频提示词。生成提示词要写可执行的镜头、动作和结束状态，明确第一帧的连续关系；台词只指导内容，禁止生成字幕、文字、水印、人声或音乐。',
    '只返回 JSON，三个非空字符串字段：tailDescription、transition、videoPrompt。',
  ].join('\n');
}
