import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import type { DouyinPersonaView } from '../../douyin-persona/entities/douyin-persona.entity.js';
import {
  buildPersonaScriptBrief,
  describePersonaVoice,
} from '../../douyin-persona/services/douyin-persona-prompt.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import { normalizeKnowledgeIds } from '../../knowledge/services/knowledge-ids.js';
import { KnowledgeService } from '../../knowledge/services/knowledge.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import {
  WorkflowModelService,
  toWorkflowLlmConfig,
} from '../../workflow-model/services/workflow-model.service.js';
import type {
  DouyinStoreVisitSpot,
  DouyinStoreVisitStoreEntity,
} from '../entities/douyin-store-visit-store.entity.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import {
  findStoreVisitHardToVoiceWords,
  findStoreVisitUnknownNumbers,
  STORE_VISIT_LINES_MIN_CHARACTERS,
  STORE_VISIT_PLAIN_SPEECH_RULE,
  STORE_VISIT_SELLING_POINT_RULE,
} from './douyin-child-topic-generation.service.js';
import {
  COSYVOICE_PRESET_CATEGORIES,
  COSYVOICE_PRESET_VOICES,
  type CosyVoicePresetVoice,
} from './douyin-cosyvoice.service.js';
import {
  DouyinStoreVisitSpotService,
  readStoreVisitText,
} from './douyin-store-visit-spot.service.js';
import {
  DOUYIN_STORE_VISIT_SEGMENT_LIMITS,
  DouyinWorkbenchRepositoryService,
} from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 每个点位带进配场景目录的图片数：按打分从高到低取，与前端 `SPOT_IMAGES_PER_TOPIC`（同步成选题素材的张数）一致，AI 挑的图一定在选题素材里。
 * @keyword-cn 配场景每点位图数, 择优选图
 * @keyword-en scene-images-per-spot, best-image-pick
 */
export const STORE_VISIT_SCENE_IMAGES_PER_SPOT = 4;

/**
 * @description 有人出镜的出镜模板：第 1 段（或首尾段）由人物站在门头前讲。
 * @keyword-cn 出镜模板, 人物出镜判断
 * @keyword-en presenter-templates, presenter-check
 */
const STORE_VISIT_PRESENTER_TEMPLATES = ['opening', 'bookend', 'presenter-all'];

/**
 * @description 配场景用的点位目录：第 k 个点位（开场门头在前）带它打分最高的几张图（编号 k.1、k.2…），没有图的点位带它的第一段实拍视频。
 * @keyword-cn 点位素材目录, 点位编号
 * @keyword-en spot-catalog, spot-numbering
 */
export interface StoreVisitSpotCatalogEntry {
  index: number;
  spot: DouyinStoreVisitSpot;
  images: Array<{ imageId: number; description: string; score: number }>;
  videoIds: number[];
}

/**
 * @description 一段脚本：这段要配的画面（之后按它从门店图库挑实拍图）与口播台词。
 * @keyword-cn 脚本分段, 画面与台词
 * @keyword-en script-segment, scene-and-lines
 */
export interface StoreVisitScriptSegment {
  scene: string;
  lines: string;
}

/**
 * @description 脚本自检结果：是否通过、对照了几条引用知识、需要用户处理的问题（只列出，不自动改）。
 * @keyword-cn 脚本自检结果, 自检问题
 * @keyword-en script-review-result, review-issues
 */
export interface StoreVisitScriptReview {
  passed: boolean;
  knowledgeCount: number;
  issues: string[];
}

/**
 * @description 写脚本与自检共用的上下文：选题、母选题标题、引用知识段落与条数、门店（选过才有）、门店资料文本与核对事实用的资料全文。
 * @keyword-cn 脚本上下文, 引用知识资料
 * @keyword-en script-context, knowledge-facts
 */
interface StoreVisitScriptContext {
  topic: DouyinTopicEntity;
  motherTitle: string;
  knowledge: string;
  knowledgeCount: number;
  store: DouyinStoreVisitStoreEntity | null;
  storeName: string;
  storeText: string;
  facts: string;
}

/**
 * @description 从模型输出里取出 JSON 对象：去掉代码块围栏，截取第一个「{」到最后一个「}」，解析失败返回空对象。
 * @keyword-cn 读取模型JSON, 容错解析
 * @keyword-en read-model-json, tolerant-parse
 * @param {string} text 模型输出。
 * @returns {Record<string, unknown>} 解析出的对象。
 */
export function readStoreVisitJson(text: string): Record<string, unknown> {
  const clean = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  try {
    const value: unknown = JSON.parse(
      start >= 0 && end > start ? clean.slice(start, end + 1) : clean,
    );
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * @description 解析 AI 写的探店脚本 JSON：是否出镜（没写时为 undefined）、原始字段（人物音色推荐用）与最多 8 段「画面 + 台词」，空台词段去掉。
 * @keyword-cn 解析探店脚本, 脚本分段
 * @keyword-en parse-store-visit-script, script-segments
 * @param {string} text 模型输出。
 * @returns {{presenter: boolean|undefined, raw: Record<string, unknown>, segments: StoreVisitScriptSegment[]}} 脚本。
 */
export function parseStoreVisitScript(text: string): {
  presenter: boolean | undefined;
  raw: Record<string, unknown>;
  segments: StoreVisitScriptSegment[];
} {
  const raw = readStoreVisitJson(text);
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((item: unknown) => {
      const record = (item && typeof item === 'object' ? item : {}) as Record<
        string,
        unknown
      >;
      return {
        scene: readStoreVisitText(record.scene)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, DOUYIN_STORE_VISIT_SEGMENT_LIMITS.scene),
        lines: readStoreVisitText(record.lines)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, DOUYIN_STORE_VISIT_SEGMENT_LIMITS.lines),
      };
    })
    .filter((segment) => segment.lines)
    .slice(0, DOUYIN_STORE_VISIT_SEGMENT_LIMITS.count);
  return {
    presenter: typeof raw.presenter === 'boolean' ? raw.presenter : undefined,
    raw,
    segments,
  };
}

/**
 * @description 把脚本分段写成给模型看的文本：「第k段（人物出镜｜画面：…）：台词」。
 * @keyword-cn 脚本分段文本, 分段编号
 * @keyword-en script-segments-text, segment-numbering
 * @param {Array<{scene?: string, lines: string, shot?: string}>} segments 分段。
 * @returns {string} 文本。
 */
export function describeStoreVisitScript(
  segments: Array<{ scene?: string; lines: string; shot?: string }>,
): string {
  return segments
    .map((segment, index) => {
      const tags = [
        segment.shot === 'presenter' ? '人物出镜' : '',
        segment.scene ? `画面：${segment.scene}` : '',
      ].filter(Boolean);
      return `第${index + 1}段${tags.length ? `（${tags.join('｜')}）` : ''}：${segment.lines}`;
    })
    .join('\n');
}

/**
 * @description 按规则核对脚本：引用知识和资料里没有的数字、方言或谐音字眼、用中文数字写的价格、开场段没说出门店名称（知道店名时）、整条太短，写成给用户看的问题。
 * @keyword-cn 脚本规则核对, 编造数字核对
 * @keyword-en script-rule-check, fabricated-number-check
 * @param {{segments: Array<{lines: string}>, facts: string, storeName?: string}} input 分段、资料全文与店名。
 * @returns {string[]} 问题，空数组表示没发现。
 */
export function reviewStoreVisitScriptRules(input: {
  segments: Array<{ lines: string }>;
  facts: string;
  storeName?: string;
}): string[] {
  const text = input.segments.map((segment) => segment.lines).join('\n');
  const issues: string[] = [];
  const unknown = findStoreVisitUnknownNumbers(text, input.facts);
  if (unknown.length)
    issues.push(
      `台词里的「${unknown.join('」「')}」在引用知识和门店资料里找不到，请核对价格和份量`,
    );
  const hard = findStoreVisitHardToVoiceWords(text, input.facts);
  if (hard.length)
    issues.push(
      `台词里的「${hard.join('」「')}」是方言或谐音字，配音可能念不准，改成普通话说法`,
    );
  if (
    /[一二两三四五六七八九十百千万]*[十百千万][一二两三四五六七八九十百千万]*\s*(?:元|块)/.test(
      text,
    )
  )
    issues.push('台词里有用中文数字写的价格，改成阿拉伯数字');
  const storeName = String(input.storeName ?? '').trim();
  if (storeName && !String(input.segments[0]?.lines ?? '').includes(storeName))
    issues.push(`第 1 段没有说出门店名称「${storeName}」`);
  // 约 4.5 字一秒，不到 90 字（约 20 秒）偏短
  const characters = Array.from(text.replace(/\s+/g, '')).length;
  if (characters < STORE_VISIT_LINES_MIN_CHARACTERS)
    issues.push(
      `台词总共只有约 ${Math.max(1, Math.round(characters / 4.5))} 秒，偏短，可以在引用知识里补充套餐内容、玩法和适合谁再重写`,
    );
  return issues;
}

/**
 * @description 解析 AI 对照引用知识的自检结果 `{"issues":[{"segment":k,"problem":""}]}`：段号超出范围的去掉，整条的问题（段号 0）不带段号，最多 8 条。
 * @keyword-cn 解析脚本自检, 自检问题
 * @keyword-en parse-script-review, review-issues
 * @param {string} text 模型输出。
 * @param {number} count 脚本段数。
 * @returns {string[]} 问题。
 */
export function parseStoreVisitReviewIssues(
  text: string,
  count: number,
): string[] {
  const raw = readStoreVisitJson(text);
  return (Array.isArray(raw.issues) ? raw.issues : [])
    .map((item: unknown) => {
      const record = (item && typeof item === 'object' ? item : {}) as Record<
        string,
        unknown
      >;
      const segment = Math.round(Number(record.segment) || 0);
      const problem = readStoreVisitText(record.problem)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (!problem || segment < 0 || segment > count) return '';
      return segment ? `第 ${segment} 段：${problem}` : problem;
    })
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * @description 整理配场景用的门店点位目录：开场门头点位排前面，每个点位按打分取最多 4 张图（同分保持原顺序，与前端同步成选题素材的规则一致），
 *   没有图的点位带第一段实拍视频，什么都没有的点位去掉。
 * @keyword-cn 整理配场景目录, 开场点位优先
 * @keyword-en build-scene-catalog, opening-spot-first
 * @param {DouyinStoreVisitSpot[]} spots 门店点位。
 * @returns {StoreVisitSpotCatalogEntry[]} 目录。
 */
export function buildStoreVisitSceneCatalog(
  spots: DouyinStoreVisitSpot[],
): StoreVisitSpotCatalogEntry[] {
  return [
    ...spots.filter((spot) => spot.opening),
    ...spots.filter((spot) => !spot.opening),
  ]
    .map((spot) => {
      const images = spot.images
        .map((image, order) => ({ image, order }))
        .sort((a, b) => b.image.score - a.image.score || a.order - b.order)
        .slice(0, STORE_VISIT_SCENE_IMAGES_PER_SPOT)
        .map(({ image }) => ({
          imageId: image.imageId,
          description: image.description,
          score: image.score,
        }));
      return {
        spot,
        images,
        videoIds: images.length
          ? []
          : spot.videos.slice(0, 1).map((video) => video.videoId),
      };
    })
    .filter((entry) => entry.images.length || entry.videoIds.length)
    .map((entry, index) => ({ index: index + 1, ...entry }));
}

/**
 * @description 把点位目录写成给模型看的资料：点位名、开场标记、说明，每张图的编号、打分与描述，实拍视频说明。
 * @keyword-cn 点位目录文本, 图片编号打分
 * @keyword-en spot-catalog-text, image-number-score
 * @param {StoreVisitSpotCatalogEntry[]} catalog 目录。
 * @returns {string} 资料文本。
 */
export function describeStoreVisitSpotCatalog(
  catalog: StoreVisitSpotCatalogEntry[],
): string {
  return catalog
    .map((entry) =>
      [
        `【点位${entry.index}】${entry.spot.name}${entry.spot.opening ? '（开场·门头）' : ''}：${entry.spot.description || '（没写点位说明，只能照图片描述认）'}`,
        ...entry.images.map(
          (image, index) =>
            `  图${entry.index}.${index + 1}（${image.score} 分）：${image.description || '没有描述'}`,
        ),
        ...entry.spot.videos
          .filter((video) => entry.videoIds.includes(video.videoId))
          .map((video) => `  实拍视频：${video.description || video.name}`),
      ].join('\n'),
    )
    .join('\n');
}

/**
 * @description 模型没给出或给错点位时按规则猜一段该配哪个点位：画面或台词里提到点位名的（取名字最长的），否则第 1 段用开场门头，其余段在非门头点位里轮换。
 * @keyword-cn 猜测分段点位, 配场景兜底
 * @keyword-en guess-segment-spot, scene-fallback
 * @param {{scene?: string, lines: string}} segment 分段。
 * @param {StoreVisitSpotCatalogEntry[]} catalog 点位目录。
 * @param {number} order 段序号（从 0 开始）。
 * @returns {StoreVisitSpotCatalogEntry} 点位。
 */
export function guessStoreVisitSceneSpot(
  segment: { scene?: string; lines: string },
  catalog: StoreVisitSpotCatalogEntry[],
  order: number,
): StoreVisitSpotCatalogEntry {
  const text = `${segment.scene ?? ''}${segment.lines}`;
  const named = catalog
    .filter((entry) => entry.spot.name && text.includes(entry.spot.name))
    .sort((a, b) => b.spot.name.length - a.spot.name.length)[0];
  if (named) return named;
  if (order === 0) return catalog[0];
  const rest = catalog.filter((entry) => !entry.spot.opening);
  const pool = rest.length ? rest : catalog;
  return pool[(order - 1) % pool.length];
}

/**
 * @description 解析 AI 按脚本配的场景 `{"segments":[{"segment":k,"spot":m,"images":["m.a"]}]}`：图片只认所选点位自己的编号（最多 3 张，人物出镜段 1 张），
 *   人物出镜段必须配有图的点位（没给时用开场门头）；没给或给错时按规则猜点位、按打分轮换挑图；只有实拍视频的点位用它的视频。
 * @keyword-cn 解析配场景结果, 每段挑图
 * @keyword-en parse-scene-matches, per-segment-images
 * @param {string} text 模型输出（失败时传空串，全部走兜底）。
 * @param {StoreVisitSpotCatalogEntry[]} catalog 点位目录。
 * @param {Array<{id: string, lines: string, scene?: string, shot?: string}>} segments 已保存的脚本分段。
 * @returns {Array<{id: string, spotId: string, sceneImageId?: number, sceneImageIds?: number[], sceneVideoId?: number}>} 每段的点位与参考素材。
 */
export function parseStoreVisitSceneMatches(
  text: string,
  catalog: StoreVisitSpotCatalogEntry[],
  segments: Array<{ id: string; lines: string; scene?: string; shot?: string }>,
): Array<{
  id: string;
  spotId: string;
  sceneImageId?: number;
  sceneImageIds?: number[];
  sceneVideoId?: number;
}> {
  const raw = readStoreVisitJson(text);
  const picks = new Map<number, { spot: number; images: string[] }>();
  for (const item of Array.isArray(raw.segments) ? raw.segments : []) {
    const record = (item && typeof item === 'object' ? item : {}) as Record<
      string,
      unknown
    >;
    const order = Number(record.segment);
    if (Number.isInteger(order) && order > 0 && !picks.has(order))
      picks.set(order, {
        spot: Number(record.spot),
        images: (Array.isArray(record.images) ? record.images : []).map(
          (code: unknown) => readStoreVisitText(code),
        ),
      });
  }
  const withImages = catalog.filter((entry) => entry.images.length);
  const opening =
    withImages.find((entry) => entry.spot.opening) ?? withImages[0];
  const used = new Map<number, number>();
  return segments.map((segment, order) => {
    const presenter = segment.shot === 'presenter';
    const pick = picks.get(order + 1);
    const picked = pick
      ? catalog.find((entry) => entry.index === pick.spot)
      : undefined;
    const entry = presenter
      ? ((picked?.images.length ? picked : undefined) ?? opening ?? catalog[0])
      : (picked ?? guessStoreVisitSceneSpot(segment, catalog, order));
    if (!entry.images.length)
      return {
        id: segment.id,
        spotId: entry.spot.id,
        sceneVideoId: entry.videoIds[0],
      };
    const limit = presenter ? 1 : 3;
    const chosen =
      pick && picked === entry
        ? [
            ...new Set(
              pick.images
                .map((code) => code.match(/(\d+)\s*\.\s*(\d+)/))
                .filter((match) => match && Number(match[1]) === entry.index)
                .map((match) => entry.images[Number(match![2]) - 1]?.imageId)
                .filter((imageId): imageId is number => Boolean(imageId)),
            ),
          ].slice(0, limit)
        : [];
    const times = used.get(entry.index) ?? 0;
    used.set(entry.index, times + 1);
    const shift = times % entry.images.length;
    const fallback = [
      ...entry.images.slice(shift),
      ...entry.images.slice(0, shift),
    ]
      .slice(0, presenter ? 1 : Math.min(2, entry.images.length))
      .map((image) => image.imageId);
    const imageIds = chosen.length ? chosen : fallback;
    return {
      id: segment.id,
      spotId: entry.spot.id,
      sceneImageId: imageIds[0],
      ...(imageIds.length > 1 ? { sceneImageIds: imageIds } : {}),
    };
  });
}

/**
 * @description 校验模型的人物与音色推荐：人物只认候选里的（要出镜时必须有形象图），音色只认音色库里的；不合规时按人物性别或「活力种草」兜底，
 *   声音描述优先用人物设定的音色。
 * @keyword-cn 校验编排推荐, 推荐兜底
 * @keyword-en validate-plan-recommendation, recommendation-fallback
 * @param {Record<string, unknown>} raw 模型输出的 JSON。
 * @param {{personas: DouyinPersonaView[], voices: readonly CosyVoicePresetVoice[], presenter: boolean}} context 候选人物、音色库与是否出镜。
 * @returns {{persona: {personaId: number, name: string, reason: string}|null, voice: {voiceId: string, voiceName: string, reason: string, voicePrompt: string}}} 推荐。
 */
export function pickStoreVisitRecommendation(
  raw: Record<string, unknown>,
  context: {
    personas: DouyinPersonaView[];
    voices: readonly CosyVoicePresetVoice[];
    presenter: boolean;
  },
): {
  persona: { personaId: number; name: string; reason: string } | null;
  voice: {
    voiceId: string;
    voiceName: string;
    reason: string;
    voicePrompt: string;
  };
} {
  const persona = context.presenter
    ? context.personas.find((item) => item.id === Number(raw.personaId)) ||
      context.personas[0]
    : undefined;
  const gender =
    persona?.voice.gender === 'male' || persona?.voice.gender === 'female'
      ? persona.voice.gender
      : undefined;
  const voice =
    context.voices.find(
      (item) => item.voiceId === readStoreVisitText(raw.voiceId),
    ) ||
    context.voices.find(
      (item) =>
        item.category === 'lively' && (!gender || item.gender === gender),
    ) ||
    context.voices[0];
  const reason = (value: unknown, fallback: string) =>
    readStoreVisitText(value).trim().slice(0, 80) || fallback;
  const presetPrompt = `${voice.gender === 'male' ? '男声' : '女声'}，${voice.trait}${voice.dialect ? `，${voice.dialect}` : ''}，自然口语，像博主带朋友逛店`;
  return {
    persona: persona
      ? {
          personaId: persona.id,
          name: persona.name,
          reason: reason(raw.personaReason, '人设和这家店的调性最搭'),
        }
      : null,
    voice: {
      voiceId: voice.voiceId,
      voiceName: voice.voiceName,
      reason: reason(raw.voiceReason, '适合探店种草的口播'),
      voicePrompt: (persona
        ? `${describePersonaVoice(persona.voice)}，自然口语，像博主带朋友逛店`
        : readStoreVisitText(raw.voicePrompt).trim() || presetPrompt
      ).slice(0, 300),
    },
  };
}

/**
 * @description 候选出镜人物写成给模型看的清单（id、名称、简介与声线，最多 20 个）。
 * @keyword-cn 候选人物清单, 人物声线
 * @keyword-en persona-candidates-text, persona-voice
 * @param {DouyinPersonaView[]} personas 有形象图的预设人物。
 * @returns {string} 清单文本。
 */
export function describeStoreVisitPersonaCandidates(
  personas: DouyinPersonaView[],
): string {
  return `候选出镜人物：\n${
    personas
      .slice(0, 20)
      .map(
        (persona) =>
          `- id=${persona.id}｜${persona.name}｜${persona.summary || ''}｜声线：${describePersonaVoice(persona.voice)}`,
      )
      .join('\n') || '（没有）'
  }`;
}

/**
 * @description 音色库写成给模型看的清单（voiceId、名称、男女声、特点、风格分类与方言）。
 * @keyword-cn 音色库清单, 音色分类
 * @keyword-en voice-library-text, voice-category
 * @returns {string} 清单文本。
 */
export function describeStoreVisitVoiceLibrary(): string {
  return `音色库：\n${COSYVOICE_PRESET_VOICES.map(
    (voice) =>
      `- voiceId=${voice.voiceId}｜${voice.voiceName}｜${voice.gender === 'male' ? '男声' : '女声'}｜${voice.trait}｜${COSYVOICE_PRESET_CATEGORIES.find((item) => item.key === voice.category)?.label || ''}${voice.dialect ? `｜${voice.dialect}` : ''}`,
  ).join('\n')}`;
}

/**
 * @description 探店脚本先行：先看母选题的引用知识写独立创作脚本，确认后根据保存的正文生成分段画面和台词，同时定下要不要出镜、谁出镜、用什么音色；
 *   写完对照引用知识自检，只列出问题交给用户，用户点「按自检意见改」才带着问题重写。脚本定好后再按脚本从门店图库给每段配实拍图。
 *   结果都只返回、不落库，由前端应用并保存。
 * @keyword-cn 探店脚本先行, 引用知识自检, 按脚本配场景
 * @keyword-en store-visit-script-first, knowledge-review, script-scene-match
 */
@Injectable()
export class DouyinStoreVisitPlannerService {
  private readonly logger = new Logger(DouyinStoreVisitPlannerService.name);

  /**
   * @description 注入选题、门店点位、预设人物、引用知识与模型依赖。
   * @keyword-cn 初始化编排服务, 编排依赖
   * @keyword-en init-planner-service, planner-dependencies
   */
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly spots: DouyinStoreVisitSpotService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly workflowModels: WorkflowModelService,
    private readonly agentService: AgentService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /**
   * @description 门店未确定时先按引用知识询问用户确认，确定后写独立创作脚本正文及人物音色建议，台词由下一步单独生成。
   * @keyword-cn AI写探店脚本, 按自检意见改
   * @keyword-en write-store-visit-script, revise-by-review
   */
  async writeScript(
    topicId: number,
    input: { prompt?: string; keepCast?: boolean; issues?: string[] },
    scope: DouyinScope,
  ) {
    const context = await this.loadScriptContext(topicId, scope);
    if (!context.store) {
      return {
        needsStore: true as const,
        storeQuestion: await this.askStore(context, input.prompt, scope),
      };
    }
    const keepCast = Boolean(input.keepCast || input.issues?.length);
    const candidates = keepCast
      ? []
      : (await this.personas.list(scope)).filter((item) =>
          item.referenceImages?.some(
            (image) => Number(image.imageId) > 0 && image.url,
          ),
        );
    const presenterNow = STORE_VISIT_PRESENTER_TEMPLATES.includes(
      context.topic.storeVisit?.template ?? '',
    );
    const persona =
      keepCast && context.topic.personaId
        ? await this.personas.get(context.topic.personaId, scope)
        : null;
    const style =
      context.topic.scriptStyle &&
      context.topic.scriptStyle in DOUYIN_SCRIPT_STYLES
        ? DOUYIN_SCRIPT_STYLES[context.topic.scriptStyle]
        : undefined;
    const system = [
      '你是抖音探店短视频编导。先读【引用知识】，写出一份有具体内容、可编辑的创作脚本正文，后续才根据它生成台词。',
      '【引用知识】事实、必须提到的内容、禁用词和写法要求以引用知识为准；没有的事实不能编造，资料不足时标注待补充。',
      '【正文】按主题与切入角度、开场、中段卖点、结尾组织；每部分写清叙事目的、具体介绍什么、卖点依据、实拍画面和人物安排。正文约 300～1200 字，整片计划 20～45 秒。不能只给标题、空泛大纲或台词列表，不输出 segments。',
      '脚本是编导方案，不是口播台词，不要把正文写成可以直接朗读的对白。画面只安排资料中实际有、拍得到的内容。',
      STORE_VISIT_SELLING_POINT_RULE,
      style ? `整体调性保持「${style.label}」：${style.tone}。` : '',
      keepCast
        ? '沿用当前出镜方式、人物和音色，只修改脚本正文。'
        : '同时决定 presenter 是否开头出镜，personaId 只能选候选中有形象图的人物，无候选则不出镜。voiceId 从音色库选，voicePrompt 写年龄、男女声、音色和语速，personaReason、voiceReason 简述理由。',
      keepCast
        ? '只输出 JSON：{"script":"完整脚本正文，分段用换行"}'
        : '只输出 JSON：{"script":"完整脚本正文，分段用换行","presenter":true,"personaId":数字或null,"personaReason":"","voiceId":"","voiceReason":"","voicePrompt":""}',
    ].join('\n');
    const user = [
      `选题：${context.topic.title}；母选题：${context.motherTitle}`,
      context.knowledge || '母选题没有引用知识，只使用已有资料。',
      context.storeText,
      input.prompt
        ? `补充要求：${String(input.prompt).trim().slice(0, 500)}`
        : '',
      keepCast
        ? `当前出镜方式：${presenterNow ? '开头人物出镜' : '视频不露脸'}`
        : describeStoreVisitPersonaCandidates(candidates),
      keepCast ? '' : describeStoreVisitVoiceLibrary(),
      keepCast ? buildPersonaScriptBrief(persona) : '',
      keepCast && context.topic.storeVisit?.voicePrompt
        ? `当前声音描述：${context.topic.storeVisit.voicePrompt}`
        : '',
      context.topic.storeVisit?.script
        ? `上一版脚本：\n${context.topic.storeVisit.script}`
        : '',
      input.issues?.length
        ? `自检发现的问题（逐条改掉，其他内容尽量保留）：\n${input.issues
            .slice(0, 20)
            .map((issue) => '- ' + String(issue).slice(0, 300))
            .join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    let raw = readStoreVisitJson(
      await this.ask(
        scope,
        'douyin-workbench.store-visit-script',
        system,
        user,
        0.4,
      ),
    );
    let script =
      typeof raw.script === 'string' ? raw.script.trim().slice(0, 8000) : '';
    if (script.length < 40) {
      raw = readStoreVisitJson(
        await this.ask(
          scope,
          'douyin-workbench.store-visit-script',
          system,
          user +
            '\n格式不对：必须返回 script 字符串，写出具体完整的创作脚本，不要返回 segments 或只有标题。',
          0.4,
        ),
      );
      script =
        typeof raw.script === 'string' ? raw.script.trim().slice(0, 8000) : '';
    }
    if (script.length < 40)
      throw new BadRequestException('AI 没写出具体脚本内容，请重试');
    const review = await this.reviewBody(context, script, scope);
    const presenter = keepCast
      ? presenterNow
      : raw.presenter === true && candidates.length > 0;
    const cast = keepCast
      ? {}
      : pickStoreVisitRecommendation(raw, {
          personas: candidates,
          voices: COSYVOICE_PRESET_VOICES,
          presenter,
        });
    return { script, presenter, ...cast, review };
  }

  /**
   * @description 门店未确定时，按引用知识和已有门店提出确认问题；只给建议，不自动选店或创建门店，模型失败回退到明确询问。
   * @keyword-cn AI询问门店, 门店确认建议
   * @keyword-en ask-store-identity, store-confirmation-suggestion
   */
  private async askStore(
    context: StoreVisitScriptContext,
    prompt: string | undefined,
    scope: DouyinScope,
  ) {
    const stores = await this.spots.listStores(scope);
    let raw: Record<string, unknown> = {};
    try {
      raw = readStoreVisitJson(
        await this.ask(
          scope,
          'douyin-workbench.store-visit-store-question',
          '你是探店视频编导，写脚本前必须先向用户确认拍哪家店。结合选题、引用知识和已有门店，提出一个简短明确的问题。能确定候选时问“这条视频是拍……吗？”，有多家或资料不明时问用户店名及分店，不得擅自确定、不编门店。已有门店只可使用清单中的 storeId；新店 storeId 填 null。description 只摘录资料中属于该店的事实，不确定留空。只输出 JSON：{"question":"给用户的确认问题","storeId":数字或null,"name":"候选门店全名，不确定留空","description":"已有事实，不超过500字"}。',
          [
            `选题：${context.topic.title}；母选题：${context.motherTitle}`,
            context.knowledge,
            context.storeText,
            prompt ? `用户要求：${prompt.slice(0, 500)}` : '',
            `当前租户已有门店：\n${stores.map((store) => `${store.id}：${store.name}`).join('\n')}`,
          ]
            .filter(Boolean)
            .join('\n'),
          0.1,
        ),
      );
    } catch {
      return {
        question:
          '暂时没能识别具体门店。这条视频准备拍哪家店？请填写门店全名，有分店的话也请写清。',
        storeId: null,
        name: '',
        description: '',
      };
    }
    const name =
      typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
    const existing =
      stores.find((store) => Number(store.id) === Number(raw.storeId)) ||
      stores.find((store) => store.name === name);
    return {
      question:
        typeof raw.question === 'string' && raw.question.trim()
          ? raw.question.trim().slice(0, 300)
          : '这条视频准备拍哪家店？请确认门店全名和分店。',
      storeId: existing?.id ?? null,
      name: existing?.name || name,
      description:
        existing?.description ||
        (typeof raw.description === 'string'
          ? raw.description.trim().slice(0, 500)
          : ''),
    };
  }

  /**
   * @description 根据已保存的脚本正文生成分段画面和口播台词，沿用当前人物音色，返回所用脚本快照与台词自检结果。
   *   格式不对重试一次，写完对照引用知识自检，不自动改正文。
   * @keyword-cn 按脚本生成台词, 分段台词生成
   * @keyword-en generate-lines-from-script, script-dialogue
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{prompt?: string}} input 台词补充要求。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 分段画面与台词、所用脚本快照、自检结果。
   */
  async generateLines(
    topicId: number,
    input: { prompt?: string },
    scope: DouyinScope,
  ) {
    const context = await this.loadScriptContext(topicId, scope);
    const { topic } = context;
    const script = topic.storeVisit?.script?.trim();
    if (!script)
      throw new BadRequestException('请先生成或填写脚本正文并保存，再生成台词');
    if (!context.store)
      throw new BadRequestException('请先在脚本步骤确认这条视频拍哪家店');
    const requirement = String(input.prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const presenterNow = STORE_VISIT_PRESENTER_TEMPLATES.includes(
      topic.storeVisit?.template ?? '',
    );
    const persona =
      presenterNow && topic.personaId
        ? await this.personas.get(topic.personaId, scope)
        : null;
    const style =
      topic.scriptStyle && topic.scriptStyle in DOUYIN_SCRIPT_STYLES
        ? DOUYIN_SCRIPT_STYLES[topic.scriptStyle]
        : undefined;
    const personaBrief = buildPersonaScriptBrief(persona);
    const system = [
      '【脚本先行】严格根据用户已确认的【脚本正文】写台词，保留叙事顺序、核心卖点、开场与结尾，不得另起主题。脚本中的编导提示不能念成台词，待补充的事实不能编造。补充要求与脚本冲突时以脚本为准。',
      '你是抖音探店短视频的编导兼撰稿人。先看引用知识和资料，再写一条分段脚本：每段配一个实拍画面、说一句口播台词。像真人博主跟朋友推荐这家店，不是逐个讲解画面的说明视频。',
      context.knowledge
        ? '【引用知识】引用知识是这条视频的依据：店名、项目、价格、套餐等事实以它为准；它规定的写法、必须提到的内容、禁用词和禁止的说法都要遵守，和下面的通用要求冲突时以引用知识为准（安全边界和输出格式除外）。'
        : '【资料】母选题没有引用知识：事实只能用选题和门店资料里的，资料里没有的一律不写。',
      '【结构】',
      `1. 第 1 段开场：先点出已知门店名称，再按脚本说清这是什么店、主打什么好玩或好吃的；不知道店名时不编造。${presenterNow ? '这一段由出镜人物站在门头前对着镜头说，用第一人称。' : ''}`,
      '2. 中间每段讲一个卖点（一个项目、一道菜、一个打卡点或一个套餐），照下面【讲卖点，不念画面】写；内容多的卖点可以分成两段，但不要为了凑长度分段。',
      '3. 资料里写了团购价的，报价要连同对象一起说，例如「这份双人套餐，抖音团购只要 99 元」；报价只是写法之一，不必每段都报，没写价格就不提价格。',
      '4. 最后一段用一句话引导下单，不再加新的事实。',
      '【画面】每段的 scene 写这段要配的实拍画面（6～20 字，例如「门头招牌」「蹦床区全景」「招牌双人套餐」）：只写门店里实际有、拍得到的东西，之后会按它从门店图库里挑实拍图；第 1 段写门头。',
      '【语气】口语、热情、自然，像跟朋友推荐；不用「老铁」「兄弟」「整」这类江湖口吻（预设人物另有要求时按人物来）。段与段之间可以用「再来看看」「还有」衔接，但不编走路、推门之类画面里没有的动作。',
      STORE_VISIT_SELLING_POINT_RULE,
      STORE_VISIT_PLAIN_SPEECH_RULE,
      '【不许编造】店名、项目、价格、份量、人数只写引用知识、选题和门店资料里出现的；不编招牌秘方、获奖排名、限时活动、赠品这类资料里没有的卖点，不写「我刚吃了」「我玩了三局」这类具体的亲身经历；价格、份量、人数一律用阿拉伯数字，且和资料里一模一样。',
      '【长度】整条约 20～45 秒（90～200 字），短而有料；共 3～8 段，每段台词 15～40 个字；台词里不写镜头号、动作提示、括号说明、标题或 Markdown。',
      presenterNow
        ? personaBrief
          ? `开头由固定的预设人物出镜，台词必须是这个人物的第一人称、语气一致：\n${personaBrief}`
          : '开头有人出镜打招呼，全程用第一人称。'
        : '视频不露脸、全程画外音，用统一的第一人称讲。',
      style ? `整体调性保持「${style.label}」：${style.tone}。` : '',
      '【示例】只示范写法和节奏，内容必须换成本店的，不要照抄示例里的店名、项目和价格：',
      '{"segments":[{"scene":"门头招牌","lines":"今天我们来到了 XX 乐园，一家室内亲子乐园，蹦床、滑梯、海洋球一次玩个够。"},{"scene":"蹦床区全景","lines":"蹦床区怎么蹦都不怕摔，小朋友能玩一下午，大人跟着蹦也特别解压。"},{"scene":"咖啡休息区","lines":"玩累了去咖啡区坐坐，大人喝杯咖啡歇歇脚，孩子就在眼前玩。"},{"scene":"门头招牌","lines":"单人票抖音团购 59 元，周末遛娃就来这儿，点左下角就能下单。"}]}',
      '只输出 JSON，不要解释：{"segments":[{"scene":"","lines":""}]}',
    ]
      .filter(Boolean)
      .join('\n');
    const user = [
      `选题：${topic.title}`,
      context.motherTitle && context.motherTitle !== topic.title
        ? `母选题：${context.motherTitle}`
        : '',
      context.knowledge || '（母选题没有引用知识）',
      context.storeText,
      `【脚本正文】\n${script}\n【脚本正文结束】`,
      requirement ? `补充要求：<requirement>${requirement}</requirement>` : '',
      '请输出 JSON 格式的分段脚本。',
    ]
      .filter(Boolean)
      .join('\n');
    let text = await this.ask(
      scope,
      'douyin-workbench.store-visit-script-lines',
      system,
      user,
      0.4,
    );
    let draft = parseStoreVisitScript(text);
    if (
      draft.segments.length < 3 ||
      draft.segments.some((segment) => !segment.scene)
    ) {
      text = await this.ask(
        scope,
        'douyin-workbench.store-visit-script-lines',
        system,
        [
          user,
          `上一次的输出：\n${text.slice(0, 2000)}`,
          '格式不对：必须只输出上面要求的 JSON，segments 有 3～8 段，每段都要有非空的 scene 和 lines。',
        ].join('\n'),
        0.4,
      );
      draft = parseStoreVisitScript(text);
    }
    if (
      draft.segments.length < 3 ||
      draft.segments.some((segment) => !segment.scene)
    )
      throw new BadRequestException('AI 没按脚本写出完整分段台词，请重试');
    const review = await this.reviewSegments(context, draft.segments, scope);
    return {
      presenter: presenterNow,
      segments: draft.segments,
      linesScript: script,
      review,
    };
  }

  /**
   * @description 对照引用知识自检已保存的脚本（用户手改后重新自检用），只列出问题不改。
   * @keyword-cn 自检探店脚本, 对照引用知识
   * @keyword-en review-store-visit-script, knowledge-check
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<StoreVisitScriptReview>} 自检结果。
   */
  async reviewScript(
    topicId: number,
    scope: DouyinScope,
  ): Promise<StoreVisitScriptReview> {
    const context = await this.loadScriptContext(topicId, scope);
    const script = context.topic.storeVisit?.script?.trim();
    if (script) return await this.reviewBody(context, script, scope);
    const segments = (context.topic.storeVisit?.segments ?? []).filter(
      (segment) => segment.lines?.trim(),
    );
    if (!segments.length) throw new BadRequestException('先写好脚本再自检');
    return await this.reviewSegments(context, segments, scope);
  }

  /**
   * @description 按脚本给每段配门店场景图库里的实拍图：模型看每段的画面与台词，从门店全部点位里挑一个点位和它的 1～3 张图（人物出镜段用门头 1 张）；
   *   模型失败或漏段时按规则兜底，不阻断。只返回每段的点位与参考素材，前端据此同步选题素材并保存。
   * @keyword-cn 按脚本配场景, 门店图库挑图
   * @keyword-en match-scenes-by-script, store-gallery-pick
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 每段的点位与参考图（或实拍视频）。
   */
  async matchScenes(topicId: number, scope: DouyinScope) {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    const storeId = Number(topic.storeVisit?.storeId);
    if (
      (topic.storeVisit?.script || topic.storeVisit?.linesScript) &&
      topic.storeVisit.linesScript !== (topic.storeVisit.script || '').trim()
    )
      throw new BadRequestException('脚本已修改，请先根据当前脚本重新生成台词');
    if (!storeId) throw new BadRequestException('先选好门店');
    const store = await this.spots.requireStore(storeId, scope);
    const segments = (topic.storeVisit?.segments ?? []).filter((segment) =>
      segment.lines?.trim(),
    );
    if (!segments.length)
      throw new BadRequestException('先在「脚本」步骤写好脚本');
    const catalog = buildStoreVisitSceneCatalog(store.spots);
    if (!catalog.length)
      throw new BadRequestException(
        '这家店的场景图库还没有点位，先上传照片让 AI 归类',
      );
    let text = '';
    try {
      text = await this.ask(
        scope,
        'douyin-workbench.store-visit-scenes',
        [
          '你是探店短视频的剪辑师，按脚本给每段配门店场景图库里的实拍图。只输出 JSON，不要解释。',
          '1. 每段先挑一个最贴合这段「画面」和台词的点位（spot 填点位序号），再从这个点位的图里挑 1～3 张（images 填图编号，如 "2.1"），第一张是主画面；优先高分图，只能用这个点位自己的图。',
          '2. 标了「人物出镜」的段由人物站在门头前说话：用标了「开场·门头」的点位（没有就用最能代表门店的点位），只挑 1 张图。',
          '3. 讲到具体项目、菜品、套餐的段，配那个项目的点位；开场和结尾引导下单的段可以用门头或最有代表性的点位。',
          '4. 相邻两段尽量不用同一张图；同一点位配几段时换不同的图。只有实拍视频、没有图的点位 images 留空。',
          '{"segments":[{"segment":1,"spot":1,"images":["1.1"]}]}',
        ].join('\n'),
        [
          `门店：${store.name}`,
          topic.storeVisit?.script
            ? `创作脚本：\n${topic.storeVisit.script}`
            : '',
          `门店点位（序号即 spot，图k.a 即 images 里的编号）：<spots>\n${describeStoreVisitSpotCatalog(catalog)}\n</spots>`,
          `脚本：\n${describeStoreVisitScript(segments)}`,
          '请输出每段配的点位和图片。',
        ].join('\n'),
        0.2,
      );
    } catch (error) {
      this.logger.warn(
        `[matchScenes] 配场景失败按规则兜底 topic=${topicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      segments: parseStoreVisitSceneMatches(text, catalog, segments),
    };
  }

  /**
   * @description AI 替用户挑人物与音色（脚本页切到出镜或点「让 AI 挑」时用）：要出镜时从有形象图的预设人物里挑最搭这条脚本的一个，再从音色库挑一个音色（选了人物时跟人物性别与气质走），
   *   并写一句可直接用的声音描述（音色库不可用时前端改用它）。模型失败时按规则兜底，不阻断流程。
   * @keyword-cn AI推荐人物音色, 编排推荐
   * @keyword-en ai-recommend-persona-voice, plan-recommendation
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{presenter: boolean}} options 是否有人出镜。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 推荐的人物（不出镜时为 null）与音色。
   */
  async recommend(
    topicId: number,
    options: { presenter: boolean },
    scope: DouyinScope,
  ) {
    const context = await this.loadScriptContext(topicId, scope);
    const personas = (await this.personas.list(scope)).filter(
      (persona) =>
        !options.presenter ||
        persona.referenceImages?.some(
          (image) => Number(image.imageId) > 0 && image.url,
        ),
    );
    const script = (context.topic.storeVisit?.segments ?? []).filter(
      (segment) => segment.lines?.trim(),
    );
    let raw: Record<string, unknown> = {};
    try {
      raw = readStoreVisitJson(
        await this.ask(
          scope,
          'douyin-workbench.store-visit-plan-recommend',
          [
            '你是探店短视频的编导，替用户挑出镜人物和配音音色。只输出 JSON，不要解释。',
            options.presenter
              ? '视频开头有人物站在门头前打招呼：从候选人物里挑一个最搭这家店和这条脚本的（看店的类型、脚本语气和人物的简介、人设与声线）。'
              : '视频不露脸、全程画外音：不用挑人物，personaId 填 null。',
            '再从音色库里挑一个最适合的音色：亲子游乐、潮流打卡偏活力；咖啡甜品、生活方式偏温柔；品牌讲解偏知性；本地老店小吃可以用方言。选了人物时音色的男女要和人物一致。引用知识对人物或声音有要求时照它来。',
            'reason 用 20 字内的大白话说为什么选它；voicePrompt 写一句 30 字内的声音描述（年龄、男女声、音色、语速、说话风格）。',
            '{"personaId":数字或null,"personaReason":"","voiceId":"音色库里的 voiceId","voiceReason":"","voicePrompt":""}',
          ].join('\n'),
          [
            `选题：${context.topic.title}`,
            context.knowledge,
            context.storeText,
            context.topic.storeVisit?.script
              ? `创作脚本：\n${context.topic.storeVisit.script}`
              : script.length
                ? `台词：\n${describeStoreVisitScript(script)}`
                : '',
            options.presenter
              ? describeStoreVisitPersonaCandidates(personas)
              : '',
            describeStoreVisitVoiceLibrary(),
          ]
            .filter(Boolean)
            .join('\n'),
          0.3,
        ),
      );
    } catch (error) {
      this.logger.warn(
        `[recommend] 推荐失败按规则兜底 topic=${topicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const picked = pickStoreVisitRecommendation(raw, {
      personas,
      voices: COSYVOICE_PRESET_VOICES,
      presenter: options.presenter,
    });
    return {
      ...picked,
      ...(options.presenter && !personas.length
        ? {
            personaHint:
              '还没有带形象图的预设人物，请从图库选人物照片或先去人物管理生成形象图',
          }
        : {}),
    };
  }

  /**
   * @description 对照引用知识审核独立创作脚本的事实、叙事和画面安排，不将编导正文当作口播检查；失败时提示重新自检。
   * @keyword-cn 脚本正文自检, 引用知识检查
   * @keyword-en review-script-body, script-fact-check
   */
  private async reviewBody(
    context: StoreVisitScriptContext,
    script: string,
    scope: DouyinScope,
  ): Promise<StoreVisitScriptReview> {
    try {
      const text = await this.ask(
        scope,
        'douyin-workbench.store-visit-script-review',
        '对照【引用知识】和门店资料审核创作脚本正文：核对事实、必须提及的内容、禁用词、画面安排和叙事完整性。正文是编导方案，不是口播台词，不按口播长度或是否逐字说店名判断。只列需要修改的问题，不自动改。输出 JSON：{"issues":[{"segment":0,"problem":"具体问题与修改建议"}]}；没有问题输出 {"issues":[]}。',
        [context.knowledge, context.storeText, `脚本正文：\n${script}`]
          .filter(Boolean)
          .join('\n'),
        0.1,
      );
      if (!Array.isArray(readStoreVisitJson(text).issues))
        throw new Error('自检格式不正确');
      const issues = parseStoreVisitReviewIssues(text, 8);
      return {
        passed: !issues.length,
        knowledgeCount: context.knowledgeCount,
        issues,
      };
    } catch {
      return {
        passed: false,
        knowledgeCount: context.knowledgeCount,
        issues: ['AI 对照引用知识的自检这次没完成，可以点「重新自检」再试'],
      };
    }
  }

  /**
   * @description 自检一版脚本：先按规则核对（编造数字、方言字、中文价格、开场店名、长度），再让模型对照引用知识与门店资料逐段找问题；
   *   模型自检失败时只返回规则问题并提示可重试。只列出问题，不自动改。
   * @keyword-cn 脚本自检, 引用知识核对
   * @keyword-en review-script, knowledge-verification
   * @param {StoreVisitScriptContext} context 脚本上下文。
   * @param {Array<{scene?: string, lines: string, shot?: string}>} segments 要自检的分段。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<StoreVisitScriptReview>} 自检结果。
   */
  private async reviewSegments(
    context: StoreVisitScriptContext,
    segments: Array<{ scene?: string; lines: string; shot?: string }>,
    scope: DouyinScope,
  ): Promise<StoreVisitScriptReview> {
    const issues = reviewStoreVisitScriptRules({
      segments,
      facts: context.facts,
      storeName: context.storeName,
    });
    let checked = true;
    try {
      const text = await this.ask(
        scope,
        'douyin-workbench.store-visit-script-review',
        [
          '你是探店短视频的脚本审核。对照【引用知识】和门店资料逐段检查脚本，只找真正需要改的问题，不挑措辞风格。只输出 JSON，不要解释。',
          '检查：',
          '1. 引用知识里规定的写法、必须提到的内容、禁用词或禁止的说法，脚本有没有违反或漏掉；',
          '2. 店名、项目、价格、份量、人数等事实和引用知识、门店资料对不上，或是资料里没有、编出来的（包括「我刚吃了」这类编的亲身经历）；',
          '3. 开场没说清这是哪家店、什么店，结尾没有引导下单；',
          '4. 违法、虚假承诺、「最好」「第一」这类绝对化用语等平台违规风险。',
          '每个问题写清在第几段（整条的问题 segment 填 0）、哪里不对、怎么改，problem 40 字内。没有问题就输出 {"issues":[]}。',
          '{"issues":[{"segment":1,"problem":""}]}',
        ].join('\n'),
        [
          `选题：${context.topic.title}`,
          context.knowledge ||
            '（母选题没有引用知识，只按门店资料和上面的通用规则检查）',
          context.storeText,
          `脚本：\n${describeStoreVisitScript(segments)}`,
        ]
          .filter(Boolean)
          .join('\n'),
        0.1,
      );
      issues.push(...parseStoreVisitReviewIssues(text, segments.length));
    } catch (error) {
      checked = false;
      issues.push('AI 对照引用知识的自检这次没完成，可以点「重新自检」再试');
      this.logger.warn(
        `[review] 脚本自检失败 topic=${context.topic.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const unique = [...new Set(issues)].slice(0, 12);
    return {
      passed: checked && !unique.length,
      knowledgeCount: context.knowledgeCount,
      issues: unique,
    };
  }

  /**
   * @description 读取写脚本与自检的上下文：子选题、母选题的引用知识（按引用拼成提示词段落），选过门店时带门店名称、整体说明与点位清单，
   *   旧选题没门店 ID 时用它记下的门店名与说明；资料全文用来核对台词里的数字。
   * @keyword-cn 读取脚本上下文, 母选题引用知识
   * @keyword-en load-script-context, mother-knowledge
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<StoreVisitScriptContext>} 上下文。
   */
  private async loadScriptContext(
    topicId: number,
    scope: DouyinScope,
  ): Promise<StoreVisitScriptContext> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    const mother = topic.parentId
      ? await this.repository.get(topic.parentId, scope)
      : null;
    const knowledgeIds = mother?.knowledgeIds ?? [];
    const knowledge = await this.knowledge.buildPromptSection(
      knowledgeIds,
      scope,
    );
    const storeId = Number(topic.storeVisit?.storeId);
    let store: DouyinStoreVisitStoreEntity | null = null;
    if (storeId) {
      try {
        store = await this.spots.requireStore(storeId, scope);
      } catch {
        store = null;
      }
    }
    const storeName =
      store?.name || String(topic.storeVisit?.storeName ?? '').trim();
    const storeDescription =
      store?.description ||
      String(topic.storeVisit?.sceneDescription ?? '').trim();
    const storeText = [
      storeName ? `门店名称：<store_name>${storeName}</store_name>` : '',
      storeDescription
        ? `门店整体说明：<store>${storeDescription.slice(0, 2000)}</store>`
        : '',
      store?.spots.length
        ? `门店里的点位（用来知道店里有什么、写画面；说明是照图写的画面描述，不要照着念）：<spots>\n${store.spots
            .map(
              (spot) =>
                `- ${spot.name}${spot.opening ? '（门头）' : ''}：${spot.description || '没写说明'}`,
            )
            .join('\n')}\n</spots>`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      topic,
      motherTitle: mother?.title ?? '',
      knowledge,
      knowledgeCount: knowledge
        ? normalizeKnowledgeIds(knowledgeIds).length
        : 0,
      store,
      storeName,
      storeText,
      facts: [topic.title, mother?.title, knowledge, storeText]
        .filter(Boolean)
        .join('\n'),
    };
  }

  /**
   * @description 用「探店编排推荐」节点（关思考、非流式）问一次模型并取出文本。
   * @keyword-cn 编排模型调用, 读取文本
   * @keyword-en planner-llm-call, read-text
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {string} source 计费来源。
   * @param {string} system 系统提示词。
   * @param {string} user 用户内容。
   * @param {number} temperature 随机性。
   * @returns {Promise<string>} 模型输出。
   */
  private async ask(
    scope: DouyinScope,
    source: string,
    system: string,
    user: string,
    temperature: number,
  ): Promise<string> {
    const result = await this.agentService.runWithMessages({
      callOption: { signal: AbortSignal.timeout(2 * 60 * 1000) },
      config: {
        ...toWorkflowLlmConfig(
          await this.workflowModels.resolveNodeRuntime(
            WORKFLOW_NODES.douyinWorkbench.key,
            WORKFLOW_NODES.douyinWorkbench.storeVisitPlanner,
          ),
        ),
        tenantId: scope.tenantId,
        temperature,
        nonStreaming: true,
        noPostHook: true,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          platformScope: !scope.tenantId,
          source,
        },
        system,
      },
      messages: [{ role: 'user', content: user }],
    });
    const content = (result as { content?: unknown }).content;
    return typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === 'string'
                ? part
                : typeof part === 'object' && part && 'text' in part
                  ? readStoreVisitText((part as { text?: unknown }).text)
                  : '',
            )
            .join('')
        : '';
  }
}
