import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * @description 单条聊天消息
 * @keyword-en finance agent chat message dto
 */
export class FinanceAgentChatMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MaxLength(20000)
  content!: string;
}

/**
 * @description 后台财务 Agent 聊天请求
 * @keyword-en finance agent chat request dto
 */
export class FinanceAgentChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FinanceAgentChatMessageDto)
  messages!: FinanceAgentChatMessageDto[];
}
