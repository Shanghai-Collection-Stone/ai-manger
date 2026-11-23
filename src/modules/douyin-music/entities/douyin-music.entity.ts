import type { ObjectId } from 'mongodb';

/**
 * @description 曲库分类登记表（键名 → 中文名），前后端取值唯一来源。
 * @keyword-cn 曲库分类, 音乐风格
 * @keyword-en music-categories, music-style
 */
export const DOUYIN_MUSIC_CATEGORIES = {
  upbeat: '轻快',
  warm: '温馨',
  chill: '舒缓',
  energetic: '动感',
  guofeng: '国风',
  other: '其他',
} as const;

/**
 * @description 曲库分类键名。
 * @keyword-cn 曲库分类键, 分类枚举
 * @keyword-en music-category-key, category-enum
 */
export type DouyinMusicCategory = keyof typeof DOUYIN_MUSIC_CATEGORIES;

/**
 * @description 音乐来源：`library` 是后台维护的曲库，`upload` 是工作台用户自己上传的。
 * @keyword-cn 音乐来源, 曲库或上传
 * @keyword-en music-source, library-or-upload
 */
export type DouyinMusicSource = 'library' | 'upload';

/**
 * @description 单个音乐文件的大小上限（30MB），前端上传前也按它拦。
 * @keyword-cn 音乐大小上限, 上传限制
 * @keyword-en music-max-bytes, upload-limit
 */
export const DOUYIN_MUSIC_MAX_BYTES = 30 * 1024 * 1024;

/**
 * @description 每个用户最多保留的自传音乐数量，避免对象存储被无限占用。
 * @keyword-cn 自传音乐上限, 存储保护
 * @keyword-en user-upload-limit, storage-guard
 */
export const DOUYIN_MUSIC_USER_UPLOAD_LIMIT = 50;

/**
 * @description 背景音乐默认音量（1～100），铺在人声下面不抢戏。
 * @keyword-cn 默认音乐音量, 背景音量
 * @keyword-en default-music-volume, bed-volume
 */
export const DOUYIN_MUSIC_DEFAULT_VOLUME = 25;

/**
 * @description 脚本的背景音乐设置：`trackId` 为 0 表示不用音乐，`updatedAt` 用来判断现有成片是否早于这次改动。
 * @keyword-cn 脚本背景音乐, 音乐设置
 * @keyword-en background-music-setting, topic-music
 */
export interface DouyinBackgroundMusicSetting {
  trackId: number;
  volume: number;
  updatedAt: Date;
}

/**
 * @description 音乐持久化实体：曲库曲目和成员上传的音乐都按租户共享（平台曲目可公开给所有租户），`userId` 记录上传者，用于配额与删除权限。
 * @keyword-cn 音乐实体, 曲库曲目
 * @keyword-en douyin-music-entity, library-track
 */
export interface DouyinMusicEntity {
  _id: ObjectId;
  id: number;
  source: DouyinMusicSource;
  tenantId?: string;
  userId: string;
  name: string;
  category: DouyinMusicCategory;
  key: string;
  contentType: string;
  sizeBytes: number;
  licenseNote?: string;
  status: 'active' | 'archived';
  isPublic?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 给前端的音乐视图：去掉数据库 ID、对象键与上传者 ID，带试听地址、平台只读标记、是否本人上传与能否删除。
 * @keyword-cn 音乐视图, 试听地址
 * @keyword-en douyin-music-view, preview-url
 */
export type DouyinMusicView = Omit<
  DouyinMusicEntity,
  '_id' | 'key' | 'userId' | 'tenantId'
> & { url: string; fromPlatform: boolean; mine: boolean; canDelete: boolean };
