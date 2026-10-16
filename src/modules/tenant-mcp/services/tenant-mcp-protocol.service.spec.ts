import {
  ForbiddenException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { TenantMcpController } from '../controller/tenant-mcp.controller.js';
import { TenantMcpAuthGuard } from '../controller/tenant-mcp-auth.guard.js';
import { TenantMcpService } from './tenant-mcp.service.js';
import { TenantMcpToolsService } from './tenant-mcp-tools.service.js';
import { TenantMcpProtocolService } from './tenant-mcp-protocol.service.js';

jest.mock('./tenant-mcp-tools.service.js', () => ({
  TenantMcpToolsService: class {},
}));

describe('MCP Streamable HTTP 协议', () => {
  let app: INestApplication;
  let url: string;
  let client: Client;
  let permissions: string[];
  let revoked: boolean;
  const endpointId = '64b000000000000000000001';
  const execute = jest.fn();

  beforeEach(async () => {
    permissions = ['library_list'];
    revoked = false;
    const module = await Test.createTestingModule({
      controllers: [TenantMcpController],
      providers: [
        TenantMcpProtocolService,
        TenantMcpAuthGuard,
        {
          provide: TenantMcpService,
          useValue: {
            authenticate: jest.fn(async (id: string, authorization: string) => {
              if (
                id !== endpointId ||
                authorization !== 'Bearer test-key' ||
                revoked
              )
                throw new UnauthorizedException('INVALID_MCP_CREDENTIALS');
              return {
                tenantId: 'tenant-a',
                endpointId,
                keyId: 'key-a',
                permissions: [...permissions],
                userId: 'owner',
                username: 'owner',
              };
            }),
          },
        },
        { provide: TenantMcpToolsService, useValue: { execute } },
      ],
    }).compile();
    execute.mockReset().mockImplementation(async (principal, name) => {
      if (!principal.permissions.includes(name))
        throw new ForbiddenException('MCP_TOOL_NOT_ALLOWED');
      return { items: [], total: 0 };
    });
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/mcp/${endpointId}`;
    client = new Client({ name: 'integration-test', version: '1.0.0' });
  });

  afterEach(async () => {
    await client.close();
    await app.close();
  });

  it('官方客户端完成初始化、工具发现和调用，权限更新无需重连', async () => {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: 'Bearer test-key' } },
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'library_list',
    ]);
    const result = await client.callTool({
      name: 'library_list',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ items: [], total: 0 });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'library_list',
      {},
    );
    const denied = await client.callTool({
      name: 'article_publish',
      arguments: {},
    });
    expect(denied.isError).toBe(true);
    permissions = ['article_get'];
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'article_get',
    ]);
    revoked = true;
    await expect(client.listTools()).rejects.toThrow();
  });

  it('无密钥、无效链接和浏览器跨域来源均被拒绝', async () => {
    await request(app.getHttpServer())
      .post(`/api/mcp/${endpointId}`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/mcp/other-endpoint')
      .set('Authorization', 'Bearer test-key')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .set('Origin', 'https://evil.test')
      .send({})
      .expect(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('无状态端点对 GET 与 DELETE 返回 405', async () => {
    await request(app.getHttpServer())
      .get(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .expect('Allow', 'POST')
      .expect(405);
    await request(app.getHttpServer())
      .delete(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .expect(405);
  });
});
