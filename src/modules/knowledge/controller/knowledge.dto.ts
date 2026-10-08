import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  KNOWLEDGE_CONTENT_MAX_LENGTH,
  KNOWLEDGE_NAME_MAX_LENGTH,
} from '../entities/knowledge.entity.js';

/**
 * @description 校验新建引用知识参数：名称与知识内容都必填。
 * @keyword-cn 新建引用知识参数
 * @keyword-en create-knowledge-dto
 */
export class CreateKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_NAME_MAX_LENGTH)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_CONTENT_MAX_LENGTH)
  content!: string;
}

/**
 * @description 校验修改引用知识参数，只传要改的字段。
 * @keyword-cn 修改引用知识参数
 * @keyword-en update-knowledge-dto
 */
export class UpdateKnowledgeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_CONTENT_MAX_LENGTH)
  content?: string;
}
