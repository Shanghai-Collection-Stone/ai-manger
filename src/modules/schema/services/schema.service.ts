import { Injectable, Inject } from '@nestjs/common';
import { Db } from 'mongodb';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  MongoSchemaCache,
  TableMeta,
  FieldMeta,
} from '../../data-source/types/data-source.types.js';
import {
  ZOverrides,
  Overrides,
  ZOverridesAlt,
  ZOverridesKeyedAlt,
} from '../types/schema.types.js';
import { readMongoSchemaCache } from '../../data-source/cache/mongo.cache.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { TextFormatService } from '../../format/services/format.service.js';
import { CreateAgentParams } from 'langchain';

/**
 * @title Schema 服务 Schema Service
 * @description 推断集合字段类型并生成缓存JS。
 * @keywords-cn Schema, 缓存, 字段
 * @keywords-en schema, cache, fields
 */
@Injectable()
export class SchemaService {
  constructor(
    @Inject('SCHEMA_MONGO_DB') private readonly db: Db,
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
  ) {}

  async getCollections(): Promise<string[]> {
    const cols = await this.db.listCollections().toArray();
    const names: string[] = [];
    for (const c of cols) {
      if (typeof c.name === 'string') names.push(c.name);
    }
    return names;
  }

  private inferType(val: unknown): string {
    if (val === null || typeof val === 'undefined') return 'null';
    if (Array.isArray(val)) return 'array';
    const t = typeof val;
    if (t === 'string' || t === 'number' || t === 'boolean') return t;
    if (val instanceof Date) return 'date';
    return 'object';
  }

  async sampleSchema(collection: string, sample = 100): Promise<FieldMeta[]> {
    const col = this.db.collection(collection);
    const cursor = col.find({}, { limit: sample });
    const seen: Map<string, string> = new Map();
    for await (const doc of cursor) {
      if (doc && typeof doc === 'object') {
        for (const [k, v] of Object.entries(doc)) {
          const tp = this.inferType(v);
          if (!seen.has(k)) seen.set(k, tp);
        }
      }
    }
    const fields: FieldMeta[] = [];
    for (const [name, type] of seen.entries()) {
      fields.push({ name, type });
    }
    return fields;
  }

  async getDatabaseSchema(): Promise<MongoSchemaCache> {
    const names = await this.getCollections();
    const tables: TableMeta[] = [];
    for (const n of names) {
      const fields = await this.sampleSchema(n);
      tables.push({ name: n, fields });
    }
    return { tables };
  }

  async buildCache(
    overrides?: Overrides,
    cache?: MongoSchemaCache,
  ): Promise<{ path: string; size: number }> {
    const base = cache ?? (await this.getDatabaseSchema());
    const merged: MongoSchemaCache = { tables: [] };
    for (const t of base.tables) {
      const ov = overrides ? overrides[t.name] : undefined;
      const fields: FieldMeta[] = [];
      for (const f of t.fields) {
        const fv = ov && ov.fields ? ov.fields[f.name] : undefined;
        fields.push({
          name: f.name,
          type: f.type,
          nameCn: fv?.nameCn,
          description: fv?.description,
        });
      }
      merged.tables.push({
        name: t.name,
        nameCn: ov?.nameCn,
        keywords: ov?.keywords,
        fields,
      });
    }
    const dir = join(process.cwd(), 'data', 'cache');
    await fs.mkdir(dir, { recursive: true });
    const file = join(dir, 'mongo-schema.mjs');
    const content = `export default ${JSON.stringify(merged, null, 2)};\n`;
    await fs.writeFile(file, content, 'utf8');
    const stat = await fs.stat(file);
    return { path: file, size: stat.size };
  }

  /**
   * @title 使用AI优化缓存 Optimize Cache with AI
   * @description 读取现有缓存，调用Gemini优化字段描述与关键词，并更新缓存文件。
   * @keywords-cn AI优化, Gemini, 缓存
   * @keywords-en ai optimize, gemini, cache
   */
  async optimizeCacheWithAI(params?: {
    model?: string;
    temperature?: number;
  }): Promise<{ path: string; size: number }> {
    const current = await readMongoSchemaCache();
    const cache: MongoSchemaCache = current ?? (await this.getDatabaseSchema());
    const sys =
      '你是一个数据库Schema优化助手。针对输入的单个表信息，补充更准确的中文名称、关键词列表与字段描述。严格要求：仅返回有效的JSON对象，符合overrides结构，且只包含该表的键；不允许代码块标记、注释或任何非JSON字符；必须使用双引号；不允许多余逗号。';
    const config = {
      provider: 'deepseek' as const,
      model: params?.model ?? 'deepseek-chat',
      temperature: params?.temperature ?? 0.3,
      system: sys,
      contextSchema:
        ZOverrides as unknown as CreateAgentParams['contextSchema'],
    };
    const overrides: Overrides = {};
    const messages = this.agent.toMessages([{ role: 'system', content: sys }]);
    const tables = cache.tables;
    for (const t of tables) {
      const single = { table: { name: t.name, fields: t.fields } };
      const input = JSON.stringify(single);
      console.log('[SchemaService] optimize start', t.name);
      messages.push(
        ...this.agent.toMessages([{ role: 'user', content: input }]),
      );
      const ai = await this.agent.runWithMessages({ config, messages });
      const text = (ai as unknown as { content: unknown }).content;
      const raw0 = typeof text === 'string' ? text : JSON.stringify(text);
      const raw = this.format.normalizeJsonText(raw0);
      console.log('[SchemaService] optimize result', t.name, raw);
      messages.push(
        ...this.agent.toMessages([{ role: 'assistant', content: raw }]),
      );
      let obj: unknown;
      try {
        obj = JSON.parse(raw) as unknown;
      } catch (e) {
        console.error(e);
        continue;
      }
      const norm = this.normalizeOverrides(obj);
      if (norm) {
        for (const k of Object.keys(norm)) {
          overrides[k] = norm[k];
        }
      }
    }
    return this.buildCache(overrides, cache);
  }

  private normalizeOverrides(input: unknown): Overrides | null {
    const a = ZOverrides.safeParse(input);
    if (a.success) return a.data;
    const k = ZOverridesKeyedAlt.safeParse(input);
    if (k.success) {
      const out: Overrides = {} as Overrides;
      const data = k.data;
      for (const tableName of Object.keys(data)) {
        const t = data[tableName];
        out[tableName] = {
          nameCn: t.nameCn,
          keywords: t.keywords,
          fields: {},
        };
        if (t.fields) {
          for (const f of t.fields) {
            out[tableName].fields![f.name] = {
              nameCn: f.nameCn,
              description: f.description,
            };
          }
        }
      }
      return out;
    }
    const b = ZOverridesAlt.safeParse(input);
    if (b.success) {
      const t = b.data.table;
      const out: Overrides = {} as Overrides;
      out[t.name] = {
        nameCn: t.nameCn,
        keywords: t.keywords,
        fields: {},
      };
      for (const f of t.fields) {
        out[t.name].fields![f.name] = {
          nameCn: f.nameCn,
          description: f.description,
        };
      }
      return out;
    }
    return null;
  }
}
