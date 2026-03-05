import { ObjectId } from 'mongodb';

/**
 * @description SaaS数据操作日志实体，记录data接口操作轨迹
 * @keyword-en sass database log entity
 */
export interface SassDatabaseLogEntity {
  _id: ObjectId;
  schemaId: string;
  tenantId: string;
  keyId?: string;
  operation:
    | 'insert'
    | 'patch'
    | 'list'
    | 'find_one'
    | 'update_one'
    | 'delete_one';
  collectionName: string;
  dataIds?: string[];
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: Date;
}
