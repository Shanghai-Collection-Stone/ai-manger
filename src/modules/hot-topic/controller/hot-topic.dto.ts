import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  HOT_TOPIC_CATEGORIES,
  type HotTopicCategory,
} from '../entities/hot-topic.entity.js';

/**
 * @description 校验榜单条目字段的取值路径，标题路径必填。
 * @keyword-cn 字段路径参数, 解析路径校验
 * @keyword-en field-path-dto, parse-path-validation
 */
export class HotTopicRuleFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  heat?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  summary?: string;
}

/**
 * @description 校验新建采集规则请求：名称、榜单地址与标题路径必填，其余按需。
 * @keyword-cn 新建规则参数, 榜单地址校验
 * @keyword-en create-rule-dto, endpoint-validation
 */
export class CreateHotTopicRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsIn(HOT_TOPIC_CATEGORIES)
  category!: HotTopicCategory;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  endpoint!: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  listPath?: string;

  @ValidateNested()
  @Type(() => HotTopicRuleFieldsDto)
  fields!: HotTopicRuleFieldsDto;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  urlTemplate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  defaultTags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * @description 校验更新采集规则请求，全部字段可选，只更新传入的部分。
 * @keyword-cn 更新规则参数, 增量更新
 * @keyword-en update-rule-dto, partial-update
 */
export class UpdateHotTopicRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(HOT_TOPIC_CATEGORIES)
  category?: HotTopicCategory;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  endpoint?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  listPath?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HotTopicRuleFieldsDto)
  fields?: HotTopicRuleFieldsDto;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  urlTemplate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  defaultTags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * @description 校验触发采集请求。`clearPrevious` 不传即按默认 true 处理，也就是默认清除上一轮。
 * @keyword-cn 采集参数, 默认清除历史
 * @keyword-en collect-dto, clear-previous-default
 */
export class CollectHotTopicDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  ruleIds?: number[];

  @IsOptional()
  @IsBoolean()
  clearPrevious?: boolean;

  @IsOptional()
  @IsBoolean()
  autoTag?: boolean;
}

/**
 * @description 校验榜单条目分页查询参数。
 * @keyword-cn 榜单查询参数, 分页过滤
 * @keyword-en item-query-dto, paged-filter
 */
export class HotTopicItemQueryDto {
  @IsOptional()
  @IsIn(HOT_TOPIC_CATEGORIES)
  category?: HotTopicCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ruleId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/**
 * @description 校验按母选题推荐热点的请求，母选题必填。
 * @keyword-cn 推荐参数, 母选题必填
 * @keyword-en recommend-dto, parent-topic-required
 */
export class RecommendHotTopicDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  parentTopic!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  parentTopicBrief?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  ruleIds?: number[];

  @IsOptional()
  @IsIn(HOT_TOPIC_CATEGORIES)
  category?: HotTopicCategory;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

/**
 * @description 校验清空榜单条目请求，可只清指定规则的历史。
 * @keyword-cn 清空榜单参数, 按规则清除
 * @keyword-en clear-items-dto, clear-by-rule
 */
export class ClearHotTopicItemDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  ruleIds?: number[];
}
