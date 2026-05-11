import { ObjectId } from 'mongodb';

/**
 * @description 现金流方向(给 agent 拼默认值用)
 * @keyword-en finance flow direction
 */
export type FinanceFlow = 'in' | 'out';

/**
 * @description 对方主体分类(对齐外部 API 的 partyType)
 * @keyword-en finance party type
 */
export type FinancePartyType =
  | 'supplier'
  | 'customer'
  | 'employee'
  | 'counterparty';

/**
 * @description 多维表源项(归属 storeId/companyId 不在源级别绑定,由 DSL 用 lookup 从行字段映射;`alias` 即表定义 — 用户在飞书表上起的名字本身已携带语义,如"云境上海银行流水",Agent 据此理解每张表的归属/业务)
 * @keyword-en bitable source item, alias is the table definition for agent
 */
export interface FinanceBitableSourceItem {
  type: 'bitable';
  appToken: string;
  tableId: string;
  /** 表定义 — 用户给这张表起的语义化名字,Agent 据此理解表的归属/业务/银行等 */
  alias?: string;
}

/**
 * @description 审批源项(`alias` 同为表定义)
 * @keyword-en approval source item, alias is the table definition for agent
 */
export interface FinanceApprovalSourceItem {
  type: 'approval';
  approvalCode: string;
  alias?: string;
}

/**
 * @description 源项联合
 * @keyword-en finance source item union
 */
export type FinanceSourceItem =
  | FinanceBitableSourceItem
  | FinanceApprovalSourceItem;

/**
 * @description 财务源绑定(每作用域 × 每 name 唯一;name 由用户自定义,如"报销-飞书审批"、"应付-月结"、"银行流水-招行")
 * @keyword-en finance binding entity, named scope, sources, flow defaults
 */
export interface FinanceBindingEntity {
  _id: ObjectId;
  tenantId: string;
  /** 用户自定义业务名,作用域内唯一 */
  name: string;
  /** 现金流默认方向(in/out;给 agent 拼 DSL 默认值参考,推送时不会强校验) */
  flowDefault?: FinanceFlow;
  /** 对方主体默认类型 */
  partyTypeDefault?: FinancePartyType;
  sources: FinanceSourceItem[];
  remark?: string;
  createdAt: Date;
  updatedAt: Date;
}
