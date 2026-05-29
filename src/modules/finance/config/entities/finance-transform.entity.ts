import { ObjectId } from 'mongodb';
import type { TransformDsl } from '../../transform/types/transform-dsl.types.js';

/**
 * @description 财务 Transform DSL 持久化(每作用域 × 每 binding name 唯一)
 * @keyword-en finance transform entity, dsl persistence by name
 */
export interface FinanceTransformEntity {
  _id: ObjectId;
  tenantId: string;
  /** 与 binding 同名,一一对应 */
  name: string;
  dsl: TransformDsl | null;
  /** 由 agent 生成的解读说明 */
  explanation?: string;
  createdAt: Date;
  updatedAt: Date;
}
