import type { ObjectId } from 'mongodb';

/**
 * @description 租户看板配置映射实体（租户 -> 配置文件路径，可选 AI 覆盖配置）
 * @keyword-en tenant dashboard config mapping entity
 */
export interface DashboardConfigMappingEntity {
  _id: ObjectId;
  dashboardCode: string;
  tenantId?: string | null;
  filePath: string;
  /** AI 工具修改后的覆盖配置，优先级高于 filePath 指向的文件 */
  customConfig?: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
