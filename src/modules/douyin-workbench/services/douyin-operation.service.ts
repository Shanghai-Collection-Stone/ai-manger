import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
} from '../entities/douyin-workbench.entity.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinOperation = 'generate' | 'publish' | 'crawl';
type DouyinScope = { tenantId?: string; userId: string };
type DirectConfig = {
  url: string;
  apiKey?: string;
  statusUrlTemplate?: string;
};

/**
 * @description 通过显式配置的直连 HTTP 服务执行视频生成、抖音发布与数据抓取，不隐式使用 SuperClaw。
 * @keyword-cn 抖音直连接口, 禁止隐式节点
 * @keyword-en douyin-direct-api, no-implicit-super-claw
 */
@Injectable()
export class DouyinOperationService {
  private readonly operations: Collection<DouyinOperationEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly billing: AiBillingService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
    void this.ensureIndexes();
  }

  /**
   * @description 创建租户用户、选题和更新时间查询索引。
   * @keyword-cn 抖音调用索引, 操作查询
   * @keyword-en douyin-operation-indexes, operation-query
   */
  async ensureIndexes(): Promise<void> {
    await this.operations.createIndex({ id: 1 }, { unique: true });
    await this.operations.createIndex({
      tenantId: 1,
      userId: 1,
      updatedAt: -1,
    });
    await this.operations.createIndex({
      tenantId: 1,
      userId: 1,
      topicId: 1,
      operation: 1,
    });
  }

  /**
   * @description 把真实分镜提交给显式配置的视频生成服务，成功受理后记录响应并扣除生视频服务 Credit。
   * @keyword-cn 直连视频生成, 生视频扣费
   * @keyword-en direct-video-generation, video-service-charge
   */
  async createGeneration(
    topicId: number,
    prompt: string | undefined,
    user: AdminUserEntity,
  ): Promise<DouyinOperationView> {
    const scope = this.scopeOf(user);
    const topic = await this.requireChild(topicId, scope);
    if (!topic.storyboard.length)
      throw new BadRequestException('DOUYIN_STORYBOARD_REQUIRED');
    const config = this.readConfig('generate');
    const request = {
      topicId: topic.id,
      title: topic.title,
      aspectRatio: '9:16',
      storyboard: topic.storyboard,
      prompt: String(prompt ?? '').trim() || undefined,
    };
    const operationId = randomUUID();
    await this.billing.chargeService({
      serviceCode: 'video-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId,
      source: 'douyin-workbench.video-generation',
      platformScope: !scope.tenantId,
    });
    const operation = await this.billing.runWithServiceBilling(() =>
      this.invoke('generate', topic.id, request, config, scope, operationId),
    );
    const generatedVideoId = this.readGeneratedVideoId(operation.result);
    if (generatedVideoId) {
      await this.repository.update(topic.id, { generatedVideoId }, scope);
    }
    return operation;
  }

  /**
   * @description 把当前租户真实视频库素材和文案提交给显式配置的抖音发布服务。
   * @keyword-cn 直连抖音发布, 真实视频素材
   * @keyword-en direct-douyin-publish, real-video-asset
   */
  async createPublish(
    topicId: number,
    input: { videoId: number; caption: string },
    user: AdminUserEntity,
  ): Promise<DouyinOperationView> {
    const scope = this.scopeOf(user);
    await this.requireChild(topicId, scope);
    const video = await this.repository.requireVideo(input.videoId, scope);
    const videoUrl = typeof video.url === 'string' ? video.url.trim() : '';
    if (!videoUrl) throw new BadRequestException('DOUYIN_VIDEO_URL_MISSING');
    return await this.invoke(
      'publish',
      topicId,
      {
        topicId,
        videoId: input.videoId,
        videoUrl,
        caption: input.caption.trim(),
      },
      this.readConfig('publish'),
      scope,
    );
  }

  /**
   * @description 把真实作品 ID 提交给显式配置的抖音数据服务并持久化返回指标。
   * @keyword-cn 直连抖音抓取, 真实作品数据
   * @keyword-en direct-douyin-crawl, real-published-metrics
   */
  async createCrawl(
    topicId: number,
    platformVideoId: string,
    user: AdminUserEntity,
  ): Promise<DouyinOperationView> {
    const scope = this.scopeOf(user);
    await this.requireChild(topicId, scope);
    return await this.invoke(
      'crawl',
      topicId,
      { topicId, platformVideoId: platformVideoId.trim() },
      this.readConfig('crawl'),
      scope,
    );
  }

  /**
   * @description 查询当前用户直连接口调用的真实状态与原始业务结果。
   * @keyword-cn 查询抖音调用, 真实接口结果
   * @keyword-en list-douyin-operations, real-api-result
   */
  async list(scope: DouyinScope): Promise<DouyinOperationView[]> {
    const rows = await this.operations
      .find({ userId: scope.userId, ...this.tenantFilter(scope.tenantId) })
      .sort({ updatedAt: -1 })
      .limit(200)
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 使用配置的状态地址同步异步供应商任务，不存在状态模板时明确拒绝。
   * @keyword-cn 同步抖音调用状态, 异步任务查询
   * @keyword-en sync-douyin-operation, async-job-status
   */
  async sync(id: string, user: AdminUserEntity): Promise<DouyinOperationView> {
    const scope = this.scopeOf(user);
    const row = await this.operations.findOne({
      id,
      userId: scope.userId,
      ...this.tenantFilter(scope.tenantId),
    });
    if (!row) throw new BadRequestException('DOUYIN_OPERATION_NOT_FOUND');
    if (!row.externalId)
      throw new BadRequestException('DOUYIN_OPERATION_EXTERNAL_ID_MISSING');
    const config = this.readConfig(row.operation);
    if (!config.statusUrlTemplate)
      throw new ServiceUnavailableException('DOUYIN_STATUS_API_NOT_CONFIGURED');
    const url = config.statusUrlTemplate.replace(
      '{id}',
      encodeURIComponent(row.externalId),
    );
    const response = await this.fetchJson(
      url,
      { method: 'GET' },
      config.apiKey,
    );
    const updated = await this.operations.findOneAndUpdate(
      { id: row.id },
      {
        $set: {
          status: this.readStatus(response),
          result: response,
          error: this.readError(response),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    const finalRow = updated ?? row;
    if (finalRow.operation === 'generate') {
      const generatedVideoId = this.readGeneratedVideoId(finalRow.result);
      if (generatedVideoId) {
        await this.repository.update(
          finalRow.topicId,
          { generatedVideoId },
          scope,
        );
      }
    }
    return this.toView(finalRow);
  }

  /**
   * @description 调用配置好的外部 HTTP 接口并保存原始请求与响应审计记录。
   * @keyword-cn 调用抖音外部接口, 保存调用审计
   * @keyword-en invoke-douyin-external-api, persist-call-audit
   */
  private async invoke(
    operation: DouyinOperation,
    topicId: number,
    request: Record<string, unknown>,
    config: DirectConfig,
    scope: DouyinScope,
    operationId?: string,
  ): Promise<DouyinOperationView> {
    const now = new Date();
    const id = operationId ?? randomUUID();
    try {
      const response = await this.fetchJson(
        config.url,
        {
          method: 'POST',
          body: JSON.stringify({ operationId: id, ...request }),
        },
        config.apiKey,
      );
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id,
        operation,
        topicId,
        tenantId: scope.tenantId,
        userId: scope.userId,
        request,
        status: this.readStatus(response),
        externalId: this.readExternalId(response),
        result: response,
        error: this.readError(response),
        createdAt: now,
        updatedAt: now,
      };
      await this.operations.insertOne(doc);
      return this.toView(doc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.operations.insertOne({
        _id: new ObjectId(),
        id,
        operation,
        topicId,
        tenantId: scope.tenantId,
        userId: scope.userId,
        request,
        status: 'failed',
        error: message,
        createdAt: now,
        updatedAt: now,
      });
      throw error;
    }
  }

  /**
   * @description 发起带超时和可选 Bearer 密钥的 JSON 请求，非 2xx 原样报错。
   * @keyword-cn 抖音HTTP请求, 超时控制
   * @keyword-en douyin-http-request, timeout-control
   */
  private async fetchJson(
    url: string,
    init: RequestInit,
    apiKey?: string,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch (error) {
      throw new BadGatewayException(
        `DOUYIN_DIRECT_API_NETWORK_ERROR: ${String(error)}`,
      );
    }
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'DOUYIN_DIRECT_API_FAILED',
        status: response.status,
        response: data,
      });
    }
    return data;
  }

  /**
   * @description 从环境读取指定直连接口与状态查询模板，未配置时阻止业务操作。
   * @keyword-cn 读取抖音直连配置, 缺配置拒绝
   * @keyword-en read-douyin-direct-config, reject-unconfigured
   */
  private readConfig(operation: DouyinOperation): DirectConfig {
    const prefix =
      operation === 'generate'
        ? 'DOUYIN_VIDEO_GENERATION'
        : operation === 'publish'
          ? 'DOUYIN_PUBLISH'
          : 'DOUYIN_DATA';
    const url = String(process.env[`${prefix}_URL`] ?? '').trim();
    if (!url) throw new ServiceUnavailableException(`${prefix}_NOT_CONFIGURED`);
    return {
      url,
      apiKey:
        String(process.env[`${prefix}_API_KEY`] ?? '').trim() || undefined,
      statusUrlTemplate:
        String(process.env[`${prefix}_STATUS_URL_TEMPLATE`] ?? '').trim() ||
        undefined,
    };
  }

  /**
   * @description 从供应商响应读取通用任务 ID 字段。
   * @keyword-cn 解析外部任务ID, 供应商兼容
   * @keyword-en parse-external-job-id, provider-compatibility
   */
  private readExternalId(
    response: Record<string, unknown>,
  ): string | undefined {
    const value =
      response.id ?? response.taskId ?? response.jobId ?? response.itemId;
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined;
  }

  /**
   * @description 读取供应商响应状态，缺失时只标记已受理。
   * @keyword-cn 解析外部状态, 受理状态
   * @keyword-en parse-external-status, accepted-status
   */
  private readStatus(response: Record<string, unknown>): string {
    const value = response.status ?? response.state;
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : 'accepted';
  }

  /**
   * @description 读取供应商结构化错误供前端和审计展示。
   * @keyword-cn 解析外部错误, 调用失败原因
   * @keyword-en parse-external-error, call-failure-reason
   */
  private readError(response: Record<string, unknown>): string | undefined {
    const value = response.error ?? response.errorMessage;
    return value === undefined
      ? undefined
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  }

  /**
   * @description 从同步或异步视频生成响应读取已登记到真实视频库的业务 ID。
   * @keyword-cn 读取生成视频ID, 自动绑定成片
   * @keyword-en read-generated-video-id, auto-bind-output
   */
  private readGeneratedVideoId(result: unknown): number | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const response = result as Record<string, unknown>;
    const nested =
      response.data && typeof response.data === 'object'
        ? (response.data as Record<string, unknown>)
        : {};
    const id = Number(response.videoId ?? nested.videoId);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  }

  /**
   * @description 校验当前用户拥有的抖音子选题。
   * @keyword-cn 校验抖音子选题, 操作所有权
   * @keyword-en require-douyin-child, operation-ownership
   */
  private async requireChild(topicId: number, scope: DouyinScope) {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }

  /**
   * @description 从后台用户生成租户用户作用域。
   * @keyword-cn 抖音用户作用域, 租户身份
   * @keyword-en douyin-user-scope, tenant-identity
   */
  private scopeOf(user: AdminUserEntity): DouyinScope {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }

  /**
   * @description 构造母平台或租户数据过滤边界。
   * @keyword-cn 抖音租户过滤, 母平台边界
   * @keyword-en douyin-tenant-filter, platform-boundary
   */
  private tenantFilter(tenantId?: string): Record<string, unknown> {
    return tenantId
      ? { tenantId }
      : {
          $or: [
            { tenantId: { $exists: false } },
            { tenantId: null },
            { tenantId: '' },
          ],
        };
  }

  /**
   * @description 移除数据库字段和请求内容后返回调用安全视图。
   * @keyword-cn 抖音调用安全视图, 隐藏请求字段
   * @keyword-en douyin-operation-view, hide-request-fields
   */
  private toView(row: DouyinOperationEntity): DouyinOperationView {
    return {
      id: row.id,
      operation: row.operation,
      topicId: row.topicId,
      status: row.status,
      externalId: row.externalId,
      result: row.result,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
