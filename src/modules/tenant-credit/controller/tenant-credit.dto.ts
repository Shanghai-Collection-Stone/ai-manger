import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';

/**
 * @description Credit 流水倒序分页参数，before 为上一页最后一笔的 createdAt。
 * @keyword-cn 流水分页参数, 时间游标
 * @keyword-en credit-ledger-query-dto, time-cursor
 */
export class CreditLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsDateString()
  before?: string;
}

/**
 * @description 租户额度总览查询参数，超管必须指定租户，租户管理员省略即本租户。
 * @keyword-cn 额度总览查询, 目标租户
 * @keyword-en tenant-credit-overview-query-dto, target-tenant
 */
export class TenantCreditOverviewQueryDto {
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 给成员分配（正数，从待分配额度划出）或回收（负数，退回待分配额度）Credit。
 * @keyword-cn 成员额度分配请求体, 回收额度
 * @keyword-en allocate-member-credit-dto, reclaim-credit
 */
export class AllocateMemberCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}

/**
 * @description 租户额度设置：新成员加入时从待分配额度赠送的 Credit。
 * @keyword-cn 新成员赠送设置, 租户额度设置
 * @keyword-en tenant-credit-settings-dto, new-member-grant
 */
export class UpdateTenantCreditSettingsDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1_000_000_000)
  memberCreditGrant!: number;
}

/**
 * @description 把旧共用租户切到分配模式；migrate 为 true 时原余额给每个成员各一份全额。
 * @keyword-cn 切换分配模式请求体, 旧余额迁移
 * @keyword-en switch-credit-mode-dto, legacy-credit-migration
 */
export class SwitchTenantCreditModeDto {
  @IsBoolean()
  migrate!: boolean;
}

/**
 * @description 个人额度正数充值请求体。
 * @keyword-cn 个人充值请求体, 外部单号
 * @keyword-en personal-recharge-dto, reference-id
 */
export class RechargePersonalCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(1_000_000_000)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;
}

/**
 * @description 个人额度正负人工调账请求体，零变动不允许入账。
 * @keyword-cn 个人调账请求体, 非零变动
 * @keyword-en personal-adjustment-dto, nonzero-change
 */
export class AdjustPersonalCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;
}
