import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
 * @description 校验人工新建抖音母选题参数，子选题统一由 LLM 生成入口创建。
 * @keyword-cn 新建抖音母题, 人工母题
 * @keyword-en create-douyin-mother, manual-mother-topic
 */
export class CreateDouyinMotherTopicDto {
  @IsIn(['mother'])
  kind!: 'mother';

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title!: string;
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
