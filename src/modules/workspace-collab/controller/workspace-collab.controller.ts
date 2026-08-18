import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { WorkspaceAgentService } from '../services/workspace-agent.service.js';
import { WorkspaceConversationService } from '../services/workspace-conversation.service.js';
import { WorkspaceTaskService } from '../services/workspace-task.service.js';
import {
  AddTaskFollowupDto,
  CreateConversationDto,
  CreateWorkspaceAgentDto,
  CreateWorkspaceTaskDto,
  SendMessageDto,
  UpdateWorkspaceAgentDto,
  UpdateWorkspaceTaskDto,
  WorkspaceTaskQueryDto,
} from './workspace-collab.dto.js';

/**
 * @description 工作区协作控制器(v2)，工作区内页的 Agent 通讯录、会话消息与任务跟进端点，
 *   后台 JWT + CASL 鉴权，工作区与租户边界由服务层强制
 * @keyword-en workspace collab controller
 * @keyword-cn 工作区协作控制器
 */
@Controller('api/v2/workspaces/:workspaceId')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class WorkspaceCollabController {
  constructor(
    private readonly agentService: WorkspaceAgentService,
    private readonly conversationService: WorkspaceConversationService,
    private readonly taskService: WorkspaceTaskService,
  ) {}

  /**
   * @description Agent 通讯录
   * @keyword-en list workspace agents endpoint
   * @keyword-cn Agent通讯录端点
   */
  @RequirePermission('read', 'WorkspaceAgent')
  @Get('agents')
  async listAgents(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
  ) {
    const agents = await this.agentService.list(
      this.requireUser(req),
      workspaceId,
    );
    return { agents };
  }

  /**
   * @description 新增 Agent
   * @keyword-en create workspace agent endpoint
   * @keyword-cn 新增Agent端点
   */
  @RequirePermission('create', 'WorkspaceAgent')
  @Post('agents')
  async createAgent(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateWorkspaceAgentDto,
  ) {
    const agent = await this.agentService.create(
      this.requireUser(req),
      workspaceId,
      body,
    );
    return { agent };
  }

  /**
   * @description 更新 Agent(可用状态与 AI 接入开关)
   * @keyword-en update workspace agent endpoint
   * @keyword-cn 更新Agent端点
   */
  @RequirePermission('update', 'WorkspaceAgent')
  @Patch('agents/:agentId')
  async updateAgent(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('agentId') agentId: string,
    @Body() body: UpdateWorkspaceAgentDto,
  ) {
    const agent = await this.agentService.update(
      this.requireUser(req),
      workspaceId,
      agentId,
      body,
    );
    return { agent };
  }

  /**
   * @description 删除 Agent
   * @keyword-en delete workspace agent endpoint
   * @keyword-cn 删除Agent端点
   */
  @RequirePermission('delete', 'WorkspaceAgent')
  @Delete('agents/:agentId')
  async removeAgent(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('agentId') agentId: string,
  ) {
    const ok = await this.agentService.remove(
      this.requireUser(req),
      workspaceId,
      agentId,
    );
    return { ok };
  }

  /**
   * @description 会话列表
   * @keyword-en list workspace conversations endpoint
   * @keyword-cn 会话列表端点
   */
  @RequirePermission('read', 'WorkspaceConversation')
  @Get('conversations')
  async listConversations(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
  ) {
    const conversations = await this.conversationService.list(
      this.requireUser(req),
      workspaceId,
    );
    return { conversations };
  }

  /**
   * @description 新建会话
   * @keyword-en create workspace conversation endpoint
   * @keyword-cn 新建会话端点
   */
  @RequirePermission('create', 'WorkspaceConversation')
  @Post('conversations')
  async createConversation(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateConversationDto,
  ) {
    const conversation = await this.conversationService.create(
      this.requireUser(req),
      workspaceId,
      body,
    );
    return { conversation };
  }

  /**
   * @description 删除会话及其消息
   * @keyword-en delete workspace conversation endpoint
   * @keyword-cn 删除会话端点
   */
  @RequirePermission('delete', 'WorkspaceConversation')
  @Delete('conversations/:conversationId')
  async removeConversation(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const ok = await this.conversationService.remove(
      this.requireUser(req),
      workspaceId,
      conversationId,
    );
    return { ok };
  }

  /**
   * @description 会话消息列表
   * @keyword-en list conversation messages endpoint
   * @keyword-cn 会话消息端点
   */
  @RequirePermission('read', 'WorkspaceConversation')
  @Get('conversations/:conversationId/messages')
  async listMessages(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const messages = await this.conversationService.listMessages(
      this.requireUser(req),
      workspaceId,
      conversationId,
    );
    return { messages };
  }

  /**
   * @description 发送会话消息(Agent 已接入 AI 时同步返回真实回复)
   * @keyword-en send conversation message endpoint
   * @keyword-cn 发送消息端点
   */
  @RequirePermission('create', 'WorkspaceConversation')
  @Post('conversations/:conversationId/messages')
  async sendMessage(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.conversationService.sendMessage(
      this.requireUser(req),
      workspaceId,
      conversationId,
      { text: body.text ?? '', attachmentIds: body.attachmentIds },
    );
  }

  /**
   * @description 任务列表与状态计数
   * @keyword-en list workspace tasks endpoint
   * @keyword-cn 任务列表端点
   */
  @RequirePermission('read', 'WorkspaceTask')
  @Get('tasks')
  async listTasks(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Query() query: WorkspaceTaskQueryDto,
  ) {
    const { items, counts } = await this.taskService.list(
      this.requireUser(req),
      workspaceId,
      query.status,
    );
    return { tasks: items, counts };
  }

  /**
   * @description 创建任务
   * @keyword-en create workspace task endpoint
   * @keyword-cn 创建任务端点
   */
  @RequirePermission('create', 'WorkspaceTask')
  @Post('tasks')
  async createTask(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateWorkspaceTaskDto,
  ) {
    const task = await this.taskService.create(
      this.requireUser(req),
      workspaceId,
      body,
    );
    return { task };
  }

  /**
   * @description 更新任务
   * @keyword-en update workspace task endpoint
   * @keyword-cn 更新任务端点
   */
  @RequirePermission('update', 'WorkspaceTask')
  @Patch('tasks/:taskId')
  async updateTask(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: UpdateWorkspaceTaskDto,
  ) {
    const task = await this.taskService.update(
      this.requireUser(req),
      workspaceId,
      taskId,
      body,
    );
    return { task };
  }

  /**
   * @description 删除任务
   * @keyword-en delete workspace task endpoint
   * @keyword-cn 删除任务端点
   */
  @RequirePermission('delete', 'WorkspaceTask')
  @Delete('tasks/:taskId')
  async removeTask(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
  ) {
    const ok = await this.taskService.remove(
      this.requireUser(req),
      workspaceId,
      taskId,
    );
    return { ok };
  }

  /**
   * @description 任务跟进记录列表
   * @keyword-en list task followups endpoint
   * @keyword-cn 跟进记录端点
   */
  @RequirePermission('read', 'WorkspaceTask')
  @Get('tasks/:taskId/followups')
  async listFollowups(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
  ) {
    const followups = await this.taskService.listFollowups(
      this.requireUser(req),
      workspaceId,
      taskId,
    );
    return { followups };
  }

  /**
   * @description 追加任务跟进(可带网盘附件并流转状态)
   * @keyword-en add task followup endpoint
   * @keyword-cn 追加跟进端点
   */
  @RequirePermission('update', 'WorkspaceTask')
  @Post('tasks/:taskId/followups')
  async addFollowup(
    @Req() req: AdminRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: AddTaskFollowupDto,
  ) {
    const followup = await this.taskService.addFollowup(
      this.requireUser(req),
      workspaceId,
      taskId,
      {
        text: body.text ?? '',
        attachmentIds: body.attachmentIds,
        status: body.status,
      },
    );
    return { followup };
  }

  /**
   * @description 读取当前登录后台用户
   * @keyword-en read current admin user
   * @keyword-cn 读取当前用户
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
