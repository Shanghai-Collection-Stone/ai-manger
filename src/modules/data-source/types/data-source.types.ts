/**
 * @title 数据源类型定义 Data Source Types
 * @description 数据源相关的类型定义。
 */

/**
 * @title 字段元数据 Field Meta
 * @description 描述集合中单个字段的元数据。
 */
export interface FieldMeta {
  name: string;
  type: string;
  nameCn?: string;
  description?: string;
  required?: boolean;
}

/**
 * @title 表元数据 Table Meta
 * @description 描述集合的元数据，包含字段列表。
 */
export interface TableMeta {
  name: string;
  nameCn?: string;
  description?: string;
  keywords?: string[];
  fields: FieldMeta[];
}

/**
 * @title MongoDB Schema 缓存 Mongo Schema Cache
 * @description 缓存的 Schema 结构。
 */
export interface MongoSchemaCache {
  tables: TableMeta[];
  version?: string;
  updatedAt?: Date;
}
