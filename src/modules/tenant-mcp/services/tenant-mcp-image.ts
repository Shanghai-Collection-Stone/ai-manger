import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { decodeMcpBase64 } from '../tenant-mcp.tools.js';

/**
 * @description MCP 上传图片的大小上限（10 MiB）。
 * @keyword-cn MCP图片上限, 上传大小
 * @keyword-en mcp-image-limit, upload-size
 */
export const MCP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * @description 把 MCP 传来的 base64 图片严格解码、校验格式（JPEG / PNG / WebP）、纠正方向并限制在 2400 像素内，重新编码成 JPEG 写进上传目录；
 *   返回登记图库需要的文件信息，登记失败时调用方负责删掉文件。
 * @keyword-cn MCP图片落盘, 图片重编码
 * @keyword-en save-mcp-image, image-reencode
 * @param {string} base64 不含 data URI 前缀的 base64。
 * @returns {Promise<{fileName: string, absPath: string, url: string, mimeType: string, size: number, width: number, height: number}>} 文件信息。
 * @throws {BadRequestException} base64 非法、超过大小或格式不支持。
 */
export async function saveMcpImageFile(base64: string): Promise<{
  fileName: string;
  absPath: string;
  url: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}> {
  const buffer = decodeMcpBase64(base64, MCP_IMAGE_MAX_BYTES);
  const processor = sharp(buffer, {
    limitInputPixels: 40000000,
    animated: false,
  });
  const metadata = await processor.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
    throw new BadRequestException('UNSUPPORTED_IMAGE_FORMAT');
  const output = await processor
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const fileName = `mcp-${randomUUID()}.jpg`;
  const directory = join(process.cwd(), 'public', 'uploads');
  const absPath = join(directory, fileName);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absPath, output.data, { flag: 'wx' });
  return {
    fileName,
    absPath,
    url: `/static/uploads/${fileName}`,
    mimeType: 'image/jpeg',
    size: output.data.length,
    width: output.info.width,
    height: output.info.height,
  };
}
