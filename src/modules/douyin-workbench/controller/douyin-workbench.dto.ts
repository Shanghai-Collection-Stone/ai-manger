import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsMongoId,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DOUYIN_FACE_MASK_STYLES,
  DOUYIN_SCRIPT_STYLES,
  DOUYIN_STORE_VISIT_TEMPLATES,
  type DouyinFaceMaskStyle,
  type DouyinStoreVisitTemplate,
} from '../entities/douyin-workbench.entity.js';
import { KNOWLEDGE_REFERENCE_LIMIT } from '../../knowledge/entities/knowledge.entity.js';

/** @type {string[]} 允许的脚本风格键名，取自实体登记表，前后端同源。 */
const SCRIPT_STYLE_KEYS = Object.keys(DOUYIN_SCRIPT_STYLES);

/** @description 续接探店待生成片段，只收真实前段视频与已入图库的尾帧编号。 @keyword-cn 续段生成参数, 尾帧编号 @keyword-en continue-segment-dto, tail-image-id */
export class ContinueDouyinStoreVisitDto {
  @IsInt()
  @Min(1)
  previousVideoId!: number;

  @IsInt()
  @Min(1)
  tailImageId!: number;
}

/** @description 截帧失败的可持久化原因，不接受状态或视频输出字段。 @keyword-cn 续段失败参数, 截帧错误 @keyword-en continuation-failure-dto, frame-extraction-error */
export class FailDouyinStoreVisitContinuationDto {
  @IsString()
  @MaxLength(500)
  error!: string;
}

/**
 * @description 探店台词最长字数（约 3 分钟口播），前端台词框上限与它一致。
 * @keyword-cn 探店台词上限, 台词字数
 * @keyword-en store-visit-lines-limit, lines-length
 */
export const DOUYIN_STORE_VISIT_LINES_MAX = 2000;

/**
 * @description 校验分镜素材引用，只允许真实图库或视频库业务 ID 与地址。
 * @keyword-cn 分镜素材参数, 真实素材引用
 * @keyword-en storyboard-media-dto, persisted-media-reference
 */
export class DouyinMediaReferenceDto {
  @IsIn(['image', 'video'])
  type!: 'image' | 'video';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverUrl?: string;
}

/**
 * @description 校验一段抖音分镜的可编辑字段。
 * @keyword-cn 分镜段落参数, 镜头编辑
 * @keyword-en storyboard-shot-dto, shot-editing
 */
export class DouyinStoryboardShotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(120)
  duration!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  shotType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  visual!: string;

  @IsString()
  @MaxLength(1000)
  narration!: string;

  @IsString()
  @MaxLength(100)
  transition!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinMediaReferenceDto)
  media?: DouyinMediaReferenceDto | null;

  // 卡通换头前的原画面，由服务端写入；前端保存分镜时会原样回传，必须在白名单里
  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinMediaReferenceDto)
  originalMedia?: DouyinMediaReferenceDto | null;

  // 人像处理风格同样由服务端写入、前端原样回传
  @IsOptional()
  @IsIn(DOUYIN_FACE_MASK_STYLES)
  faceMaskStyle?: DouyinFaceMaskStyle | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imagePrompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  videoId?: number;
}

/**
 * @description 校验分镜人像处理的风格参数，缺省为 3D 卡通大头。
 * @keyword-cn 人像处理风格参数
 * @keyword-en mask-shot-faces-dto
 */
export class MaskDouyinShotFacesDto {
  @IsOptional()
  @IsIn(DOUYIN_FACE_MASK_STYLES)
  style?: DouyinFaceMaskStyle;
}

/**
 * @description 校验人工新建抖音母选题参数，子选题统一由 LLM 生成入口创建。
 * @keyword-cn 新建抖音母题, 人工母题
 * @keyword-en create-douyin-mother, manual-mother-topic
 */
export class CreateDouyinMotherTopicDto {
  @IsIn(['mother'])
  kind!: 'mother';

  @IsOptional()
  @IsIn(['storyboard', 'store-visit'])
  productionMode?: 'storyboard' | 'store-visit';

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KNOWLEDGE_REFERENCE_LIMIT)
  @IsMongoId({ each: true })
  knowledgeIds?: string[];
}

/**
 * @description 校验基于母选题和平台 AI 提示生成短视频子选题的可选要求，数量由 LLM 判定。
 * @keyword-cn 生成抖音子题, 平台提示词
 * @keyword-en generate-douyin-children, platform-ai-prompt
 */
export class GenerateDouyinChildrenDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  personaId?: number;

  @IsOptional()
  @IsIn(SCRIPT_STYLE_KEYS)
  scriptStyle?: string;
}

/**
 * @description 校验脚本的分镜配图偏向：AI 生成或图库自找，图库自找可限定最多 20 个标签。
 * @keyword-cn 配图偏向参数, 图库标签限定
 * @keyword-en storyboard-preference-dto, gallery-tag-filter
 */
export class DouyinStoryboardPreferenceDto {
  @IsIn(['generate', 'gallery'])
  imageSource!: 'generate' | 'gallery';

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  galleryTags!: string[];
}

/**
 * @description 校验脚本参考图：只接受真实图库图片，最多 4 张，出图时作为底图候选。
 * @keyword-cn 脚本参考图参数, 底图候选
 * @keyword-en reference-image-dto, base-image-candidate
 */
export class DouyinReferenceImageDto {
  @IsIn(['image'])
  type!: 'image';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverUrl?: string;
}

/**
 * @description 校验探店场景图：图库图片引用，另带这张场景的说明（最多 500 字，与图库备注同上限）与标签（最多 10 个、每个 30 字内）。
 *   旧数据可以没有说明，保存时不拦，生成前由服务端要求补齐。
 * @keyword-cn 探店场景图参数, 场景说明标签
 * @keyword-en store-visit-scene-image-dto, scene-description-tags
 */
export class DouyinStoreVisitSceneImageDto extends DouyinReferenceImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

/**
 * @description 校验视频声音设置：配音 / 仅音乐 / 静音，与配音语言。
 * @keyword-cn 声音设置参数, 配音语言
 * @keyword-en video-audio-dto, voiceover-language
 */
export class DouyinVideoAudioDto {
  @IsIn(['voiceover', 'music', 'mute'])
  mode!: 'voiceover' | 'music' | 'mute';

  @IsIn(['zh-CN', 'yue', 'en'])
  language!: 'zh-CN' | 'yue' | 'en';
}

/**
 * @description 校验脚本发布文案：标题最多 60 字、正文最多 1000 字、话题最多 5 个（单个最多 20 字，允许带井号）。
 * @keyword-cn 发布文案参数, 话题数量限制
 * @keyword-en publish-copy-dto, tag-count-limit
 */
export class DouyinPublishCopyDto {
  @IsString()
  @MaxLength(60)
  title!: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(21, { each: true })
  tags!: string[];
}

/**
 * @description 校验一段探店分段：段 ID、本段台词（最多 1000 字）、对应场景图 ID、画面描述与镜头类型（人物出镜 / 门店空镜）；
 *   人物首帧、成片与配音只由服务端写入。
 * @keyword-cn 探店分段参数, 分段台词
 * @keyword-en store-visit-segment-dto, segment-lines
 */
export class DouyinStoreVisitSegmentDto {
  @IsOptional()
  @IsIn(['presenter', 'broll'])
  shot?: 'presenter' | 'broll';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  id?: string;

  @IsString()
  @MaxLength(1000)
  lines!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sceneImageId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  action?: string;
}

/**
 * @description 校验探店出镜人物（图库图片，传 null 清掉）、出镜模板、场景、场景说明、台词与分段；音色只由克隆和选用接口写入，这里不收。
 * @keyword-cn 探店设置参数, 场景台词
 * @keyword-en store-visit-setting-dto, scene-lines
 */
export class DouyinStoreVisitDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinReferenceImageDto)
  faceImage?: DouyinReferenceImageDto | null;

  @IsOptional()
  @IsIn(DOUYIN_STORE_VISIT_TEMPLATES)
  template?: DouyinStoreVisitTemplate;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => DouyinStoreVisitSceneImageDto)
  sceneImages?: DouyinStoreVisitSceneImageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sceneDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DOUYIN_STORE_VISIT_LINES_MAX)
  lines?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => DouyinStoreVisitSegmentDto)
  segments?: DouyinStoreVisitSegmentDto[];
}

/**
 * @description 校验一条被挑中的候选脚本：`key` 指向任务里的候选，标题 / 正文可在挑选时改写。
 * @keyword-cn 挑选脚本参数, 候选改写
 * @keyword-en script-draft-pick-dto, draft-edit
 */
export class DouyinScriptDraftPickDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  script?: string;

  @ValidateNested()
  @Type(() => DouyinStoryboardPreferenceDto)
  storyboardPreference!: DouyinStoryboardPreferenceDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  personaId?: number;

  @IsOptional()
  @IsIn(SCRIPT_STYLE_KEYS)
  scriptStyle?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => DouyinReferenceImageDto)
  referenceImages?: DouyinReferenceImageDto[];
}

/**
 * @description 校验保存挑中候选脚本的请求，一次 1 至 12 条。
 * @keyword-cn 保存挑选脚本, 批量入库
 * @keyword-en confirm-script-drafts-dto, batch-persist
 */
export class ConfirmDouyinScriptDraftsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => DouyinScriptDraftPickDto)
  items!: DouyinScriptDraftPickDto[];
}

/**
 * @description 校验抖音选题及完整分镜更新参数。
 * @keyword-cn 更新抖音选题, 保存分镜
 * @keyword-en update-douyin-topic, save-storyboard
 */
export class UpdateDouyinTopicDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title?: string;

  // 仅母选题生效：引用知识 ID，传空数组表示不再引用
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KNOWLEDGE_REFERENCE_LIMIT)
  @IsMongoId({ each: true })
  knowledgeIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  script?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  topicType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinStoryboardPreferenceDto)
  storyboardPreference?: DouyinStoryboardPreferenceDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  personaId?: number;

  @IsOptional()
  @IsIn([...SCRIPT_STYLE_KEYS, ''])
  scriptStyle?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => DouyinReferenceImageDto)
  referenceImages?: DouyinReferenceImageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinVideoAudioDto)
  videoAudio?: DouyinVideoAudioDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  fullVideoDuration?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  fullVideoResolution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  shotVideoResolution?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinPublishCopyDto)
  publishCopy?: DouyinPublishCopyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinStoreVisitDto)
  storeVisit?: DouyinStoreVisitDto;

  @IsOptional()
  @IsBoolean()
  autoConcatShots?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DouyinStoryboardShotDto)
  storyboard?: DouyinStoryboardShotDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  generatedVideoId?: number;
}

/**
 * @description 校验脚本 AI 微调请求：要改的正文与一句话修改指令；不落库，改完由前端决定是否保存。
 * @keyword-cn 脚本微调参数, 修改指令
 * @keyword-en refine-script-dto, revision-instruction
 */
export class RefineDouyinScriptDto {
  @IsString()
  @MinLength(20)
  @MaxLength(8000)
  script!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  instruction!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  personaId?: number;

  @IsOptional()
  @IsIn(SCRIPT_STYLE_KEYS)
  scriptStyle?: string;
}

/**
 * @description 校验真实 LLM 分镜生成的补充要求。
 * @keyword-cn 生成分镜参数, 创作要求
 * @keyword-en generate-storyboard-dto, creative-requirement
 */
export class GenerateDouyinStoryboardDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}

/**
 * @description 校验按当前分镜创建真实视频生成任务的附加提示。
 * @keyword-cn 生成视频参数, 分镜合成
 * @keyword-en generate-video-dto, storyboard-rendering
 */
export class GenerateDouyinVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}

/**
 * @description 校验重新生成一段分镜画面的补充描述，为空时按分镜已有的画面与配图提示词出图。
 * @keyword-cn 分镜配图参数, 重新生成画面
 * @keyword-en generate-shot-image-dto, regenerate-shot-frame
 */
export class GenerateDouyinShotImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}

/**
 * @description 校验单段分镜视频生成的补充提示。
 * @keyword-cn 分镜视频参数, 单镜头生成
 * @keyword-en generate-shot-video-dto, single-shot-render
 */
export class GenerateDouyinShotVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}

/**
 * @description 校验客户端准备合成的参数：`auto` 表示「全部出片后自动合成」由客户端领取。
 * @keyword-cn 分镜合成参数, 自动合成领取
 * @keyword-en concat-shot-videos-dto, auto-concat-claim
 */
export class ConcatDouyinShotVideosDto {
  @IsOptional()
  @IsBoolean()
  auto?: boolean;
}

/**
 * @description 校验客户端回报的合成结果：进行中带进度，完成带已登记的视频库 ID，失败带中文原因与原始信息。
 * @keyword-cn 合成结果参数, 客户端回报
 * @keyword-en concat-result-dto, client-report
 */
export class ReportDouyinConcatResultDto {
  @IsIn(['running', 'completed', 'failed'])
  status!: 'running' | 'completed' | 'failed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  videoId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  errorDetail?: string;
}

/**
 * @description 校验 AI 写探店台词的一句话补充要求（如「突出性价比」），为空时按脚本正文改写。
 * @keyword-cn 探店台词参数, 台词补充要求
 * @keyword-en store-visit-lines-dto, lines-requirement
 */
export class GenerateDouyinStoreVisitLinesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;
}

/**
 * @description 校验生成人物首帧的可选补充描述（最多 500 字），如「站在门口指着招牌」。
 * @keyword-cn 人物首帧参数, 首帧补充描述
 * @keyword-en keyframe-dto, keyframe-requirement
 */
export class GenerateDouyinStoreVisitKeyframeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;
}

/**
 * @description 校验选用或试听的音色 ID：系统音色 ID 由服务端按目录再校验一次，克隆音色只允许本脚本自己的。
 * @keyword-cn 音色参数, 选用试听音色
 * @keyword-en store-visit-voice-dto, pick-or-preview-voice
 */
export class DouyinStoreVisitVoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_.-]+$/)
  voiceId!: string;
}

/**
 * @description 校验提示词定制音色：声音描述 5～500 字（百炼声音设计只认中英文描述、最多 500 字），可选一个 30 字内的音色名称。
 * @keyword-cn 提示词定制音色参数, 声音描述
 * @keyword-en design-voice-dto, voice-prompt
 */
export class DesignDouyinStoreVisitVoiceDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  name?: string;
}

/**
 * @description 校验抖音发布任务所需的视频素材和发布文案。
 * @keyword-cn 发布视频参数, 抖音文案
 * @keyword-en publish-video-dto, douyin-caption
 */
export class PublishDouyinVideoDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  videoId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  caption!: string;
}

/**
 * @description 校验针对已发布抖音视频创建抓取任务的输入。
 * @keyword-cn 抓取抖音数据, 视频作品标识
 * @keyword-en crawl-douyin-data, published-video-id
 */
export class CrawlDouyinDataDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  platformVideoId!: string;
}
