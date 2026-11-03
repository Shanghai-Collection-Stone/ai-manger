import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MODEL_CONCURRENCY_MAX_LIMIT } from '../entities/model-concurrency.entity.js';

/**
 * @description 校验设置模型并发上限的请求：`limit` 为空（null / 不传）表示清除上限、不再限制。
 * @keyword-cn 设置并发上限参数, 清除上限
 * @keyword-en set-concurrency-limit-dto, clear-limit
 */
export class SetModelConcurrencyLimitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  providerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MODEL_CONCURRENCY_MAX_LIMIT)
  limit?: number | null;
}
