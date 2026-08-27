import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  BrowserSessionEntity,
  BrowserSessionView,
} from '../entities/browser-auth.entity.js';
import { BrowserAuthCryptoService } from './browser-auth-crypto.service.js';

const PLATFORM_SCOPE_ID = '__platform__';
const MAX_STORAGE_STATE_BYTES = 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @description 按租户、工作区与站点管理加密的 Playwright storageState。
 * @keyword-cn 浏览器会话存储, Cookie复用
 * @keyword-en browser-session-storage, cookie-reuse
 */
@Injectable()
export class BrowserSessionService {
  private readonly sessions: Collection<BrowserSessionEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: BrowserAuthCryptoService,
  ) {
    this.sessions = db.collection<BrowserSessionEntity>('browser_sessions');
    void this.ensureIndexes();
  }

  /**
   * @description 建立浏览器会话的唯一作用域索引和过期时间索引。
   * @keyword-cn 浏览器会话索引, 作用域唯一
   * @keyword-en browser-session-indexes, unique-scope
   */
  async ensureIndexes(): Promise<void> {
    await this.sessions.createIndex(
      { scopeId: 1, workspaceId: 1, site: 1, profile: 1 },
      { unique: true },
    );
    await this.sessions.createIndex({ expiresAt: 1 });
  }

  /**
   * @description 读取仍有效的浏览器会话，并仅在本次调用中返回解密 storageState。
   * @keyword-cn 读取浏览器会话, 复用登录态
   * @keyword-en read-browser-session, reuse-login-state
   */
  async get(input: {
    tenantId?: string;
    workspaceId: string;
    site: string;
    profile?: string;
  }): Promise<BrowserSessionView> {
    const site = this.normalizeKey(input.site, 'BROWSER_SESSION_SITE_REQUIRED');
    const profile = this.normalizeProfile(input.profile);
    const row = await this.sessions.findOne({
      scopeId: input.tenantId || PLATFORM_SCOPE_ID,
      workspaceId: this.normalizeKey(
        input.workspaceId,
        'BROWSER_SESSION_WORKSPACE_REQUIRED',
      ),
      site,
      profile,
      expiresAt: { $gt: new Date() },
    });
    if (!row) {
      return {
        found: false,
        site,
        profile,
        storageStateJson: '',
        expiresAt: '',
        updatedAt: '',
      };
    }
    await this.sessions.updateOne(
      { _id: row._id },
      { $set: { lastUsedAt: new Date() } },
    );
    return {
      found: true,
      site,
      profile,
      storageStateJson: this.crypto.decrypt(row.storageState),
      expiresAt: row.expiresAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * @description 新增或覆盖当前任务作用域的加密浏览器 storageState。
   * @keyword-cn 保存浏览器会话, 加密Cookie
   * @keyword-en save-browser-session, encrypted-cookie
   */
  async upsert(input: {
    tenantId?: string;
    workspaceId: string;
    site: string;
    profile?: string;
    storageStateJson: string;
    expiresAt?: string;
  }): Promise<BrowserSessionView> {
    const workspaceId = this.normalizeKey(
      input.workspaceId,
      'BROWSER_SESSION_WORKSPACE_REQUIRED',
    );
    const site = this.normalizeKey(input.site, 'BROWSER_SESSION_SITE_REQUIRED');
    const profile = this.normalizeProfile(input.profile);
    const storageStateJson = this.validateStorageState(input.storageStateJson);
    const expiresAt = this.readExpiry(input.expiresAt);
    const now = new Date();
    await this.sessions.findOneAndUpdate(
      {
        scopeId: input.tenantId || PLATFORM_SCOPE_ID,
        workspaceId,
        site,
        profile,
      },
      {
        $set: {
          tenantId: input.tenantId,
          storageState: this.crypto.encrypt(storageStateJson),
          expiresAt,
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true },
    );
    return {
      found: true,
      site,
      profile,
      storageStateJson: '',
      expiresAt: expiresAt.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /**
   * @description 删除已失效或用户要求退出的浏览器会话。
   * @keyword-cn 失效浏览器会话, 删除Cookie
   * @keyword-en invalidate-browser-session, delete-cookie
   */
  async invalidate(input: {
    tenantId?: string;
    workspaceId: string;
    site: string;
    profile?: string;
  }): Promise<boolean> {
    const result = await this.sessions.deleteOne({
      scopeId: input.tenantId || PLATFORM_SCOPE_ID,
      workspaceId: this.normalizeKey(
        input.workspaceId,
        'BROWSER_SESSION_WORKSPACE_REQUIRED',
      ),
      site: this.normalizeKey(input.site, 'BROWSER_SESSION_SITE_REQUIRED'),
      profile: this.normalizeProfile(input.profile),
    });
    return result.deletedCount === 1;
  }

  /**
   * @description 规范站点、工作区等必填键。
   * @keyword-cn 规范会话键, 必填校验
   * @keyword-en normalize-session-key, required-validation
   */
  private normalizeKey(value: string | undefined, code: string): string {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) throw new BadRequestException(code);
    return normalized;
  }

  /**
   * @description 规范浏览器配置名，默认使用 default。
   * @keyword-cn 规范浏览器配置, 默认配置
   * @keyword-en normalize-browser-profile, default-profile
   */
  private normalizeProfile(value?: string): string {
    return (
      String(value ?? '')
        .trim()
        .toLowerCase() || 'default'
    );
  }

  /**
   * @description 校验 Playwright storageState JSON 的结构与大小。
   * @keyword-cn 校验会话状态, Cookie结构
   * @keyword-en validate-storage-state, cookie-structure
   */
  private validateStorageState(value: string): string {
    const normalized = String(value ?? '').trim();
    if (
      !normalized ||
      Buffer.byteLength(normalized, 'utf8') > MAX_STORAGE_STATE_BYTES
    ) {
      throw new BadRequestException('INVALID_BROWSER_STORAGE_STATE');
    }
    try {
      const parsed = JSON.parse(normalized) as {
        cookies?: unknown;
        origins?: unknown;
      };
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray(parsed.cookies)
      ) {
        throw new Error('invalid');
      }
      if (parsed.origins !== undefined && !Array.isArray(parsed.origins)) {
        throw new Error('invalid');
      }
    } catch {
      throw new BadRequestException('INVALID_BROWSER_STORAGE_STATE');
    }
    return normalized;
  }

  /**
   * @description 解析会话过期时间，缺省使用三十天且拒绝已过期值。
   * @keyword-cn 解析会话过期, 默认有效期
   * @keyword-en parse-session-expiry, default-ttl
   */
  private readExpiry(value?: string): Date {
    const expiresAt = value
      ? new Date(value)
      : new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('INVALID_BROWSER_SESSION_EXPIRY');
    }
    return expiresAt;
  }
}
