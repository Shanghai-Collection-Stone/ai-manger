import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Collection, Db, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import { TodoService } from '../../todo/services/todo.service.js';
import type {
  BrowserAuthInteractionEntity,
  BrowserAuthInteractionEnvelope,
  BrowserAuthInteractionKind,
  BrowserAuthInteractionView,
} from '../entities/browser-auth.entity.js';
import { BrowserAuthCryptoService } from './browser-auth-crypto.service.js';

const PLATFORM_SCOPE_ID = '__platform__';
const DEFAULT_QR_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TEXT_TTL_MS = 30 * 60 * 1000;
const MAX_INTERACTION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @description 管理 Todo 等待用户扫码或简短回复的交互请求，并在回调后恢复原任务。
 * @keyword-cn 任务等待用户, 登录回调
 * @keyword-en task-waiting-user, login-callback
 */
@Injectable()
export class BrowserAuthInteractionService {
  private readonly interactions: Collection<BrowserAuthInteractionEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: BrowserAuthCryptoService,
    private readonly todos: TodoService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.interactions = db.collection<BrowserAuthInteractionEntity>(
      'browser_auth_interactions',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 建立任务交互的任务状态索引和过期时间索引。
   * @keyword-cn 任务交互索引, 交互过期
   * @keyword-en task-interaction-indexes, interaction-expiry
   */
  async ensureIndexes(): Promise<void> {
    await this.interactions.createIndex({ id: 1 }, { unique: true });
    await this.interactions.createIndex({
      todoId: 1,
      status: 1,
      createdAt: -1,
    });
    await this.interactions.createIndex({ expiresAt: 1 });
  }

  /**
   * @description 节点为执行中的 Todo 创建唯一待处理交互，旧待处理交互会被取消。
   * @keyword-cn 创建任务交互, 取消旧交互
   * @keyword-en create-task-interaction, cancel-stale-interaction
   */
  async create(
    todo: TodoEntity,
    input: {
      kind?: string;
      title?: string;
      prompt?: string;
      qrContent?: string;
      expiresAt?: string;
    },
  ): Promise<BrowserAuthInteractionView> {
    if (!todo.workspaceId) {
      throw new BadRequestException('TASK_WORKSPACE_REQUIRED');
    }
    const kind = this.readKind(input.kind);
    const title = String(input.title ?? '')
      .trim()
      .slice(0, 120);
    const prompt = String(input.prompt ?? '')
      .trim()
      .slice(0, 2000);
    if (!title || !prompt) {
      throw new BadRequestException('TASK_INTERACTION_CONTENT_REQUIRED');
    }
    const qrContent = String(input.qrContent ?? '').trim();
    if (kind === 'qr_login' && !qrContent) {
      throw new BadRequestException('TASK_INTERACTION_QR_REQUIRED');
    }
    const expiresAt = this.readExpiry(input.expiresAt, kind);
    const now = new Date();
    await this.interactions.updateMany(
      { todoId: todo.id, status: 'pending' },
      { $set: { status: 'cancelled', updatedAt: now } },
    );
    const row: BrowserAuthInteractionEntity = {
      _id: new ObjectId(),
      id: randomUUID(),
      todoId: todo.id,
      scopeId: todo.tenantId || PLATFORM_SCOPE_ID,
      tenantId: todo.tenantId,
      userId: todo.userId,
      workspaceId: todo.workspaceId,
      sessionId: todo.sessionKey,
      kind,
      status: 'pending',
      title,
      prompt,
      qrContent: qrContent ? this.crypto.encrypt(qrContent) : undefined,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    await this.interactions.insertOne(row);
    return this.toView(row, { includeQr: true, includeResponse: false });
  }

  /**
   * @description 节点凭当前任务 Token 查询指定或最近一次交互及用户回复。
   * @keyword-cn 节点查询交互, 读取用户回复
   * @keyword-en node-read-interaction, read-user-response
   */
  async getForTask(
    todo: TodoEntity,
    interactionId?: string,
  ): Promise<BrowserAuthInteractionEnvelope> {
    const row = await this.interactions.findOne(
      interactionId
        ? { id: interactionId, todoId: todo.id }
        : { todoId: todo.id },
      { sort: { createdAt: -1 } },
    );
    if (!row) return { found: false };
    const current = await this.expireIfNeeded(row);
    return {
      found: true,
      interaction: this.toView(current, {
        includeQr: true,
        includeResponse: true,
      }),
    };
  }

  /**
   * @description 后台用户读取本租户 Todo 当前待处理交互，用于展示二维码或短对话窗口。
   * @keyword-cn 用户读取交互, 登录窗口
   * @keyword-en user-read-interaction, login-window
   */
  async getActiveForUser(
    currentUser: AdminUserEntity,
    todoId: number,
  ): Promise<BrowserAuthInteractionEnvelope> {
    const row = await this.interactions.findOne(
      { todoId, status: 'pending' },
      { sort: { createdAt: -1 } },
    );
    if (!row) return { found: false };
    this.requireScope(currentUser, row);
    const current = await this.expireIfNeeded(row);
    if (current.status !== 'pending') return { found: false };
    return {
      found: true,
      interaction: this.toView(current, {
        includeQr: true,
        includeResponse: false,
      }),
    };
  }

  /**
   * @description 用户提交扫码确认或简短文本，随后恢复原 Todo 的执行状态。
   * @keyword-cn 提交任务回调, 恢复原任务
   * @keyword-en submit-task-callback, resume-original-task
   */
  async respond(
    currentUser: AdminUserEntity,
    interactionId: string,
    responseValue?: string,
  ): Promise<BrowserAuthInteractionView> {
    const row = await this.interactions.findOne({ id: interactionId });
    if (!row) throw new NotFoundException('TASK_INTERACTION_NOT_FOUND');
    this.requireScope(currentUser, row);
    const current = await this.expireIfNeeded(row);
    if (current.status !== 'pending') {
      throw new BadRequestException('TASK_INTERACTION_NOT_PENDING');
    }
    const response = String(responseValue ?? '').trim();
    if (current.kind === 'short_text' && !response) {
      throw new BadRequestException('TASK_INTERACTION_RESPONSE_REQUIRED');
    }
    if (response.length > 2000) {
      throw new BadRequestException('TASK_INTERACTION_RESPONSE_TOO_LONG');
    }
    const now = new Date();
    const updated = await this.interactions.findOneAndUpdate(
      { id: current.id, status: 'pending' },
      {
        $set: {
          status: 'answered',
          response: this.crypto.encrypt(response || '用户已确认完成扫码'),
          answeredAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!updated.value) {
      throw new BadRequestException('TASK_INTERACTION_NOT_PENDING');
    }
    const resumed = await this.todos.resumeAfterInteraction(
      current.todoId,
      current.tenantId,
    );
    if (resumed?.status === 'pending') {
      await this.notifyTaskAvailable(resumed);
    }
    return this.toView(updated.value, {
      includeQr: false,
      includeResponse: false,
    });
  }

  /**
   * @description 创建任务进入等待态失败时取消刚建立的交互请求。
   * @keyword-cn 回滚任务交互, 取消交互
   * @keyword-en rollback-task-interaction, cancel-interaction
   */
  async cancel(interactionId: string): Promise<void> {
    await this.interactions.updateOne(
      { id: interactionId, status: 'pending' },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
    );
  }

  /**
   * @description 把超时交互转为 expired，并将仍等待用户的 Todo 标记失败。
   * @keyword-cn 交互超时失败, 等待用户超时
   * @keyword-en expire-interaction, user-wait-timeout
   */
  private async expireIfNeeded(
    row: BrowserAuthInteractionEntity,
  ): Promise<BrowserAuthInteractionEntity> {
    if (row.status !== 'pending' || row.expiresAt.getTime() > Date.now()) {
      return row;
    }
    const now = new Date();
    await this.interactions.updateOne(
      { id: row.id, status: 'pending' },
      { $set: { status: 'expired', updatedAt: now } },
    );
    const todo = await this.todos.get(row.todoId, row.tenantId);
    if (todo?.status === 'waiting_user') {
      await this.todos.update({
        id: row.todoId,
        tenantId: row.tenantId,
        status: 'failed',
        abnormalReason: `等待用户${row.kind === 'qr_login' ? '扫码登录' : '回复'}超时，任务未能继续执行。`,
      });
    }
    return { ...row, status: 'expired', updatedAt: now };
  }

  /**
   * @description 校验后台用户只能访问本租户交互，平台交互仅超级管理员可访问。
   * @keyword-cn 校验交互租户, 平台交互保护
   * @keyword-en validate-interaction-tenant, platform-interaction-protection
   */
  private requireScope(
    currentUser: AdminUserEntity,
    row: BrowserAuthInteractionEntity,
  ): void {
    if (row.tenantId) {
      if (currentUser.tenantId !== row.tenantId) {
        throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
      }
      return;
    }
    if (currentUser.role !== 'super_admin') {
      throw new ForbiddenException('PLATFORM_INTERACTION_FORBIDDEN');
    }
  }

  /**
   * @description 解析并限制任务交互类型。
   * @keyword-cn 解析交互类型, 类型校验
   * @keyword-en parse-interaction-kind, kind-validation
   */
  private readKind(value?: string): BrowserAuthInteractionKind {
    if (value === 'qr_login' || value === 'short_text') return value;
    throw new BadRequestException('INVALID_TASK_INTERACTION_KIND');
  }

  /**
   * @description 解析交互截止时间并按类型设置默认时限。
   * @keyword-cn 解析交互时限, 二维码有效期
   * @keyword-en parse-interaction-expiry, qr-expiry
   */
  private readExpiry(
    value: string | undefined,
    kind: BrowserAuthInteractionKind,
  ): Date {
    const fallback =
      kind === 'qr_login' ? DEFAULT_QR_TTL_MS : DEFAULT_TEXT_TTL_MS;
    const expiresAt = value ? new Date(value) : new Date(Date.now() + fallback);
    const delta = expiresAt.getTime() - Date.now();
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      delta <= 0 ||
      delta > MAX_INTERACTION_TTL_MS
    ) {
      throw new BadRequestException('INVALID_TASK_INTERACTION_EXPIRY');
    }
    return expiresAt;
  }

  /**
   * @description 将交互实体转换为按调用方裁剪敏感字段的视图。
   * @keyword-cn 转换交互视图, 敏感字段裁剪
   * @keyword-en map-interaction-view, redact-sensitive-fields
   */
  private toView(
    row: BrowserAuthInteractionEntity,
    options: { includeQr: boolean; includeResponse: boolean },
  ): BrowserAuthInteractionView {
    return {
      id: row.id,
      todoId: row.todoId,
      kind: row.kind,
      status: row.status,
      title: row.title,
      prompt: row.prompt,
      qrContent:
        options.includeQr && row.qrContent
          ? this.crypto.decrypt(row.qrContent)
          : undefined,
      response:
        options.includeResponse && row.response
          ? this.crypto.decrypt(row.response)
          : undefined,
      expiresAt: row.expiresAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * @description 原任务恢复为 pending 时通知其绑定 SuperClaw 节点立即尝试重新投递。
   * @keyword-cn 通知任务恢复, 重新投递
   * @keyword-en notify-task-resume, redispatch-task
   */
  private async notifyTaskAvailable(todo: TodoEntity): Promise<void> {
    try {
      const channel = this.moduleRef.get<{
        notifyTenant: (tenantId: string) => Promise<boolean>;
        notifyWorkspace: (workspaceId: string) => Promise<boolean>;
      }>('SuperClawTaskChannelService', { strict: false });
      if (!channel) return;
      if (todo.tenantId) await channel.notifyTenant(todo.tenantId);
      else if (todo.workspaceId)
        await channel.notifyWorkspace(todo.workspaceId);
    } catch {
      // 回调已持久化且任务已恢复；在线通知失败时由任务通道空闲巡检兜底。
    }
  }
}
