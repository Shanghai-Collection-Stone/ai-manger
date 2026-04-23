import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import type { Request, Response } from 'express';
import { AntiDetectionService } from '../services/anti-detection.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type {
  AntiDetectionOutputFormat,
  AntiDetectionStrength,
} from '../types/anti-detection.types.js';

/** 合法强度档位 */
const VALID_STRENGTHS = new Set<AntiDetectionStrength>([
  'light',
  'standard',
  'strong',
]);
/** 合法输出格式 */
const VALID_FORMATS = new Set<AntiDetectionOutputFormat>(['keep', 'jpeg', 'png']);
/** 批量单次上限 */
const BATCH_LIMIT = 20;
/** 单文件大小上限 20MB */
const FILE_SIZE_LIMIT = 20 * 1024 * 1024;

/**
 * @description 合法化并规范强度入参（非法默认 standard）
 * @keyword-en normalize strength param
 */
const normalizeStrength = (input: unknown): AntiDetectionStrength => {
  const v = String(input ?? '').trim().toLowerCase();
  return VALID_STRENGTHS.has(v as AntiDetectionStrength)
    ? (v as AntiDetectionStrength)
    : 'standard';
};

/**
 * @description 合法化并规范输出格式入参（非法默认 keep）
 * @keyword-en normalize output format param
 */
const normalizeFormat = (input: unknown): AntiDetectionOutputFormat => {
  const v = String(input ?? '').trim().toLowerCase();
  return VALID_FORMATS.has(v as AntiDetectionOutputFormat)
    ? (v as AntiDetectionOutputFormat)
    : 'keep';
};

/**
 * @description 解析可选 JPEG 质量数值入参
 * @keyword-en parse optional jpeg quality number
 */
const parseQuality = (input: unknown): number | undefined => {
  if (input === undefined || input === null || input === '') return undefined;
  const n = Number(input);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(40, Math.min(100, Math.round(n)));
};

/**
 * @description 根据输出 mime 生成下载文件名（保留源基名，换扩展名）
 * @keyword-en derive output filename from source name and mime
 */
const deriveOutName = (srcName: string, mime: string): string => {
  const base = (srcName || 'image').replace(/\.[^./\\]+$/u, '') || 'image';
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  return `${base}-clean.${ext}`;
};

/**
 * @title 抗AI识别控制器 Anti-AI-Detection Controller
 * @description 对外暴露单张与批量"去 AI 标识"处理入口，供前端工具页调用。
 * @keyword-en anti detection controller single batch upload download
 */
@Controller('api/anti-detection')
export class AntiDetectionController {
  constructor(
    private readonly antiDetection: AntiDetectionService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 鉴权解析（Bearer token，沿用项目 admin token 体系）
   * @keyword-en resolve auth from bearer token
   */
  private async resolveAuth(req: Request): Promise<void> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('AUTH_REQUIRED');
    const user = await this.adminService.getUserByToken(token);
    if (!user) throw new UnauthorizedException('AUTH_REQUIRED');
  }

  /**
   * @description 单张处理：multipart/form-data 上传 field=file；返回处理后二进制
   * @keyword-en process single image return binary
   */
  @Post('process')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: FILE_SIZE_LIMIT },
      fileFilter: (
        _req: unknown,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const mt = String(file.mimetype || '').toLowerCase();
        cb(null, mt.startsWith('image/'));
      },
    }),
  )
  async processSingle(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      strength?: string;
      outputFormat?: string;
      jpegQualityMin?: string;
      jpegQualityMax?: string;
    },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.resolveAuth(req);
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('FILE_REQUIRED');
    }
    const result = await this.antiDetection.process(file.buffer, {
      strength: normalizeStrength(body?.strength),
      outputFormat: normalizeFormat(body?.outputFormat),
      jpegQualityMin: parseQuality(body?.jpegQualityMin),
      jpegQualityMax: parseQuality(body?.jpegQualityMax),
      tag: 'anti-detection-api',
    });
    const outName = deriveOutName(file.originalname ?? 'image', result.mimeType);
    res
      .status(200)
      .set({
        'Content-Type': result.mimeType,
        'Content-Length': String(result.buffer.length),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(outName)}"`,
        'X-AntiDetection-Processed': result.processed ? '1' : '0',
      })
      .send(result.buffer);
  }

  /**
   * @description 批量处理：multipart/form-data 上传 field=files[]；返回 JSON（base64 数组）
   * @keyword-en process batch images return json base64
   */
  @Post('process-batch')
  @UseInterceptors(
    FilesInterceptor('files', BATCH_LIMIT, {
      storage: multer.memoryStorage(),
      limits: { fileSize: FILE_SIZE_LIMIT },
      fileFilter: (
        _req: unknown,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const mt = String(file.mimetype || '').toLowerCase();
        cb(null, mt.startsWith('image/'));
      },
    }),
  )
  async processBatch(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body()
    body: {
      strength?: string;
      outputFormat?: string;
      jpegQualityMin?: string;
      jpegQualityMax?: string;
    },
    @Req() req: Request,
  ): Promise<{
    count: number;
    items: Array<{
      originalName: string;
      outputName: string;
      mimeType: string;
      size: number;
      processed: boolean;
      dataBase64: string;
      appliedParams?: Record<string, number | string | boolean>;
    }>;
  }> {
    await this.resolveAuth(req);
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('FILES_REQUIRED');
    }
    const opts = {
      strength: normalizeStrength(body?.strength),
      outputFormat: normalizeFormat(body?.outputFormat),
      jpegQualityMin: parseQuality(body?.jpegQualityMin),
      jpegQualityMax: parseQuality(body?.jpegQualityMax),
      tag: 'anti-detection-api-batch',
    };

    const items = [] as Array<{
      originalName: string;
      outputName: string;
      mimeType: string;
      size: number;
      processed: boolean;
      dataBase64: string;
      appliedParams?: Record<string, number | string | boolean>;
    }>;
    for (const file of files) {
      if (!file?.buffer || file.buffer.length === 0) continue;
      const result = await this.antiDetection.process(file.buffer, opts);
      items.push({
        originalName: file.originalname ?? 'image',
        outputName: deriveOutName(file.originalname ?? 'image', result.mimeType),
        mimeType: result.mimeType,
        size: result.buffer.length,
        processed: result.processed,
        dataBase64: result.buffer.toString('base64'),
        appliedParams: result.appliedParams,
      });
    }
    return { count: items.length, items };
  }
}
