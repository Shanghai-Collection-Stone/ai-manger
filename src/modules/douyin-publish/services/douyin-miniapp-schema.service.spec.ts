import type { ConfigService } from '@nestjs/config';
import {
  DouyinMiniappSchemaError,
  DouyinMiniappSchemaService,
} from './douyin-miniapp-schema.service.js';

/**
 * @description 构造只读配置桩。
 * @keyword-cn 配置桩, Schema测试
 * @keyword-en config-stub, schema-test
 */
function configOf(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * @description 构造返回 JSON 的 fetch 响应桩。
 * @keyword-cn 响应桩, Schema测试
 * @keyword-en response-stub, schema-test
 */
function jsonResponse(body: unknown): Response {
  return { status: 200, text: async () => JSON.stringify(body) } as Response;
}

const configured = configOf({
  DOUYIN_MINIAPP_APP_ID: 'tt123',
  DOUYIN_MINIAPP_APP_SECRET: 'secret',
});
const tokenBody = (token: string) => ({
  data: { access_token: token, expires_in: 7200, error_code: 0 },
  message: 'success',
});
const schemaBody = (schema: string) => ({
  data: { schema },
  err_no: 0,
  err_msg: '',
  log_id: 'log',
});

describe('DouyinMiniappSchemaService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('is disabled without AppID and AppSecret', () => {
    const service = new DouyinMiniappSchemaService(configOf({}));
    expect(service.isConfigured()).toBe(false);
    expect(service.buildSchemaKey({ token: 't' })).toBeNull();
  });

  it('requests a permanent schema for the publish page with flat launch params', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody('clt.a')))
      .mockResolvedValueOnce(
        jsonResponse(schemaBody('sslocal://miniapp?ticket=v1_x')),
      );
    const service = new DouyinMiniappSchemaService(configured);

    const schema = await service.generatePermanentSchema({
      token: 'tok',
      tenantId: 't1',
    });

    expect(schema).toBe('sslocal://miniapp?ticket=v1_x');
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://open.douyin.com/oauth/client_token/');
    expect(JSON.parse(tokenInit.body)).toEqual({
      client_key: 'tt123',
      client_secret: 'secret',
      grant_type: 'client_credential',
    });
    const [schemaUrl, schemaInit] = fetchMock.mock.calls[1];
    expect(schemaUrl).toBe(
      'https://open.douyin.com/api/apps/v1/url/generate_schema/',
    );
    expect(schemaInit.headers['access-token']).toBe('clt.a');
    expect(JSON.parse(schemaInit.body)).toEqual({
      app_id: 'tt123',
      path: 'pages/publish/index',
      query: '{"token":"tok","tenantId":"t1"}',
      no_expire: true,
    });
  });

  it('reuses the cached client token and refreshes once when Douyin reports it invalid', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody('clt.a')))
      .mockResolvedValueOnce(
        jsonResponse(schemaBody('sslocal://miniapp?ticket=1')),
      )
      .mockResolvedValueOnce(
        jsonResponse({ err_no: 28001003, err_msg: 'access_token无效' }),
      )
      .mockResolvedValueOnce(jsonResponse(tokenBody('clt.b')))
      .mockResolvedValueOnce(
        jsonResponse(schemaBody('sslocal://miniapp?ticket=2')),
      );
    const service = new DouyinMiniappSchemaService(configured);

    await service.generatePermanentSchema({ token: 'a' });
    const second = await service.generatePermanentSchema({ token: 'b' });

    expect(second).toBe('sslocal://miniapp?ticket=2');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      urls.filter((url) => url.endsWith('/oauth/client_token/')),
    ).toHaveLength(2);
    expect(fetchMock.mock.calls[2][1].headers['access-token']).toBe('clt.a');
    expect(fetchMock.mock.calls[4][1].headers['access-token']).toBe('clt.b');
  });

  it('surfaces Douyin errors with the original err_no', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody('clt.a')))
      .mockResolvedValueOnce(
        jsonResponse({
          err_no: 28005076,
          err_msg: '生成Schema数量超过上限',
          log_id: 'x',
        }),
      );
    const service = new DouyinMiniappSchemaService(configured);

    const error = await service
      .generatePermanentSchema({ token: 'a' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DouyinMiniappSchemaError);
    expect((error as DouyinMiniappSchemaError).code).toBe(
      'DOUYIN_MINIAPP_SCHEMA_FAILED',
    );
    expect((error as DouyinMiniappSchemaError).errNo).toBe(28005076);
  });
});
