import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { extname } from 'path';

/**
 * @description 阿里云 OSS 直传票据签发与对象清理。
 *
 *   **不引 ali-oss SDK**：这里只需要两件事——签一张 PostObject 表单策略、删几个对象。
 *   前者是 `base64(policyJSON)` + `HMAC-SHA1`，后者是一个带签名头的 DELETE，两个加起来
 *   不到 60 行 `node:crypto`；为此拉进一个几 MB、自带重试与分片逻辑的 SDK 不划算，还多一条
 *   要跟着升级的供应链。要上分片续传时再换 SDK 也不迟，届时改的只有这个文件。
 *
 *   **签名只在服务端**：AccessKeySecret 不下发给桌面端——安装包是可解包的，密钥落到用户
 *   机器上等于公开。前端拿到的票据限定了对象键、大小上限和过期时间。
 * @keyword-cn OSS存储, 直传签名, 对象删除
 * @keyword-en oss-storage, post-policy-signature, delete-object
 */

/** @description 直传场景，决定对象前缀与大小上限。 */
export type OssUploadScene = 'video' | 'poster';

/**
 * @description 签发给前端的直传票据，字段与桌面端 `ossDirectUpload.js` 逐字对应。
 * @keyword-cn 直传票据
 * @keyword-en upload-ticket
 */
export interface OssUploadTicket {
  mode: 'post';
  host: string;
  key: string;
  publicUrl: string;
  formFields: Record<string, string>;
  maxSizeBytes: number;
  expireAt: string;
}

/** @description 默认视频单文件上限 2GB。 */
const DEFAULT_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** @description 默认封面单文件上限 10MB，抓帧出来的 JPEG 远小于此。 */
const DEFAULT_POSTER_MAX_BYTES = 10 * 1024 * 1024;
/** @description 票据默认有效期，够传完一个大文件的握手时间，又不至于长期可复用。 */
const DEFAULT_EXPIRE_SECONDS = 15 * 60;
/** @description 对象键根前缀。 */
const DEFAULT_ROOT_DIR = 'video-library';

@Injectable()
export class OssStorageService {
  /**
   * @description 读取 OSS 配置。每次读而不是构造时缓存，是为了让运维改完环境变量重启进程即可
   *   生效，不必关心本服务的实例化时机。
   * @keyword-cn OSS配置
   * @keyword-en oss-config
   * @returns {{region: string, bucket: string, accessKeyId: string, accessKeySecret: string, endpoint: string, publicBase: string, rootDir: string}} 配置项。
   */
  private readConfig(): {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    publicBase: string;
    rootDir: string;
  } {
    const region = String(process.env.OSS_REGION ?? '').trim();
    const bucket = String(process.env.OSS_BUCKET ?? '').trim();
    const endpoint =
      String(process.env.OSS_ENDPOINT ?? '').trim() ||
      (region ? `${region}.aliyuncs.com` : '');
    return {
      region,
      bucket,
      accessKeyId: String(process.env.OSS_ACCESS_KEY_ID ?? '').trim(),
      accessKeySecret: String(process.env.OSS_ACCESS_KEY_SECRET ?? '').trim(),
      endpoint: endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
      publicBase: String(process.env.OSS_PUBLIC_BASE_URL ?? '')
        .trim()
        .replace(/\/+$/, ''),
      rootDir:
        String(process.env.OSS_VIDEO_LIBRARY_DIR ?? '').trim() ||
        DEFAULT_ROOT_DIR,
    };
  }

  /**
   * @description 判断 OSS 是否已配置齐全。
   * @keyword-cn OSS已配置
   * @keyword-en oss-configured
   * @returns {boolean} 是否可用。
   */
  isConfigured(): boolean {
    const config = this.readConfig();
    return Boolean(
      config.bucket &&
      config.endpoint &&
      config.accessKeyId &&
      config.accessKeySecret,
    );
  }

  /**
   * @description 读取配置，缺项直接 503。**不降级到本地磁盘**：静默落盘会让"视频已入库"
   *   这件事在没有对象存储的环境里也成立，等真正配好 OSS 时数据已经散在两处，对不上账。
   * @keyword-cn OSS配置校验
   * @keyword-en require-oss-config
   * @returns {ReturnType<OssStorageService['readConfig']>} 配置项。
   * @throws {ServiceUnavailableException} 配置缺失时抛出 `OSS_NOT_CONFIGURED`。
   */
  private requireConfig(): ReturnType<OssStorageService['readConfig']> {
    const config = this.readConfig();
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('OSS_NOT_CONFIGURED');
    }
    return config;
  }

  /**
   * @description 单文件大小上限，按场景取环境变量或默认值。
   * @keyword-cn 上传大小上限
   * @keyword-en max-upload-bytes
   * @param {OssUploadScene} scene - 直传场景。
   * @returns {number} 字节上限。
   */
  maxBytesOf(scene: OssUploadScene): number {
    const raw =
      scene === 'poster'
        ? process.env.OSS_POSTER_MAX_BYTES
        : process.env.OSS_VIDEO_MAX_BYTES;
    const parsed = Number(String(raw ?? '').trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return scene === 'poster'
      ? DEFAULT_POSTER_MAX_BYTES
      : DEFAULT_VIDEO_MAX_BYTES;
  }

  /**
   * @description 生成对象键：`<root>/<scene>/<tenant>/<yyyy>/<mm>/<uuid><ext>`。
   *   文件名只取扩展名、主体换成 UUID——用户的原始文件名带中文、空格和 `..` 的都有，
   *   拼进对象键会同时踩上编码和路径穿越两个坑；展示名另存在数据库里，不影响用户看到的名字。
   * @keyword-cn 对象键生成, 路径穿越防护
   * @keyword-en build-object-key, path-traversal-guard
   * @param {{scene: OssUploadScene, fileName?: string, tenantId?: string}} input - 生成参数。
   * @returns {string} 对象键。
   */
  buildObjectKey(input: {
    scene: OssUploadScene;
    fileName?: string;
    tenantId?: string;
  }): string {
    const { rootDir } = this.readConfig();
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const rawExt = extname(String(input.fileName ?? '')).toLowerCase();
    const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '';
    const tenant =
      String(input.tenantId ?? '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '') || 'platform';
    return `${rootDir}/${input.scene}/${tenant}/${year}/${month}/${randomUUID()}${ext}`;
  }

  /**
   * @description 拼可访问地址。配了 `OSS_PUBLIC_BASE_URL`（CDN / 自定义域名）就以它为准，
   *   否则回落到 bucket 的默认外网域名。
   * @keyword-cn 可访问地址, CDN域名
   * @keyword-en public-url, cdn-domain
   * @param {string} key - 对象键。
   * @returns {string} 可访问地址，key 为空时返回空串。
   */
  publicUrl(key: string): string {
    const objectKey = String(key ?? '').replace(/^\/+/, '');
    if (!objectKey) return '';
    const config = this.readConfig();
    if (config.publicBase) return `${config.publicBase}/${objectKey}`;
    if (!config.bucket || !config.endpoint) return '';
    return `https://${config.bucket}.${config.endpoint}/${objectKey}`;
  }

  /**
   * @description 签发一张 PostObject 直传票据。策略里逐条锁死 `key`、大小区间、
   *   `success_action_status` 与 `Content-Type`：策略没覆盖的表单字段 OSS 会拒收，
   *   而覆盖得越死，这张票据被拿去传别的东西的空间越小。
   * @keyword-cn 直传票据, 直传签名
   * @keyword-en upload-ticket, post-policy-signature
   * @param {{scene: OssUploadScene, fileName?: string, contentType?: string, tenantId?: string}} input - 签发参数。
   * @returns {OssUploadTicket} 直传票据。
   * @throws {ServiceUnavailableException} OSS 未配置时抛出。
   */
  createUploadTicket(input: {
    scene: OssUploadScene;
    fileName?: string;
    contentType?: string;
    tenantId?: string;
  }): OssUploadTicket {
    const config = this.requireConfig();
    const key = this.buildObjectKey({
      scene: input.scene,
      fileName: input.fileName,
      tenantId: input.tenantId,
    });
    const maxSizeBytes = this.maxBytesOf(input.scene);
    const expireSeconds = this.readExpireSeconds();
    const expiration = new Date(Date.now() + expireSeconds * 1000);
    const contentType = this.normalizeContentType(input.contentType);

    const conditions: unknown[] = [
      { bucket: config.bucket },
      ['eq', '$key', key],
      ['content-length-range', 0, maxSizeBytes],
      ['eq', '$success_action_status', '200'],
    ];
    if (contentType) conditions.push(['eq', '$Content-Type', contentType]);

    const policy = Buffer.from(
      JSON.stringify({ expiration: expiration.toISOString(), conditions }),
      'utf8',
    ).toString('base64');
    const signature = createHmac('sha1', config.accessKeySecret)
      .update(policy, 'utf8')
      .digest('base64');

    const formFields: Record<string, string> = {
      key,
      policy,
      OSSAccessKeyId: config.accessKeyId,
      Signature: signature,
      success_action_status: '200',
    };
    if (contentType) formFields['Content-Type'] = contentType;

    return {
      mode: 'post',
      host: `https://${config.bucket}.${config.endpoint}`,
      key,
      publicUrl: this.publicUrl(key),
      formFields,
      maxSizeBytes,
      expireAt: expiration.toISOString(),
    };
  }

  /**
   * @description 读取票据有效期秒数。
   * @keyword-cn 票据有效期
   * @keyword-en ticket-expire-seconds
   * @returns {number} 有效期秒数。
   */
  private readExpireSeconds(): number {
    const parsed = Number(
      String(process.env.OSS_SIGNATURE_EXPIRE_SECONDS ?? '').trim(),
    );
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.floor(parsed), 3600);
    }
    return DEFAULT_EXPIRE_SECONDS;
  }

  /**
   * @description 归一化 Content-Type：只放行 `type/subtype` 形状，带参数或含控制字符的一律丢弃。
   *   这个值会进签名策略，塞进奇怪内容会让签名和实际请求头对不上，报错还很难查。
   * @keyword-cn 内容类型归一化
   * @keyword-en normalize-content-type
   * @param {string} [value] - 原始值。
   * @returns {string} 归一化结果，不合法时为空串。
   */
  private normalizeContentType(value?: string): string {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase();
    return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(raw) ? raw : '';
  }

  /**
   * @description 删除一批对象。单个失败不影响其余，返回实际删掉的数量——记录已经从库里去掉了，
   *   为一个残留对象把整个删除接口判失败，用户会以为视频还在。
   * @keyword-cn 删除对象, 清理OSS
   * @keyword-en delete-objects, cleanup-oss
   * @param {string[]} keys - 对象键列表。
   * @returns {Promise<{deleted: number, failed: string[]}>} 删除统计与失败的键。
   */
  async deleteObjects(
    keys: string[],
  ): Promise<{ deleted: number; failed: string[] }> {
    const list = Array.from(
      new Set(
        (Array.isArray(keys) ? keys : [])
          .map((key) => String(key ?? '').replace(/^\/+/, ''))
          .filter(Boolean),
      ),
    );
    if (list.length === 0) return { deleted: 0, failed: [] };
    if (!this.isConfigured()) return { deleted: 0, failed: list };

    const failed: string[] = [];
    let deleted = 0;
    for (const key of list) {
      try {
        await this.deleteObject(key);
        deleted += 1;
      } catch {
        failed.push(key);
      }
    }
    return { deleted, failed };
  }

  /**
   * @description 服务端直接上传一个对象（用于 AI 生成的视频转存），V1 头签名，与删除同一套签名写法。
   * @keyword-cn 服务端上传对象, 生成视频转存
   * @keyword-en server-put-object, generated-video-transfer
   * @param {string} key - 对象键。
   * @param {Buffer} body - 文件内容。
   * @param {string} contentType - MIME 类型。
   * @returns {Promise<string>} 可访问地址。
   * @throws {ServiceUnavailableException} OSS 未配置时抛出。
   * @throws {Error} 非 2xx 响应时抛出 `OSS_PUT_FAILED_<status>`。
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    const config = this.requireConfig();
    const objectKey = String(key ?? '').replace(/^\/+/, '');
    const date = new Date().toUTCString();
    const signature = createHmac('sha1', config.accessKeySecret)
      .update(
        `PUT\n\n${contentType}\n${date}\n/${config.bucket}/${objectKey}`,
        'utf8',
      )
      .digest('base64');
    const url = `https://${config.bucket}.${config.endpoint}/${objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Date: date,
        'Content-Type': contentType,
        Authorization: `OSS ${config.accessKeyId}:${signature}`,
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok) {
      throw new Error(`OSS_PUT_FAILED_${response.status}`);
    }
    return this.publicUrl(objectKey);
  }

  /**
   * @description 删除单个对象：V1 头签名（`VERB\nContent-MD5\nContent-Type\nDate\n/bucket/key`）
   *   + `Authorization: OSS <ak>:<sig>`。OSS 对不存在的对象也返回 204，所以重复删除是幂等的。
   * @keyword-cn 删除对象, 请求签名
   * @keyword-en delete-object, request-signature
   * @param {string} key - 对象键。
   * @returns {Promise<void>} 删除完成。
   * @throws {Error} 非 2xx 响应时抛出。
   */
  private async deleteObject(key: string): Promise<void> {
    const config = this.requireConfig();
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/${key}`;
    const signature = createHmac('sha1', config.accessKeySecret)
      .update(`DELETE\n\n\n${date}\n${canonicalResource}`, 'utf8')
      .digest('base64');
    const url = `https://${config.bucket}.${config.endpoint}/${key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Date: date,
        Authorization: `OSS ${config.accessKeyId}:${signature}`,
      },
    });
    if (!response.ok) {
      throw new Error(`OSS_DELETE_FAILED_${response.status}`);
    }
  }
}
