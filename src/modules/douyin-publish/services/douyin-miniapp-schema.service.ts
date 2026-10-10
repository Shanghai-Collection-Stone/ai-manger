import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 抖音开放平台默认网关；沙盒联调时把 DOUYIN_OPEN_API_BASE 配成 https://open-sandbox.douyin.com */
const DEFAULT_DOUYIN_OPEN_API_BASE = 'https://open.douyin.com';
/** 小程序发布页路径，与 publish-douyin 的 pages.json 一致 */
const DEFAULT_PUBLISH_PAGE = 'pages/publish/index';
/** client_token 提前多久视为过期（官方新旧令牌有 5 分钟重叠期） */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** 抖音接口请求超时 */
const DOUYIN_OPEN_API_TIMEOUT_MS = 10 * 1000;
/** access_token 无效（被其他进程刷新挤掉等），刷新后重试一次 */
const ACCESS_TOKEN_INVALID_ERR_NO = 28001003;

/**
 * @description 抖音开放平台调用失败，`code` 为业务错误码，`detail` 带抖音返回的原始错误便于排查。
 * @keyword-cn 抖音开放平台错误, 生成Schema失败
 * @keyword-en douyin-open-api-error, generate-schema-failure
 */
export class DouyinMiniappSchemaError extends Error {
  /**
   * @description 记录错误码与抖音原始错误。
   * @keyword-cn 抖音开放平台错误, 错误码
   * @keyword-en douyin-open-api-error, error-code
   */
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly errNo?: number,
  ) {
    super(code);
  }
}

/**
 * @description 抖音小程序 Schema 生成：用 client_token 调「生成 SchemaV2」，把发布库的扫码参数做成抖音 App 内可直接打开小程序发布页的
 *   `sslocal://miniapp?ticket=…` 链接。client_token 按进程缓存并提前 5 分钟刷新，遇到令牌失效刷新后重试一次。
 * @keyword-cn 抖音小程序Schema, 扫码唤起小程序
 * @keyword-en douyin-miniapp-schema, qr-open-miniapp
 */
@Injectable()
export class DouyinMiniappSchemaService {
  private readonly logger = new Logger(DouyinMiniappSchemaService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  /**
   * @description 注入配置读取 AppID、AppSecret 与网关地址。
   * @keyword-cn 抖音小程序Schema, 配置读取
   * @keyword-en douyin-miniapp-schema, config-read
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * @description 读取小程序 AppID、AppSecret、网关与发布页路径；AppID 或 AppSecret 缺失时返回 null。
   * @keyword-cn 小程序配置, 配置读取
   * @keyword-en miniapp-config, config-read
   */
  private readSettings(): {
    appId: string;
    appSecret: string;
    apiBase: string;
    page: string;
  } | null {
    const read = (key: string) =>
      String(this.config.get<string>(key) ?? '').trim();
    const appId = read('DOUYIN_MINIAPP_APP_ID');
    const appSecret = read('DOUYIN_MINIAPP_APP_SECRET');
    if (!appId || !appSecret) return null;
    return {
      appId,
      appSecret,
      apiBase: (
        read('DOUYIN_OPEN_API_BASE') || DEFAULT_DOUYIN_OPEN_API_BASE
      ).replace(/\/+$/, ''),
      page: read('DOUYIN_MINIAPP_PUBLISH_PAGE') || DEFAULT_PUBLISH_PAGE,
    };
  }

  /**
   * @description 是否已配置小程序 AppID 与 AppSecret；未配置时调用方沿用原有二维码内容。
   * @keyword-cn 小程序配置, 是否启用Schema
   * @keyword-en miniapp-config, schema-enabled
   */
  isConfigured(): boolean {
    return this.readSettings() !== null;
  }

  /**
   * @description 当前 Schema 的身份键：AppID + 发布页 + 启动参数。任何一项变了，已缓存的 Schema 就不能再用。
   * @keyword-cn Schema身份键, 失效判断
   * @keyword-en schema-identity-key, cache-invalidation
   * @param {Record<string, string>} query 启动参数。
   * @returns {string | null} 未配置时为 null。
   */
  buildSchemaKey(query: Record<string, string>): string | null {
    const settings = this.readSettings();
    if (!settings) return null;
    return `${settings.appId}|${settings.page}|${JSON.stringify(query)}`;
  }

  /**
   * @description 生成长期有效的 Schema（`no_expire: true`），启动参数原样作为页面 options 交给小程序。
   * @keyword-cn 生成长期Schema, 扫码唤起小程序
   * @keyword-en generate-permanent-schema, qr-open-miniapp
   * @param {Record<string, string>} query 启动参数，小程序在 onLoad 的 options 里按键读取。
   * @returns {Promise<string>} `sslocal://miniapp?ticket=…`。
   * @throws {DouyinMiniappSchemaError} 未配置或抖音接口失败。
   */
  async generatePermanentSchema(
    query: Record<string, string>,
  ): Promise<string> {
    const settings = this.readSettings();
    if (!settings) {
      throw new DouyinMiniappSchemaError('DOUYIN_MINIAPP_NOT_CONFIGURED');
    }
    const body = {
      app_id: settings.appId,
      path: settings.page,
      query: JSON.stringify(query),
      no_expire: true,
    };
    let token = await this.getClientToken(settings, false);
    let result = await this.postSchema(settings, token, body);
    if (result.errNo === ACCESS_TOKEN_INVALID_ERR_NO) {
      token = await this.getClientToken(settings, true);
      result = await this.postSchema(settings, token, body);
    }
    if (result.errNo !== 0 || !result.schema) {
      throw new DouyinMiniappSchemaError(
        'DOUYIN_MINIAPP_SCHEMA_FAILED',
        `err_no=${result.errNo} err_msg=${result.errMsg} log_id=${result.logId}`,
        result.errNo,
      );
    }
    return result.schema;
  }

  /**
   * @description 调用「生成 SchemaV2」，把响应整理成错误码、错误信息与 Schema。
   * @keyword-cn 生成Schema请求, 抖音开放平台
   * @keyword-en generate-schema-request, douyin-open-api
   */
  private async postSchema(
    settings: { apiBase: string },
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ errNo: number; errMsg: string; logId: string; schema: string }> {
    const data = await this.postJson(
      `${settings.apiBase}/api/apps/v1/url/generate_schema/`,
      body,
      { 'access-token': token },
    );
    const payload = (data ?? {}) as {
      err_no?: number;
      err_msg?: string;
      log_id?: string;
      data?: { schema?: string };
    };
    return {
      errNo: Number(payload.err_no ?? -1),
      errMsg: String(payload.err_msg ?? ''),
      logId: String(payload.log_id ?? ''),
      schema: String(payload.data?.schema ?? '').trim(),
    };
  }

  /**
   * @description 取 client_token：缓存未到期直接用，否则单路在途地向 `/oauth/client_token/` 换新的。
   * @keyword-cn 获取client_token, 令牌缓存
   * @keyword-en get-client-token, token-cache
   * @param {boolean} forceRefresh 令牌被判无效时强制刷新。
   */
  private async getClientToken(
    settings: { appId: string; appSecret: string; apiBase: string },
    forceRefresh: boolean,
  ): Promise<string> {
    if (
      !forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()
    ) {
      return this.cachedToken.value;
    }
    if (!this.pendingToken) {
      this.pendingToken = this.fetchClientToken(settings).finally(() => {
        this.pendingToken = null;
      });
    }
    return this.pendingToken;
  }

  /**
   * @description 用 AppID / AppSecret 以 client_credential 方式换取 client_token 并写入缓存。
   * @keyword-cn 获取client_token, 非用户授权
   * @keyword-en get-client-token, client-credential
   */
  private async fetchClientToken(settings: {
    appId: string;
    appSecret: string;
    apiBase: string;
  }): Promise<string> {
    const data = (await this.postJson(
      `${settings.apiBase}/oauth/client_token/`,
      {
        client_key: settings.appId,
        client_secret: settings.appSecret,
        grant_type: 'client_credential',
      },
    )) as {
      data?: {
        access_token?: string;
        expires_in?: number;
        error_code?: number;
        description?: string;
      };
      message?: string;
    } | null;
    const token = String(data?.data?.access_token ?? '').trim();
    if (!token) {
      throw new DouyinMiniappSchemaError(
        'DOUYIN_MINIAPP_TOKEN_FAILED',
        `error_code=${data?.data?.error_code ?? ''} description=${data?.data?.description ?? data?.message ?? ''}`,
      );
    }
    const expiresInSeconds = Number(data?.data?.expires_in) || 7200;
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    return token;
  }

  /**
   * @description 发 JSON POST 并解析响应；网络错误或非 JSON 响应统一抛出带原因的错误。
   * @keyword-cn 抖音接口请求, 超时控制
   * @keyword-en douyin-open-api-request, timeout-control
   */
  private async postJson(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DOUYIN_OPEN_API_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[douyin-open-api] request_failed url=${url} ${message}`,
      );
      throw new DouyinMiniappSchemaError(
        'DOUYIN_OPEN_API_UNREACHABLE',
        message,
      );
    }
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new DouyinMiniappSchemaError(
        'DOUYIN_OPEN_API_BAD_RESPONSE',
        `status=${response.status} body=${text.slice(0, 200)}`,
      );
    }
  }
}
