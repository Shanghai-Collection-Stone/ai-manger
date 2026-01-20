import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { readMongoSchemaCache } from '../../mongo/cache/mongo.cache.js';
import { SchemaService } from '../../../schema/services/schema.service.js';

/**
 * @title Schema 函数调用服务 Schema Function Call Service
 * @description 提供基于自然语言的Schema搜索工具。
 * @keywords-cn Schema, 函数调用, 搜索
 * @keywords-en schema, function-call, search
 */
@Injectable()
export class SchemaFunctionCallService {
  constructor(private readonly schema: SchemaService) {}

  getHandle(): CreateAgentParams['tools'] {
    const schemaSearch = tool(
      async ({ query, limit }) => {
        console.log('开始搜索', query, limit);
        const cache =
          (await readMongoSchemaCache()) ??
          (await this.schema.getDatabaseSchema());
        const q = String(query).toLowerCase();
        const tokens = q
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const max = typeof limit === 'number' && limit > 0 ? limit : 10;
        const items = [] as {
          name: string;
          nameCn?: string;
          keywords?: string[];
        }[];
        for (const t of cache.tables) {
          const lowerName = t.name.toLowerCase();
          const nameHits = tokens.length
            ? tokens.some((tok) => lowerName.includes(tok))
            : lowerName.includes(q);
          const kwHits = tokens.length
            ? (t.keywords ?? []).some((k) =>
                tokens.some((tok) => k.toLowerCase().includes(tok)),
              )
            : (t.keywords ?? []).some((k) => k.toLowerCase().includes(q));
          if (nameHits || kwHits) {
            items.push({
              name: t.name,
              nameCn: t.nameCn,
              keywords: t.keywords,
            });
            if (items.length >= max) break;
          }
        }
        return JSON.stringify({ query, items });
      },
      {
        name: 'schema_search',
        description: 'Search related table schema based on natural language',
        schema: z.object({
          query: z
            .string()
            .describe('表的中文关键词,尽可能一次多个,多个可以用空格隔开'),
          limit: z
            .number()
            .optional()
            .describe('Max number of tables to return'),
        }),
      },
    );
    return [schemaSearch];
  }
}
