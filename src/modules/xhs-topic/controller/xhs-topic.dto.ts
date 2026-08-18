import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  XhsArticleCanvasBoard,
  XhsArticleCanvasCollage,
  XhsArticleCanvasCollageCell,
  XhsArticleCanvasMaterial,
  XhsTopicKind,
} from '../entities/xhs-topic.entity.js';

/**
 * @description 请求 Agent 生成母选题或子选题候选的参数。
 * @keyword-cn 选题生成参数, 提示词数量
 * @keyword-en topic-generation-dto, prompt-quantity
 */
export class GenerateXhsTopicDto {
  @IsIn(['mother', 'child'])
  kind!: XhsTopicKind;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  parentTopic?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  count?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useSearch?: boolean;
}

/**
 * @description 请求 AI 根据当前母题推荐一条可直接编辑并用于生成子选题的提示词。
 * @keyword-cn 子选题提示词推荐, 母题上下文
 * @keyword-en child-topic-prompt-recommendation, parent-topic-context
 */
export class RecommendXhsTopicPromptDto {
  @IsString()
  @MaxLength(200)
  parentTopic!: string;
}

/**
 * @description 用户确认入库的单条选题标题和题目类型。
 * @keyword-cn 保存选题候选, 题目类型
 * @keyword-en persist-topic-candidate, topic-type
 */
export class PersistXhsTopicCandidateDto {
  @IsString()
  @MaxLength(100)
  title!: string;

  @IsString()
  @MaxLength(30)
  topicType!: string;
}

/**
 * @description 批量保存母选题或指定母题下的子选题。
 * @keyword-cn 批量保存选题, 数据库存储
 * @keyword-en create-topics-dto, database-storage
 */
export class CreateXhsTopicsDto {
  @IsIn(['mother', 'child'])
  kind!: XhsTopicKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceTodoId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PersistXhsTopicCandidateDto)
  candidates!: PersistXhsTopicCandidateDto[];
}

/**
 * @description 批量删除当前用户选题的请求参数，删除母题时级联删除子题。
 * @keyword-cn 批量删除选题, 级联删除
 * @keyword-en delete-topics-dto, cascade-delete
 */
export class DeleteXhsTopicsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
}

/**
 * @description 修改真实选题标题、题目类型或业务状态的请求参数。
 * @keyword-cn 更新真实选题, 选题状态
 * @keyword-en update-persisted-topic, topic-status
 */
export class UpdateXhsTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  topicType?: string;

  @IsOptional()
  @IsIn(['pending', 'draft', 'generated', 'published'])
  status?: 'pending' | 'draft' | 'generated' | 'published';
}

/**
 * @description 请求 Agent 为指定子选题生成真实文章的参数。
 * @keyword-cn 文章生成参数, 文章提示词
 * @keyword-en article-generation-dto, article-prompt
 */
export class GenerateXhsArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useSearch?: boolean;
}

/**
 * @description 校验拼图画布格式里的单个源图格子。
 * @keyword-cn 拼图画布格式, 拼图格子
 * @keyword-en collage-canvas-format, collage-cell
 */
export class XhsArticleCanvasCollageCellDto
  implements XhsArticleCanvasCollageCell
{
  @IsString()
  @MaxLength(2000)
  src!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageId?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  x!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  y!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height!: number;

  @IsOptional()
  @IsIn(['cover', 'contain'])
  objectFit?: 'cover' | 'contain';
}

/**
 * @description 校验拼图图片的画布格式，含画布尺寸与 2-4 个源图格子。
 * @keyword-cn 拼图画布格式, 可换图拼图
 * @keyword-en collage-canvas-format, swappable-collage
 */
export class XhsArticleCanvasCollageDto implements XhsArticleCanvasCollage {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height!: number;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => XhsArticleCanvasCollageCellDto)
  cells!: XhsArticleCanvasCollageCellDto[];
}

/**
 * @description 校验封面中与照片分离、可标记文字已融合的图片素材层。
 * @keyword-cn 可编辑装饰素材, 图层分离
 * @keyword-en editable-decoration-material, separated-layers
 */
export class XhsArticleCanvasMaterialDto implements XhsArticleCanvasMaterial {
  @IsString()
  @MaxLength(100)
  id!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(2000)
  src!: string;

  @IsString()
  @MaxLength(2000)
  materialSrc!: string;

  @Type(() => Number)
  @IsNumber()
  x!: number;

  @Type(() => Number)
  @IsNumber()
  y!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  canvasWidth!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  canvasHeight!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includesText?: boolean;

  @IsOptional()
  @IsObject()
  effect?: Record<string, unknown>;
}

/**
 * @description 校验文章图片对应的灵感画布初始化元数据，包括独立底图、含字素材层、旧版文字和拼图。
 * @keyword-cn 文章画板, 可编辑封面, 图层分离
 * @keyword-en article-canvas-board, editable-cover, separated-layers
 */
export class XhsArticleCanvasBoardDto implements XhsArticleCanvasBoard {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(19)
  imageIndex!: number;

  @IsIn(['cover', 'inner'])
  kind!: 'cover' | 'inner';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseSrc?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => XhsArticleCanvasMaterialDto)
  materials?: XhsArticleCanvasMaterialDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => XhsArticleCanvasCollageDto)
  collage?: XhsArticleCanvasCollageDto;
}

/**
 * @description 修改已生成真实文章内容和真实配图的参数。
 * @keyword-cn 编辑文章参数, 真实配图
 * @keyword-en update-article-dto, persisted-images
 */
export class UpdateXhsArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => XhsArticleCanvasBoardDto)
  canvasBoards?: XhsArticleCanvasBoardDto[];

  @IsOptional()
  @IsIn(['图文', '视频', '直播'])
  contentType?: '图文' | '视频' | '直播';
}
