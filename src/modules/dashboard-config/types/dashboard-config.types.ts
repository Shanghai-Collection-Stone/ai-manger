/**
 * @description Dashboard Block 组件类型定义
 * @keyword-en dashboard block types
 */

/**
 * 基础类型
 */
export type DashboardCode = string; // e.g., 'ai-commander'
export type BlockType = 
  | 'ai_progress'
  | 'revenue_overview_card'
  | 'revenue_total_card'
  | 'stat_card'
  | 'conversion_rate_card'
  | 'people_total_card'
  | 'people_pie_card'
  | 'demand_channel_pie_card'
  | 'demand_type_pie_card'
  | 'daily_revenue_people_chart'
  | 'daily_demand_trend_chart'
  | 'staff_distribution_card'
  | 'activity_type_conversion_card'
  | 'theme_ratio_card'
  | 'room_ratio_card'
  | 'theme_revenue_people_chart'
  | 'room_revenue_people_chart'
  | 'sales_ranking_card'
  | 'sales_ranking_inline'
  | 'customer_tag_cloud_card'
  | 'sales_rate_grid_card';

export type QueryKey = 
  | 'revenueOverview'
  | 'dailyRevenue'
  | 'peopleStats'
  | 'demandChannel'
  | 'events'
  | 'sales';

/**
 * 布局配置
 */
export interface GridLayout {
  cols?: number; // 1-6, default 2
  gap?: number; // 0-48, default 16
}

export interface BlockLayout {
  colSpan?: number; // default 1
  rowSpan?: number; // default 1
}

/**
 * Block 定义
 */
export interface DashboardBlock {
  id: string;
  type: BlockType;
  query?: QueryKey;
  layout?: BlockLayout;
  props?: Record<string, unknown>;
}

/**
 * Tab 定义
 */
export interface DashboardTab {
  id: string;
  label: string;
  keywordEn?: string;
  layout?: GridLayout;
  blocks?: DashboardBlock[];
}

/**
 * Dashboard 配置完整结构
 */
export interface DashboardConfig {
  dashboardCode: DashboardCode;
  version: number;
  title: string;
  description?: string;
  timeRanges?: string[];
  tabs: DashboardTab[];
}

/**
 * 看板配置映射（用于多租户）
 */
export interface DashboardConfigMapping {
  _id?: string;
  dashboardCode: DashboardCode;
  tenantId?: string | null;
  filePath: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * 获取配置的响应
 */
export interface GetDashboardConfigResponse {
  dashboardCode: DashboardCode;
  tenantId?: string;
  filePath: string;
  config: DashboardConfig;
}
