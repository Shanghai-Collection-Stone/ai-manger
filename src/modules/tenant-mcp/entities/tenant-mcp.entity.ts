import type { ObjectId } from 'mongodb';

/** @keyword-en mcp-endpoint, tenant-isolation */
export interface TenantMcpEndpoint {
  _id: ObjectId;
  tenantId: string;
  name: string;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** @keyword-en mcp-key, tool-permission */
export interface TenantMcpKey {
  _id: ObjectId;
  tenantId: string;
  endpointId: string;
  name: string;
  secretHash: string;
  prefix: string;
  permissions: string[];
  enabled: boolean;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

/** @keyword-en mcp-auth, tenant-isolation */
export interface TenantMcpPrincipal {
  tenantId: string;
  endpointId: string;
  keyId: string;
  permissions: string[];
  userId: string;
  username: string;
}
