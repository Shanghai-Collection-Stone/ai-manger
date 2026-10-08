import type { ObjectId } from 'mongodb';

/**
 * @description 阿里云配置的平台作用域 ID（与短信配置的平台作用域写法一致）。
 * @keyword-cn 平台作用域, 阿里云配置
 * @keyword-en platform-scope, aliyun-setting
 */
export const ALIYUN_PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description 配置保存后通知其他进程重新加载的消息名（多进程时经主进程广播给全部 worker）。
 * @keyword-cn 配置变更广播, 进程间消息
 * @keyword-en setting-changed-broadcast, ipc-message
 */
export const ALIYUN_CONFIG_CHANGED_MESSAGE = 'aliyun-config.setting.changed';

/**
 * @description AccessKey Secret 落库信封：`aes-256-gcm` 密文，或没有加密密钥时的 `plain` 明文；与短信配置的信封格式一致。
 * @keyword-cn 密钥信封, 加密存储
 * @keyword-en secret-envelope, encrypted-storage
 */
export type AliyunSecretEnvelope =
  | { algorithm: 'plain'; value: string }
  | {
      algorithm: 'aes-256-gcm';
      keyVersion: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

/**
 * @description 后台保存的 OSS 设置（不含密钥；OSS 专用 AccessKey 单独存放，不与短信共用）。
 * @keyword-cn OSS设置, 对象存储
 * @keyword-en oss-setting, object-storage
 */
export interface AliyunOssSetting {
  /** 地域，带 `oss-` 前缀，如 `oss-cn-shanghai` */
  region: string;
  bucket: string;
  /** 自定义 endpoint，空表示按地域推导 `<region>.aliyuncs.com` */
  endpoint: string;
  /** CDN / 自定义域名，空表示用 bucket 默认外网域名 */
  publicBaseUrl: string;
  /** 对象键根前缀，空表示 `video-library` */
  rootDir: string;
}

/**
 * @description 落库的 OSS 子文档：OSS 设置加 OSS 专用 AccessKey（Secret 加密成信封）。
 * @keyword-cn OSS配置文档, OSS访问密钥
 * @keyword-en oss-setting-document, oss-access-key
 */
export interface AliyunOssSettingDocument extends Partial<AliyunOssSetting> {
  accessKeyId?: string;
  accessKeySecret?: AliyunSecretEnvelope;
}

/**
 * @description 阿里云配置文档，集合 `aliyun_settings`，`scopeId` 唯一。
 * @keyword-cn 阿里云配置实体
 * @keyword-en aliyun-setting-entity
 */
export interface AliyunSettingEntity {
  _id: ObjectId;
  scopeId: string;
  oss?: AliyunOssSettingDocument;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 阿里云配置保存入参：`oss` 只更新传入的字段；`oss.accessKeySecret` 空串清空、undefined 保持不变。
 * @keyword-cn 阿里云配置入参
 * @keyword-en aliyun-setting-input
 */
export interface AliyunSettingInput {
  oss?: Partial<AliyunOssSetting> & {
    accessKeyId?: string;
    accessKeySecret?: string;
  };
}

/**
 * @description 阿里云访问密钥明文（只在服务端内部流转）。
 * @keyword-cn 阿里云访问密钥, OSS访问密钥
 * @keyword-en aliyun-credential, oss-access-key
 */
export interface AliyunCredential {
  accessKeyId: string;
  accessKeySecret: string;
}

/**
 * @description OSS 运行配置：后台设置齐全（OSS 专用密钥 + bucket + endpoint）时给出，交给对象存储服务直接使用。
 * @keyword-cn OSS运行配置, 后台优先
 * @keyword-en oss-runtime-config, admin-first
 */
export interface AliyunOssRuntimeConfig extends AliyunOssSetting {
  accessKeyId: string;
  accessKeySecret: string;
}

/**
 * @description 配置页视图：OSS 专用 Secret 只回掩码，并标出当前生效来源（后台 / 环境变量 / 未配置）。
 * @keyword-cn 阿里云配置视图, 密钥掩码
 * @keyword-en aliyun-setting-view, masked-secret
 */
export interface AliyunSettingView {
  oss: AliyunOssSetting & {
    accessKeyId: string;
    hasAccessKeySecret: boolean;
    accessKeySecretMasked: string;
    /** 当前生效的 OSS 配置来源 */
    effectiveSource: 'admin' | 'env' | 'none';
    /** 按当前生效配置拼出的对象访问地址前缀，便于核对 */
    publicUrlPrefix: string;
  };
  updatedAt?: string;
}

/**
 * @description OSS 自检结果：写入并删除一个小对象，失败时带原因。
 * @keyword-cn OSS自检结果, 写入测试
 * @keyword-en oss-probe-result, write-test
 */
export interface AliyunOssProbeResult {
  ok: boolean;
  source: 'admin' | 'env' | 'none';
  message?: string;
}
