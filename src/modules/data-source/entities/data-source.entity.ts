import { ObjectId } from 'mongodb';

/**
 * @title 数据源状态枚举 Data Source Status Enum
 * @description 数据源的激活状态。
 * @keywords-cn 数据源状态, 枚举
 * @keywords-en data source status, enum
 */
export type DataSourceStatus = 'active' | 'inactive';

/**
 * @title 数据源可见范围 Data Source Scope
 * @description 标识数据源属于平台还是租户私有。
 * @keyword-en data source scope
 */
export type DataSourceScope = 'platform' | 'tenant';

/**
 * @title Mongo 连接模式 Mongo Connection Mode
 * @description 标识Mongo数据源的连接方式。
 * @keyword-en mongo connection mode
 */
export type MongoConnectionMode = 'main' | 'local' | 'external';

/**
 * @title Mongo 连接配置 Mongo Connection Config
 * @description Mongo数据源连接参数，支持主库、本地库前缀、外部库。
 * @keyword-en mongo connection config
 */
export interface MongoConnectionConfig {
  mode: MongoConnectionMode;
  uri?: string;
  dbName?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  authSource?: string;
  params?: Record<string, string>;
  localCollectionPrefix?: string;
  collectionMap?: Record<string, string>;
}

/**
 * @title 数据源实体 Data Source Entity
 * @description 表示一个数据源的元信息，用于动态路由到对应的 source 模块。
 * @keywords-cn 数据源, 实体, 向量搜索
 * @keywords-en data source, entity, vector search
 */
export interface DataSourceEntity {
  _id: ObjectId;
  /**
   * 唯一标识，与 source 模块对应，如 'mongo', 'feishu-doc'
   */
  code: string;
  /**
   * 显示名称
   */
  name: string;
  /**
   * 数据源描述（用于向量搜索匹配）
   */
  description: string;
  /**
   * 向量字段（768维，Google Embeddings gemini-embedding-001）
   */
  embedding: number[];
  /**
   * 对应的 source 模块路径，如 'sources/mongo'
   */
  moduleRef: string;
  sourceType?: 'mongo' | 'api';
  scope?: DataSourceScope;
  tenantId?: string;
  connection?: MongoConnectionConfig;
  /**
   * 数据源状态
   */
  status: DataSourceStatus;
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
 * @title 数据源创建输入 Data Source Create Input
 * @description 创建数据源时的输入参数。
 */
export interface DataSourceCreateInput {
  code: string;
  name: string;
  description: string;
  moduleRef: string;
  sourceType?: 'mongo' | 'api';
  scope?: DataSourceScope;
  tenantId?: string;
  connection?: MongoConnectionConfig;
  status?: DataSourceStatus;
}

/**
 * @title 向量搜索结果 Vector Search Result
 * @description 向量相似度搜索的结果。
 */
export interface DataSourceSearchResult {
  source: DataSourceEntity;
  score: number;
}
