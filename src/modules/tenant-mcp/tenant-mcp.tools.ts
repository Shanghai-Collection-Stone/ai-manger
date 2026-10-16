import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

/** @keyword-en mcp-schema, input-validation */
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** @keyword-en mcp-schema, input-validation */
const text = z.string().trim().min(1).max(200);
/** @keyword-en mcp-schema, pagination */
const pagination = {
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(100000).default(0),
};
/** @keyword-en mcp-schema, article-content */
const content = {
  title: text,
  text: z.string().max(100000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  imageUrls: z
    .array(
      z
        .string()
        .max(2000)
        .regex(/^(https?:\/\/|\/static\/uploads\/)/),
    )
    .max(30)
    .optional(),
};

/** @keyword-en mcp-tools, tool-permission */
export const TENANT_MCP_TOOLS = {
  gallery_search: {
    title: '图库搜索',
    description:
      '搜索本租户图库。query 为语义搜索，tags 为标签过滤；不传 query 则列出最近图片。',
    schema: z
      .object({
        query: z.string().trim().min(1).max(500).optional(),
        tags: z.array(text).max(32).optional(),
        limit: pagination.limit,
        cursorId: id.optional(),
      })
      .strict(),
  },
  image_upload: {
    title: '图片上传',
    description:
      '上传 base64 图片到本租户图库，支持 JPEG、PNG、WebP，最多 10 MiB。base64 不含 data URI 前缀。',
    schema: z
      .object({
        base64: z.string().min(4).max(13981016),
        originalName: text,
        tags: z.array(text).max(32).optional(),
        description: z.string().max(2000).optional(),
      })
      .strict(),
  },
  library_list: {
    title: '文章库列表',
    description: '分页列出本租户文章库。',
    schema: z.object({ ...pagination, type: text.optional() }).strict(),
  },
  library_get: {
    title: '文章库详情',
    description: '获取本租户文章库详情与文章统计。',
    schema: z.object({ libraryId: id }).strict(),
  },
  library_create: {
    title: '新增文章库',
    description: '为本租户创建文章库。',
    schema: z
      .object({ name: text, type: z.string().max(100).default('') })
      .strict(),
  },
  library_update: {
    title: '修改文章库',
    description: '修改本租户文章库名称或类型。',
    schema: z
      .object({
        libraryId: id,
        name: text.optional(),
        type: z.string().max(100).optional(),
      })
      .strict(),
  },
  article_publish: {
    title: '发布文章到文章库',
    description:
      '把标题、正文与图片存入指定文章库，状态为未发布，等待扫码发布。此操作不会直接发布到小红书。',
    schema: z.object({ libraryId: id, ...content }).strict(),
  },
  article_upload: {
    title: '上传文章到文章库',
    description:
      '上传 UTF-8 JSON 文件的 base64 内容到文章库。文件结构为 {title,text?,tags?,imageUrls?}，最多 1 MiB。',
    schema: z
      .object({ libraryId: id, base64: z.string().min(4).max(1398104) })
      .strict(),
  },
  article_get: {
    title: '文章详情',
    description: '读取本租户单篇文章。',
    schema: z.object({ articleId: id }).strict(),
  },
  article_update: {
    title: '修改文章',
    description: '修改本租户文章的标题、正文、标签或图片。',
    schema: z
      .object({ articleId: id, ...content, title: text.optional() })
      .strict(),
  },
  article_list: {
    title: '文章列表',
    description: '分页读取指定文章库文章，可按发布状态过滤。',
    schema: z
      .object({
        libraryId: id,
        status: z.enum(['all', 'published', 'unpublished']).default('all'),
        ...pagination,
      })
      .strict(),
  },
  article_list_published: {
    title: '已发布文章列表',
    description: '分页获取指定文章库内已发布文章。',
    schema: z.object({ libraryId: id, ...pagination }).strict(),
  },
  article_list_unpublished: {
    title: '未发布文章列表',
    description: '分页获取指定文章库内未发布文章。',
    schema: z.object({ libraryId: id, ...pagination }).strict(),
  },
  library_publish_qr: {
    title: '文章库发布二维码',
    description:
      '获取文章库扫码发布二维码内容与小红书短链，此工具会授予扫码领取能力。',
    schema: z.object({ libraryId: id }).strict(),
  },
  article_recent_data: {
    title: '文章近期抓取数据',
    description:
      '获取本租户已发布文章最近 days 天的抓取数据，可按 taskId 查询某次抓取结果。',
    schema: z
      .object({
        articleId: id,
        taskId: id.optional(),
        days: z.number().int().min(1).max(90).default(7),
        ...pagination,
      })
      .strict(),
  },
  article_crawl: {
    title: '抓取文章数据',
    description:
      '立即抓取带有效小红书 NoteId 的已发布文章，首次抓取自动补建监控绑定。沿用现有采集渠道，可能抓取同选题的多篇文章；返回目标文章数据。同步完成返回终态，异步返回 taskId，可通过 article_recent_data 轮询。',
    schema: z.object({ articleId: id }).strict(),
  },
} as const;

/** @keyword-en mcp-tools, tool-permission */
export type TenantMcpToolName = keyof typeof TENANT_MCP_TOOLS;

/** @keyword-en article-upload, input-validation */
export const MCP_ARTICLE_CONTENT_SCHEMA = z.object(content).strict();

/** @keyword-en base64-validation, upload-limit */
export function decodeMcpBase64(value: string, maxBytes: number): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new BadRequestException('INVALID_BASE64');
  const buffer = Buffer.from(value, 'base64');
  if (
    !buffer.length ||
    buffer.length > maxBytes ||
    buffer.toString('base64') !== value
  )
    throw new BadRequestException('INVALID_UPLOAD_SIZE_OR_BASE64');
  return buffer;
}
