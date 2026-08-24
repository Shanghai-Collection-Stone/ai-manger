import { ObjectId } from 'mongodb';

/**
 * @description SuperClaw 当前连接状态
 * @keyword-cn 连接状态, 节点在线
 * @keyword-en connection-status, node-online
 */
export type SuperClawConnectionStatus = 'pending' | 'online' | 'offline';

/**
 * @description 平台专属 SuperClaw 节点实体，Token 仅保存 SHA-256 哈希
 * @keyword-cn 节点实体, 令牌哈希
 * @keyword-en node-entity, token-hash
 */
export interface SuperClawEntity {
  _id: ObjectId;
  name: string;
  description?: string;
  tokenHash: string;
  tokenPrefix: string;
  capacity: number;
  allocatedCapacity: number;
  status: SuperClawConnectionStatus;
  instanceId?: string;
  endpoint?: string;
  version?: string;
  reportedUsedCapacity?: number;
  lastRegisteredAt?: Date;
  lastHeartbeatAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 后台可见的 SuperClaw 节点视图，不暴露 Token 哈希
 * @keyword-cn 节点视图, 剩余容量
 * @keyword-en node-view, remaining-capacity
 */
export interface SuperClawView extends Omit<
  SuperClawEntity,
  'tokenHash' | 'status'
> {
  status: SuperClawConnectionStatus;
  remainingCapacity: number;
}

/**
 * @description SuperClaw gRPC 注册请求
 * @keyword-cn 注册请求, 实例信息
 * @keyword-en register-request, instance-info
 */
export interface SuperClawRegisterRequest {
  instanceId?: string;
  endpoint?: string;
  version?: string;
}

/**
 * @description SuperClaw gRPC 注册响应
 * @keyword-cn 注册响应, 心跳间隔
 * @keyword-en register-response, heartbeat-interval
 */
export interface SuperClawRegisterResponse {
  superClawId: string;
  registered: boolean;
  capacity: number;
  allocatedCapacity: number;
  heartbeatIntervalSeconds: number;
  serverTime: string;
}

/**
 * @description SuperClaw gRPC 心跳请求
 * @keyword-cn 心跳请求, 上报容量
 * @keyword-en heartbeat-request, reported-capacity
 */
export interface SuperClawHeartbeatRequest {
  instanceId?: string;
  usedCapacity?: number;
}

/**
 * @description SuperClaw gRPC 心跳响应
 * @keyword-cn 心跳响应, 连接续期
 * @keyword-en heartbeat-response, connection-renewal
 */
export interface SuperClawHeartbeatResponse {
  accepted: boolean;
  capacity: number;
  allocatedCapacity: number;
  serverTime: string;
}
