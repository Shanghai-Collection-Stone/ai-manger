import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type { MailTemplateContent } from '../../mail/entities/mail.entity.js';
import { MailService } from '../../mail/services/mail.service.js';
import {
  EMAIL_ADDRESS_DAILY_LIMIT,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_SECONDS,
  EMAIL_IP_HOURLY_LIMIT,
  EMAIL_RESEND_INTERVAL_SECONDS,
  EMAIL_SCENE_ACTIONS,
  EMAIL_VERIFICATION_SCENES,
  type EmailCodeEntity,
  type EmailVerificationScene,
  type EmailVerifiedContext,
} from '../entities/email-verification.entity.js';

/** @type {RegExp} 邮箱格式：本地部分@域名.后缀，不含空白。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @description 邮箱验证码核心服务：发码（频控 + 平台发信邮箱发送）、校验（次数上限 + 场景绑定）、成功后作废。
 * @keyword-cn 邮箱验证码服务, 发送频控, 验证码校验
 * @keyword-en email-verification-service, send-throttle, verify-email-code
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly codes: Collection<EmailCodeEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly mail: MailService,
  ) {
    this.codes = db.collection<EmailCodeEntity>('email_verification_codes');
    void this.ensureIndexes();
  }

  /**
   * @description 建立验证码集合索引：过期 24 小时后 TTL 清理（保证日限额统计窗口内记录还在）、邮箱与 IP 频控查询索引
   * @keyword-cn 邮箱验证码索引, TTL清理
   * @keyword-en email-code-indexes, ttl-cleanup
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.codes.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 24 * 60 * 60, name: 'email_code_ttl' },
    );
    await this.codes.createIndex(
      { email: 1, scene: 1, createdAt: -1 },
      { name: 'email_code_address_scene' },
    );
    await this.codes.createIndex(
      { ip: 1, createdAt: -1 },
      { name: 'email_code_ip' },
    );
  }

  /**
   * @description 发送邮箱验证码：校验场景与邮箱 → 频控 → 先落库再发信，发送失败删除记录不占额度
   * @keyword-cn 发送邮箱验证码, 发送频控
   * @keyword-en send-email-code, send-throttle
   * @param input 邮箱、场景与客户端 IP。
   * @returns {Promise<{ expiresInSeconds: number; resendAfterSeconds: number }>} 有效期与重发间隔。
   */
  async send(input: {
    email: string;
    scene: string;
    ip: string;
  }): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const email = this.normalizeEmail(input.email);
    const scene = this.assertScene(input.scene);
    await this.assertSendQuota(email, scene, input.ip);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();
    const doc: EmailCodeEntity = {
      _id: new ObjectId(),
      email,
      scene,
      codeHash: this.hashCode(email, scene, code),
      ip: input.ip,
      attempts: 0,
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_SECONDS * 1000),
      createdAt: now,
    };
    await this.codes.insertOne(doc);
    try {
      await this.mail.sendTemplate(email, this.buildCodeMail(scene, code));
    } catch (error) {
      await this.codes.deleteOne({ _id: doc._id });
      throw this.toPublicSendError(error);
    }
    return {
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
      resendAfterSeconds: EMAIL_RESEND_INTERVAL_SECONDS,
    };
  }

  /**
   * @description 校验验证码但不作废：只认该邮箱该场景最新一条，先原子累加次数再比对，超过上限即失效
   * @keyword-cn 校验邮箱验证码, 防爆破
   * @keyword-en verify-email-code, brute-force-guard
   * @param input 邮箱、场景与验证码。
   * @returns {Promise<EmailVerifiedContext>} 验证通过上下文。
   */
  async verify(input: {
    email: string;
    scene: EmailVerificationScene;
    code: string;
  }): Promise<EmailVerifiedContext> {
    const email = this.normalizeEmail(input.email);
    const code = String(input.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('EMAIL_CODE_INVALID');
    }
    const latest = await this.codes.findOne(
      { email, scene: input.scene },
      { sort: { createdAt: -1 } },
    );
    if (
      !latest ||
      latest.consumedAt ||
      latest.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('EMAIL_CODE_EXPIRED');
    }
    const counted = await this.codes.findOneAndUpdate(
      {
        _id: latest._id,
        attempts: { $lt: EMAIL_CODE_MAX_ATTEMPTS },
        consumedAt: { $exists: false },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!counted.value) {
      throw new BadRequestException('EMAIL_CODE_TOO_MANY_ATTEMPTS');
    }
    const expected = Buffer.from(latest.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(email, input.scene, code), 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new BadRequestException('EMAIL_CODE_INVALID');
    }
    return { codeId: latest._id.toHexString(), email, scene: input.scene };
  }

  /**
   * @description 业务接口成功后作废验证码，重复作废返回 false
   * @keyword-cn 作废邮箱验证码, 一次性使用
   * @keyword-en consume-email-code, single-use
   * @param codeId 验证码记录 ID。
   * @returns {Promise<boolean>} 本次是否成功作废。
   */
  async consume(codeId: string): Promise<boolean> {
    if (!ObjectId.isValid(codeId)) return false;
    const res = await this.codes.updateOne(
      { _id: new ObjectId(codeId), consumedAt: { $exists: false } },
      { $set: { consumedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  }

  /**
   * @description 组装验证码邮件文案：说明用途、突出验证码、提示有效期与防诈骗
   * @keyword-cn 验证码邮件文案, 防诈骗提示
   * @keyword-en code-mail-copy, anti-fraud-notice
   * @param scene 业务场景。
   * @param code 6 位验证码。
   * @returns {MailTemplateContent} 模板邮件内容。
   */
  private buildCodeMail(
    scene: EmailVerificationScene,
    code: string,
  ): MailTemplateContent {
    const action = EMAIL_SCENE_ACTIONS[scene];
    const minutes = Math.round(EMAIL_CODE_TTL_SECONDS / 60);
    return {
      subject: '邮箱验证码',
      preheader: `您的验证码是 ${code}，${minutes} 分钟内有效。`,
      title: '验证您的邮箱',
      paragraphs: [
        `您正在${action}，请在页面中输入以下验证码完成邮箱验证：`,
      ],
      code,
      codeHint: `验证码 ${minutes} 分钟内有效，仅可使用一次。`,
      notice:
        '请勿将验证码告诉任何人，平台工作人员不会以任何理由向您索要验证码。如果这不是您本人的操作，请忽略本邮件，您的邮箱不会被绑定。',
    };
  }

  /**
   * @description 发送频控：同邮箱同场景 60 秒重发间隔、单邮箱 24 小时上限、单 IP 1 小时上限
   * @keyword-cn 发送频控, 重发间隔
   * @keyword-en send-throttle, resend-interval
   * @param email 规范化邮箱。
   * @param scene 业务场景。
   * @param ip 客户端 IP。
   * @returns {Promise<void>}
   */
  private async assertSendQuota(
    email: string,
    scene: EmailVerificationScene,
    ip: string,
  ): Promise<void> {
    const now = Date.now();
    const latest = await this.codes.findOne(
      { email, scene },
      { sort: { createdAt: -1 } },
    );
    if (latest) {
      const waitSeconds = Math.ceil(
        (latest.createdAt.getTime() +
          EMAIL_RESEND_INTERVAL_SECONDS * 1000 -
          now) /
          1000,
      );
      if (waitSeconds > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'EMAIL_SEND_TOO_FREQUENT',
            retryAfterSeconds: waitSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const emailCount = await this.codes.countDocuments({
      email,
      createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) },
    });
    if (emailCount >= EMAIL_ADDRESS_DAILY_LIMIT) {
      throw new HttpException(
        'EMAIL_ADDRESS_DAILY_LIMIT',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (ip) {
      const ipCount = await this.codes.countDocuments({
        ip,
        createdAt: { $gte: new Date(now - 60 * 60 * 1000) },
      });
      if (ipCount >= EMAIL_IP_HOURLY_LIMIT) {
        throw new HttpException(
          'EMAIL_IP_HOURLY_LIMIT',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  /**
   * @description 把发信错误收敛成对外错误码：未配置单独提示，SMTP 原始错误只进日志不对公开接口泄露
   * @keyword-cn 发送错误收敛, 隐藏服务商错误
   * @keyword-en map-send-error, hide-provider-error
   * @param error 原始异常。
   * @returns {HttpException} 对外异常。
   */
  private toPublicSendError(error: unknown): HttpException {
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const message =
      response && typeof response === 'object' && 'message' in response
        ? String(response.message)
        : error instanceof Error
          ? error.message
          : String(error);
    if (message === 'MAIL_NOT_CONFIGURED') {
      return new ServiceUnavailableException('EMAIL_NOT_CONFIGURED');
    }
    this.logger.warn(`[send] 邮箱验证码发送失败: ${message}`);
    return new ServiceUnavailableException('EMAIL_SEND_FAILED');
  }

  /**
   * @description 计算验证码 HMAC-SHA256 摘要，邮箱与场景参与计算，防止跨邮箱、跨场景复用
   * @keyword-cn 邮箱验证码摘要, 场景绑定
   * @keyword-en email-code-hash, scene-binding
   * @param email 规范化邮箱。
   * @param scene 业务场景。
   * @param code 6 位验证码。
   * @returns {string} 十六进制摘要。
   */
  private hashCode(
    email: string,
    scene: EmailVerificationScene,
    code: string,
  ): string {
    const pepper = String(
      process.env.MAIL_ENCRYPTION_KEY ??
        process.env.SMS_ENCRYPTION_KEY ??
        process.env.BROWSER_AUTH_ENCRYPTION_KEY ??
        process.env.ADMIN_JWT_SECRET ??
        'ai-mvp-email-verification-pepper',
    );
    return createHmac('sha256', pepper)
      .update(`${scene}:${email}:${code}`)
      .digest('hex');
  }

  /**
   * @description 规范化邮箱：去空格、转小写，格式或长度不合法时报错
   * @keyword-cn 邮箱规范化, 邮箱格式校验
   * @keyword-en normalize-email, email-format-check
   * @param raw 原始邮箱。
   * @returns {string} 规范化邮箱。
   */
  private normalizeEmail(raw: string): string {
    const email = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('EMAIL_ADDRESS_INVALID');
    }
    return email;
  }

  /**
   * @description 校验场景在白名单内
   * @keyword-cn 场景校验, 场景白名单
   * @keyword-en assert-scene, scene-allowlist
   * @param scene 场景值。
   * @returns {EmailVerificationScene} 合法场景。
   */
  private assertScene(scene: string): EmailVerificationScene {
    if (!(EMAIL_VERIFICATION_SCENES as readonly string[]).includes(scene)) {
      throw new BadRequestException('EMAIL_SCENE_INVALID');
    }
    return scene as EmailVerificationScene;
  }
}
