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
import { TENANT_MCP_TOOLS } from '../tenant-mcp.tools.js';

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
    await expect(
      client.callTool({ name: 'article_publish', arguments: {} }),
    ).rejects.toMatchObject({ code: -32602 });
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

  it('全部授权时发现 16 个工具，每个都有名称、用途说明和 JSON Schema 参数结构', async () => {
    permissions = Object.keys(TENANT_MCP_TOOLS);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: 'Bearer test-key' } },
      }),
    );
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
    expect(client.getInstructions()).toContain('tools/list');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(16);
    expect(tools.map((tool) => tool.name)).toEqual(
      Object.keys(TENANT_MCP_TOOLS),
    );
    for (const tool of tools) {
      const definition =
        TENANT_MCP_TOOLS[tool.name as keyof typeof TENANT_MCP_TOOLS];
      expect(tool.title).toBe(definition.title);
      expect(tool.description).toBe(definition.description);
      expect(tool.description?.trim().length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        properties: expect.any(Object),
        additionalProperties: false,
      });
    }
    const qr = tools.find((tool) => tool.name === 'library_publish_qr');
    expect(qr?.inputSchema.required).toEqual(['libraryId']);
    const list = tools.find((tool) => tool.name === 'library_list');
    expect(list?.inputSchema.required || []).toEqual([]);
  });

  it('未分配工具权限时返回标准空工具列表', async () => {
    permissions = [];
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: 'Bearer test-key' } },
      }),
    );
    expect(await client.listTools()).toEqual({ tools: [] });
  });

  it('tools/list 是 JSON-RPC 方法，拼成 tool/list 返回方法不存在', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      .expect(200);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'library_list' }] },
    });
    const invalid = await request(app.getHttpServer())
      .post(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 2, method: 'tool/list', params: {} })
      .expect(200);
    expect(invalid.body).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601 },
    });
  });

  it('缺少标准 Accept 类型时返回 406，不能当成空工具列表', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/mcp/${endpointId}`)
      .set('Authorization', 'Bearer test-key')
      .set('Accept', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(406);
    expect(response.body.error.message).toContain('text/event-stream');
  });

  it('未知工具返回标准 JSON-RPC 参数错误，业务执行失败保留 isError', async () => {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: 'Bearer test-key' } },
      }),
    );
    await expect(
      client.callTool({ name: 'missing_tool', arguments: {} }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(execute).not.toHaveBeenCalled();
    execute.mockRejectedValueOnce(new Error('internal-sensitive-error'));
    const result = await client.callTool({
      name: 'library_list',
      arguments: {},
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'MCP_TOOL_EXECUTION_FAILED' }],
    });
    expect(JSON.stringify(result)).not.toContain('internal-sensitive-error');
  });
});
