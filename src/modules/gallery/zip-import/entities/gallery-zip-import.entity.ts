import { ObjectId } from 'mongodb';

/** @description ZIP 导入任务状态机:pending → extracting → importing → done|failed|cancelled */
export type GalleryZipImportStatus =
  | 'pending'
  | 'extracting'
  | 'importing'
  | 'done'
  | 'failed'
  | 'cancelled';

/** @description 实时进度:total=zip 内可识别图片张数,processed=已落盘 */
export interface GalleryZipImportProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
}

/** @description 单张图片导入失败明细 */
export interface GalleryZipImportErrorItem {
  fileName: string;
  reason: string;
}

export interface GalleryZipImportEntity {
  _id: ObjectId;
  /** @description 任务 ID(UUID 字符串,前端轮询 key) */
  id: string;
  userId: string;
  scope: 'platform' | 'tenant';
  tenantId?: string;
  /** @description 目标图库分组(可选) */
  groupId?: string | number;
  /** @description 入库时打上的全局 tags */
  tags: string[];
  /** @description zip 原文件名 */
  originalName: string;
  /** @description zip 文件大小(字节) */
  fileSize: number;
  /** @description zip 临时绝对路径(处理完会清理) */
  zipAbsPath?: string;
  status: GalleryZipImportStatus;
  /** @description 当前步骤的可读文案("正在解压 12/350") */
  stage?: string;
  progress: GalleryZipImportProgress;
  errors: GalleryZipImportErrorItem[];
  /** @description 入库后产生的图片 id 列表(用于后续可视化/回滚) */
  imageIds: number[];
  /** @description 取消标记:置 true 后处理循环下一次检查时中断 */
  cancelRequested?: boolean;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryZipImportCreateInput {
  userId: string;
  tenantId?: string;
  scope?: 'platform' | 'tenant';
  groupId?: string | number;
  tags?: string[];
  originalName: string;
  fileSize: number;
  zipAbsPath: string;
}
