import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import {
  FeishuBitableAppConfig,
  FeishuBitableConfig,
  FeishuBitableTableConfig,
  FEISHU_FIELD_TYPE_MAP,
} from './feishu-bitable.config.js';
import { FieldMeta } from '../../types/data-source.types.js';

type FeishuBitableFilterCondition = {
  field?: string;
  fieldName?: string;
  field_name?: string;
  operator: string;
  value?: string | string[];
};

type FeishuBitableFilter = {
  conjunction?: 'and' | 'or';
  conditions?: FeishuBitableFilterCondition[];
};

/**
 * @title 飞书多维表格数据源服务 Feishu Bitable Source Service
 * @description 提供飞书多维表格数据源的核心操作能力，使用官方 SDK。
 * @keywords-cn 飞书, 多维表格, 数据源
 * @keywords-en feishu, bitable, data source
 */
@Injectable()
export class FeishuBitableSourceService {
  private client: lark.Client | null = null;
  private config: FeishuBitableConfig | null = null;
  private readonly configPath: string;

  constructor(private readonly configService: ConfigService) {
    // 配置文件路径 - 支持 src 和 dist 两种情况
    const possiblePaths = [
      path.join(
        process.cwd(),
        'src/modules/data-source/sources/feishu-bitable/feishu-bitable.config.json',
      ),
      path.join(__dirname, 'feishu-bitable.config.json'),
    ];
    this.configPath =
      possiblePaths.find((p) => fs.existsSync(p)) ?? possiblePaths[0];
    console.log(`[FeishuBitableSourceService] Config path: ${this.configPath}`);
  }

  /**
   * @title 加载配置 Load Config
   * @description 从配置文件加载飞书多维表格配置。
   */
  loadConfig(): FeishuBitableConfig | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn(
          `[FeishuBitableSourceService] Config file not found: ${this.configPath}`,
        );
        return null;
      }

      const content = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(content) as FeishuBitableConfig;

      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.warn(
          '[FeishuBitableSourceService] Config file is empty or not an array',
        );
        this.config = null;
        return null;
      }

      const configs: FeishuBitableAppConfig[] = parsed.map((item) => {
        const cfg = { ...item };
        if (!cfg.appId) {
          cfg.appId =
            this.configService.get<string>('FEISHU_APP_ID') ?? undefined;
        }
        if (!cfg.appSecret) {
          cfg.appSecret =
            this.configService.get<string>('FEISHU_APP_SECRET') ?? undefined;
        }
        if (!cfg.sourceCode) {
          cfg.sourceCode = 'feishu-bitable';
        }
        return cfg;
      });

      this.config = configs;

      const totalTables = configs.reduce(
        (sum, cfg) => sum + (cfg.tables?.length ?? 0),
        0,
      );

      console.log(
        `[FeishuBitableSourceService] Config loaded: apps=${configs.length}, tables=${totalTables}`,
      );

      return this.config;
    } catch (error) {
      console.error(
        '[FeishuBitableSourceService] Failed to load config:',
        error,
      );
      return null;
    }
  }

  /**
   * @title 获取 Lark Client Get Lark Client
   * @description 获取或创建飞书 SDK Client。
   */
  getClient(): lark.Client {
    if (this.client) {
      return this.client;
    }

    if (!this.config) {
      this.loadConfig();
    }

    const first = this.config?.[0];

    if (!first?.appId || !first?.appSecret) {
      throw new Error(
        'Feishu appId and appSecret are required. Please set FEISHU_APP_ID and FEISHU_APP_SECRET in environment variables.',
      );
    }

    this.client = new lark.Client({
      appId: first.appId,
      appSecret: first.appSecret,
      disableTokenCache: false,
    });

    return this.client;
  }

  /**
   * @title 获取配置的表列表 Get Configured Tables
   * @description 返回配置文件中定义的表列表。
   */
  getConfiguredTables(): FeishuBitableTableConfig[] {
    if (!this.config) {
      this.loadConfig();
    }
    if (!this.config) {
      return [];
    }
    return this.config.flatMap((cfg) => cfg.tables ?? []);
  }

  /**
   * @title 获取 App Token Get App Token
   */
  getAppToken(tableId?: string): string | null {
    if (!this.config) {
      this.loadConfig();
    }
    if (!this.config) {
      return null;
    }
    if (tableId) {
      for (const cfg of this.config) {
        const table = cfg.tables.find((t) => t.tableId === tableId);
        if (table) {
          return cfg.appToken;
        }
      }
      return null;
    }
    return this.config[0]?.appToken ?? null;
  }

  /**
   * @title 获取数据源代码 Get Source Code
   */
  getSourceCode(): string {
    if (!this.config) {
      this.loadConfig();
    }
    const first = this.config?.[0];
    return first?.sourceCode ?? 'feishu-bitable';
  }

  /**
   * @title 列出数据表 List Tables
   * @description 从飞书 API 获取多维表格中的所有数据表。
   */
  async listTables(): Promise<
    Array<{ tableId: string; name: string; revision: number }>
  > {
    const client = this.getClient();
    const appToken = this.getAppToken();

    if (!appToken) {
      throw new Error('App token is required');
    }

    const response = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_size: 100 },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list tables: ${response.msg}`);
    }

    return (
      response.data?.items?.map((item) => ({
        tableId: item.table_id ?? '',
        name: item.name ?? '',
        revision: item.revision ?? 0,
      })) ?? []
    );
  }

  /**
   * @title 列出字段 List Fields
   * @description 获取指定数据表的所有字段。
   */
  async listFields(tableId: string): Promise<FieldMeta[]> {
    const client = this.getClient();
    const appToken = this.getAppToken(tableId);

    if (!appToken) {
      throw new Error('App token is required');
    }

    const response = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100 },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list fields: ${response.msg}`);
    }

    return (
      response.data?.items?.map((field) => ({
        name: field.field_name ?? '',
        type: FEISHU_FIELD_TYPE_MAP[field.type ?? 1] ?? 'string',
        nameCn: field.field_name,
        description:
          typeof field.description === 'object'
            ? (field.description as { text?: string })?.text
            : undefined,
      })) ?? []
    );
  }

  /**
   * @title 列出记录 List Records
   * @description 获取指定数据表的记录列表。
   */
  async listRecords(
    tableId: string,
    options?: {
      pageSize?: number;
      pageToken?: string;
      filter?: FeishuBitableFilter;
      sort?: string[];
    },
  ): Promise<{
    records: Array<{ recordId: string; fields: Record<string, unknown> }>;
    hasMore: boolean;
    pageToken?: string;
    total?: number;
  }> {
    const client = this.getClient();
    const appToken = this.getAppToken(tableId);

    if (!appToken) {
      throw new Error('App token is required');
    }

    type FeishuBitableNormalizedCondition = {
      field_name: string;
      operator: string;
      value: string[];
    };

    const normalizedConditions = options?.filter?.conditions
      ?.map((condition) => {
        const fieldName =
          condition.field_name ?? condition.fieldName ?? condition.field;
        if (!fieldName) return null;

        let operator = condition.operator;
        const rawValue = condition.value;

        let valueArray: string[];
        if (Array.isArray(rawValue)) {
          valueArray = rawValue.map((v) => String(v));
        } else if (typeof rawValue === 'string') {
          valueArray = rawValue.length > 0 ? [rawValue] : [];
        } else if (rawValue == null) {
          valueArray = [];
        } else {
          valueArray = [String(rawValue)];
        }

        if (operator === 'isEmpty' || operator === 'isNotEmpty') {
          valueArray = [];
        }

        const dateOperators = new Set([
          'is',
          'isGreater',
          'isLess',
          'isGreaterEqual',
          'isLessEqual',
        ]);

        if (
          dateOperators.has(operator) &&
          valueArray.length === 1 &&
          /^\d{4}-\d{2}-\d{2}$/.test(valueArray[0])
        ) {
          const timestamp = Date.parse(`${valueArray[0]}T00:00:00Z`);
          if (!Number.isNaN(timestamp)) {
            valueArray = ['ExactDate', String(timestamp)];
          }
        }

        if (operator === 'isGreaterEqual') {
          operator = 'isGreater';
        } else if (operator === 'isLessEqual') {
          operator = 'isLess';
        }

        return {
          field_name: fieldName,
          operator,
          value: valueArray,
        } as FeishuBitableNormalizedCondition;
      })
      .filter((condition): condition is FeishuBitableNormalizedCondition =>
        Boolean(condition),
      );

    const filterPayload = normalizedConditions?.length
      ? {
          conjunction: options?.filter?.conjunction ?? 'and',
          conditions: normalizedConditions,
        }
      : undefined;

    const sortPayload = options?.sort
      ?.map((rule) => {
        const trimmed = rule.trim();
        if (!trimmed) return null;
        const [fieldName, direction] = trimmed.split(/\s+/);
        if (!fieldName) return null;
        return {
          field_name: fieldName,
          desc:
            typeof direction === 'string'
              ? direction.toUpperCase() === 'DESC'
              : false,
        };
      })
      .filter(
        (item): item is { field_name: string; desc: boolean } => item !== null,
      );

    type FeishuBitableSearchResponse = {
      code: number;
      msg?: string;
      data?: {
        items?: Array<{
          record_id?: string;
          fields?: Record<string, unknown>;
        }>;
        has_more?: boolean;
        page_token?: string;
        total?: number;
      };
    };

    type FeishuBitableAppTableRecordClient = {
      search: (args: {
        path: { app_token: string; table_id: string };
        params: { page_size: number; page_token?: string };
        data: {
          filter?:
            | {
                conjunction: 'and' | 'or';
                conditions: Array<{
                  field_name: string;
                  operator: string;
                  value: string[];
                }>;
              }
            | undefined;
          sort?: Array<{ field_name: string; desc: boolean }> | undefined;
          automatic_fields: boolean;
        };
      }) => Promise<FeishuBitableSearchResponse>;
    };

    const appTableRecord = client.bitable
      .appTableRecord as unknown as FeishuBitableAppTableRecordClient;

    const response = await appTableRecord.search({
      path: { app_token: appToken, table_id: tableId },
      params: {
        page_size: options?.pageSize ?? 20,
        page_token: options?.pageToken,
      },
      data: {
        filter: filterPayload,
        sort: sortPayload && sortPayload.length > 0 ? sortPayload : undefined,
        automatic_fields: false,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list records: ${response.msg}`);
    }

    return {
      records:
        response.data?.items?.map(
          (item: { record_id?: string; fields?: Record<string, unknown> }) => ({
            recordId: item.record_id ?? '',
            fields: item.fields ?? {},
          }),
        ) ?? [],
      hasMore: response.data?.has_more ?? false,
      pageToken: response.data?.page_token,
      total: response.data?.total,
    };
  }

  /**
   * @title 获取单条记录 Get Record
   * @description 获取指定记录的详细信息。
   */
  async getRecord(
    tableId: string,
    recordId: string,
  ): Promise<{ recordId: string; fields: Record<string, unknown> } | null> {
    const client = this.getClient();
    const appToken = this.getAppToken(tableId);

    if (!appToken) {
      throw new Error('App token is required');
    }

    const response = await client.bitable.appTableRecord.get({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
    });

    if (response.code !== 0) {
      console.error(`Failed to get record: ${response.msg}`);
      return null;
    }

    return {
      recordId: response.data?.record?.record_id ?? recordId,
      fields: response.data?.record?.fields ?? {},
    };
  }

  /**
   * @title 获取表 Schema Get Table Schema
   * @description 获取指定表的完整 Schema 信息，合并配置文件中的描述。
   */
  async getTableSchema(tableId: string): Promise<{
    tableId: string;
    tableName: string;
    nameCn?: string;
    description?: string;
    keywords?: string[];
    fields: FieldMeta[];
  } | null> {
    // 从配置中获取表的元数据
    const tableConfig = this.getConfiguredTables().find(
      (t) => t.tableId === tableId,
    );

    if (!tableConfig) {
      console.warn(
        `[FeishuBitableSourceService] Table ${tableId} not found in config`,
      );
      return null;
    }

    // 从 API 获取字段列表
    const fields = await this.listFields(tableId);

    return {
      tableId,
      tableName: tableConfig.tableName,
      nameCn: tableConfig.nameCn,
      description: tableConfig.description,
      keywords: tableConfig.keywords,
      fields,
    };
  }

  /**
   * @title 获取所有配置表的 Schema Get All Table Schemas
   * @description 获取配置文件中所有表的 Schema 信息。
   */
  async getAllTableSchemas(): Promise<
    Array<{
      tableId: string;
      tableName: string;
      nameCn?: string;
      description?: string;
      keywords?: string[];
      fields: FieldMeta[];
    }>
  > {
    const tables = this.getConfiguredTables();
    console.log(
      `[FeishuBitableSourceService] getAllTableSchemas: found ${tables.length} configured tables`,
      tables.map((t) => t.tableId),
    );
    const schemas: Array<{
      tableId: string;
      tableName: string;
      nameCn?: string;
      description?: string;
      keywords?: string[];
      fields: FieldMeta[];
    }> = [];

    for (const table of tables) {
      try {
        const schema = await this.getTableSchema(table.tableId);
        if (schema) {
          schemas.push(schema);
        }
      } catch (error) {
        console.error(
          `[FeishuBitableSourceService] Failed to get schema for ${table.tableId}:`,
          error,
        );
      }
    }

    return schemas;
  }
}
