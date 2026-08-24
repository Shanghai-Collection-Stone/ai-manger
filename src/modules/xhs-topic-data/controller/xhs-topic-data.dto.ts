import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * @description 校验分页查询参数，页码与每页条数都有上限，防止一次拉爆明细表。
 * @keyword-cn 分页参数校验, 页码条数
 * @keyword-en pagination-dto, page-size
 */
export class XhsTopicDataPageDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * @description 校验按自然日删除抓取数据的日期参数，只接受 `YYYY-MM-DD`。
 * @keyword-cn 按天删除参数, 日期校验
 * @keyword-en delete-day-dto, date-validation
 */
export class DeleteXhsTopicDayDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'day 必须是 YYYY-MM-DD 格式的自然日',
  })
  day!: string;
}

/**
 * @description 校验舆论分析请求，`force` 为真时跳过缓存重新分析。
 * @keyword-cn 舆论分析参数, 强制刷新
 * @keyword-en opinion-dto, force-refresh
 */
export class XhsTopicOpinionQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  force?: boolean;
}

/**
 * @description 校验取消/恢复抓取的目标状态，只允许两种抓取开关取值。
 * @keyword-cn 抓取状态参数, 取消恢复
 * @keyword-en crawl-status-dto, cancel-resume
 */
export class UpdateXhsCrawlStatusDto {
  @IsString()
  @Matches(/^(crawling|cancelled)$/, {
    message: 'status 只能是 crawling 或 cancelled',
  })
  status!: 'crawling' | 'cancelled';
}

/**
 * @description 校验抓取频率设置，与前端设置面板的分钟档位对齐。
 * @keyword-cn 抓取频率参数, 调度间隔
 * @keyword-en crawl-settings-dto, schedule-interval
 */
export class UpdateXhsCrawlSettingsDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  intervalMinutes!: number;
}
