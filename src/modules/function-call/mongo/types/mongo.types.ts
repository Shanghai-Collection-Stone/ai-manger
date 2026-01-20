/**
 * @title Function Call 描述 Function Call Description
 * @description 定义函数调用的元信息与参数描述。
 * @keywords-cn 函数调用, 描述, 参数
 * @keywords-en function call, description, params
 */
export interface FunctionParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
}

export interface FunctionCallDescription<I, O> {
  name: string;
  title: string;
  description: string;
  keywordsCn: string[];
  keywordsEn: string[];
  params: FunctionParam[];
  handle: (input: I) => Promise<O>;
}

/**
 * @title Mongo 查询请求 Mongo Query Request
 * @description 结构化的MongoDB查询参数。
 * @keywords-cn Mongo, 查询
 * @keywords-en Mongo, query
 */
export interface MongoQueryRequest {
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, 0 | 1>;
  limit?: number;
  sort?: Record<string, 1 | -1>;
}

/**
 * @title 字段元数据 Field Meta
 * @description 字段描述与中文映射。
 * @keywords-cn 字段, 元数据
 * @keywords-en field, meta
 */
export interface FieldMeta {
  name: string;
  type: string;
  description?: string;
  nameCn?: string;
}

/**
 * @title 表元数据 Table Meta
 * @description 表的中文映射与关键词。
 * @keywords-cn 表, 元数据
 * @keywords-en table, meta
 */
export interface TableMeta {
  name: string;
  nameCn?: string;
  keywords?: string[];
  fields: FieldMeta[];
}

/**
 * @title 缓存结构 Schema Cache
 * @description 所有集合的元数据缓存。
 * @keywords-cn 缓存, 元数据
 * @keywords-en cache, metadata
 */
export interface MongoSchemaCache {
  tables: TableMeta[];
}
