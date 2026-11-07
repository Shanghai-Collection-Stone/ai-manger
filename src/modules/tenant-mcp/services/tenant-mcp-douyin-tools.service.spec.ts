import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import { TENANT_MCP_TOOLS, TENANT_MCP_TOOL_META } from '../tenant-mcp.tools.js';
import { TenantMcpDouyinToolsService } from './tenant-mcp-douyin-tools.service.js';

jest.mock(
  '../../douyin-workbench/services/douyin-workbench-agent.service.js',
  () => ({ DouyinWorkbenchAgentService: class {} }),
);

/**
 * @description 构造抖音工具服务：编排服务全是替身，记录收到的作用域。
 * @keyword-cn 抖音工具测试桩, 编排替身
 * @keyword-en douyin-tools-fixture, agent-stub
 */
function fixture() {
  const principal: TenantMcpPrincipal = {
    tenantId: new ObjectId().toHexString(),
    keyId: new ObjectId().toHexString(),
    endpointId: new ObjectId().toHexString(),
    permissions: Object.keys(TENANT_MCP_TOOLS),
    userId: new ObjectId().toHexString(),
    username: 'owner',
  };
  const agent = {
    topicDetail: jest.fn().mockResolvedValue({
      id: 5,
      mergedVideo: { videoId: 9, url: '/static/videos/9.mp4' },
      segments: [{ video: { url: 'https://cdn.test/1.mp4' } }],
    }),
    generateStoreVisit: jest.fn().mockResolvedValue({ state: 'running' }),
    controlStoreVisitPipeline: jest.fn().mockResolvedValue({ state: 'paused' }),
    registerStorePhoto: jest.fn().mockRejectedValue(new Error('门店不存在')),
  };
  const service = new TenantMcpDouyinToolsService(
    agent as never,
    new ConfigService({ APP_URL: 'https://example.test/' }),
  );
  return { service, agent, principal };
}

describe('抖音工作台 MCP 工具', () => {
  afterEach(() => jest.restoreAllMocks());

  it('每个抖音工具都有分组与严格 schema，拒绝外部注入租户或用户', () => {
    const names = Object.keys(TENANT_MCP_TOOLS).filter((name) =>
      name.startsWith('douyin_'),
    );
    expect(names).toHaveLength(29);
    for (const name of names) {
      expect(
        TENANT_MCP_TOOL_META[name as keyof typeof TENANT_MCP_TOOL_META].group,
      ).toMatch(/^抖音 · /);
      expect(() =>
        TENANT_MCP_TOOLS[name as keyof typeof TENANT_MCP_TOOLS].schema.parse({
          topicId: 1,
          storeId: 1,
          tenantId: 'other',
        }),
      ).toThrow();
    }
    expect(() =>
      TENANT_MCP_TOOLS.douyin_store_spots_classify.schema.parse({
        storeId: 1,
        imageIds: Array.from({ length: 17 }, (_, index) => index + 1),
      }),
    ).toThrow();
  });

  it('调用身份固定为密钥的租户与创建人，返回里的站内地址补成完整地址', async () => {
    const { service, agent, principal } = fixture();
    const result = await service.execute(principal, 'douyin_topic_get', {
      topicId: 5,
    });
    expect(agent.topicDetail).toHaveBeenCalledWith(5, {
      tenantId: principal.tenantId,
      userId: principal.userId,
    });
    expect(result).toEqual({
      id: 5,
      mergedVideo: {
        videoId: 9,
        url: 'https://example.test/static/videos/9.mp4',
      },
      segments: [{ video: { url: 'https://cdn.test/1.mp4' } }],
    });
    await service.execute(principal, 'douyin_store_visit_generate', {
      topicId: 5,
      all: true,
    });
    expect(agent.generateStoreVisit).toHaveBeenCalledWith(
      5,
      { all: true },
      { tenantId: principal.tenantId, userId: principal.userId },
    );
    await service.execute(principal, 'douyin_store_visit_pipeline', {
      topicId: 5,
      action: 'redo',
      segmentId: 'seg-2',
    });
    expect(agent.controlStoreVisitPipeline).toHaveBeenCalledWith(
      5,
      { action: 'redo', segmentId: 'seg-2' },
      { tenantId: principal.tenantId, userId: principal.userId },
    );
    expect(() =>
      TENANT_MCP_TOOLS.douyin_store_visit_pipeline.schema.parse({
        topicId: 5,
        action: 'stop',
      }),
    ).toThrow();
  });

  it('门店照片登记失败时删掉已落盘的文件', async () => {
    const { service, principal } = fixture();
    const writes: string[] = [];
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fs, 'writeFile').mockImplementation(async (path) => {
      writes.push(String(path));
    });
    const unlink = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#f00' },
    })
      .png()
      .toBuffer();
    await expect(
      service.execute(principal, 'douyin_store_photo_upload', {
        storeId: 7,
        base64: png.toString('base64'),
        originalName: '门头.png',
      }),
    ).rejects.toThrow('门店不存在');
    expect(writes).toHaveLength(1);
    expect(unlink).toHaveBeenCalledWith(writes[0]);
  });
});
