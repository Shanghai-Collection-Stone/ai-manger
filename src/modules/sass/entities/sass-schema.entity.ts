import { ObjectId } from 'mongodb';

/**
 * @description SaaS表结构实体，存储表名、表描述与字段描述
 * @keyword-en sass schema entity
 */
export interface SassSchemaEntity {
  _id: ObjectId;
  table: string;
  tableDesc: string;
  tableField: Record<string, string>;
  dedupeField?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 创建SaaS表结构输入
 * @keyword-en sass schema create input
 */
export interface SassSchemaCreateInput {
  table: string;
  tableDesc: string;
  tableField: Record<string, string>;
  dedupeField?: string;
}

/**
 * @description 更新SaaS表结构输入
 * @keyword-en sass schema update input
 */
export interface SassSchemaUpdateInput {
  id: string;
  table?: string;
  tableDesc?: string;
  tableField?: Record<string, string>;
  dedupeField?: string;
}
