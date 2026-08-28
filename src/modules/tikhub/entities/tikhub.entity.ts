import type { ObjectId } from 'mongodb';

/**
 * @description TikHub 采集渠道的作用域：与小红书抓取频率设置同一维度（租户 + 后台用户），
 *   保证「切到 TikHub」和「抓取频率」永远落在同一份配置边界里。
 * @keyword-cn 配置作用域, 租户用户
 * @keyword-en config-scope, tenant-user
 */
export interface TikhubConfigScope {
  tenantId?: string | null;
  userId: string;
}

/**
 * @description API Key 的存储信封。配置了加密密钥时保存 AES-256-GCM 密文，
 *   未配置时退化为明文并在日志里告警——否则本地环境根本存不进 Key。
 * @keyword-cn 密钥信封, 加密存储
 * @keyword-en secret-envelope, encrypted-storage
 */
export type TikhubSecretEnvelope =
  | {
      algorithm: 'aes-256-gcm';
      keyVersion: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    }
  | {
      algorithm: 'plain';
      value: string;
    };

/**
 * @description TikHub 平台配置文档，一个作用域一行。API Key 只以信封形式落库，绝不明文出接口。
 * @keyword-cn TikHub配置实体, 平台密钥
 * @keyword-en tikhub-config-entity, platform-api-key
 */
export interface TikhubConfigEntity {
  _id: ObjectId;
  tenantId?: string | null;
  userId: string;
  /** 未配置时为 undefined，此时回落到环境变量 TIKHUB_API_KEY。 */
  apiKey?: TikhubSecretEnvelope;
  /** 自定义 API 域名，国内直连可填 https://api.tikhub.dev。 */
  baseUrl?: string;
  updatedAt: Date;
}

/**
 * @description 返回给配置页的 TikHub 配置视图，只带掩码后的 Key 尾号，不回传明文。
 * @keyword-cn 配置视图, 密钥掩码
 * @keyword-en config-view, masked-api-key
 */
export interface TikhubConfigView {
  /** 当前作用域或环境变量里是否已经有可用的 Key。 */
  hasApiKey: boolean;
  /** 形如 `tk_****abcd`，没有 Key 时为空串。 */
  apiKeyMasked: string;
  /** Key 来源：数据库配置或环境变量兜底。 */
  apiKeySource: 'config' | 'env' | 'none';
  baseUrl: string;
  updatedAt?: string;
}

/**
 * @description 一次 TikHub 连通性自检的结果，配置页保存前用它确认 Key 真的能用。
 * @keyword-cn 连通性自检, 密钥校验
 * @keyword-en connectivity-check, api-key-validation
 */
export interface TikhubProbeResult {
  ok: boolean;
  /** 失败原因；成功时为空。 */
  message?: string;
  /** TikHub 账户余额，探测接口返回时带上。 */
  balance?: number;
}

/**
 * @description TikHub 采集到并归一化后的一篇小红书笔记互动数据。
 *   采集端拿不到的字段一律留 undefined，不填 0——看板据此区分「真的是 0」和「还没采到」。
 * @keyword-cn 归一化笔记数据, 互动指标
 * @keyword-en normalized-note-stat, interaction-metrics
 */
export interface TikhubXhsNoteStat {
  noteId: string;
  title: string;
  postUrl: string;
  authorUrl?: string;
  tag?: string;
  likeCount: number;
  commentCount: number;
  collectCount: number;
  viewCount?: number;
  shareCount?: number;
  topComments: { content: string; likeCount: number; replyCount: number }[];
  dataAt: Date;
}

/**
 * @description 一批笔记的采集结果：成功项与逐条失败原因分开返回，供调用方判定终态。
 * @keyword-cn 批量采集结果, 逐条失败
 * @keyword-en batch-collect-result, per-note-failure
 */
export interface TikhubXhsCollectResult {
  stats: TikhubXhsNoteStat[];
  failures: { noteId: string; reason: string }[];
}
