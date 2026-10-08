import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type {
  MailRuntimeConfig,
  MailSendInput,
  MailSendResult,
  MailTemplateContent,
} from '../entities/mail.entity.js';
import { MailConfigService } from './mail-config.service.js';
import {
  formatMailDateTime,
  MailTemplateService,
} from './mail-template.service.js';

/**
 * @description 平台 SMTP 发信服务，提供配置检查、模拟发送与 transporter 指纹缓存
 * @keyword-cn SMTP发信服务, 邮件发送
 * @keyword-en mail-service, smtp-send
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterFingerprint = '';

  constructor(
    private readonly config: MailConfigService,
    private readonly templates: MailTemplateService,
  ) {}

  /**
   * @description 使用已启用的平台 SMTP 配置发送邮件，非生产模拟模式仅记录脱敏日志
   * @keyword-cn 发送邮件, 模拟发信
   * @keyword-en send-mail, mock-mail
   * @param input 收件人、主题与正文。
   * @returns {Promise<MailSendResult>} 服务商消息 ID。
   */
  async send(input: MailSendInput): Promise<MailSendResult> {
    if (this.config.isMockMode()) {
      const messageId = `mock-${Date.now()}`;
      this.logger.warn(
        `[send] MAIL_MOCK 模拟发信，未真实发送 to=${this.maskAddress(input.to)} subject=${input.subject} text=${input.text.slice(0, 200)}`,
      );
      return { messageId };
    }
    const runtime = await this.config.resolveRuntime();
    if (!runtime) {
      throw new ServiceUnavailableException('MAIL_NOT_CONFIGURED');
    }
    return this.deliver(runtime, input);
  }

  /**
   * @description 按平台统一版式渲染模板邮件后发送，业务模块只需提供文案结构
   * @keyword-cn 发送模板邮件, 统一版式
   * @keyword-en send-template-mail, unified-layout
   * @param to 收件地址。
   * @param content 邮件文案结构。
   * @returns {Promise<MailSendResult>} 服务商消息 ID。
   */
  async sendTemplate(
    to: string,
    content: MailTemplateContent,
  ): Promise<MailSendResult> {
    return this.send({ to, ...this.templates.render(content) });
  }

  /**
   * @description 判断已启用的平台 SMTP 配置是否完整
   * @keyword-cn 发信就绪检查, 配置完整性
   * @keyword-en mail-ready-check, config-completeness
   * @returns {Promise<boolean>} 配置齐全且已启用时为 true。
   */
  async isReady(): Promise<boolean> {
    return Boolean(await this.config.resolveRuntime());
  }

  /**
   * @description 忽略启用开关并强制真实发送后台测试邮件（统一版式，附发信服务器与发件地址便于核对）
   * @keyword-cn 测试发送邮件, 配置自检
   * @keyword-en test-send-mail, config-probe
   * @param to 测试邮件收件地址。
   * @returns {Promise<{ ok: true; messageId: string }>} 测试发送结果。
   */
  async testSend(to: string): Promise<{ ok: true; messageId: string }> {
    const runtime = await this.config.resolveRuntime({ requireEnabled: false });
    if (!runtime) {
      throw new ServiceUnavailableException('MAIL_NOT_CONFIGURED');
    }
    const result = await this.deliver(runtime, {
      to,
      ...this.templates.render({
        subject: '发信配置测试',
        preheader: '收到这封邮件，说明平台发信邮箱配置可用。',
        title: '发信配置测试成功',
        paragraphs: [
          '这是一封来自 AI 营销官管理后台的测试邮件。收到此邮件，说明平台发信邮箱（SMTP）配置可用，验证码、注册成功、入驻审核等通知邮件可以正常发送。',
        ],
        details: [
          {
            label: '发信服务器',
            value: `${runtime.host}:${runtime.port}（${runtime.secure ? 'SSL' : 'STARTTLS / 明文'}）`,
          },
          { label: '发件地址', value: runtime.fromAddress },
          { label: '发送时间', value: formatMailDateTime(new Date()) },
        ],
        notice:
          '如果这封邮件出现在垃圾邮件箱，请把发件地址加入通讯录或白名单，并检查发信域名的 SPF / DKIM 配置。',
      }),
    });
    return { ok: true, messageId: result.messageId };
  }

  /**
   * @description 使用指定运行配置真实发送邮件并收敛服务商错误
   * @keyword-cn 执行SMTP发送, 发送错误
   * @keyword-en deliver-smtp-mail, send-error
   * @param runtime SMTP 运行配置。
   * @param input 邮件内容。
   * @returns {Promise<MailSendResult>} 服务商消息 ID。
   */
  private async deliver(
    runtime: MailRuntimeConfig,
    input: MailSendInput,
  ): Promise<MailSendResult> {
    try {
      const info = await this.getTransporter(runtime).sendMail({
        from: this.formatFrom(runtime),
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html === undefined ? {} : { html: input.html }),
      });
      const messageId = String(info.messageId ?? '');
      this.logger.log(
        `[deliver] 邮件发送成功 to=${this.maskAddress(input.to)} messageId=${messageId}`,
      );
      return { messageId };
    } catch (error) {
      const message = this.extractErrorMessage(error);
      this.logger.error(
        `[deliver] 邮件发送失败 to=${this.maskAddress(input.to)} error=${message}`,
      );
      throw new ServiceUnavailableException({
        code: 'MAIL_SEND_FAILED',
        message,
      });
    }
  }

  /**
   * @description 按 SMTP 配置指纹复用 transporter，配置变化后关闭旧连接并重建
   * @keyword-cn 传输器缓存, 配置指纹
   * @keyword-en transporter-cache, config-fingerprint
   * @param runtime SMTP 运行配置。
   * @returns {Transporter} Nodemailer transporter。
   */
  private getTransporter(runtime: MailRuntimeConfig): Transporter {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(runtime), 'utf8')
      .digest('hex');
    if (this.transporter && this.transporterFingerprint === fingerprint) {
      return this.transporter;
    }
    this.transporter?.close();
    this.transporter = nodemailer.createTransport({
      host: runtime.host,
      port: runtime.port,
      secure: runtime.secure,
      auth: {
        user: runtime.username,
        pass: runtime.password,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
    });
    this.transporterFingerprint = fingerprint;
    return this.transporter;
  }

  /**
   * @description 生成带可选显示名的标准发件人字符串
   * @keyword-cn 格式化发件人, 显示名称
   * @keyword-en format-mail-from, display-name
   * @param runtime SMTP 运行配置。
   * @returns {string} Nodemailer 发件人字段。
   */
  private formatFrom(runtime: MailRuntimeConfig): string {
    if (!runtime.fromName) return runtime.fromAddress;
    const name = runtime.fromName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${name}" <${runtime.fromAddress}>`;
  }

  /**
   * @description 对日志中的邮件地址脱敏，仅保留本地部分首字符与完整域名
   * @keyword-cn 邮件地址脱敏, 日志安全
   * @keyword-en mask-email-address, log-safety
   * @param address 邮件地址。
   * @returns {string} 脱敏地址。
   */
  private maskAddress(address: string): string {
    const normalized = String(address ?? '').trim();
    const at = normalized.lastIndexOf('@');
    if (at <= 0 || at === normalized.length - 1) return '***';
    return `${normalized[0]}***${normalized.slice(at)}`;
  }

  /**
   * @description 提取 SMTP 服务商原始错误文本供后台排障
   * @keyword-cn 提取错误信息, 服务商错误
   * @keyword-en extract-error-message, provider-error
   * @param error 原始异常。
   * @returns {string} 可读错误文本。
   */
  private extractErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
