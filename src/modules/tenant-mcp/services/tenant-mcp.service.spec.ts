import { ConfigService } from '@nestjs/config';
import { ObjectId, type Db } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { TenantMcpService } from './tenant-mcp.service.js';

/** @keyword-en mcp-test-fixture, key-management */
function fixture() {
  const tenantId = new ObjectId().toHexString();
  const endpointId = new ObjectId().toHexString();
  const owner = {
    _id: new ObjectId(),
    username: 'owner',
    tenantId,
    enabled: true,
    role: 'tenant_admin',
  } as AdminUserEntity;
  const endpoints = {
    findOne: jest
      .fn()
      .mockResolvedValue({
        _id: new ObjectId(endpointId),
        tenantId,
        enabled: true,
      }),
    insertOne: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const keys = {
    insertOne: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest
      .fn()
      .mockResolvedValue({ _id: new ObjectId(), permissions: [] }),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const users = { findOne: jest.fn().mockResolvedValue(owner) };
  const db = {
    collection: (name: string) =>
      name === 'tenant_mcp_endpoints'
        ? endpoints
        : name === 'tenant_mcp_keys'
          ? keys
          : users,
  } as unknown as Db;
  const service = new TenantMcpService(
    db,
    new ConfigService({ APP_URL: 'https://example.test' }),
  );
  return { service, tenantId, endpointId, owner, endpoints, keys, users };
}

describe('租户 MCP 密钥和隔离', () => {
  it('租户管理员不能跨租户，操作员不能管理，平台管理员必须选择租户', () => {
    const { service, owner, tenantId } = fixture();
    expect(service.scope(owner)).toBe(tenantId);
    expect(() => service.scope(owner, new ObjectId().toHexString())).toThrow(
      'MCP_TENANT_MISMATCH',
    );
    expect(() => service.scope({ ...owner, role: 'operator' })).toThrow(
      'MCP_ADMIN_REQUIRED',
    );
    expect(() =>
      service.scope({ ...owner, role: 'super_admin', tenantId: undefined }),
    ).toThrow('MCP_TENANT_REQUIRED');
  });

  it('生成 256 位随机密钥，数据库与公开视图均不保存明文', async () => {
    const { service, tenantId, endpointId, owner, keys } = fixture();
    const result = await service.createKey(tenantId, endpointId, owner, {
      name: 'writer',
      permissions: ['article_publish', 'article_publish'],
    });
    expect(result.secret).toMatch(/^tmcp_[A-Za-z0-9_-]{43}$/);
    const document = keys.insertOne.mock.calls[0][0];
    expect(document.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(document)).not.toContain(result.secret);
    expect(result.key).not.toHaveProperty('secretHash');
    expect(result.key.permissions).toEqual(['article_publish']);
  });

  it('拒绝不存在的工具权限和过去的有效期', async () => {
    const { service, tenantId, endpointId, owner, keys } = fixture();
    await expect(
      service.createKey(tenantId, endpointId, owner, {
        name: 'bad',
        permissions: ['__proto__'],
      }),
    ).rejects.toThrow('INVALID_MCP_PERMISSIONS');
    await expect(
      service.createKey(tenantId, endpointId, owner, {
        name: 'bad',
        permissions: [],
        expiresAt: '2020-01-01',
      }),
    ).rejects.toThrow('MCP_EXPIRY_MUST_BE_FUTURE');
    expect(keys.insertOne).not.toHaveBeenCalled();
  });

  it('认证将哈希、链接、启用状态和有效期共同限定，并读取当前密钥权限', async () => {
    const f = fixture();
    const created = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'reader', permissions: ['library_list'] },
    );
    const stored = f.keys.insertOne.mock.calls[0][0];
    f.keys.findOne.mockResolvedValue(stored);
    const principal = await f.service.authenticate(
      f.endpointId,
      `Bearer ${created.secret}`,
    );
    expect(principal.tenantId).toBe(f.tenantId);
    expect(principal.permissions).toEqual(['library_list']);
    expect(f.keys.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: f.endpointId,
        enabled: true,
        secretHash: stored.secretHash,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: expect.any(Date) } }],
      }),
    );
    expect(f.endpoints.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: f.tenantId, enabled: true }),
    );
    f.keys.findOne.mockResolvedValue(null);
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${created.secret}`),
    ).rejects.toThrow('INVALID_MCP_CREDENTIALS');
  });

  it('链接停用、创建者迁出租户或账号停用后拒绝认证', async () => {
    const f = fixture();
    const created = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'reader', permissions: [] },
    );
    f.keys.findOne.mockResolvedValue(f.keys.insertOne.mock.calls[0][0]);
    f.users.findOne.mockResolvedValue({
      ...f.owner,
      tenantId: new ObjectId().toHexString(),
    });
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${created.secret}`),
    ).rejects.toThrow('INVALID_MCP_CREDENTIALS');
    f.users.findOne.mockResolvedValue(null);
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${created.secret}`),
    ).rejects.toThrow('INVALID_MCP_CREDENTIALS');
    f.users.findOne.mockResolvedValue(f.owner);
    f.endpoints.findOne.mockResolvedValue(null);
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${created.secret}`),
    ).rejects.toThrow('INVALID_MCP_CREDENTIALS');
  });

  it('删除链接时级联撤销对应租户与链接的密钥', async () => {
    const f = fixture();
    await f.service.deleteEndpoint(f.tenantId, f.endpointId);
    expect(f.endpoints.deleteOne).toHaveBeenCalledWith({
      _id: new ObjectId(f.endpointId),
      tenantId: f.tenantId,
    });
    expect(f.keys.deleteMany).toHaveBeenCalledWith({
      tenantId: f.tenantId,
      endpointId: f.endpointId,
    });
  });

  it('部分更新忽略 DTO 自带的 undefined 字段，不能把密钥启用状态或名称写成 null', async () => {
    const f = fixture();
    await f.service.updateKey(
      f.tenantId,
      f.endpointId,
      new ObjectId().toHexString(),
      {
        name: undefined,
        enabled: undefined,
        expiresAt: undefined,
        permissions: ['library_list'],
      },
    );
    const changes = f.keys.findOneAndUpdate.mock.calls[0][1].$set;
    expect(changes).toEqual({
      permissions: ['library_list'],
      updatedAt: expect.any(Date),
    });
    await f.service.updateEndpoint(f.tenantId, f.endpointId, {
      name: undefined,
      enabled: false,
    });
    expect(f.endpoints.updateOne.mock.calls[0][1].$set).toEqual({
      enabled: false,
      updatedAt: expect.any(Date),
    });
  });
});
