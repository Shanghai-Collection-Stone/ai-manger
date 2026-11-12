import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type { DouyinPublishWorkEntity } from '../entities/douyin-publish.entity.js';
import {
  DouyinMiniappSchemaError,
  DouyinMiniappSchemaService,
} from './douyin-miniapp-schema.service.js';
import { DouyinPublishWorkService } from './douyin-publish-work.service.js';

/** 持久化每件作品历次平台任务，保留过期任务以关联延迟通知。
 * @keyword-cn 任务关联, 发布回调
 * @keyword-en task-mapping, publish-webhook
 */
interface PublishVideoTaskSlot {
  _id: string;
  appId: string;
  workId: ObjectId;
  libraryId: ObjectId;
  tasks: { id: string; expiresAt: Date }[];
  owner?: string | null;
  creatingUntil?: Date | null;
}

/** 创建发布任务并将签名验证后的平台通知交给关联作品。
 * @keyword-cn 拍抖音任务, 发布回调
 * @keyword-en douyin-video-task, publish-webhook
 */
@Injectable()
export class DouyinPublishWebhookService {
  private readonly slots: Collection<PublishVideoTaskSlot>;
  private readonly logger = new Logger(DouyinPublishWebhookService.name);

  /** 注入平台调用、作品服务与持久化任务关联。
   * @keyword-cn 拍抖音任务, 发布回调
   * @keyword-en douyin-video-task, publish-webhook
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly config: ConfigService,
    private readonly platform: DouyinMiniappSchemaService,
    private readonly works: DouyinPublishWorkService,
  ) {
    this.slots = db.collection<PublishVideoTaskSlot>(
      'douyin_publish_video_tasks',
    );
  }

  /** 在启动完成前建立平台任务唯一索引，支持多进程去重。
   * @keyword-cn 任务关联, 唯一索引
   * @keyword-en task-mapping, unique-index
   */
  async onModuleInit(): Promise<void> {
    await this.slots.createIndex(
      { 'tasks.id': 1 },
      {
        unique: true,
        partialFilterExpression: { 'tasks.id': { $type: 'string' } },
      },
    );
  }

  /** 为未发布作品复用或创建任务；启用后配置和权限错误会阻止无回调发布。
   * @keyword-cn 拍抖音任务, 任务关联
   * @keyword-en douyin-video-task, task-mapping
   */
  async prepareTask(work: DouyinPublishWorkEntity): Promise<string[]> {
    if (
      work.status === 'published' ||
      String(this.config.get('DOUYIN_PUBLISH_WEBHOOK_ENABLED'))
        .trim()
        .toLowerCase() !== 'true'
    )
      return [];
    const appId = String(this.config.get('DOUYIN_MINIAPP_APP_ID') ?? '').trim();
    const secret = String(
      this.config.get('DOUYIN_PUBLISH_WEBHOOK_SECRET') ?? '',
    ).trim();
    if (!appId || !secret || !this.platform.isConfigured())
      throw new ServiceUnavailableException(
        'DOUYIN_PUBLISH_WEBHOOK_NOT_CONFIGURED',
      );
    const key = `${appId}:${work._id.toHexString()}`;
    const current = await this.slots.findOne({ _id: key });
    const usable = this.activeTask(current);
    if (usable) return [usable];
    const owner = randomBytes(16).toString('hex');
    let slot: PublishVideoTaskSlot | null;
    try {
      slot = await this.slots.findOneAndUpdate(
        {
          _id: key,
          $or: [
            { creatingUntil: null },
            { creatingUntil: { $lte: new Date() } },
          ],
        },
        {
          $set: { owner, creatingUntil: new Date(Date.now() + 60000) },
          $setOnInsert: {
            appId,
            workId: work._id,
            libraryId: work.libraryId,
            tasks: [],
          },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      throw new ServiceUnavailableException('DOUYIN_PUBLISH_TASK_PREPARING');
    }
    if (!slot)
      throw new ServiceUnavailableException('DOUYIN_PUBLISH_TASK_PREPARING');
    try {
      const existing = this.activeTask(slot);
      if (existing) return [existing];
      const task = await this.platform.createPublishVideoTask();
      const saved = await this.slots.updateOne(
        { _id: key, owner },
        { $push: { tasks: task } },
      );
      if (!saved.matchedCount)
        throw new ServiceUnavailableException('DOUYIN_PUBLISH_TASK_PREPARING');
      return [task.id];
    } catch (error) {
      if (error instanceof DouyinMiniappSchemaError) {
        this.logger.warn(`${error.code} err_no=${error.errNo ?? ''}`);
        throw new ServiceUnavailableException(error.code);
      }
      throw error;
    } finally {
      await this.slots.updateOne(
        { _id: key, owner },
        { $set: { owner: null, creatingUntil: null } },
      );
    }
  }

  /** 查找仍有至少五分钟有效期的任务。
   * @keyword-cn 任务关联, 任务复用
   * @keyword-en task-mapping, task-reuse
   */
  private activeTask(slot: PublishVideoTaskSlot | null): string {
    if (!slot) return '';
    for (const task of slot.tasks) {
      if (task.expiresAt.getTime() > Date.now() + 300000) return task.id;
    }
    return '';
  }

  /** 处理平台原生事件名，关联任务后记录作品ID和审核公开状态；未知事件只确认接收。
   * @keyword-cn 发布回调, 作品标识
   * @keyword-en publish-webhook, video-identity
   */
  async receive(
    body: Record<string, unknown>,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    if (body.event === 'verify_webhook') {
      const content = this.parseContent(body.content);
      const challenge = content.challenge;
      if (
        !(typeof challenge === 'number' && Number.isFinite(challenge)) &&
        !(
          typeof challenge === 'string' &&
          challenge.length > 0 &&
          challenge.length <= 256
        )
      )
        throw new BadRequestException('DOUYIN_WEBHOOK_CHALLENGE_INVALID');
      return { challenge };
    }
    if (body.event !== 'douyin_video_task_message') return {};
    const content = this.parseContent(body.content);
    const taskId =
      typeof content.task_id === 'string' ? content.task_id.trim() : '';
    const videoId =
      typeof content.video_id === 'string' ? content.video_id.trim() : '';
    const status = content.status;
    const timestamp = content.time_stamp;
    if (
      !taskId ||
      taskId.length > 200 ||
      !videoId ||
      videoId.length > 200 ||
      ![0, 1, 2].includes(status as number) ||
      !Number.isSafeInteger(timestamp) ||
      Number(timestamp) <= 0
    )
      throw new BadRequestException('DOUYIN_WEBHOOK_TASK_INVALID');
    const slot = await this.slots.findOne({
      appId: String(body.client_key),
      'tasks.id': taskId,
    });
    if (!slot) {
      this.logger.warn('DOUYIN_WEBHOOK_TASK_NOT_FOUND');
      return {};
    }
    await this.works.applyPublishWebhook(slot.workId, {
      taskId,
      videoId,
      status: status as 0 | 1 | 2,
      timestamp: Number(timestamp),
      messageId,
    });
    return {};
  }

  /** 兼容平台 content 对象及 JSON 字符串格式。
   * @keyword-cn 发布回调, 消息解析
   * @keyword-en publish-webhook, message-parse
   */
  private parseContent(value: unknown): Record<string, unknown> {
    let parsed = value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw new BadRequestException('DOUYIN_WEBHOOK_CONTENT_INVALID');
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BadRequestException('DOUYIN_WEBHOOK_CONTENT_INVALID');
    return parsed as Record<string, unknown>;
  }
}
