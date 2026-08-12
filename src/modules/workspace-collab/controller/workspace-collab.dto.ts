import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * @description 附件最多引用的网盘文件数
 * @keyword-en attachment max count
 * @keyword-cn 附件数量上限
 */
const ATTACHMENT_MAX = 20;

/**
 * @description 新增 Agent 请求体
 * @keyword-en create workspace agent dto
 * @keyword-cn 新增Agent请求体
 */
export class CreateWorkspaceAgentDto {
  /** 租户内唯一键，仅小写字母/数字/中划线 */
  @IsString()
  @Matches(/^[a-z0-9-]{2,32}$/)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  accent?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  aiModel?: string;
}

/**
 * @description 更新 Agent 请求体
 * @keyword-en update workspace agent dto
 * @keyword-cn 更新Agent请求体
 */
export class UpdateWorkspaceAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  accent?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  aiModel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * @description 新建会话请求体
 * @keyword-en create workspace conversation dto
 * @keyword-cn 新建会话请求体
 */
export class CreateConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  agentKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}

/**
 * @description 发送会话消息请求体
 * @keyword-en send conversation message dto
 * @keyword-cn 发送消息请求体
 */
export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  /** 网盘文件节点 ID 列表(先经 /api/v2/netdisk/files 真实上传) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENT_MAX)
  @IsMongoId({ each: true })
  attachmentIds?: string[];
}

/**
 * @description 任务列表查询参数
 * @keyword-en workspace task query dto
 * @keyword-cn 任务查询参数
 */
export class WorkspaceTaskQueryDto {
  @IsOptional()
  @IsIn(['in_progress', 'completed', 'failed'])
  status?: 'in_progress' | 'completed' | 'failed';
}

/**
 * @description 创建任务请求体
 * @keyword-en create workspace task dto
 * @keyword-cn 创建任务请求体
 */
export class CreateWorkspaceTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(['user', 'agent'])
  assigneeType!: 'user' | 'agent';

  /** assigneeType=user 时为后台用户 ID；=agent 时为 Agent 键 */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  assigneeId!: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENT_MAX)
  @IsMongoId({ each: true })
  attachmentIds?: string[];
}

/**
 * @description 更新任务请求体
 * @keyword-en update workspace task dto
 * @keyword-cn 更新任务请求体
 */
export class UpdateWorkspaceTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['in_progress', 'completed', 'failed'])
  status?: 'in_progress' | 'completed' | 'failed';

  @IsOptional()
  @IsIn(['user', 'agent'])
  assigneeType?: 'user' | 'agent';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  assigneeId?: string;

  /** 传空串表示清除截止时间 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENT_MAX)
  @IsMongoId({ each: true })
  attachmentIds?: string[];
}

/**
 * @description 追加任务跟进请求体
 * @keyword-en add task followup dto
 * @keyword-cn 追加跟进请求体
 */
export class AddTaskFollowupDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENT_MAX)
  @IsMongoId({ each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsIn(['in_progress', 'completed', 'failed'])
  status?: 'in_progress' | 'completed' | 'failed';
}
