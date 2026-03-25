/**
 * @description Mongo JSON Filter 查询请求类型定义
 * @keyword-en mongo query types
 */

export type MongoWhereOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'between'
  | 'exists'
  | 'regex'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

export type MongoWhereCondition = {
  field: string;
  op?: MongoWhereOp;
  value?: unknown;
  values?: unknown[];
  min?: unknown;
  max?: unknown;
  options?: string;
};

export type MongoWhereGroup = {
  and?: MongoWhereNode[];
  or?: MongoWhereNode[];
  not?: MongoWhereNode;
};

export type MongoWhereNode = MongoWhereCondition | MongoWhereGroup;

export type MongoQueryJoin = {
  from: string;
  as: string;
  localField: string;
  foreignField: string;
  localFieldIsArray?: boolean;
  unwind?: boolean | { preserveNullAndEmptyArrays?: boolean };
  where?: MongoWhereNode;
  filter?: Record<string, unknown>;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  tenantField?: string;
};

export type MongoQueryRequest = {
  collection: string;
  mode: 'list' | 'count' | 'aggregate';
  sourceType?: 'mongo' | 'feishu-bitable';
  sourceCode?: string;
  filter?: Record<string, unknown>;
  where?: MongoWhereNode;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  pipeline?: Record<string, unknown>[] | string;
  feishuFilter?: {
    conjunction?: 'and' | 'or';
    conditions?: Array<{
      field?: string;
      fieldName?: string;
      field_name?: string;
      operator: string;
      value?: string | string[];
    }>;
  };
  feishuSort?: string[];
  joins?: MongoQueryJoin[];
  tenantField?: string;
};

export type MongoQueryResponse =
  | { rows: Record<string, unknown>[] }
  | { count: number };
