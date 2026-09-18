import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  PixmaxAsset,
  PixmaxAssetCacheEntity,
  PixmaxRuntime,
  PixmaxSubmitInput,
  PixmaxTask,
} from '../entities/pixmax.entity.js';

/**
 * @description PixMax 默认域名。
 * @keyword-cn PixMax域名, 默认地址
 * @keyword-en pixmax-base-url, default-endpoint
 */
export const PIXMAX_DEFAULT_BASE_URL = 'https://app.pixmax.cn';

/**
 * @description 合规审核最长等待时间与轮询间隔（接口限流 QPS 2 / QPM 100）。
 * @keyword-cn 合规审核等待, 审核轮询
 * @keyword-en compliance-wait, compliance-polling
 */
export const PIXMAX_COMPLIANCE_WAIT_MS = 90 * 1000;
const PIXMAX_COMPLIANCE_POLL_MS = 3000;

/**
 * @description PixMax OpenAPI 客户端：统一鉴权与响应信封，提供项目、资产上传与合规审核、任务提交与查询。
 *   连接信息按调用传入（来自后台提供商配置），本服务不读环境变量。
 * @keyword-cn PixMax客户端, OpenAPI调用
 * @keyword-en pixmax-client, openapi-call
 */
@Injectable()
export class PixmaxClientService {
  private readonly logger = new Logger(PixmaxClientService.name);
  private readonly assetCache: Collection<PixmaxAssetCacheEntity>;
  /** 账号 + 项目名 → 项目 UUID，进程内缓存 */
  private readonly projectCache = new Map<string, string>();

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.assetCache =
      db.collection<PixmaxAssetCacheEntity>('pixmax_asset_cache');
    void this.ensureIndexes();
  }

  /**
   * @description 建立资产缓存唯一索引。
   * @keyword-cn 资产缓存索引, 唯一约束
   * @keyword-en asset-cache-index, unique-constraint
   */
  async ensureIndexes(): Promise<void> {
    await this.assetCache.createIndex(
      { accountKey: 1, sourceKey: 1 },
      { unique: true },
    );
  }

  /**
   * @description 按名称复用或创建 PixMax 项目（任务必须落在项目里），结果按账号缓存。
   * @keyword-cn 复用PixMax项目, 按名称建项目
   * @keyword-en ensure-pixmax-project, project-by-name
   * @param runtime 连接信息。
   * @param name 项目名（最长 64 字符）。
   * @returns {Promise<string>} 项目 UUID。
   */
  async ensureProject(runtime: PixmaxRuntime, name: string): Promise<string> {
    const projectName = name.trim().slice(0, 64);
    const cacheKey = `${this.accountKey(runtime)}|${projectName}`;
    const cached = this.projectCache.get(cacheKey);
    if (cached) return cached;
    const page = await this.request<{
      data?: Array<{ uuid?: string; name?: string; status?: string }>;
    }>(runtime, '/openapi/project/list', {
      name: projectName,
      pageIndex: 1,
      pageSize: 50,
    });
    const existing = (page?.data ?? []).find(
      (item) => item?.name === projectName && item?.status !== 'DISABLED',
    );
    const uuid =
      existing?.uuid ??
      (await this.request<string>(runtime, '/openapi/project/createOrUpdate', {
        name: projectName,
        description: '由 AI 工作台自动创建',
      }));
    if (!uuid) throw new BadGatewayException('PIXMAX_PROJECT_CREATE_FAILED');
    this.projectCache.set(cacheKey, uuid);
    return uuid;
  }

  /**
   * @description 上传一个文件为 PixMax 资产；`sourceKey` 相同的素材在同一账号下只上传一次。
   *   `requireCompliance` 时上传后发起合规审核并等待通过（火山系模型引用素材需要）。
   * @keyword-cn 上传PixMax资产, 上传去重
   * @keyword-en upload-pixmax-asset, dedupe-upload
   * @param runtime 连接信息。
   * @param input 缓存键、文件读取函数、文件名与类型、是否需要合规审核。
   * @returns {Promise<string>} 资产 UUID。
   */
  async uploadAssetCached(
    runtime: PixmaxRuntime,
    input: {
      sourceKey: string;
      fileName: string;
      contentType: string;
      load: () => Promise<Buffer>;
      requireCompliance?: boolean;
    },
  ): Promise<string> {
    const accountKey = this.accountKey(runtime);
    const cached = await this.assetCache.findOne({
      accountKey,
      sourceKey: input.sourceKey,
    });
    let assetUuid = cached?.assetUuid;
    if (!assetUuid) {
      const buffer = await input.load();
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(buffer)], { type: input.contentType }),
        input.fileName,
      );
      const asset = await this.request<PixmaxAsset>(
        runtime,
        '/openapi/assets/upload',
        form,
      );
      assetUuid = asset?.assetsUuid || asset?.assetUuid;
      if (!assetUuid) throw new BadGatewayException('PIXMAX_UPLOAD_FAILED');
      await this.assetCache
        .updateOne(
          { accountKey, sourceKey: input.sourceKey },
          {
            $set: { assetUuid },
            $setOnInsert: { _id: new ObjectId(), createdAt: new Date() },
          },
          { upsert: true },
        )
        .catch(() => undefined);
    }
    if (input.requireCompliance) {
      await this.waitCompliance(runtime, assetUuid);
    }
    return assetUuid;
  }

  /**
   * @description 发起资产合规审核并轮询到通过；失败抛 `PIXMAX_ASSET_COMPLIANCE_FAILED`，超时抛 `PIXMAX_ASSET_COMPLIANCE_TIMEOUT`。
   * @keyword-cn 资产合规审核, 等待审核通过
   * @keyword-en asset-compliance-check, wait-compliance
   * @param runtime 连接信息。
   * @param assetUuid 资产 UUID。
   */
  async waitCompliance(
    runtime: PixmaxRuntime,
    assetUuid: string,
  ): Promise<void> {
    const deadline = Date.now() + PIXMAX_COMPLIANCE_WAIT_MS;
    for (;;) {
      let status = '';
      let reason: unknown;
      try {
        const result = await this.request<{
          syncStatus?: string;
          auditStatus?: string;
          complianceStatus?: string;
          complianceErrorMsg?: unknown;
          syncErrorMsg?: unknown;
        }>(runtime, '/openapi/assetLibrary/compliance/check', { assetUuid });
        status = String(
          result?.complianceStatus ||
            result?.syncStatus ||
            result?.auditStatus ||
            '',
        ).toUpperCase();
        reason = result?.complianceErrorMsg ?? result?.syncErrorMsg;
      } catch (error) {
        // 20 秒防重锁或限流时继续等，其余错误直接抛出
        const message = error instanceof Error ? error.message : String(error);
        if (!/RateLimit|429|重复|Repeat|Duplicate/i.test(message)) throw error;
      }
      if (status === 'ACTIVE') return;
      if (status === 'FAILED') {
        throw new BadGatewayException(
          `PIXMAX_ASSET_COMPLIANCE_FAILED:${typeof reason === 'string' ? reason : JSON.stringify(reason ?? '')}`,
        );
      }
      if (Date.now() > deadline) {
        throw new BadGatewayException('PIXMAX_ASSET_COMPLIANCE_TIMEOUT');
      }
      await new Promise((resolve) =>
        setTimeout(resolve, PIXMAX_COMPLIANCE_POLL_MS),
      );
    }
  }

  /**
   * @description 提交生成任务，返回初始任务对象（通常为 QUEUE）。
   * @keyword-cn 提交PixMax任务, 生成任务
   * @keyword-en submit-pixmax-task, generation-task
   * @param runtime 连接信息。
   * @param input 项目、输入资产、输入文本与模型参数。
   * @returns {Promise<PixmaxTask>} 任务对象。
   */
  async submitTask(
    runtime: PixmaxRuntime,
    input: PixmaxSubmitInput,
  ): Promise<PixmaxTask> {
    const task = await this.request<PixmaxTask>(
      runtime,
      '/openapi/task/submit',
      input,
    );
    if (!task?.taskUuid) throw new BadGatewayException('PIXMAX_SUBMIT_FAILED');
    return task;
  }

  /**
   * @description 查询任务详情。
   * @keyword-cn 查询PixMax任务, 任务轮询
   * @keyword-en get-pixmax-task, task-polling
   * @param runtime 连接信息。
   * @param taskUuid 任务 UUID。
   * @returns {Promise<PixmaxTask>} 任务对象。
   */
  async getTask(runtime: PixmaxRuntime, taskUuid: string): Promise<PixmaxTask> {
    return this.request<PixmaxTask>(runtime, '/openapi/task/detail', {
      taskUuid,
    });
  }

  /**
   * @description 拼出资产的完整访问地址：优先 `fullUrl`，其次 `ossDomain + webUrl`，最后用 PixMax 域名兜底。
   * @keyword-cn 资产完整地址, 地址拼接
   * @keyword-en asset-full-url, url-join
   * @param runtime 连接信息。
   * @param asset 资产对象。
   * @param field 取原文件或预览图。
   * @returns {string} 完整地址，缺路径时为空串。
   */
  resolveAssetUrl(
    runtime: PixmaxRuntime,
    asset: PixmaxAsset,
    field: 'webUrl' | 'previewWebUrl' = 'webUrl',
  ): string {
    if (field === 'webUrl' && asset.fullUrl) return asset.fullUrl;
    const path = String(asset[field] ?? '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const domain =
      String(asset.ossDomain ?? '').trim() || this.baseUrlOf(runtime);
    return `${domain.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  /**
   * @description 下载 PixMax 返回的文件。
   * @keyword-cn 下载PixMax结果, 结果文件
   * @keyword-en download-pixmax-result, result-file
   * @param url 完整地址。
   * @returns {Promise<Buffer>} 文件内容。
   */
  async download(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (!response.ok) {
      throw new BadGatewayException(
        `PIXMAX_DOWNLOAD_FAILED_${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * @description 统一调用 OpenAPI：带 Bearer Key，按 `success / errCode / errMessage` 信封解析，返回 `data`。
   * @keyword-cn PixMax请求, 响应信封
   * @keyword-en pixmax-request, response-envelope
   * @throws {ServiceUnavailableException} PIXMAX_API_KEY_NOT_CONFIGURED。
   * @throws {BadGatewayException} PIXMAX_API_FAILED:<errCode>:<errMessage> / PIXMAX_NETWORK_ERROR。
   */
  private async request<T>(
    runtime: PixmaxRuntime,
    path: string,
    body: Record<string, unknown> | PixmaxSubmitInput | FormData,
  ): Promise<T> {
    const apiKey = String(runtime.apiKey ?? '').trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('PIXMAX_API_KEY_NOT_CONFIGURED');
    }
    const isForm = body instanceof FormData;
    const requestId = randomUUID().slice(0, 8);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrlOf(runtime)}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout((isForm ? 5 : 1) * 60 * 1000),
      });
    } catch (error) {
      throw new BadGatewayException(
        `PIXMAX_NETWORK_ERROR:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    let payload: {
      success?: boolean;
      errCode?: string | null;
      errMessage?: string | null;
      data?: T;
    } = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { success: false, errMessage: text.slice(0, 300) };
    }
    if (!response.ok || payload.success === false) {
      const reason = `${payload.errCode ?? `HTTP_${response.status}`}:${payload.errMessage ?? ''}`;
      this.logger.warn(`[request ${requestId}] ${path} 失败 ${reason}`);
      throw new BadGatewayException(`PIXMAX_API_FAILED:${reason}`);
    }
    return payload.data as T;
  }

  /**
   * @description 取连接的域名，未配置时用 PixMax 默认域名。
   * @keyword-cn 读取PixMax域名, 默认回退
   * @keyword-en read-pixmax-base-url, default-fallback
   */
  private baseUrlOf(runtime: PixmaxRuntime): string {
    return (
      String(runtime.baseUrl ?? '').trim() || PIXMAX_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  /**
   * @description 用域名 + Key 的摘要区分账号，缓存不落明文 Key。
   * @keyword-cn 账号摘要, 缓存隔离
   * @keyword-en account-digest, cache-isolation
   */
  private accountKey(runtime: PixmaxRuntime): string {
    return createHash('sha256')
      .update(
        `${this.baseUrlOf(runtime)}|${String(runtime.apiKey ?? '').trim()}`,
      )
      .digest('hex')
      .slice(0, 32);
  }
}
