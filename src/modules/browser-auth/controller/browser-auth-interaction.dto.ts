import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * @description 用户提交任务扫码确认或简短文本回复的请求体。
 * @keyword-cn 任务交互回复参数, 简短对话
 * @keyword-en task-interaction-response-dto, short-dialog
 */
export class RespondBrowserAuthInteractionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  response?: string;
}
