import { z } from 'zod';
import { MongoSchemaCache } from './mongo.types.js';

/**
 * @title 缓存Zod Schema Cache Zod Schema
 * @description 使用zod定义 `MongoSchemaCache` 的结构约束。
 * @keywords-cn Zod, 缓存, 结构
 * @keywords-en zod, cache, schema
 */
export const ZFieldMeta = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  nameCn: z.string().optional(),
});

export const ZTableMeta = z.object({
  name: z.string(),
  nameCn: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fields: z.array(ZFieldMeta),
});

export const ZMongoSchemaCache = z.object({
  tables: z.array(ZTableMeta),
});

export type ZMongoSchemaCacheType = z.infer<typeof ZMongoSchemaCache>;

export function safeParseMongoSchemaCache(data: unknown): {
  success: boolean;
  data: MongoSchemaCache;
} {
  const parsed = ZMongoSchemaCache.safeParse(data);
  if (!parsed.success) return { success: false, data: { tables: [] } };
  return { success: true, data: parsed.data as MongoSchemaCache };
}
