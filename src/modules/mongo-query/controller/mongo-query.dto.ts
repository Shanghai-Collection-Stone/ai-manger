import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * @description Mongo 查询 Join 定义 DTO
 * @keyword-en mongo query join dto
 */
export class MongoQueryJoinDto {
  @IsString()
  from!: string;

  @IsString()
  as!: string;

  @IsString()
  localField!: string;

  @IsString()
  foreignField!: string;

  @IsOptional()
  localFieldIsArray?: boolean;

  @IsOptional()
  unwind?: boolean | { preserveNullAndEmptyArrays?: boolean };

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  projection?: Record<string, 0 | 1>;

  @IsOptional()
  @IsObject()
  sort?: Record<string, 1 | -1>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  tenantField?: string;
}

/**
 * @description Mongo 查询请求 DTO
 * @keyword-en mongo query dto
 */
export class MongoQueryDto {
  @IsString()
  collection!: string;

  @IsIn(['list', 'count'])
  mode!: 'list' | 'count';

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  projection?: Record<string, 0 | 1>;

  @IsOptional()
  @IsObject()
  sort?: Record<string, 1 | -1>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MongoQueryJoinDto)
  joins?: MongoQueryJoinDto[];

  @IsOptional()
  @IsString()
  tenantField?: string;
}

