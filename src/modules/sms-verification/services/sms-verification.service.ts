import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  SMS_CODE_MAX_ATTEMPTS,
  SMS_CODE_TTL_SECONDS,
  SMS_IP_HOURLY_LIMIT,
  SMS_PHONE_DAILY_LIMIT,
  SMS_RESEND_INTERVAL_SECONDS,
  SMS_VERIFICATION_SCENES,
  type SmsCodeEntity,
  type SmsVerificationScene,
  type SmsVerifiedContext,
} from '../entities/sms-verification.entity.js';
import { AliyunSmsError, AliyunSmsService } from './aliyun-sms.service.js';
import { SmsConfigService } from './sms-config.service.js';
import { SmsCryptoService } from './sms-crypto.service.js';

/**
 * @description 短信验证码核心服务：发码（频控 + 阿里云发送）、校验（次数上限 + 场景绑定）、成功后作废。
 * @keyword-cn 短信验证码服务, 发送频控, 验证码校验
 * @keyword-en sms-verification-service, send-throttle, verify-sms-code
 */
@Injectable()
export class SmsVerificationService {
  private readonly logger = new Logger(SmsVerificationService.name);
  private readonly codes: Collection<SmsCodeEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly config: SmsConfigService,
    private readonly aliyun: AliyunSmsService,
    private readonly crypto: SmsCryptoService,
  ) {
    this.codes = db.collection<SmsCodeEntity>('sms_verification_codes');
    void this.ensureIndexes();
  }

  /**
   * @description 建立验证码集合索引：过期 24 小时后 TTL 清理（保证日限额统计窗口内记录还在）、手机号与 IP 频控查询索引
   * @keyword-cn 验证码索引, TTL清理
   * @keyword-en sms-code-indexes, ttl-cleanup
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.codes.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 24 * 60 * 60, name: 'sms_code_ttl' },
    );
    await this.codes.createIndex(
      { phone: 1, scene: 1, createdAt: -1 },
      { name: 'sms_code_phone_scene' },
    );
    await this.codes.createIndex(
      { ip: 1, createdAt: -1 },
      { name: 'sms_code_ip' },
    );
  }

  /**
   * @description 发送验证码：校验场景与手机号 → 频控 → 先落库再发送，发送失败删除记录不占额度
   * @keyword-cn 发送验证码, 发送频控
   * @keyword-en send-sms-code, send-throttle
   * @param input 手机号、场景与客户端 IP。
   * @returns {Promise<{ expiresInSeconds: number; resendAfterSeconds: number }>} 有效期与重发间隔。
   */
  async send(input: {
    phone: string;
    scene: string;
    ip: string;
  }): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const phone = this.normalizePhone(input.phone);
    const scene = this.assertScene(input.scene);
    const mock = this.config.isMockMode();
    const runtime = mock ? null : await this.config.resolveRuntime();
    if (!mock && !runtime) {
      throw new ServiceUnavailableException('SMS_NOT_CONFIGURED');
    }
    await this.assertSendQuota(phone, scene, input.ip);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();
    const doc: SmsCodeEntity = {
      _id: new ObjectId(),
      phone,
      scene,
      codeHash: this.crypto.hashCode(phone, scene, code),
      ip: input.ip,
      attempts: 0,
      expiresAt: new Date(now.getTime() + SMS_CODE_TTL_SECONDS * 1000),
      createdAt: now,
    };
    await this.codes.insertOne(doc);
    try {
      if (runtime) {
        const { bizId } = await this.aliyun.sendCode(runtime, phone, code);
        if (bizId) {
          await this.codes.updateOne(
            { _id: doc._id },
            { $set: { providerBizId: bizId } },
          );
        }
      } else {
        this.logger.warn(
          `[send] SMS_VERIFICATION_MOCK 模拟发送，未真实下发 phone=${phone} scene=${scene} code=${code}`,
        );
      }
    } catch (error) {
      await this.codes.deleteOne({ _id: doc._id });
      throw this.toPublicSendError(error);
    }
    return {
      expiresInSeconds: SMS_CODE_TTL_SECONDS,
      resendAfterSeconds: SMS_RESEND_INTERVAL_SECONDS,
    };
  }

  /**
   * @description 校验验证码但不作废：只认该手机号该场景最新一条，先原子累加次数再比对，超过上限即作废
   * @keyword-cn 校验验证码, 防爆破
   * @keyword-en verify-sms-code, brute-force-guard
   * @param input 手机号、场景与验证码。
   * @returns {Promise<SmsVerifiedContext>} 验证通过上下文。
   */
  async verify(input: {
    phone: string;
    scene: SmsVerificationScene;
    code: string;
  }): Promise<SmsVerifiedContext> {
    const phone = this.normalizePhone(input.phone);
    const code = String(input.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('SMS_CODE_INVALID');
    const latest = await this.codes.findOne(
      { phone, scene: input.scene },
      { sort: { createdAt: -1 } },
    );
    if (
      !latest ||
      latest.consumedAt ||
      latest.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('SMS_CODE_EXPIRED');
    }
    const counted = await this.codes.findOneAndUpdate(
      {
        _id: latest._id,
        attempts: { $lt: SMS_CODE_MAX_ATTEMPTS },
        consumedAt: { $exists: false },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!counted.value) {
      throw new BadRequestException('SMS_CODE_TOO_MANY_ATTEMPTS');
    }
    const expected = Buffer.from(latest.codeHash, 'hex');
    const actual = Buffer.from(
      this.crypto.hashCode(phone, input.scene, code),
      'hex',
    );
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new BadRequestException('SMS_CODE_INVALID');
    }
    return { codeId: latest._id.toHexString(), phone, scene: input.scene };
  }

  /**
   * @description 业务接口成功后作废验证码，重复作废返回 false
   * @keyword-cn 作废验证码, 一次性使用
   * @keyword-en consume-sms-code, single-use
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
   * @description 后台测试发送：忽略启用开关，用当前配置真实发一条随机验证码，返回服务商原始错误便于排查
   * @keyword-cn 测试发送短信, 配置自检
   * @keyword-en test-send-sms, config-probe
   * @param rawPhone 接收测试短信的手机号。
   * @returns {Promise<{ ok: boolean; bizId?: string; code?: string; message?: string }>} 测试结果。
   */
  async testSend(
    rawPhone: string,
  ): Promise<{ ok: boolean; bizId?: string; code?: string; message?: string }> {
    const phone = this.normalizePhone(rawPhone);
    const runtime = await this.config.resolveRuntime({ requireEnabled: false });
    if (!runtime) {
      return {
        ok: false,
        code: 'SMS_NOT_CONFIGURED',
        message: 'AccessKey ID / Secret / 签名 / 模板编码未填写完整',
      };
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    try {
      const { bizId } = await this.aliyun.sendCode(runtime, phone, code);
      return { ok: true, bizId };
    } catch (error) {
      if (error instanceof AliyunSmsError) {
        return { ok: false, code: error.code, message: error.providerMessage };
      }
      return {
        ok: false,
        code: 'SMS_SEND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * @description 发送频控：同号同场景 60 秒重发间隔、单号 24 小时上限、单 IP 1 小时上限
   * @keyword-cn 发送频控, 重发间隔
   * @keyword-en send-throttle, resend-interval
   * @param phone 规范化手机号。
   * @param scene 业务场景。
   * @param ip 客户端 IP。
   * @returns {Promise<void>}
   */
  private async assertSendQuota(
    phone: string,
    scene: SmsVerificationScene,
    ip: string,
  ): Promise<void> {
    const now = Date.now();
    const latest = await this.codes.findOne(
      { phone, scene },
      { sort: { createdAt: -1 } },
    );
    if (latest) {
      const waitSeconds = Math.ceil(
        (latest.createdAt.getTime() + SMS_RESEND_INTERVAL_SECONDS * 1000 - now) /
          1000,
      );
      if (waitSeconds > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'SMS_SEND_TOO_FREQUENT',
            retryAfterSeconds: waitSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const phoneCount = await this.codes.countDocuments({
      phone,
      createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) },
    });
    if (phoneCount >= SMS_PHONE_DAILY_LIMIT) {
      throw new HttpException('SMS_PHONE_DAILY_LIMIT', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (ip) {
      const ipCount = await this.codes.countDocuments({
        ip,
        createdAt: { $gte: new Date(now - 60 * 60 * 1000) },
      });
      if (ipCount >= SMS_IP_HOURLY_LIMIT) {
        throw new HttpException('SMS_IP_HOURLY_LIMIT', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  /**
   * @description 把阿里云错误收敛成对外错误码，配置类错误不向公开接口泄露细节
   * @keyword-cn 发送错误收敛, 服务商错误映射
   * @keyword-en map-send-error, provider-error-mapping
   * @param error 原始异常。
   * @returns {HttpException} 对外异常。
   */
  private toPublicSendError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof AliyunSmsError) {
      if (error.code === 'isv.BUSINESS_LIMIT_CONTROL') {
        return new HttpException(
          'SMS_PROVIDER_RATE_LIMITED',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error.code === 'isv.MOBILE_NUMBER_ILLEGAL') {
        return new BadRequestException('SMS_PHONE_INVALID');
      }
    }
    return new ServiceUnavailableException('SMS_SEND_FAILED');
  }

  /**
   * @description 规范化中国大陆手机号：去空格与 +86/86 前缀后必须为 11 位
   * @keyword-cn 手机号规范化, 大陆手机号
   * @keyword-en normalize-phone, mainland-mobile
   * @param raw 原始手机号。
   * @returns {string} 11 位手机号。
   */
  private normalizePhone(raw: string): string {
    const phone = String(raw ?? '')
      .replace(/[\s-]/g, '')
      .replace(/^(\+?86)(?=1\d{10}$)/, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new BadRequestException('SMS_PHONE_INVALID');
    }
    return phone;
  }

  /**
   * @description 校验场景在白名单内
   * @keyword-cn 场景校验, 场景白名单
   * @keyword-en assert-scene, scene-allowlist
   * @param scene 场景值。
   * @returns {SmsVerificationScene} 合法场景。
   */
  private assertScene(scene: string): SmsVerificationScene {
    if (!(SMS_VERIFICATION_SCENES as readonly string[]).includes(scene)) {
      throw new BadRequestException('SMS_SCENE_INVALID');
    }
    return scene as SmsVerificationScene;
  }
}
