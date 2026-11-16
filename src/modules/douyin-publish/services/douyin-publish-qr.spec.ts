import type { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { ObjectId, type Db } from 'mongodb';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard';
import { DouyinPublishWorkService } from './douyin-publish-work.service';
import { DouyinPublishController } from '../controller/douyin-publish.controller';
import type { AdminRequest } from '../../admin/types/admin-request.types';
import type {
  DouyinMiniappVersionType,
  DouyinPublishLibraryEntity,
} from '../entities/douyin-publish.entity';
import { DouyinMiniappSchemaService } from './douyin-miniapp-schema.service';
import { DouyinPublishLibraryService } from './douyin-publish-library.service';

/** 构造真实版本缓存服务、平台配置及按字段更新的持久层替身。
 * @keyword-cn 版本二维码测试, 缓存隔离
 * @keyword-en version-qr-test, cache-isolation
 */
function versionQrFixture() {
  const library: DouyinPublishLibraryEntity = {
    _id: new ObjectId(),
    userId: 'u1',
    tenantId: 't1',
    name: '测试发布库',
    qrToken: 'fixture-token',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const settings: Record<string, string> = {
    DOUYIN_MINIAPP_APP_ID: 'tt-qr-test',
    DOUYIN_MINIAPP_APP_SECRET: 'test-secret',
  };
  /** 读取二维码测试配置。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  function getVersionQrSetting(key: string) {
    return settings[key];
  }
  const config = { get: getVersionQrSetting } as unknown as ConfigService;
  const platform = new DouyinMiniappSchemaService(config);
  /** 查询精确发布库并保留快照，模拟并发读。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function readVersionQrLibrary(filter: Record<string, unknown>) {
    if (
      String(filter._id) !== String(library._id) ||
      filter.userId !== library.userId ||
      filter.tenantId !== library.tenantId
    )
      return null;
    return { ...library, qrSchemas: { ...library.qrSchemas } };
  }
  /** 应用 Mongo 点号字段更新，验证两种版本不会互相覆盖。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function saveVersionQrLibrary(
    filter: Record<string, unknown>,
    patch: { $set: Record<string, unknown> },
  ) {
    if (filter.qrToken !== library.qrToken) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(patch.$set)) {
      if (key.startsWith('qrSchemas.')) {
        library.qrSchemas ??= {};
        library.qrSchemas[
          key.slice('qrSchemas.'.length) as DouyinMiniappVersionType
        ] = value as { schema: string; key: string };
      } else Object.assign(library, { [key]: value });
    }
    return { matchedCount: 1 };
  }
  const collection = {
    createIndex: jest.fn().mockResolvedValue('index'),
    findOne: jest.fn(readVersionQrLibrary),
    updateOne: jest.fn(saveVersionQrLibrary),
  };
  /** 提供发布库测试集合。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  function getVersionQrCollection() {
    return collection;
  }
  const service = new DouyinPublishLibraryService(
    { collection: getVersionQrCollection } as unknown as Db,
    config,
    platform,
  );
  /** 为每种版本生成不同入口，以发现串码和错误复用。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function generateVersionQr(_query: Record<string, string>) {
    return `sslocal://miniapp?ticket=${platform.getVersionType()}`;
  }
  const generate = jest
    .spyOn(platform, 'generatePermanentSchema')
    .mockImplementation(generateVersionQr);
  return {
    library,
    settings,
    config,
    platform,
    service,
    collection,
    generate,
    scope: { userId: 'u1', tenantId: 't1' },
  };
}

/** 验证版本参数贯穿管理端、缓存和官方 API，且与原发布库回调凭证保持关联。
 * @keyword-cn 版本二维码测试, 缓存隔离
 * @keyword-en version-qr-test, cache-isolation
 */
function versionQrTests() {
  /** 后端改版本时隔离缓存，原库 token 和发布结果关联不变。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function isolatesVersionCaches() {
    const f = versionQrFixture();
    const current = await f.service.getQr(String(f.library._id), f.scope);
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
    const latest = await f.service.getQr(String(f.library._id), f.scope);
    expect(current.versionType).toBe('current');
    expect(latest.versionType).toBe('latest');
    expect(current.token).toBe(latest.token);
    expect(current.path).toBe(latest.path);
    expect(current.libraryId).toBe(latest.libraryId);
    expect(current.qrContent).not.toBe(latest.qrContent);
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'current';
    expect(
      (await f.service.getQr(String(f.library._id), f.scope)).qrContent,
    ).toBe(current.qrContent);
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
    expect(
      (await f.service.getQr(String(f.library._id), f.scope)).qrContent,
    ).toBe(latest.qrContent);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.library.qrSchema).toBe(current.qrContent);
  }
  /** 旧正式版缓存仍可用，同一后端版本并发只生成一次。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function reusesLegacyAndConcurrentCaches() {
    const f = versionQrFixture();
    f.library.qrSchema = 'sslocal://miniapp?ticket=legacy-current';
    f.library.qrSchemaKey = f.platform.buildSchemaKey({
      token: f.library.qrToken!,
      tenantId: 't1',
    })!;
    expect(
      (await f.service.getQr(String(f.library._id), f.scope)).qrContent,
    ).toBe(f.library.qrSchema);
    expect(f.generate).not.toHaveBeenCalled();
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
    const results = await Promise.all([
      f.service.getQr(String(f.library._id), f.scope),
      f.service.getQr(String(f.library._id), f.scope),
    ]);
    expect(results[0].qrContent).toBe(results[1].qrContent);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.library.qrSchema).toBe('sslocal://miniapp?ticket=legacy-current');
  }
  /** 真实 HTTP 客户端试图提交其他版本时仍只能得到后端配置的版本。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function enforcesBackendVersionOverQuery() {
    const f = versionQrFixture();
    const authGuard = {
      /** 为隔离的 HTTP 测试提供已验证的用户上下文。
       * @keyword-cn 版本二维码测试, 缓存隔离
       * @keyword-en version-qr-test, cache-isolation
       */
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest<AdminRequest>().adminUser = {
          _id: 'u1',
          tenantId: 't1',
        } as never;
        return true;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [DouyinPublishController],
      providers: [
        { provide: DouyinPublishLibraryService, useValue: f.service },
        { provide: DouyinPublishWorkService, useValue: {} },
      ],
    })
      .overrideGuard(AdminAuthGuard)
      .useValue(authGuard)
      .overrideGuard(AdminPoliciesGuard)
      .useValue(authGuard)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const path = '/api/douyin-publish/libraries/' + f.library._id + '/qr';
      const current = await request(app.getHttpServer()).get(
        path + '?versionType=latest',
      );
      expect(current.status).toBe(200);
      expect(current.body.versionType).toBe('current');
      f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
      const latest = await request(app.getHttpServer()).get(
        path + '?versionType=current',
      );
      expect(latest.status).toBe(200);
      expect(latest.body.versionType).toBe('latest');
      expect(f.collection.findOne).toHaveBeenCalledWith({
        _id: f.library._id,
        userId: 'u1',
        tenantId: 't1',
      });
    } finally {
      await app.close();
    }
  }
  /** 非法服务端配置或缺平台凭证时拒绝，不回退成另一版本。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function rejectsUnsupportedVersion() {
    const f = versionQrFixture();
    expect(f.platform.getVersionType()).toBe('current');
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'trial';
    await expect(
      f.service.getQr(String(f.library._id), f.scope),
    ).rejects.toThrow('DOUYIN_MINIAPP_VERSION_TYPE_INVALID');
    f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
    jest.spyOn(f.platform, 'isConfigured').mockReturnValue(false);
    await expect(
      f.service.getQr(String(f.library._id), f.scope),
    ).rejects.toThrow('DOUYIN_PUBLISH_TEST_QR_NOT_CONFIGURED');
    expect(f.generate).not.toHaveBeenCalled();
  }
  /** 官方 API 的 version_type 由后端配置提供，页面与扫码参数保持。
   * @keyword-cn 版本二维码测试, 缓存隔离
   * @keyword-en version-qr-test, cache-isolation
   */
  async function sendsOfficialVersionParameter() {
    const f = versionQrFixture();
    f.generate.mockRestore();
    const mockedFetch = jest.spyOn(globalThis, 'fetch');
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { access_token: 'fixture-client-token', expires_in: 7200 },
        }),
      ),
    );
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          err_no: 0,
          data: { schema: 'sslocal://miniapp?ticket=current' },
        }),
      ),
    );
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          err_no: 0,
          data: { schema: 'sslocal://miniapp?ticket=latest' },
        }),
      ),
    );
    try {
      const query = { token: 'fixture-token', tenantId: 't1' };
      await f.platform.generatePermanentSchema(query);
      f.settings.DOUYIN_MINIAPP_VERSION_TYPE = 'latest';
      await f.platform.generatePermanentSchema(query);
      const current = JSON.parse(String(mockedFetch.mock.calls[1][1]?.body));
      const latest = JSON.parse(String(mockedFetch.mock.calls[2][1]?.body));
      expect(current).toMatchObject({
        version_type: 'current',
        no_expire: true,
        path: 'pages/publish/index',
        query: JSON.stringify(query),
      });
      expect(latest).toMatchObject({ ...current, version_type: 'latest' });
      expect(mockedFetch).toHaveBeenCalledTimes(3);
    } finally {
      mockedFetch.mockRestore();
    }
  }
  it(
    'isolates backend current/latest caches with the same library token',
    isolatesVersionCaches,
  );
  it(
    'reuses legacy current cache and deduplicates backend latest generation',
    reusesLegacyAndConcurrentCaches,
  );
  it(
    'ignores client version overrides and preserves tenant/user ownership',
    enforcesBackendVersionOverQuery,
  );
  it(
    'rejects invalid backend version and missing platform configuration',
    rejectsUnsupportedVersion,
  );
  it(
    'sends the configured version_type through the real Schema API client',
    sendsOfficialVersionParameter,
  );
}

describe('Publishing library backend version QR codes', versionQrTests);
