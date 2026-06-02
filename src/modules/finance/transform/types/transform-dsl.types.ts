/**
 * @description Transform DSL 顶层结构
 * @keyword-en transform-dsl-root, dsl-schema
 */
export interface TransformDsl {
  version: number;
  /** 行级过滤(命中所有条件才保留) */
  filter?: TransformFilterCondition[];
  /** 输出字段定义(按顺序执行) */
  fields: TransformFieldRule[];
}

/**
 * @description 字段规则 = 直接映射 | 计算
 * @keyword-en transform-field-rule, dsl-field
 */
export type TransformFieldRule = TransformMapRule | TransformComputeRule;

/**
 * @description 直接映射:from → to + 类型转换
 * @keyword-en transform-map-rule, field-map
 */
export interface TransformMapRule {
  to: string;
  from: string;
  type?: TransformValueType;
  /** 日期格式(type=date 生效,支持 YYYY-MM-DD / YYYY-MM,留空用 ISO) */
  format?: string;
  /** 缺失值兜底 */
  default?: unknown;
  /** 同名 to 字段的合并策略;留空时使用智能叠加 */
  merge?: TransformMergeMode;
}

/**
 * @description 计算规则:concat / sum / if / coalesce / const / lookup
 * @keyword-en transform-compute-rule, compute-rule
 */
export interface TransformComputeRule {
  to: string;
  compute: TransformComputeOp;
  /** concat / sum / coalesce 使用 */
  fields?: string[];
  /** concat 分隔符 */
  sep?: string;
  /** if 使用 */
  when?: TransformFilterCondition;
  then?: unknown;
  else?: unknown;
  /** const 直接产出的常量值 */
  value?: unknown;
  /** lookup / regex 时读取的源字段名 */
  from?: string;
  /** lookup 映射表 { 源值: 目标值 } */
  map?: Record<string, unknown>;
  /** regex 模式串(JS RegExp 语法) */
  pattern?: string;
  /** regex 标志位,如 "i" / "im" */
  flags?: string;
  /** regex 捕获组下标:0 整段、1+ 捕获组,默认 0 */
  index?: number;
  /** 类型 */
  type?: TransformValueType;
  /** 日期格式(type=date 生效,支持 YYYY-MM-DD / YYYY-MM,留空用 ISO) */
  format?: string;
  default?: unknown;
  /** 同名 to 字段的合并策略;留空时使用智能叠加 */
  merge?: TransformMergeMode;
}

/**
 * @description 过滤条件
 * @keyword-en transform-filter-condition, filter-condition
 */
export interface TransformFilterCondition {
  field?: string;
  op: TransformFilterOp;
  /** in/notIn 用 array;其他单值 */
  value?: unknown;
  /** or/and 分组条件 */
  conditions?: TransformFilterCondition[];
}

/**
 * @description 过滤操作符
 * @keyword-en transform-filter-operator, filter-op
 */
export type TransformFilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'between'
  | 'regex'
  | 'notRegex'
  | 'or'
  | 'and';

/**
 * @description 计算操作符
 * @keyword-en transform-compute-operator, compute-op
 */
export type TransformComputeOp =
  | 'concat'
  | 'sum'
  | 'if'
  | 'coalesce'
  | 'const'
  | 'lookup'
  | 'regex';

/**
 * @description 值类型转换
 * @keyword-en transform-value-type, value-cast
 */
export type TransformValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array';

/**
 * @description 同名输出字段合并策略
 * @keyword-en transform-merge-mode, duplicate-field
 */
export type TransformMergeMode =
  | 'auto'
  | 'replace'
  | 'append'
  | 'array'
  | 'concat'
  | 'sum'
  | 'object';

/**
 * @description 引擎执行结果
 * @keyword-en transform-engine-result, run-result
 */
export interface TransformResult<T = Record<string, unknown>> {
  rows: T[];
  errors: TransformError[];
  sourceCount: number;
  filteredCount: number;
}

/**
 * @description 单行异常
 * @keyword-en transform-row-error, row-error
 */
export interface TransformError {
  rowIndex: number;
  rowId?: string;
  message: string;
  field?: string;
}
