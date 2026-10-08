import type { ObjectId } from 'mongodb';

/**
 * @description 平台级发信邮箱配置作用域占位符（全平台一份）
 * @keyword-cn 平台作用域, 邮箱配置
 * @keyword-en platform-scope, mail-setting
 */
export const MAIL_PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description SMTP 密码落库信封，支持 AES-256-GCM 密文与无密钥时的明文降级
 * @keyword-cn 密码信封, 加密存储
 * @keyword-en password-envelope, encrypted-storage
 */
export type MailPasswordEnvelope =
  | { algorithm: 'plain'; value: string }
  | {
      algorithm: 'aes-256-gcm';
      keyVersion: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

/**
 * @description 平台发信邮箱配置文档，集合 `mail_settings`，`scopeId` 唯一
 * @keyword-cn 邮箱配置实体
 * @keyword-en mail-setting-entity
 */
export interface MailSettingEntity {
  _id: ObjectId;
  scopeId: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnvelope?: MailPasswordEnvelope;
  fromAddress: string;
  fromName?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 平台发信邮箱配置保存入参，password 空串清空、undefined 保持不变
 * @keyword-cn 邮箱配置入参
 * @keyword-en mail-setting-input
 */
export interface MailSettingInput {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
}

/**
 * @description 发信邮箱配置页视图，密码只返回掩码
 * @keyword-cn 邮箱配置视图, 密码掩码
 * @keyword-en mail-setting-view, masked-password
 */
export interface MailSettingView {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  passwordMasked: string;
  fromAddress: string;
  fromName: string;
  ready: boolean;
  mockMode: boolean;
  updatedAt: string | null;
}

/**
 * @description Nodemailer 发信所需的明文 SMTP 运行配置
 * @keyword-cn SMTP运行配置
 * @keyword-en smtp-runtime-config
 */
export interface MailRuntimeConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  version: string;
}

/**
 * @description 其他模块调用发信服务时使用的消息参数
 * @keyword-cn 发信参数
 * @keyword-en mail-send-input
 */
export interface MailSendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * @description SMTP 发信成功结果
 * @keyword-cn 发信结果
 * @keyword-en mail-send-result
 */
export interface MailSendResult {
  messageId: string;
}

/**
 * @description 邮件品牌名，统一用于主题前缀、版式页眉与落款
 * @keyword-cn 邮件品牌名, 主题前缀
 * @keyword-en mail-brand-name, subject-prefix
 */
export const MAIL_BRAND_NAME = 'AI 营销官';

/**
 * @description 模板邮件信息表格的一行
 * @keyword-cn 邮件信息行
 * @keyword-en mail-detail-row
 */
export interface MailTemplateDetail {
  label: string;
  value: string;
}

/**
 * @description 模板邮件内容：只描述文案与结构，版式、转义、纯文本版本由模板服务统一生成
 * @keyword-cn 模板邮件内容, 统一版式
 * @keyword-en mail-template-content, unified-layout
 */
export interface MailTemplateContent {
  /** 主题，不含品牌前缀，渲染时统一加「【AI 营销官】」 */
  subject: string;
  /** 收件箱列表里的预览摘要 */
  preheader: string;
  /** 正文大标题 */
  title: string;
  /** 称呼，缺省为「您好：」 */
  greeting?: string;
  /** 标题下的正文段落 */
  paragraphs: string[];
  /** 验证码，以大号等宽字突出展示 */
  code?: string;
  /** 验证码下方的说明，如有效期 */
  codeHint?: string;
  /** 信息表格 */
  details?: MailTemplateDetail[];
  /** 信息表格之后的段落 */
  afterParagraphs?: string[];
  /** 提示框文字，如安全提醒 */
  notice?: string;
}

/**
 * @description 模板渲染结果，可直接展开进 MailService.send 的参数
 * @keyword-cn 模板渲染结果
 * @keyword-en mail-rendered-content
 */
export interface MailRenderedContent {
  subject: string;
  text: string;
  html: string;
}
