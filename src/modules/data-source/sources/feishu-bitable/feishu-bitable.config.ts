/**
 * @title 飞书多维表格配置 Feishu Bitable Config
 * @description 飞书多维表格数据源的配置接口定义。
 * @keywords-cn 飞书, 多维表格, 配置
 * @keywords-en feishu, bitable, config
 */

/**
 * 飞书多维表格表配置
 */
export interface FeishuBitableTableConfig {
  tableId: string;
  tableName: string;
  nameCn?: string;
  description?: string;
  keywords?: string[];
}

export interface FeishuBitableAppConfig {
  appId?: string;
  appSecret?: string;
  appToken: string;
  sourceCode?: string;
  tables: FeishuBitableTableConfig[];
}

export type FeishuBitableConfig = FeishuBitableAppConfig[];

/**
 * 飞书字段类型映射到通用类型
 */
export const FEISHU_FIELD_TYPE_MAP: Record<number, string> = {
  1: 'string', // 多行文本
  2: 'number', // 数字
  3: 'string', // 单选
  4: 'array', // 多选
  5: 'date', // 日期
  7: 'boolean', // 复选框
  11: 'array', // 人员
  13: 'string', // 电话号码
  15: 'string', // 超链接
  17: 'object', // 附件
  18: 'string', // 单向关联
  19: 'string', // 查找引用
  20: 'string', // 公式
  21: 'string', // 双向关联
  22: 'string', // 地理位置
  23: 'string', // 群组
  1001: 'date', // 创建时间
  1002: 'date', // 最后更新时间
  1003: 'object', // 创建人
  1004: 'object', // 修改人
  1005: 'string', // 自动编号
};
