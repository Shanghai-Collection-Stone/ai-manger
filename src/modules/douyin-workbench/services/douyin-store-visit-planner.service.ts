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
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import {
  WorkflowModelService,
  toWorkflowLlmConfig,
} from '../../workflow-model/services/workflow-model.service.js';
import type { DouyinStoreVisitSpot } from '../entities/douyin-store-visit-store.entity.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinStoreVisitSceneImage,
  type DouyinStoreVisitSceneVideo,
} from '../entities/douyin-workbench.entity.js';
import {
  findStoreVisitHardToVoiceWords,
  findStoreVisitUnknownNumbers,
  reviewStoreVisitLines,
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
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 点位写台词用的素材目录：第 k 个点位（按重点推荐顺序）带它在选题里的参考图（按打分排好，编号 k.1、k.2…）与实拍视频。
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
 * @description 按重点推荐顺序整理点位目录：只收选题里已同步的参考图（打分高的在前），点位说明为空时用图片描述补；开场门头点位排第一。
 * @keyword-cn 整理点位目录, 开场点位优先
 * @keyword-en build-spot-catalog, opening-spot-first
 * @param {DouyinStoreVisitSpot[]} spots 门店点位。
 * @param {string[]} spotIds 重点推荐点位 ID（按介绍顺序）。
 * @param {DouyinStoreVisitSceneImage[]} sceneImages 选题里同步好的参考图。
 * @param {DouyinStoreVisitSceneVideo[]} [sceneVideos] 选题里同步好的实拍视频。
 * @returns {StoreVisitSpotCatalogEntry[]} 目录。
 */
export function buildStoreVisitSpotCatalog(
  spots: DouyinStoreVisitSpot[],
  spotIds: string[],
  sceneImages: DouyinStoreVisitSceneImage[],
  sceneVideos: DouyinStoreVisitSceneVideo[] = [],
): StoreVisitSpotCatalogEntry[] {
  const picked = spotIds
    .map((id) => spots.find((spot) => spot.id === id))
    .filter((spot): spot is DouyinStoreVisitSpot => Boolean(spot));
  const ordered = [
    ...picked.filter((spot) => spot.opening),
    ...picked.filter((spot) => !spot.opening),
  ];
  const imageIds = new Set(sceneImages.map((image) => image.id));
  const videoIds = new Set(sceneVideos.map((video) => video.id));
  return ordered
    .map((spot, index) => ({
      index: index + 1,
      spot,
      images: [...spot.images]
        .filter((image) => imageIds.has(image.imageId))
        .sort((a, b) => b.score - a.score)
        .map((image) => ({
          imageId: image.imageId,
          description: image.description,
          score: image.score,
        })),
      videoIds: spot.videos
        .map((video) => video.videoId)
        .filter((id) => videoIds.has(id)),
    }))
    .filter((entry) => entry.images.length || entry.videoIds.length);
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
        `【点位${entry.index}】${entry.spot.name}${entry.spot.opening ? '（开场·门头）' : ''}：${entry.spot.description || '（没写点位说明，只能照图片描述讲）'}`,
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
 * @description 解析按点位写的台词：每段第一行「【点位k｜图k.a,k.b】」，图片只认这个点位的编号（最多 3 张），没写或写错时按打分挑，
 *   同一点位分成几段时主图轮换；只有实拍视频的点位用它的第一段视频。最多 8 段。
 * @keyword-cn 解析点位台词, 每段挑图
 * @keyword-en parse-spot-segments, per-segment-images
 * @param {string} text 模型输出。
 * @param {StoreVisitSpotCatalogEntry[]} catalog 点位目录。
 * @returns {Array<{spotId: string, lines: string, sceneImageId?: number, sceneImageIds?: number[], sceneVideoId?: number}>} 分段。
 */
export function parseStoreVisitSpotSegments(
  text: string,
  catalog: StoreVisitSpotCatalogEntry[],
): Array<{
  spotId: string;
  lines: string;
  sceneImageId?: number;
  sceneImageIds?: number[];
  sceneVideoId?: number;
}> {
  const marker = /^\s*【\s*点位\s*(\d+)\s*(?:[｜|]\s*([^】]*))?】\s*$/gm;
  const matches = [...String(text ?? '').matchAll(marker)];
  const used = new Map<number, number>();
  const segments: ReturnType<typeof parseStoreVisitSpotSegments> = [];
  matches.forEach((match, order) => {
    const entry = catalog.find((item) => item.index === Number(match[1]));
    const end =
      order + 1 < matches.length ? matches[order + 1].index : undefined;
    const lines = String(text)
      .slice((match.index ?? 0) + match[0].length, end)
      .replace(/^\s*【[^】]*】\s*$/gm, '')
      .trim()
      .slice(0, 1000);
    if (!entry || !lines) return;
    if (!entry.images.length) {
      segments.push({
        spotId: entry.spot.id,
        lines,
        sceneVideoId: entry.videoIds[0],
      });
      return;
    }
    const chosen = [
      ...new Set(
        [...String(match[2] ?? '').matchAll(/(\d+)\s*\.\s*(\d+)/g)]
          .filter((item) => Number(item[1]) === entry.index)
          .map((item) => entry.images[Number(item[2]) - 1]?.imageId)
          .filter((imageId): imageId is number => Boolean(imageId)),
      ),
    ].slice(0, 3);
    const times = used.get(entry.index) ?? 0;
    used.set(entry.index, times + 1);
    const fallback = [
      ...entry.images.slice(times % entry.images.length),
      ...entry.images.slice(0, times % entry.images.length),
    ]
      .slice(0, Math.min(2, entry.images.length))
      .map((image) => image.imageId);
    const imageIds = chosen.length ? chosen : fallback;
    segments.push({
      spotId: entry.spot.id,
      lines,
      sceneImageId: imageIds[0],
      ...(imageIds.length > 1 ? { sceneImageIds: imageIds } : {}),
    });
  });
  return segments.slice(0, 8);
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
 * @description 探店 AI 编排：按门店与重点推荐点位先挑出镜人物与音色（用户可再换），再按点位写台词并为每段挑同一点位的 1～3 张参考图；
 *   结果都只返回、不落库，由前端应用并保存。
 * @keyword-cn 探店AI编排, 点位台词
 * @keyword-en store-visit-ai-planner, spot-lines
 */
@Injectable()
export class DouyinStoreVisitPlannerService {
  private readonly logger = new Logger(DouyinStoreVisitPlannerService.name);

  /**
   * @description 注入选题、门店点位、预设人物与模型依赖。
   * @keyword-cn 初始化编排服务, 编排依赖
   * @keyword-en init-planner-service, planner-dependencies
   */
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly spots: DouyinStoreVisitSpotService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly workflowModels: WorkflowModelService,
    private readonly agentService: AgentService,
  ) {}

  /**
   * @description AI 先替用户挑人物与音色：要出镜时从有形象图的预设人物里挑最搭这家店的一个，再从音色库挑一个音色（选了人物时跟人物性别与气质走），
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
    const { topic, store, catalog } = await this.loadContext(topicId, scope);
    const personas = (await this.personas.list(scope)).filter(
      (persona) =>
        !options.presenter ||
        persona.referenceImages?.some(
          (image) => Number(image.imageId) > 0 && image.url,
        ),
    );
    let raw: Record<string, unknown> = {};
    try {
      const text = await this.ask(
        scope,
        'douyin-workbench.store-visit-plan-recommend',
        [
          '你是探店短视频的编导，替用户挑出镜人物和配音音色。只输出 JSON，不要解释。',
          options.presenter
            ? '视频开头有人物站在门头前打招呼：从候选人物里挑一个最搭这家店的（看店的类型、点位和人物的简介、人设与声线）。'
            : '视频不露脸、全程画外音：不用挑人物，personaId 填 null。',
          '再从音色库里挑一个最适合这家店的音色：亲子游乐、潮流打卡偏活力；咖啡甜品、生活方式偏温柔；品牌讲解偏知性；本地老店小吃可以用方言。选了人物时音色的男女要和人物一致。',
          'reason 用 20 字内的大白话说为什么选它；voicePrompt 写一句 30 字内的声音描述（年龄、男女声、音色、语速、说话风格）。',
          '{"personaId":数字或null,"personaReason":"","voiceId":"音色库里的 voiceId","voiceReason":"","voicePrompt":""}',
        ].join('\n'),
        [
          `门店：${store.name}`,
          store.description
            ? `门店说明：${store.description.slice(0, 600)}`
            : '',
          `重点推荐点位：${catalog.map((entry) => `${entry.spot.name}${entry.spot.description ? `（${entry.spot.description.slice(0, 60)}）` : ''}`).join('；')}`,
          options.presenter
            ? `候选人物：\n${
                personas
                  .slice(0, 20)
                  .map(
                    (persona) =>
                      `- id=${persona.id}｜${persona.name}｜${persona.summary || ''}｜声线：${describePersonaVoice(persona.voice)}`,
                  )
                  .join('\n') || '（没有）'
              }`
            : '',
          `音色库：\n${COSYVOICE_PRESET_VOICES.map(
            (voice) =>
              `- voiceId=${voice.voiceId}｜${voice.voiceName}｜${voice.gender === 'male' ? '男声' : '女声'}｜${voice.trait}｜${COSYVOICE_PRESET_CATEGORIES.find((item) => item.key === voice.category)?.label || ''}${voice.dialect ? `｜${voice.dialect}` : ''}`,
          ).join('\n')}`,
          topic.title ? `选题：${topic.title}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        0.3,
      );
      const clean = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      raw = JSON.parse(
        start >= 0 && end > start ? clean.slice(start, end + 1) : clean,
      ) as Record<string, unknown>;
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
   * @description 按重点推荐点位写简短的探店台词（约 20～45 秒，附示例）：开场用门头点位报店名和这是家什么店，之后按用户挑的顺序一段讲一个点位的卖点
   *   （是什么、能干嘛、好玩好吃在哪，不复述图片描述里的画面），结尾引导下单；每段从该点位的参考图里挑 1～3 张（优先高分图）；
   *   店名、项目、价格等事实只用门店、点位与图片描述里的，编了数字或用了方言字时重写一次，仍有问题带核对提醒返回。
   * @keyword-cn 按点位写台词, 每段挑参考图
   * @keyword-en write-spot-lines, pick-segment-images
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string|undefined} prompt 一句话补充要求。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 全文、分段（含点位与参考图）与核对提醒。
   */
  async writeSpotLines(
    topicId: number,
    prompt: string | undefined,
    scope: DouyinScope,
  ) {
    const { topic, store, catalog } = await this.loadContext(topicId, scope);
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const personaBrief = buildPersonaScriptBrief(persona);
    const style =
      topic.scriptStyle && topic.scriptStyle in DOUYIN_SCRIPT_STYLES
        ? DOUYIN_SCRIPT_STYLES[topic.scriptStyle]
        : undefined;
    const requirement = String(prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const presenterOpening = ['opening', 'bookend', 'presenter-all'].includes(
      topic.storeVisit?.template ?? '',
    );
    const catalogText = describeStoreVisitSpotCatalog(catalog);
    const facts = [
      topic.title,
      store.name,
      store.description,
      catalogText,
      requirement,
    ]
      .filter(Boolean)
      .join('\n');
    const system = [
      '你是抖音探店短视频的口播撰稿人。门店给了用户挑好的重点推荐点位（每个点位是一个游乐设备、打卡点、菜品或门头，带几张实拍图的描述），每段台词配一个点位播放。请写一条简短、自然、让人想去的探店画外音口播，像真人博主跟朋友推荐这家店，不是逐个讲解画面的说明视频。',
      '【结构】',
      `1. 第 1 段开场：用标了「开场·门头」的点位（没有时用点位1）。先点出门店名称，例如「今天我们来到了${store.name}」，再用一句话说清这是一家什么店、主打什么好玩或好吃的（可以从所有点位归纳），不描述门头长什么样。${presenterOpening ? '这一段由出镜人物站在门头前对着镜头说，用第一人称。' : ''}`,
      '2. 后面按点位顺序一段讲一个点位，照下面【讲卖点，不念画面】写；内容多的点位可以分成两段、换不同的图，但不要为了凑长度分段。',
      '3. 说明里写了团购价的，报价要连同对象一起说，例如「这份双人套餐，抖音团购只要 99 元」；报价只是写法之一，不必每段都报，没写价格就不提价格。',
      '4. 最后一段用一句话引导下单（可以接在最后一个点位后面，或用开场点位收尾），不再加新的事实。',
      '【配图】每段第一行写「【点位k｜图k.a,k.b】」：k 是点位序号，后面列 1～3 张最能配合这段台词的图（只能用这个点位的图编号，优先高分图；同一点位分几段时尽量换不同的图）。',
      '【语气】口语、热情、自然，像跟朋友推荐；不用「老铁」「兄弟」「整」这类江湖口吻（预设人物另有要求时按人物来）。段与段之间可以用「再来看看」「还有」衔接，但不编走路、推门之类画面里没有的动作。',
      STORE_VISIT_SELLING_POINT_RULE,
      STORE_VISIT_PLAIN_SPEECH_RULE,
      '【不许编造】店名、项目、价格、份量、人数只写门店名称、门店说明、点位说明和图片描述里出现的；不编招牌秘方、获奖排名、限时活动、赠品这类资料里没有的卖点，不写「我刚吃了」「我玩了三局」这类具体的亲身经历；价格、份量、人数一律用阿拉伯数字，且和资料里一模一样。',
      '【长度与格式】整条约 20～45 秒（90～200 字），短而有料；共 3～8 段，每段 15～40 个字；每段第一行只写「【点位k｜图k.a,k.b】」，下一行起写台词；不写镜头号、动作提示、括号说明、标题、Markdown 或任何解释。',
      '【示例】只示范写法和节奏，内容必须换成本店的点位，不要照抄示例里的店名、项目和价格：',
      '【点位1｜图1.1】\n今天我们来到了 XX 乐园，一家室内亲子乐园，蹦床、滑梯、海洋球一次玩个够。\n【点位2｜图2.1,2.2】\n蹦床区怎么蹦都不怕摔，小朋友能玩一下午，大人跟着蹦也特别解压。\n【点位3｜图3.1】\n玩累了去咖啡区坐坐，大人喝杯咖啡歇歇脚，孩子就在眼前玩。\n【点位1｜图1.1】\n单人票抖音团购 59 元，周末遛娃就来这儿，点左下角就能下单。',
      personaBrief
        ? `出镜人是固定的预设人物，台词必须是这个人物的第一人称、语气一致：\n${personaBrief}`
        : '',
      style ? `整体调性保持「${style.label}」：${style.tone}。` : '',
      '只输出台词本身。',
    ]
      .filter(Boolean)
      .join('\n');
    const user = [
      `选题：${topic.title}`,
      `门店名称：<store_name>${store.name}</store_name>`,
      store.description
        ? `门店整体说明：<store>${store.description.slice(0, 2000)}</store>`
        : '',
      `重点推荐点位（序号即【点位k】的 k；点位说明和图片描述写的是画面里有什么，用来认出这是什么和挑图，不要照着念）：<spots>\n${catalogText}\n</spots>`,
      requirement ? `补充要求：<requirement>${requirement}</requirement>` : '',
      '请输出探店台词。',
    ]
      .filter(Boolean)
      .join('\n');
    let text = await this.ask(
      scope,
      'douyin-workbench.store-visit-spot-lines',
      system,
      user,
      0.4,
    );
    let segments = parseStoreVisitSpotSegments(text, catalog);
    const written = segments.map((segment) => segment.lines).join('\n') || text;
    const unknown = findStoreVisitUnknownNumbers(written, facts);
    const hard = findStoreVisitHardToVoiceWords(written, facts);
    if (!segments.length || unknown.length || hard.length) {
      const retried = await this.ask(
        scope,
        'douyin-workbench.store-visit-spot-lines',
        system,
        [
          user,
          `上一版：\n${text}`,
          segments.length
            ? ''
            : '格式不对：每段第一行必须单独写「【点位k｜图k.a,k.b】」。',
          unknown.length
            ? `台词里的「${unknown.join('」「')}」在资料里找不到，不能编造数字。`
            : '',
          hard.length
            ? `台词里的「${hard.join('」「')}」是方言或谐音字，改用普通话常用说法。`
            : '',
          '请按同样的要求重写全部台词。',
        ]
          .filter(Boolean)
          .join('\n'),
        0.4,
      );
      const parsed = parseStoreVisitSpotSegments(retried, catalog);
      if (parsed.length) {
        text = retried;
        segments = parsed;
      }
    }
    if (!segments.length)
      throw new BadRequestException('AI 没写出按点位分段的台词，请重试');
    const warnings = reviewStoreVisitLines({
      segments,
      facts,
      storeName: store.name,
    });
    return {
      lines: segments
        .map((segment) => segment.lines)
        .join('\n')
        .slice(0, 2000),
      segments,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /**
   * @description 读取点位模式选题、门店与重点推荐点位目录，缺门店或点位时提示回到对应步骤。
   * @keyword-cn 读取编排上下文, 点位目录
   * @keyword-en load-planner-context, spot-catalog
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   */
  private async loadContext(topicId: number, scope: DouyinScope) {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    const storeId = Number(topic.storeVisit?.storeId);
    if (!storeId) throw new BadRequestException('先在「门店」步骤选好门店');
    const store = await this.spots.requireStore(storeId, scope);
    const catalog = buildStoreVisitSpotCatalog(
      store.spots,
      topic.storeVisit?.spotIds ?? [],
      topic.storeVisit?.sceneImages ?? [],
      topic.storeVisit?.sceneVideos ?? [],
    );
    if (!catalog.length)
      throw new BadRequestException(
        '先在「推荐点位」步骤选至少一个有图片的点位',
      );
    return { topic, store, catalog };
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
