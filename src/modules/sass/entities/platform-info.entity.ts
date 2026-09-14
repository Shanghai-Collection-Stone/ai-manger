import type { ObjectId } from 'mongodb';

/**
 * @description 租户平台信息实体（AI补充说明）
 * @keyword-en tenant platform info entity
 */
export interface PlatformInfoEntity {
  _id: ObjectId;
  tenantId: string;
  /** AI 补充说明（markdown 格式），用于给各租户填写更适合自己使用习惯的AI提示 */
  aiPromptSupplement: string;
  /** 是否开启 AI 封面生成 */
  enableAiCover?: boolean;
  /** 全平台小红书文章生成总并发上限 */
  xhsArticleGlobalConcurrencyLimit?: number;
  /** 平台作用域：自助注册未入驻时返回的业务员微信二维码（http(s) 地址或 data:image base64） */
  salesWechatQrCodeUrl?: string;
  /** 平台作用域：业务员二维码旁的提示语 */
  salesContactTip?: string;
  createdAt: Date;
  updatedAt: Date;
}
