import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  FinanceFlow,
  FinancePartyType,
} from '../entities/finance-binding.entity.js';

/**
 * @description Upsert binding 请求体(name 由用户自定义,作用域内唯一;改名传 previousName)
 * @keyword-en upsert finance binding dto
 */
export class UpsertFinanceBindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  previousName?: string;

  @IsOptional()
  @IsIn(['in', 'out'])
  flowDefault?: FinanceFlow;

  @IsOptional()
  @IsIn(['supplier', 'customer', 'employee', 'counterparty'])
  partyTypeDefault?: FinancePartyType;

  /** sources 数组:item 含 type=bitable|approval 等字段;service normalizeSources 强校验 */
  @IsArray()
  @ArrayMinSize(1)
  sources!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}

/**
 * @description Upsert transform DSL 请求体
 * @keyword-en upsert finance transform dto
 */
export class UpsertFinanceTransformDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  previousName?: string;

  @IsObject()
  dsl!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  explanation?: string;
}
