import { ConfigService } from '@nestjs/config';
import { ObjectId, type Db } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { TenantMcpService } from './tenant-mcp.service.js';

/** @keyword-en mcp-test-fixture, key-management */
function fixture(settings: Record<string, string> = {}) {
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
    find: jest.fn(),
    findOne: jest.fn().mockResolvedValue({
      _id: new ObjectId(endpointId),
      tenantId,
      enabled: true,
    }),
    insertOne: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const keys = {
    find: jest.fn(),
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
  const config = new ConfigService({
    APP_URL: 'https://example.test',
    TENANT_MCP_ENCRYPTION_KEY: 'test-only-mcp-encryption-key',
    ...settings,
  });
  const service = new TenantMcpService(db, config);
  return {
    service,
    tenantId,
    endpointId,
    owner,
    endpoints,
    keys,
    users,
    db,
    config,
  };
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

  it('生成随机密钥并加密存储，后台视图可恢复完整密钥且不泄露哈希和信封', async () => {
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
    expect(result.key).not.toHaveProperty('secretEnvelope');
    expect(result.key.secret).toBe(result.secret);
    expect(document.secretEnvelope.algorithm).toBe('aes-256-gcm');
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

  it('模拟刷新后从持久化记录恢复密钥，列表仍受租户过滤', async () => {
    const f = fixture();
    const created = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'reader', permissions: ['library_list'] },
    );
    const stored = f.keys.insertOne.mock.calls[0][0];
    f.endpoints.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(f.endpointId),
            tenantId: f.tenantId,
            name: 'link',
            enabled: true,
          },
        ],
      }),
    });
    f.keys.find.mockReturnValue({
      sort: () => ({ toArray: async () => [stored] }),
    });
    const reloaded = new TenantMcpService(f.db, f.config);
    const result = await reloaded.list(f.tenantId);
    expect(result.endpoints[0].keys[0].secret).toBe(created.secret);
    expect(result.endpoints[0].keys[0]).not.toHaveProperty('secretEnvelope');
    expect(f.keys.find).toHaveBeenCalledWith({ tenantId: f.tenantId });
    expect(f.endpoints.find).toHaveBeenCalledWith({ tenantId: f.tenantId });
  });

  it('没有加密配置时沿用可恢复信封，后台刷新仍可复制密钥', async () => {
    const f = fixture({
      TENANT_MCP_ENCRYPTION_KEY: '',
      BROWSER_AUTH_ENCRYPTION_KEY: '',
      ADMIN_JWT_SECRET: '',
    });
    const created = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'local', permissions: [] },
    );
    expect(f.keys.insertOne.mock.calls[0][0].secretEnvelope).toEqual({
      algorithm: 'plain',
      value: created.secret,
    });
    expect(created.key.secret).toBe(created.secret);
  });

  it('旧哈希密钥成功认证后补存可恢复值，运行时认证结果不暴露密钥', async () => {
    const f = fixture();
    const created = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'legacy', permissions: [] },
    );
    const stored = { ...f.keys.insertOne.mock.calls[0][0] };
    delete stored.secretEnvelope;
    f.keys.findOne.mockResolvedValue(stored);
    const principal = await f.service.authenticate(
      f.endpointId,
      `Bearer ${created.secret}`,
    );
    expect(JSON.stringify(principal)).not.toContain(created.secret);
    const update = f.keys.updateOne.mock.calls[0];
    expect(update[0]).toEqual({
      _id: stored._id,
      secretHash: stored.secretHash,
    });
    expect(update[1].$set.secretEnvelope.algorithm).toBe('aes-256-gcm');
    f.keys.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          { ...stored, secretEnvelope: update[1].$set.secretEnvelope },
        ],
      }),
    });
    f.endpoints.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          { _id: new ObjectId(f.endpointId), tenantId: f.tenantId },
        ],
      }),
    });
    expect((await f.service.list(f.tenantId)).endpoints[0].keys[0].secret).toBe(
      created.secret,
    );
  });

  it('信封被复制到其他密钥或内容被篡改时不会显示错误的明文', async () => {
    const f = fixture();
    await f.service.createKey(f.tenantId, f.endpointId, f.owner, {
      name: 'secure',
      permissions: [],
    });
    const stored = f.keys.insertOne.mock.calls[0][0];
    f.endpoints.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          { _id: new ObjectId(f.endpointId), tenantId: f.tenantId },
        ],
      }),
    });
    f.keys.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [{ ...stored, _id: new ObjectId() }],
      }),
    });
    expect(
      (await f.service.list(f.tenantId)).endpoints[0].keys[0].secret,
    ).toBeNull();
    f.keys.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            ...stored,
            secretEnvelope: {
              ...stored.secretEnvelope,
              authTag: Buffer.alloc(16).toString('base64'),
            },
          },
        ],
      }),
    });
    expect(
      (await f.service.list(f.tenantId)).endpoints[0].keys[0].secret,
    ).toBeNull();
  });

  it('手动重新生成保存完整新密钥，保留权限和状态并使旧密钥失效', async () => {
    const f = fixture();
    const original = await f.service.createKey(
      f.tenantId,
      f.endpointId,
      f.owner,
      { name: 'rotate', permissions: ['library_list'] },
    );
    const stored = f.keys.insertOne.mock.calls[0][0];
    f.keys.findOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...stored,
      ...update.$set,
    }));
    const rotated = await f.service.rotateKey(
      f.tenantId,
      f.endpointId,
      stored._id.toHexString(),
    );
    expect(rotated.secret).not.toBe(original.secret);
    expect(rotated.key.secret).toBe(rotated.secret);
    expect(rotated.key.permissions).toEqual(['library_list']);
    expect(rotated.key.enabled).toBe(true);
    const newHash = f.keys.findOneAndUpdate.mock.calls[0][1].$set.secretHash;
    f.keys.findOne.mockImplementation(async (filter) =>
      filter.secretHash === newHash
        ? { ...stored, ...f.keys.findOneAndUpdate.mock.calls[0][1].$set }
        : null,
    );
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${original.secret}`),
    ).rejects.toThrow('INVALID_MCP_CREDENTIALS');
    await expect(
      f.service.authenticate(f.endpointId, `Bearer ${rotated.secret}`),
    ).resolves.toMatchObject({ tenantId: f.tenantId });
    expect(f.keys.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: stored._id,
      tenantId: f.tenantId,
      endpointId: f.endpointId,
    });
  });
});
