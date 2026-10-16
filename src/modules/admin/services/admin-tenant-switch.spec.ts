import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { AdminService } from './admin.service.js';

const TENANT_A = '64b000000000000000000001';
const TENANT_B = '64b000000000000000000002';

/**
 * @description 构造切换租户测试服务：同一手机号账号在 A、B 两个租户和平台端各有成员，替换成员、租户、会话依赖。
 * @keyword-cn 切换租户测试服务, 同账号成员
 * @keyword-en tenant-switch-test-service, same-account-members
 * @param {Array<Record<string, unknown>>} rows 同账号下的成员行。
 */
function buildSwitchService(rows: Array<Record<string, unknown>>) {
  const service = Object.create(AdminService.prototype) as Record<string, any>;
  service.users = {
    find: jest.fn().mockReturnValue({ toArray: () => Promise.resolve(rows) }),
  };
  service.sassTenants = {
    find: jest.fn().mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: new ObjectId(TENANT_A), name: '集合石' },
          { _id: new ObjectId(TENANT_B), name: '街角咖啡' },
        ]),
    }),
  };
  service.issueSession = jest
    .fn()
    .mockImplementation((user: { tenantId?: string }) =>
      Promise.resolve({ token: `token-${user.tenantId ?? 'platform'}`, user }),
    );
  service.logout = jest.fn().mockResolvedValue(undefined);
  return service;
}

const current = {
  _id: new ObjectId(),
  accountId: 'acc-1',
  tenantId: TENANT_A,
  role: 'operator',
  displayName: '小陈',
  enabled: true,
  lastLoginAt: new Date('2026-10-01'),
};
const sameTenantOlder = {
  ...current,
  _id: new ObjectId(),
  displayName: '旧成员',
  lastLoginAt: new Date('2026-01-01'),
};
const otherTenant = {
  _id: new ObjectId(),
  accountId: 'acc-1',
  tenantId: TENANT_B,
  role: 'tenant_admin',
  displayName: '陈店长',
  enabled: true,
  lastLoginAt: new Date('2026-09-01'),
};
const platform = {
  _id: new ObjectId(),
  accountId: 'acc-1',
  role: 'super_admin',
  displayName: '平台',
  enabled: true,
};

describe('登录后切换租户', () => {
  it('列出同一手机号账号下每个租户一行，当前租户用当前成员并标出', async () => {
    const service = buildSwitchService([
      sameTenantOlder,
      current,
      otherTenant,
      platform,
    ]);
    const tenants = await service.listSwitchableTenants(current);
    expect(service.users.find).toHaveBeenCalledWith({
      accountId: 'acc-1',
      enabled: true,
    });
    expect(tenants).toEqual([
      expect.objectContaining({
        tenantId: TENANT_A,
        tenantName: '集合石',
        displayName: '小陈',
        current: true,
      }),
      expect.objectContaining({
        tenantId: TENANT_B,
        tenantName: '街角咖啡',
        role: 'tenant_admin',
        current: false,
      }),
      expect.objectContaining({
        tenantId: '',
        tenantName: '平台端',
        current: false,
      }),
    ]);
  });

  it('没关联手机号账号的历史成员只能看到自己，也不能凭登录态切到别处', async () => {
    const legacy = { ...current, accountId: undefined };
    const service = buildSwitchService([otherTenant]);
    expect(await service.listSwitchableTenants(legacy)).toHaveLength(1);
    expect(service.users.find).not.toHaveBeenCalled();
    await expect(
      service.switchTenant(legacy, 'old-token', TENANT_B),
    ).rejects.toThrow(ForbiddenException);
  });

  it('切到另一个租户时签发该租户成员的新会话，再吊销当前会话', async () => {
    const service = buildSwitchService([current, otherTenant]);
    const session = await service.switchTenant(current, 'old-token', TENANT_B);
    expect(service.issueSession).toHaveBeenCalledWith(otherTenant);
    expect(service.logout).toHaveBeenCalledWith('old-token');
    expect(session.token).toBe(`token-${TENANT_B}`);
  });

  it('切到当前租户或没绑定的租户时拒绝，不换令牌', async () => {
    const service = buildSwitchService([current, otherTenant]);
    await expect(
      service.switchTenant(current, 'old-token', TENANT_A),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.switchTenant(current, 'old-token', '64b0000000000000000000ff'),
    ).rejects.toThrow('TENANT_NOT_BOUND');
    expect(service.issueSession).not.toHaveBeenCalled();
    expect(service.logout).not.toHaveBeenCalled();
  });
});
