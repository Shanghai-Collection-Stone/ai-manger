import { Injectable } from '@nestjs/common';
import multer from 'multer';
import { extname, join, relative, sep } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';

/**
 * @description 网盘物理存储根目录(可由 NETDISK_STORAGE_DIR 覆盖，默认 <cwd>/storage/netdisk)
 * @keyword-en netdisk storage base dir
 * @keyword-cn 网盘存储根目录
 */
export function netdiskBaseDir(): string {
  const configured = process.env.NETDISK_STORAGE_DIR?.trim();
  return configured && configured.length > 0
    ? configured
    : join(process.cwd(), 'storage', 'netdisk');
}

/**
 * @description 构建 multer 磁盘存储引擎:按 <base>/<tenantId>/<yyyy>/<mm>/<uuid.ext> 落盘
 * @keyword-en create netdisk disk storage engine
 * @keyword-cn 网盘磁盘存储引擎
 */
export function createNetdiskDiskStorage(): multer.StorageEngine {
  return multer.diskStorage({
    destination: (
      req: Request,
      _file: Express.Multer.File,
      cb: (error: Error | null, destination: string) => void,
    ) => {
      const tenantId = (req as AdminRequest).adminUser?.tenantId ?? '_no_tenant';
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dir = join(netdiskBaseDir(), tenantId, yyyy, mm);
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error as Error, dir);
      }
    },
    filename: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, filename: string) => void,
    ) => {
      cb(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  });
}

/**
 * @description 网盘存储服务，负责相对存储键与绝对路径互转及物理文件删除
 * @keyword-en netdisk storage service
 * @keyword-cn 网盘存储服务
 */
@Injectable()
export class NetdiskStorageService {
  /**
   * @description 由 multer 落盘的绝对路径推导相对存储键(以 / 分隔)
   * @keyword-en storage key of abs path
   * @keyword-cn 绝对路径转存储键
   */
  storageKeyOf(absPath: string): string {
    return relative(netdiskBaseDir(), absPath).split(sep).join('/');
  }

  /**
   * @description 由相对存储键还原绝对路径
   * @keyword-en abs path of storage key
   * @keyword-cn 存储键转绝对路径
   */
  absPathOf(storageKey: string): string {
    return join(netdiskBaseDir(), ...storageKey.split('/'));
  }

  /**
   * @description 删除物理文件(不存在则静默)
   * @keyword-en delete stored file
   * @keyword-cn 删除物理文件
   */
  async deleteByKey(storageKey: string): Promise<void> {
    try {
      await unlink(this.absPathOf(storageKey));
    } catch {
      // 文件缺失视为已删除，忽略
    }
  }
}
