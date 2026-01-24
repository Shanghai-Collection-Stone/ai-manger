import { Injectable } from '@nestjs/common';
import { FeishuBitableSourceService } from './feishu-bitable-source.service.js';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * @title 飞书多维表格列出记录工具 Feishu Bitable List Records Tool
 */
class FeishuBitableListRecordsTool extends StructuredTool {
  name = 'feishu_bitable_list_records';
  description = `查询飞书多维表格中的记录。

【日期字段筛选】
- 日期字段操作符: is, isNot, isGreater, isLess, isEmpty, isNotEmpty
- 日期值使用 YYYY-MM-DD 字符串格式，如 ["2025-01-21"]（系统自动转换）
- 示例: {"field_name":"创建日期", "operator":"isGreater", "value":["2025-01-01"]}

【普通字段】操作符: is, isNot, contains, doesNotContain, isEmpty, isNotEmpty, isGreater, isLess`;

  schema = z.object({
    tableId: z.string().describe('数据表 ID，如 tblxxxxxxxx'),
    pageSize: z.number().optional().default(20).describe('每页记录数，默认20'),
    filter: z
      .object({
        conjunction: z
          .enum(['and', 'or'])
          .optional()
          .describe('条件关系，默认 and'),
        conditions: z
          .array(
            z.object({
              field_name: z
                .string()
                .describe('字段名（必填），使用 field_name 作为键名'),
              operator: z
                .enum([
                  'is',
                  'isNot',
                  'contains',
                  'doesNotContain',
                  'isEmpty',
                  'isNotEmpty',
                  'isGreater',
                  'isLess',
                ])
                .describe(
                  '操作符。日期字段仅支持: is, isNot, isGreater, isLess, isEmpty, isNotEmpty',
                ),
              value: z
                .array(z.string())
                .optional()
                .describe(
                  '比较值数组。日期字段用 ["YYYY-MM-DD"]，普通字段用 ["值"]。isEmpty/isNotEmpty 无需填写',
                ),
            }),
          )
          .describe('条件数组'),
      })
      .optional()
      .describe('筛选条件对象'),
    sort: z
      .array(z.string())
      .optional()
      .describe('排序规则数组，如 ["字段名 DESC"]'),
  });

  private dateFieldNames: Set<string> = new Set();
  private tableFieldsCache: Map<string, Array<{ name: string; type: string }>> =
    new Map();

  constructor(private readonly service: FeishuBitableSourceService) {
    super();
  }

  async _call(input: {
    tableId: string;
    pageSize?: number;
    filter?: {
      conjunction?: 'and' | 'or';
      conditions?: Array<{
        field_name: string;
        operator: string;
        value?: string[];
      }>;
    };
    sort?: string[];
  }): Promise<string> {
    try {
      // 获取字段元数据以识别日期字段
      let fields = this.tableFieldsCache.get(input.tableId);
      if (!fields) {
        fields = await this.service.listFields(input.tableId);
        this.tableFieldsCache.set(input.tableId, fields);
      }

      // 识别日期字段
      const dateFieldNames = new Set(
        fields.filter((f) => f.type === 'date').map((f) => f.name),
      );

      // 日期字段允许的操作符
      const dateOperators = new Set([
        'is',
        'isNot',
        'isGreater',
        'isLess',
        'isEmpty',
        'isNotEmpty',
      ]);

      // 验证并转换日期字段条件
      const validatedConditions = input.filter?.conditions?.map((condition) => {
        const fieldName = condition.field_name;
        const isDateField = dateFieldNames.has(fieldName);

        if (isDateField) {
          // 验证日期字段操作符
          if (!dateOperators.has(condition.operator)) {
            throw new Error(
              `日期字段 "${fieldName}" 不支持操作符 "${condition.operator}"。仅支持: ${[...dateOperators].join(', ')}`,
            );
          }

          // 处理日期值
          if (
            condition.value &&
            condition.value.length > 0 &&
            condition.operator !== 'isEmpty' &&
            condition.operator !== 'isNotEmpty'
          ) {
            // 检查是否已经是 ExactDate 格式
            if (condition.value[0] === 'ExactDate') {
              return condition;
            }

            // 尝试转换 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss 格式
            const dateStr = condition.value[0];
            let timestamp: number;

            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              // YYYY-MM-DD 格式，转换为当天 00:00:00 的时间戳
              timestamp = Date.parse(`${dateStr}T00:00:00+08:00`);
            } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
              // YYYY-MM-DD HH:mm:ss 格式
              timestamp = Date.parse(dateStr.replace(' ', 'T') + '+08:00');
            } else if (/^\d+$/.test(dateStr)) {
              // 已经是时间戳
              timestamp = parseInt(dateStr, 10);
            } else {
              throw new Error(
                `日期字段 "${fieldName}" 的值格式不正确: "${dateStr}"。` +
                  `请使用 ["ExactDate", "毫秒时间戳"] 或 ["YYYY-MM-DD"] 格式。`,
              );
            }

            if (Number.isNaN(timestamp)) {
              throw new Error(
                `日期字段 "${fieldName}" 的值无法解析: "${dateStr}"`,
              );
            }

            return {
              ...condition,
              value: ['ExactDate', String(timestamp)],
            };
          }
        }

        return condition;
      });

      const processedFilter = input.filter
        ? {
            ...input.filter,
            conditions: validatedConditions,
          }
        : undefined;

      const result = await this.service.listRecords(input.tableId, {
        pageSize: input.pageSize,
        filter: processedFilter,
        sort: input.sort,
      });

      return JSON.stringify(
        {
          success: true,
          total: result.total,
          hasMore: result.hasMore,
          records: result.records,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * @title 飞书多维表格获取记录工具 Feishu Bitable Get Record Tool
 */
class FeishuBitableGetRecordTool extends StructuredTool {
  name = 'feishu_bitable_get_record';
  description = `获取飞书多维表格中的单条记录详情。
Get a single record from a Feishu Bitable table.`;

  schema = z.object({
    tableId: z.string().describe('数据表 ID'),
    recordId: z.string().describe('记录 ID'),
  });

  constructor(private readonly service: FeishuBitableSourceService) {
    super();
  }

  async _call(input: { tableId: string; recordId: string }): Promise<string> {
    try {
      const record = await this.service.getRecord(
        input.tableId,
        input.recordId,
      );

      if (!record) {
        return JSON.stringify({
          success: false,
          error: 'Record not found',
        });
      }

      return JSON.stringify(
        {
          success: true,
          record,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * @title 飞书多维表格列出数据表工具 Feishu Bitable List Tables Tool
 */
class FeishuBitableListTablesTool extends StructuredTool {
  name = 'feishu_bitable_list_tables';
  description = `列出飞书多维表格中的所有数据表。
List all tables in a Feishu Bitable.`;

  schema = z.object({});

  constructor(private readonly service: FeishuBitableSourceService) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const tables = await this.service.listTables();

      return JSON.stringify(
        {
          success: true,
          tables,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * @title 飞书多维表格列出字段工具 Feishu Bitable List Fields Tool
 */
class FeishuBitableListFieldsTool extends StructuredTool {
  name = 'feishu_bitable_list_fields';
  description = `列出飞书多维表格数据表中的所有字段。
List all fields in a Feishu Bitable table.`;

  schema = z.object({
    tableId: z.string().describe('数据表 ID'),
  });

  constructor(private readonly service: FeishuBitableSourceService) {
    super();
  }

  async _call(input: { tableId: string }): Promise<string> {
    try {
      const fields = await this.service.listFields(input.tableId);

      return JSON.stringify(
        {
          success: true,
          fields,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * @title 飞书多维表格工具服务 Feishu Bitable Source Tools Service
 * @description 提供飞书多维表格相关的 AI 工具。
 * @keywords-cn 飞书, 多维表格, AI工具
 * @keywords-en feishu, bitable, AI tools
 */
@Injectable()
export class FeishuBitableSourceToolsService {
  constructor(private readonly feishuService: FeishuBitableSourceService) {}

  /**
   * @title 获取所有工具 Get All Tools
   * @description 返回所有飞书多维表格相关的工具。
   */
  getTools(): StructuredTool[] {
    return [
      new FeishuBitableListTablesTool(this.feishuService),
      new FeishuBitableListFieldsTool(this.feishuService),
      new FeishuBitableListRecordsTool(this.feishuService),
      new FeishuBitableGetRecordTool(this.feishuService),
    ];
  }
}
