import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import { ChatMainService } from '../../chat-main/services/chat.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { WorkspaceEntity } from '../../workspace/entities/workspace.entity.js';
import type {
  WorkspaceConversationEntity,
  WorkspaceMessageEntity,
} from '../entities/workspace-collab.entity.js';
import { WORKSPACE_COLLAB_AUDIT_ACTIONS } from '../constants/workspace-collab-audit.constants.js';
import { WorkspaceAgentService } from './workspace-agent.service.js';
import { WorkspaceCollabContextService } from './workspace-collab-context.service.js';

/**
 * @description 创建会话入参
 * @keyword-en create workspace conversation input
 * @keyword-cn 创建会话入参
 */
export interface CreateConversationInput {
  agentKey: string;
  title?: string;
}

/**
 * @description 发送消息入参
 * @keyword-en send workspace message input
 * @keyword-cn 发送消息入参
 */
export interface SendMessageInput {
  text: string;
  /** 网盘文件节点 ID 列表(先经网盘接口真实上传) */
  attachmentIds?: string[];
}

/**
 * @description 发送消息结果，含成员消息本身与 Agent 回复(未接入 AI 时 reply 为空)
 * @keyword-en send workspace message result
 * @keyword-cn 发送消息结果
 */
export interface SendMessageResult {
  message: WorkspaceMessageEntity;
  reply: WorkspaceMessageEntity | null;
  /** AI 回复失败原因(如未配置模型服务)，成员消息仍已落库 */
  replyError: string | null;
  conversation: WorkspaceConversationEntity;
}

/**
 * @description 工作区会话服务，维护工作区内与 Agent 的会话与消息；开启 aiEnabled 的 Agent
 *   经 chat-main 运行时生成真实回复，未开启或回复失败时只如实记录成员消息，不写入任何占位内容
 * @keyword-en workspace conversation service
 * @keyword-cn 工作区会话服务
 */
@Injectable()
export class WorkspaceConversationService {
  private readonly logger = new Logger(WorkspaceConversationService.name);
  private readonly conversations: Collection<WorkspaceConversationEntity>;
  private readonly messages: Collection<WorkspaceMessageEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly context: WorkspaceCollabContextService,
    private readonly agentService: WorkspaceAgentService,
    private readonly chatService: ChatMainService,
  ) {
    this.conversations = db.collection<WorkspaceConversationEntity>(
      'workspace_conversations',
    );
    this.messages = db.collection<WorkspaceMessageEntity>(
      'workspace_conversation_messages',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 初始化会话与消息索引
   * @keyword-en ensure conversation indexes
   * @keyword-cn 初始化会话索引
   */
  async ensureIndexes(): Promise<void> {
    await this.conversations.createIndex({ workspaceId: 1, lastMessageAt: -1 });
    await this.conversations.createIndex({ tenantId: 1 });
    await this.messages.createIndex({ conversationId: 1, createdAt: 1 });
  }

  /**
   * @description 工作区会话列表(最近活跃优先)
   * @keyword-en list workspace conversations
   * @keyword-cn 会话列表
   */
  async list(
    currentUser: AdminUserEntity,
    workspaceId: string,
  ): Promise<WorkspaceConversationEntity[]> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    return this.conversations
      .find({
        tenantId: workspace.tenantId,
        workspaceId: String(workspace._id),
      })
      .sort({ lastMessageAt: -1 })
      .toArray();
  }

  /**
   * @description 新建会话(绑定通讯录里的一个 Agent)
   * @keyword-en create workspace conversation
   * @keyword-cn 新建会话
   */
  async create(
    currentUser: AdminUserEntity,
    workspaceId: string,
    input: CreateConversationInput,
  ): Promise<WorkspaceConversationEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const agent = await this.agentService.getByKey(
      workspace.tenantId,
      input.agentKey,
    );
    if (!agent) throw new NotFoundException('AGENT_NOT_FOUND');
    if (!agent.enabled) throw new BadRequestException('AGENT_DISABLED');

    const now = new Date();
    const doc: WorkspaceConversationEntity = {
      _id: new ObjectId(),
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
      agentKey: agent.key,
      agentName: agent.name,
      title: input.title?.trim() || `与 ${agent.name} 的会话`,
      summary: agent.description,
      sessionId: `ws-${randomUUID()}`,
      createdBy: String(currentUser._id),
      createdByName: this.context.displayName(currentUser),
      messageCount: 0,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.conversations.insertOne(doc);
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.conversationCreate,
      'workspace_conversation',
      String(doc._id),
      { workspaceId, agentKey: agent.key, title: doc.title },
    );
    return doc;
  }

  /**
   * @description 获取会话详情
   * @keyword-en get workspace conversation
   * @keyword-cn 获取会话
   */
  async get(
    currentUser: AdminUserEntity,
    workspaceId: string,
    conversationId: string,
  ): Promise<WorkspaceConversationEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    return this.requireConversation(workspace, conversationId);
  }

  /**
   * @description 删除会话及其全部消息
   * @keyword-en delete workspace conversation
   * @keyword-cn 删除会话
   */
  async remove(
    currentUser: AdminUserEntity,
    workspaceId: string,
    conversationId: string,
  ): Promise<boolean> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const conversation = await this.requireConversation(
      workspace,
      conversationId,
    );
    await this.messages.deleteMany({
      conversationId: String(conversation._id),
    });
    const res = await this.conversations.deleteOne({ _id: conversation._id });
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.conversationDelete,
      'workspace_conversation',
      conversationId,
      { workspaceId, title: conversation.title },
    );
    return res.deletedCount === 1;
  }

  /**
   * @description 会话消息列表(按时间正序)
   * @keyword-en list conversation messages
   * @keyword-cn 会话消息列表
   */
  async listMessages(
    currentUser: AdminUserEntity,
    workspaceId: string,
    conversationId: string,
  ): Promise<WorkspaceMessageEntity[]> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const conversation = await this.requireConversation(
      workspace,
      conversationId,
    );
    return this.messages
      .find({ conversationId: String(conversation._id) })
      .sort({ createdAt: 1 })
      .toArray();
  }

  /**
   * @description 发送消息：成员消息先落库，若绑定 Agent 已接入 AI 运行时则同步取回真实回复；
   *   回复失败只返回原因，绝不写入占位内容
   * @keyword-en send conversation message
   * @keyword-cn 发送会话消息
   */
  async sendMessage(
    currentUser: AdminUserEntity,
    workspaceId: string,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const conversation = await this.requireConversation(
      workspace,
      conversationId,
    );
    const text = input.text?.trim() ?? '';
    const attachments = await this.context.resolveAttachments(
      workspace,
      input.attachmentIds,
    );
    if (!text && attachments.length === 0) {
      throw new BadRequestException('MESSAGE_EMPTY');
    }

    const message = await this.appendMessage(conversation, {
      role: 'user',
      authorUserId: String(currentUser._id),
      authorName: this.context.displayName(currentUser),
      text,
      attachments,
    });
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.conversationMessage,
      'workspace_conversation',
      conversationId,
      { workspaceId, attachments: attachments.length },
    );

    const agent = await this.agentService.getByKey(
      workspace.tenantId,
      conversation.agentKey,
    );
    let reply: WorkspaceMessageEntity | null = null;
    let replyError: string | null = null;
    if (text && agent?.aiEnabled) {
      try {
        const answer = await this.chatService.send({
          sessionId: conversation.sessionId,
          input: text,
          sessionType: 'default',
          provider: agent.aiProvider,
          model: agent.aiModel,
          tenantId: workspace.tenantId,
          userId: String(currentUser._id),
        });
        const answerText = answer?.text?.trim() ?? '';
        if (answerText) {
          reply = await this.appendMessage(conversation, {
            role: 'agent',
            authorName: agent.name,
            text: answerText,
            attachments: [],
          });
        } else {
          replyError = 'AI_EMPTY_REPLY';
        }
      } catch (error) {
        replyError = error instanceof Error ? error.message : 'AI_REPLY_FAILED';
        this.logger.error(
          `[WorkspaceConversation] agent reply failed: ${replyError}`,
        );
      }
    }

    const latest = await this.conversations.findOne({ _id: conversation._id });
    return {
      message,
      reply,
      replyError,
      conversation: latest ?? conversation,
    };
  }

  /**
   * @description 写入一条消息并同步会话计数、摘要与最近活跃时间
   * @keyword-en append conversation message
   * @keyword-cn 写入会话消息
   */
  private async appendMessage(
    conversation: WorkspaceConversationEntity,
    input: Omit<
      WorkspaceMessageEntity,
      '_id' | 'tenantId' | 'workspaceId' | 'conversationId' | 'createdAt'
    >,
  ): Promise<WorkspaceMessageEntity> {
    const now = new Date();
    const doc: WorkspaceMessageEntity = {
      _id: new ObjectId(),
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      conversationId: String(conversation._id),
      role: input.role,
      authorUserId: input.authorUserId,
      authorName: input.authorName,
      text: input.text,
      attachments: input.attachments,
      createdAt: now,
    };
    await this.messages.insertOne(doc);
    await this.conversations.updateOne(
      { _id: conversation._id },
      {
        $inc: { messageCount: 1 },
        $set: {
          summary: doc.text.slice(0, 120) || conversation.summary,
          lastMessageAt: now,
          updatedAt: now,
        },
      },
    );
    return doc;
  }

  /**
   * @description 读取并校验会话归属当前工作区
   * @keyword-en require conversation
   * @keyword-cn 校验会话归属
   */
  private async requireConversation(
    workspace: WorkspaceEntity,
    conversationId: string,
  ): Promise<WorkspaceConversationEntity> {
    const conversation = await this.conversations.findOne({
      _id: this.context.toId(conversationId, 'INVALID_CONVERSATION_ID'),
      tenantId: workspace.tenantId,
      workspaceId: String(workspace._id),
    });
    if (!conversation) throw new NotFoundException('CONVERSATION_NOT_FOUND');
    return conversation;
  }
}
