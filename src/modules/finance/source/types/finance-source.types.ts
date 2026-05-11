/**
 * @description 财务源原始行（统一供 transform 使用）
 * @keyword-en finance raw source row
 */
export interface FinanceRawRow {
  /** 全局 ID（多维表 record_id 或审批 instance_code） */
  id: string;
  sourceType: FinanceSourceType;
  /** 原始字段键值（多维表 fields / 审批 form 字段） */
  fields: Record<string, unknown>;
  /** 记录创建时间（毫秒） */
  createdAt?: number;
  /** 记录最近更新时间（毫秒） */
  updatedAt?: number;
}

/**
 * @description 源类型
 * @keyword-en finance source type enum
 */
export type FinanceSourceType = 'bitable' | 'approval';

/**
 * @description 字段元数据
 * @keyword-en finance column meta
 */
export interface FinanceColumnMeta {
  name: string;
  type: string;
}

/**
 * @description 拉取结果（含分页）
 * @keyword-en finance fetch result
 */
export interface FinanceFetchResult {
  rows: FinanceRawRow[];
  columns: FinanceColumnMeta[];
  hasMore: boolean;
  pageToken?: string;
}

/**
 * @description 多维表拉取参数
 * @keyword-en bitable fetch params
 */
export interface BitableFetchParams {
  tenantId: string;
  appToken: string;
  tableId: string;
  pageSize?: number;
  pageToken?: string;
}

/**
 * @description 审批拉取参数
 * @keyword-en approval fetch params
 */
export interface ApprovalFetchParams {
  tenantId: string;
  approvalCode: string;
  pageSize?: number;
  pageToken?: string;
  /** 默认仅拉 APPROVED；可显式覆盖 */
  statuses?: ApprovalInstanceStatus[];
  /** 起始时间（毫秒） */
  startTime?: number;
  /** 结束时间（毫秒） */
  endTime?: number;
}

/**
 * @description 审批实例状态
 * @keyword-en approval instance status
 */
export type ApprovalInstanceStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'DELETED';
