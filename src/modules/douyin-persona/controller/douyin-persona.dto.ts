import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DOUYIN_PERSONA_PERSPECTIVES } from '../entities/douyin-persona.entity.js';

/** @type {string[]} 允许的叙事视角键名，取自实体登记表，前端下拉与后端校验同源。 */
const PERSPECTIVE_KEYS = Object.values(DOUYIN_PERSONA_PERSPECTIVES);

/**
 * @description 校验人物音色：性别、年龄感、语速三选一，音色特质可选且限长。
 * @keyword-cn 人物音色参数, 音色校验
 * @keyword-en persona-voice-dto, voice-validation
 */
export class DouyinPersonaVoiceDto {
  @IsIn(['female', 'male', 'neutral'])
  gender!: 'female' | 'male' | 'neutral';

  @IsIn(['young', 'adult', 'mature'])
  age!: 'young' | 'adult' | 'mature';

  @IsIn(['slow', 'normal', 'fast'])
  pace!: 'slow' | 'normal' | 'fast';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  timbre?: string;
}

/**
 * @description 校验新建预设人物：人物名与外貌设定必填，外貌是形象图和分镜一致性的唯一依据。
 * @keyword-cn 新建预设人物参数, 外貌必填
 * @keyword-en create-persona-dto, appearance-required
 */
export class CreateDouyinPersonaDto {
  @IsString()
  @Length(2, 40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  summary?: string;

  @IsString()
  @Length(20, 1000)
  appearance!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  persona?: string;

  @IsOptional()
  @IsIn(PERSPECTIVE_KEYS)
  perspective?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinPersonaVoiceDto)
  voice?: DouyinPersonaVoiceDto;
}

/**
 * @description 校验更新预设人物：所有字段可选，只提交改动过的；`status` 用于归档与恢复。
 * @keyword-cn 更新预设人物参数, 归档状态
 * @keyword-en update-persona-dto, archive-status
 */
export class UpdateDouyinPersonaDto {
  @IsOptional()
  @IsString()
  @Length(2, 40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  summary?: string;

  @IsOptional()
  @IsString()
  @Length(20, 1000)
  appearance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  persona?: string;

  @IsOptional()
  @IsIn(PERSPECTIVE_KEYS)
  perspective?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DouyinPersonaVoiceDto)
  voice?: DouyinPersonaVoiceDto;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

/**
 * @description 校验 AI 人设草稿的一句话需求。
 * @keyword-cn 人设草稿参数, 一句话需求
 * @keyword-en persona-draft-dto, one-line-brief
 */
export class DraftDouyinPersonaDto {
  @IsString()
  @Length(4, 500)
  brief!: string;
}
