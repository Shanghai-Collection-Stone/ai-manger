import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * @description 校验对象键值是否为字符串映射
 * @keyword-en validate string record
 */
@ValidatorConstraint({ name: 'isStringRecord', async: false })
export class IsStringRecordConstraint implements ValidatorConstraintInterface {
  /**
   * @description 执行字符串映射校验
   * @keyword-en validate string record values
   */
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return false;
    for (const [key, desc] of entries) {
      if (!/^[a-zA-Z0-9_]+$/.test(key)) return false;
      if (typeof desc !== 'string') return false;
      if (!desc.trim()) return false;
    }
    return true;
  }
}

/**
 * @description 校验对象是否为普通对象
 * @keyword-en validate plain object
 */
@ValidatorConstraint({ name: 'isPlainObject', async: false })
export class IsPlainObjectConstraint implements ValidatorConstraintInterface {
  /**
   * @description 执行普通对象校验
   * @keyword-en validate plain object value
   */
  validate(value: unknown): boolean {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}

/**
 * @description 校验插入数据支持对象或对象数组
 * @keyword-en validate insert data payload
 */
@ValidatorConstraint({ name: 'isInsertDataPayload', async: false })
export class IsInsertDataPayloadConstraint
  implements ValidatorConstraintInterface
{
  /**
   * @description 执行插入数据结构校验
   * @keyword-en validate insert payload value
   */
  validate(value: unknown): boolean {
    if (Boolean(value) && typeof value === 'object' && !Array.isArray(value)) {
      return true;
    }
    if (!Array.isArray(value)) return false;
    if (value.length === 0 || value.length > 1000) return false;
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return false;
    }
    return true;
  }
}

/**
 * @description 创建Schema请求体
 * @keyword-en create schema dto
 */
export class CreateSchemaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  table!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tableDesc!: string;

  @Validate(IsStringRecordConstraint)
  tableField!: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  dedupeField?: string;
}

/**
 * @description 更新Schema请求体
 * @keyword-en update schema dto
 */
export class UpdateSchemaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  table?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tableDesc?: string;

  @IsOptional()
  @Validate(IsStringRecordConstraint)
  tableField?: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  dedupeField?: string;
}

/**
 * @description 创建租户请求体
 * @keyword-en create tenant dto
 */
export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/**
 * @description 创建API Key请求体
 * @keyword-en create api key dto
 */
export class CreateApiKeyDto {
  @IsMongoId()
  tenantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  expireDays?: number;
}

/**
 * @description 数据插入请求体
 * @keyword-en insert data dto
 */
export class InsertDataDto {
  @IsMongoId()
  schemaId!: string;

  @Validate(IsInsertDataPayloadConstraint)
  data!: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * @description 数据补丁请求体
 * @keyword-en patch data dto
 */
export class PatchDataDto {
  @IsMongoId()
  schemaId!: string;

  @Validate(IsInsertDataPayloadConstraint)
  data!: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * @description 查询列表请求体
 * @keyword-en list data dto
 */
export class ListDataDto {
  @IsMongoId()
  schemaId!: string;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  projection?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sort?: Record<string, 1 | -1>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;
}

/**
 * @description 查询单条请求体
 * @keyword-en find one data dto
 */
export class FindOneDataDto {
  @IsMongoId()
  schemaId!: string;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  projection?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sort?: Record<string, 1 | -1>;
}

/**
 * @description 更新单条请求体
 * @keyword-en update one data dto
 */
export class UpdateOneDataDto {
  @IsMongoId()
  schemaId!: string;

  @IsObject()
  filter!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;

  @IsObject()
  update!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  upsert?: boolean;
}

/**
 * @description 删除单条请求体
 * @keyword-en delete one data dto
 */
export class DeleteOneDataDto {
  @IsMongoId()
  schemaId!: string;

  @IsObject()
  filter!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  where?: Record<string, unknown>;
}

/**
 * @description 对接订单记录请求项
 * @keyword-en sync order item dto
 */
export class SyncOrderItemDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsDateString()
  orderTime!: string;

  @IsString()
  @IsNotEmpty()
  channelName!: string;

  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsInt()
  @Min(1)
  productQuantity!: number;

  @IsString()
  phone!: string;
}

/**
 * @description 对接订单同步请求体
 * @keyword-en sync orders dto
 */
export class SyncOrdersDto {
  @IsString()
  @IsNotEmpty()
  dataType!: string;

  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsDateString()
  timestamp!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @Validate(IsPlainObjectConstraint, { each: true })
  orders!: SyncOrderItemDto[];
}

/**
 * @description 对接订单使用记录请求项
 * @keyword-en sync usage item dto
 */
export class SyncUsageItemDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsDateString()
  usageTime!: string;

  @IsInt()
  @Min(1)
  usageQuantity!: number;
}

/**
 * @description 对接订单使用同步请求体
 * @keyword-en sync usages dto
 */
export class SyncUsagesDto {
  @IsString()
  @IsNotEmpty()
  dataType!: string;

  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsDateString()
  timestamp!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @Validate(IsPlainObjectConstraint, { each: true })
  usages!: SyncUsageItemDto[];
}

/**
 * @description 对接订单退单记录请求项
 * @keyword-en sync refund item dto
 */
export class SyncRefundItemDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsDateString()
  refundTime!: string;

  @IsInt()
  @Min(1)
  refundQuantity!: number;
}

/**
 * @description 对接订单退单同步请求体
 * @keyword-en sync refunds dto
 */
export class SyncRefundsDto {
  @IsString()
  @IsNotEmpty()
  dataType!: string;

  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsDateString()
  timestamp!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @Validate(IsPlainObjectConstraint, { each: true })
  refunds!: SyncRefundItemDto[];
}
