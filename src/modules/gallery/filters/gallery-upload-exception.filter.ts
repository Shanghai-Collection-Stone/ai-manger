import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import multer from 'multer';

/**
 * @description 将 gallery 上传场景中的 multer 异常转换为前端可读消息。
 * @keyword-en gallery upload multer exception filter
 */
@Catch(multer.MulterError, BadRequestException, PayloadTooLargeException)
export class GalleryUploadExceptionFilter implements ExceptionFilter {
  /**
   * @description 捕获 multer 错误并返回统一 JSON 响应。
   * @keyword-en catch multer error and map message
   * @param {unknown} exception - 捕获到的异常
   * @param {ArgumentsHost} host - Nest 上下文对象
   * @returns {void}
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof multer.MulterError) {
      const { status, message } = this.resolveMulterError(exception);
      response.status(status).json({ message });
      return;
    }

    if (exception instanceof PayloadTooLargeException) {
      response
        .status(HttpStatus.PAYLOAD_TOO_LARGE)
        .json({ message: '单个文件大小不能超过 12MB' });
      return;
    }

    if (exception instanceof BadRequestException) {
      const message = this.resolveBadRequestMessage(exception);
      response.status(HttpStatus.BAD_REQUEST).json({ message });
      return;
    }

    response
      .status(HttpStatus.BAD_REQUEST)
      .json({ message: '上传请求参数错误' });
  }

  /**
   * @description 将 MulterError code 映射为业务可读提示。
   * @keyword-en map multer error code to message
   * @param {multer.MulterError} error - multer 错误对象
   * @returns {{ status: number; message: string }}
   */
  private resolveMulterError(error: multer.MulterError): {
    status: number;
    message: string;
  } {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        message: '单个文件大小不能超过 12MB',
      };
    }

    if (
      error.code === 'LIMIT_FILE_COUNT' ||
      error.code === 'LIMIT_UNEXPECTED_FILE'
    ) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: '最多只能同时上传 24 个文件',
      };
    }

    return {
      status: HttpStatus.BAD_REQUEST,
      message: error.message || '上传失败，请检查文件后重试',
    };
  }

  /**
   * @description 解析 BadRequestException，覆盖上传超量等通用报错文案。
   * @keyword-en normalize bad request upload message
   * @param {BadRequestException} exception - BadRequest 异常
   * @returns {string}
   */
  private resolveBadRequestMessage(exception: BadRequestException): string {
    const response = exception.getResponse();
    const rawMessage =
      typeof response === 'string'
        ? response
        : typeof response === 'object' && response !== null
          ? (response as { message?: string | string[] }).message
          : undefined;

    const message = Array.isArray(rawMessage)
      ? rawMessage.join('; ')
      : String(rawMessage || exception.message || '').trim();

    const normalized = message.toLowerCase();
    if (
      normalized.includes('too many files') ||
      normalized.includes('unexpected field') ||
      normalized.includes('limit_file_count') ||
      normalized.includes('limit_unexpected_file')
    ) {
      return '最多只能同时上传 24 个文件';
    }

    if (
      normalized.includes('file too large') ||
      normalized.includes('payload too large') ||
      normalized.includes('limit_file_size')
    ) {
      return '单个文件大小不能超过 12MB';
    }

    return message || '上传请求参数错误';
  }
}
