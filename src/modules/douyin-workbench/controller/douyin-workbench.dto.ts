import { Type } from 'class-transformer';
import {
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
  @MaxLength(50)
  topicType?: string;

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
