import { promises as fs } from 'fs';
import { join } from 'path';
import type { MongoSchemaCache } from '../types/data-source.types.js';

/**
 * @title 读取 Mongo Schema 缓存 Read Mongo Schema Cache
 * @description 从缓存文件读取 MongoDB Schema 信息。
 */
export async function readMongoSchemaCache(): Promise<MongoSchemaCache | null> {
  try {
    // 尝试从多个位置读取缓存文件
    const possiblePaths = [
      join(process.cwd(), 'dist', 'mongo-schema.mjs'),
      join(process.cwd(), 'dist', 'mongo-schema.js'),
      join(process.cwd(), 'mongo-schema.mjs'),
      join(process.cwd(), 'mongo-schema.js'),
    ];

    for (const filePath of possiblePaths) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          // 读取并解析缓存文件
          const content = await fs.readFile(filePath, 'utf-8');
          // 尝试提取导出的对象并以 JSON 方式解析
          try {
            const jsonMatch = content.match(
              /export\s+default\s+({[\s\S]*?});?$/m,
            );
            if (jsonMatch && jsonMatch[1]) {
              const parsed = JSON.parse(jsonMatch[1]) as unknown;
              const data = parsed as Partial<MongoSchemaCache>;
              if (data && data.tables) {
                return data as MongoSchemaCache;
              }
            }
          } catch {
            // 解析失败
          }
          try {
            const assignMatch = content.match(/=\s*({[\s\S]*});?$/m);
            if (assignMatch && assignMatch[1]) {
              const parsed = JSON.parse(assignMatch[1]) as unknown;
              const data = parsed as Partial<MongoSchemaCache>;
              if (data && data.tables) {
                return data as MongoSchemaCache;
              }
            }
          } catch {
            // JSON 解析失败
          }
        }
      } catch {
        // 文件不存在，继续尝试下一个
      }
    }

    console.warn('[readMongoSchemaCache] No schema cache file found');
    return null;
  } catch (error) {
    console.error('[readMongoSchemaCache] Error reading cache:', error);
    return null;
  }
}
