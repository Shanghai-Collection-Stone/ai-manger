import { Controller, Post, Body, Get, Inject, Optional } from '@nestjs/common';
import {
  DataSourceSchemaService,
  MAIN_DATA_SOURCE,
} from '../services/data-source-schema.service.js';
import { SuperPartySourceService } from '../sources/super-party/super-party-source.service.js';
import { FeishuBitableSourceService } from '../sources/feishu-bitable/feishu-bitable-source.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { TextFormatService } from '../../format/services/format.service.js';

type FeishuTableAiField = {
  name: string;
  nameCn?: string;
  description?: string;
};

type FeishuTableAiAnalysis = {
  description?: string;
  keywords?: string[];
  fields?: FeishuTableAiField[];
};

/**
 * @title 数据源控制器 Data Source Controller
 * @description 提供数据源管理 API，包括向量更新触发。
 * @keywords-cn 数据源控制器, 向量更新, API
 * @keywords-en data source controller, vector update, API
 */
@Controller('data-source')
export class DataSourceController {
  constructor(
    private readonly schemaService: DataSourceSchemaService,
    @Optional()
    @Inject(SuperPartySourceService)
    private readonly superPartyService?: SuperPartySourceService,
    @Optional()
    @Inject(FeishuBitableSourceService)
    private readonly feishuBitableService?: FeishuBitableSourceService,
    private readonly agentService?: AgentService,
    private readonly formatService?: TextFormatService,
  ) {}

  /**
   * @title 触发向量更新 Trigger Vector Update
   * @description 主动触发指定数据源的 Schema 向量化更新。
   */
  @Post('update-vectors')
  async updateVectors(
    @Body() body: { sourceCode?: string; force?: boolean },
  ): Promise<{ success: boolean; count: number; message: string }> {
    const sourceCode = body.sourceCode ?? MAIN_DATA_SOURCE.code;
    const force = body.force ?? false;

    console.log(
      `[DataSourceController] Triggering vector update for ${sourceCode}, force=${force}`,
    );

    // 处理外部数据源
    if (sourceCode === 'super-party') {
      return this.importSuperPartySchemas(force);
    }

    if (force) {
      // 强制更新：清除旧的再重新生成
      await this.schemaService.clearSchemaForSource(sourceCode);
    }

    const count = await this.schemaService.generateAllSchemas(sourceCode);

    return {
      success: true,
      count,
      message: `Generated ${count} schemas for ${sourceCode}`,
    };
  }

  /**
   * @title 导入超级派对 Schema Import Super Party Schemas
   * @description 从 super_party 数据库导入所有集合的 schema 到主数据库。
   */
  @Post('import-super-party')
  async importSuperPartySchemas(
    @Body() body?: { force?: boolean } | boolean,
  ): Promise<{ success: boolean; count: number; message: string }> {
    const force = typeof body === 'boolean' ? body : (body?.force ?? false);
    const sourceCode = 'super-party';

    if (!this.superPartyService) {
      return {
        success: false,
        count: 0,
        message: 'SuperPartySourceService not available',
      };
    }

    console.log(
      `[DataSourceController] Importing super-party schemas, force=${force}`,
    );

    if (force) {
      await this.schemaService.clearSchemaForSource(sourceCode);
    }

    // 获取 super_party 的所有集合
    const collections = await this.superPartyService.getCollections();
    let count = 0;

    for (const collectionName of collections) {
      if (collectionName.startsWith('system.')) continue;

      try {
        // 获取集合的 schema 信息
        const fields = await this.superPartyService.getCollectionSchema(
          collectionName,
          100,
        );

        // 生成关键词
        const keywords = this.generateKeywords(collectionName);

        // 保存到 data_source_schemas
        await this.schemaService.upsertSchema({
          sourceCode,
          collectionName,
          fields: fields.map((f) => ({
            name: f.name,
            type: f.type,
          })),
          keywords,
        });

        console.log(
          `[DataSourceController] Imported schema for ${collectionName}`,
        );
        count++;
      } catch (error) {
        console.error(
          `[DataSourceController] Failed to import schema for ${collectionName}:`,
          error,
        );
      }
    }

    return {
      success: true,
      count,
      message: `Imported ${count} schemas from super-party`,
    };
  }

  /**
   * @title 导入飞书多维表格 Schema Import Feishu Bitable Schemas
   * @description 从配置文件读取飞书表定义，从 API 获取字段信息，写入 schema。
   */
  @Post('import-feishu-bitable')
  async importFeishuBitableSchemas(
    @Body() body?: { force?: boolean },
  ): Promise<{ success: boolean; count: number; message: string }> {
    const force = body?.force ?? false;

    if (!this.feishuBitableService) {
      return {
        success: false,
        count: 0,
        message: 'FeishuBitableSourceService not available',
      };
    }

    console.log(
      `[DataSourceController] Importing feishu-bitable schemas, force=${force}`,
    );

    const config = this.feishuBitableService.loadConfig();
    console.log(
      `[DataSourceController] Loaded config:`,
      config
        ? {
            apps: config.length,
            tables: this.feishuBitableService.getConfiguredTables().length,
          }
        : null,
    );
    if (!config) {
      return {
        success: false,
        count: 0,
        message: 'Failed to load feishu-bitable config file',
      };
    }

    const sourceCode = this.feishuBitableService.getSourceCode();

    if (force) {
      await this.schemaService.clearSchemaForSource(sourceCode);
    }

    console.log(
      `[DataSourceController] Getting schemas for tables:`,
      this.feishuBitableService.getConfiguredTables().map((t) => t.tableId),
    );
    const schemas = await this.feishuBitableService.getAllTableSchemas();
    console.log(`[DataSourceController] Got ${schemas.length} schemas`);
    let count = 0;

    for (const schema of schemas) {
      try {
        let aiKeywords: string[] = [];
        let fields = schema.fields;
        if (this.agentService && this.formatService) {
          try {
            const sys =
              '你是一个数据库Schema分析助手。根据输入的飞书多维表格表结构信息，生成该表的简短中文用途描述，并给出一组适合搜索的关键词。只返回JSON对象，结构为:{"description":string,"keywords":string[],"fields":Array<{"name":string,"nameCn"?:string,"description"?:string>}>}。不要返回多余文本或代码块标记。';
            const input = {
              tableId: schema.tableId,
              tableName: schema.tableName,
              nameCn: schema.nameCn,
              fields: schema.fields,
            };
            const config = {
              provider: 'deepseek' as const,
              model: 'deepseek-chat',
              temperature: 0.3,
              system: sys,
            };
            const messages = this.agentService.toMessages([
              { role: 'system', content: sys },
              { role: 'user', content: JSON.stringify(input) },
            ]);
            const ai = await this.agentService.runWithMessages({
              config,
              messages,
            });
            const content = (ai as unknown as { content: unknown }).content;
            const raw0 =
              typeof content === 'string' ? content : JSON.stringify(content);
            const raw = this.formatService.normalizeJsonText(raw0);
            const parsed = JSON.parse(raw) as FeishuTableAiAnalysis;
            if (parsed && Array.isArray(parsed.keywords)) {
              aiKeywords = parsed.keywords.filter(
                (v) => typeof v === 'string' && v.trim().length > 0,
              );
              const aiFields = parsed.fields;
              if (Array.isArray(aiFields)) {
                fields = fields.map((f) => {
                  const matched = aiFields.find((x) => x && x.name === f.name);
                  if (!matched) {
                    return f;
                  }
                  return {
                    ...f,
                    nameCn:
                      typeof matched.nameCn === 'string' &&
                      matched.nameCn.trim().length > 0
                        ? matched.nameCn
                        : f.nameCn,
                    description:
                      typeof matched.description === 'string' &&
                      matched.description.trim().length > 0
                        ? matched.description
                        : f.description,
                  };
                });
              }
            }
          } catch (e) {
            console.warn(
              `[DataSourceController] AI analysis failed for Feishu table ${schema.tableId}:`,
              e,
            );
          }
        }

        const keywords = [
          schema.tableName,
          ...this.generateKeywords(schema.tableName),
          ...(schema.keywords ?? []),
          ...aiKeywords,
        ];

        // 保存到 data_source_schemas
        // 注意：collectionName 必须存储 tableId，以便 schema_search 直接返回给工具使用
        await this.schemaService.upsertSchema({
          sourceCode,
          collectionName: schema.tableId,
          nameCn: schema.nameCn || schema.tableName,
          fields,
          keywords,
        });

        console.log(
          `[DataSourceController] Imported schema for ${schema.tableName} (${schema.tableId})`,
        );
        count++;
      } catch (error) {
        console.error(
          `[DataSourceController] Failed to import schema for ${schema.tableName}:`,
          error,
        );
      }
    }

    return {
      success: true,
      count,
      message: `Imported ${count} schemas from feishu-bitable`,
    };
  }

  /**
   * @title 更新单个 Schema 向量 Update Single Schema Vector
   * @description 更新指定集合的 Schema 向量。
   */
  @Post('update-schema')
  async updateSchema(
    @Body() body: { collectionName: string; sourceCode?: string },
  ): Promise<{ success: boolean; collectionName: string }> {
    const sourceCode = body.sourceCode ?? MAIN_DATA_SOURCE.code;

    await this.schemaService.generateSchemaForCollection(
      body.collectionName,
      sourceCode,
    );

    return {
      success: true,
      collectionName: body.collectionName,
    };
  }

  /**
   * @title 清除数据源 Schema Clear Source Schemas
   * @description 清除指定数据源的所有 Schema。
   */
  @Post('clear-schemas')
  async clearSchemas(
    @Body() body: { sourceCode?: string },
  ): Promise<{ success: boolean; deletedCount: number }> {
    const sourceCode = body.sourceCode ?? MAIN_DATA_SOURCE.code;

    const deletedCount =
      await this.schemaService.clearSchemaForSource(sourceCode);

    return {
      success: true,
      deletedCount,
    };
  }

  /**
   * @title 列出所有集合 List Collections
   * @description 返回数据源的所有集合列表。
   */
  @Get('collections')
  async listCollections(): Promise<{ collections: string[] }> {
    const collections = await this.schemaService.listCollections();
    return { collections };
  }

  /**
   * @title 搜索 Schema Search Schemas
   * @description 使用关键词搜索 Schema。
   */
  @Post('search-schema')
  async searchSchema(
    @Body() body: { query: string; sourceCode?: string; limit?: number },
  ): Promise<{ results: unknown[] }> {
    const sourceCode = body.sourceCode ?? MAIN_DATA_SOURCE.code;
    const limit = body.limit ?? 10;

    const results = await this.schemaService.searchSchema(
      body.query,
      sourceCode,
      limit,
    );

    return {
      results: results.map((r) => ({
        collectionName: r.schema.collectionName,
        nameCn: r.schema.nameCn,
        keywords: r.schema.keywords,
        fields: r.schema.fields,
        score: r.score,
        matchType: r.matchType,
      })),
    };
  }

  /**
   * @title 生成关键词 Generate Keywords
   */
  private generateKeywords(collectionName: string): string[] {
    const keywords: string[] = [];

    // 英文关键词：拆分驼峰和下划线
    const englishTokens = collectionName
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[_\-\s]+/)
      .filter((t) => t.length > 1);
    keywords.push(...englishTokens);

    // 添加完整集合名
    if (!keywords.includes(collectionName.toLowerCase())) {
      keywords.push(collectionName.toLowerCase());
    }

    return keywords;
  }
}
