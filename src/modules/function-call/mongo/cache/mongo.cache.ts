import { promises as fs } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { MongoSchemaCache } from '../types/mongo.types.js';
import { safeParseMongoSchemaCache } from '../types/cache.types.js';

/**
 * @title 缓存读取 Cache Reader
 * @description 读取生成的 `mongo-schema.js` 缓存。
 * @keywords-cn 缓存, 读取
 * @keywords-en cache, read
 */
export async function readMongoSchemaCache(): Promise<
  MongoSchemaCache | undefined
> {
  const candidates = [
    join(process.cwd(), 'data', 'cache', 'mongo-schema.mjs'),
    join(process.cwd(), 'data', 'cache', 'mongo-schema.js'),
  ];
  let file: string | undefined;
  for (const c of candidates) {
    try {
      await fs.access(c);
      file = c;
      break;
    } catch {
      void 0;
    }
  }
  if (!file) return undefined;
  const url = pathToFileURL(file).href;
  const imported: unknown = await import(url);
  if (hasDefault(imported)) {
    const parsed = safeParseMongoSchemaCache(imported.default);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function hasDefault(v: unknown): v is { default: unknown } {
  return typeof v === 'object' && v !== null && 'default' in v;
}

/**
 * @title 类型守卫 Has Default
 * @description 判断动态导入模块是否包含 default 导出。
 * @keywords-cn 类型守卫, default
 * @keywords-en type guard, default
 */
