import { ObjectId } from 'mongodb';
import { FieldMeta } from '../types/data-source.types.js';

/**
 * @title 数据源 Schema 实体 Data Source Schema Entity
 * @description 存储数据源的表定义和向量嵌入，用于 AI 搜索。
 * @keywords-cn 数据源Schema, 向量搜索, 关键词
 * @keywords-en data source schema, vector search, keywords
 */
export interface DataSourceSchemaEntity {
  _id: ObjectId;
  /**
   * 数据源代码，如 'main-mongo'
   */
  sourceCode: string;
  /**
   * 集合/表名
   */
  collectionName: string;
  /**
   * 中文名称
   */
  nameCn?: string;
  /**
   * 中英文关键词列表（用于文本搜索，优先级高）
   * 迁移时可为空，通过 API 触发生成
   */
  keywords?: string[];
  /**
   * 字段定义列表
   */
  fields: FieldMeta[];
  /**
   * 768维向量嵌入（用于语义搜索保底）
   * 迁移时可为空，通过 API 触发生成
   */
  embedding?: number[];
  /**
   * Schema 版本号
   */
  version: number;
  /**
   * 创建时间
   */
  createdAt: Date;
  /**
   * 更新时间
   */
  updatedAt: Date;
}

/**
 * @title Schema 创建输入 Schema Create Input
 * @description 创建 Schema 时的输入参数。
 */
export interface DataSourceSchemaCreateInput {
  sourceCode: string;
  collectionName: string;
  nameCn?: string;
  keywords?: string[];
  fields: FieldMeta[];
}

/**
 * @title Schema 搜索结果 Schema Search Result
 * @description Schema 搜索的结果。
 */
export interface DataSourceSchemaSearchResult {
  schema: DataSourceSchemaEntity;
  score: number;
  matchType: 'keyword' | 'vector';
}
