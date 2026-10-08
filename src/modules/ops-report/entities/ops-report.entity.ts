import type { ObjectId } from 'mongodb';

/**
 * @description 运维上报处理状态
 * @keyword-cn 上报状态
 * @keyword-en ops-report-status
 */
export type OpsReportStatus = 'open' | 'processing' | 'resolved';

/**
 * @description 运维日志来源类型
 * @keyword-cn 日志来源
 * @keyword-en ops-log-kind
 */
export type OpsLogKind = 'api' | 'page' | 'main' | 'crash';

/**
 * @description 运维日志级别
 * @keyword-cn 日志级别
 * @keyword-en ops-log-level
 */
export type OpsLogLevel = 'error' | 'warn';

/**
 * @description 桌面客户端环境信息
 * @keyword-cn 客户端环境
 * @keyword-en ops-client-info
 */
export interface OpsReportClient {
  appVersion: string;
  shellVersion?: string;
  workbenchVersion?: string;
  platform: string;
  arch?: string;
  osVersion?: string;
  page?: string;
  boardId?: string;
}

/**
 * @description 桌面客户端采集的单条错误或警告日志
 * @keyword-cn 上报日志条目
 * @keyword-en ops-log-entry
 */
export interface OpsLogEntry {
  ts: string;
  kind: OpsLogKind;
  level: OpsLogLevel;
  message: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  source?: string;
  stack?: string;
  page?: string;
}

/**
 * @description 运维上报数据库文档，存储于 ops_reports 集合
 * @keyword-cn 运维上报实体
 * @keyword-en ops-report-entity
 */
export interface OpsReportEntity {
  _id: ObjectId;
  tenantId?: string;
  tenantName?: string;
  userId: string;
  username: string;
  displayName: string;
  phone?: string;
  description: string;
  contact?: string;
  client: OpsReportClient;
  entries: OpsLogEntry[];
  status: OpsReportStatus;
  handlerNote?: string;
  handledBy?: string;
  handledByName?: string;
  handledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 运维上报列表视图，不包含日志明细
 * @keyword-cn 上报摘要视图
 * @keyword-en ops-report-summary
 */
export interface OpsReportSummary {
  id: string;
  tenantId?: string;
  tenantName?: string;
  userId: string;
  username: string;
  displayName: string;
  description: string;
  contact?: string;
  client: OpsReportClient;
  status: OpsReportStatus;
  handlerNote?: string;
  handledByName?: string;
  handledAt?: Date;
  entryCount: number;
  createdAt: Date;
}

/**
 * @description 运维上报详情视图，包含完整日志条目
 * @keyword-cn 上报详情视图
 * @keyword-en ops-report-detail
 */
export interface OpsReportDetail extends OpsReportSummary {
  entries: OpsLogEntry[];
}
