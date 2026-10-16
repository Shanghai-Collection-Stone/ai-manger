import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import { decodeMcpBase64, TENANT_MCP_TOOLS } from '../tenant-mcp.tools.js';
import { TenantMcpToolsService } from './tenant-mcp-tools.service.js';

jest.mock('../../article-library/services/article-library.service.js', () => ({
  ArticleLibraryService: class {},
}));
jest.mock('../../article-library/services/article.service.js', () => ({
  ArticleService: class {},
}));
jest.mock('../../gallery/services/gallery.service.js', () => ({
  GalleryService: class {},
}));
jest.mock('../../xhs-topic-data/services/xhs-topic-crawl.service.js', () => ({
  XhsTopicCrawlService: class {},
}));
jest.mock('../../xhs-topic/services/xhs-topic-repository.service.js', () => ({
  XhsTopicRepositoryService: class {},
}));

/** @keyword-en mcp-tools-fixture, tenant-isolation */
function toolsFixture() {
  const principal: TenantMcpPrincipal = {
    tenantId: new ObjectId().toHexString(),
    keyId: new ObjectId().toHexString(),
    endpointId: new ObjectId().toHexString(),
    permissions: Object.keys(TENANT_MCP_TOOLS),
    userId: new ObjectId().toHexString(),
    username: 'owner',
  };
  const library = {
    id: 1,
    tenantId: principal.tenantId,
    name: '库',
    type: 'xhs',
    pushConfig: { qrToken: 'private-token' },
  };
  const article = {
    id: 2,
    libraryId: 1,
    tenantId: principal.tenantId,
    title: '文章',
    publishStatus: 'published',
    lastLeaseToken: 'private-lease',
    meta: { xhsTopicId: 3, NoteId: 'abcdef0123456789abcdef01' },
  };
  const libraries = {
    get: jest.fn().mockResolvedValue(library),
    list: jest.fn().mockResolvedValue({ items: [library], total: 1 }),
    getStats: jest.fn(),
    ensureQrToken: jest.fn(),
    buildPushQrContent: jest.fn(),
  };
  const articles = {
    get: jest.fn().mockResolvedValue(article),
    create: jest.fn().mockResolvedValue(article),
    list: jest.fn().mockResolvedValue({ items: [article], total: 1 }),
    update: jest.fn().mockResolvedValue(article),
  };
  const gallery = {
    findAccessibleImages: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue([
      {
        id: 5,
        url: '/static/uploads/safe.jpg',
        originalName: 'photo',
        tags: [],
      },
    ]),
  };
  const crawl = {
    createCrawlTask: jest.fn().mockResolvedValue({ id: 4, status: 'done' }),
    syncTaskStatuses: jest.fn(),
    getScheduleStatus: jest.fn().mockResolvedValue({ status: 'waiting' }),
    syncArticlePublishSchedule: jest.fn(),
  };
  const topics = {
    createManualLinkTopic: jest.fn().mockResolvedValue({ id: 3 }),
    deleteMany: jest.fn(),
    getChildTopicById: jest
      .fn()
      .mockResolvedValue({ id: 3, tenantId: principal.tenantId }),
  };
  const stats = {
    find: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(1),
  };
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([{ likeCount: 5 }]),
  };
  stats.find.mockReturnValue(cursor);
  const tasks = {
    findOne: jest.fn().mockResolvedValue({
      id: 4,
      topicId: 3,
      tenantId: principal.tenantId,
      status: 'done',
    }),
  };
  const rawArticles = {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const db = {
    collection: (name: string) =>
      name === 'xhs_post_stats'
        ? stats
        : name === 'articles'
          ? rawArticles
          : tasks,
  };
  const service = new TenantMcpToolsService(
    db as never,
    libraries as never,
    articles as never,
    gallery as never,
    crawl as never,
    topics as never,
    new ConfigService({ APP_URL: 'https://example.test' }),
  );
  return {
    service,
    principal,
    libraries,
    articles,
    gallery,
    topics,
    stats,
    tasks,
    crawl,
    rawArticles,
  };
}

describe('MCP 业务工具', () => {
  afterEach(() => jest.restoreAllMocks());
  it('越权调用在任何业务读取前被拒绝', async () => {
    const f = toolsFixture();
    await expect(
      f.service.execute({ ...f.principal, permissions: [] }, 'article_get', {
        articleId: 2,
      }),
    ).rejects.toThrow('MCP_TOOL_NOT_ALLOWED');
    expect(f.articles.get).not.toHaveBeenCalled();
  });
  it('所有参数 schema 拒绝外部注入租户身份，拒绝越界分页', () => {
    expect(() =>
      TENANT_MCP_TOOLS.library_list.schema.parse({ tenantId: 'other' }),
    ).toThrow();
    expect(() =>
      TENANT_MCP_TOOLS.library_list.schema.parse({ limit: -1 }),
    ).toThrow();
    expect(() =>
      TENANT_MCP_TOOLS.article_get.schema.parse({ articleId: NaN }),
    ).toThrow();
  });
  it('本租户列表不泄露扫码 token 或文章租约 token', async () => {
    const f = toolsFixture();
    const libraries = await f.service.execute(f.principal, 'library_list', {});
    const articles = await f.service.execute(
      f.principal,
      'article_list_published',
      { libraryId: 1 },
    );
    expect(JSON.stringify(libraries)).not.toContain('private-token');
    expect(JSON.stringify(articles)).not.toContain('private-lease');
    expect(f.libraries.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: f.principal.tenantId }),
    );
    expect(f.articles.list).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: f.principal.tenantId,
        status: 'published',
      }),
    );
  });
  it('跨租户文章和库均返回不存在', async () => {
    const f = toolsFixture();
    f.articles.get.mockResolvedValue({ id: 2, tenantId: 'other' });
    await expect(
      f.service.execute(f.principal, 'article_get', { articleId: 2 }),
    ).rejects.toThrow('ARTICLE_NOT_FOUND');
    f.libraries.get.mockResolvedValue({ id: 1, tenantId: 'other' });
    await expect(
      f.service.execute(f.principal, 'article_list_unpublished', {
        libraryId: 1,
      }),
    ).rejects.toThrow('LIBRARY_NOT_FOUND');
    expect(f.articles.list).not.toHaveBeenCalled();
  });
  it('文章文件上传强制以本租户未发布文章入库，防止伪造已发布状态', async () => {
    const f = toolsFixture();
    await f.service.execute(f.principal, 'article_upload', {
      libraryId: 1,
      base64: Buffer.from(
        JSON.stringify({ title: 'test', text: 'body' }),
      ).toString('base64'),
    });
    expect(f.articles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: f.principal.tenantId,
        userId: 'owner',
        publishStatus: 'unpublished',
        source: 'mcp',
      }),
    );
    await expect(
      f.service.execute(f.principal, 'article_upload', {
        libraryId: 1,
        base64: Buffer.from(
          JSON.stringify({ title: 'fake', publishStatus: 'published' }),
        ).toString('base64'),
      }),
    ).rejects.toThrow();
  });
  it('拒绝损坏 base64 和超过大小上限的文件', () => {
    expect(() => decodeMcpBase64('not base64', 10)).toThrow('INVALID_BASE64');
    expect(() =>
      decodeMcpBase64(Buffer.alloc(11).toString('base64'), 10),
    ).toThrow('INVALID_UPLOAD_SIZE_OR_BASE64');
    const maxImage = Buffer.alloc(10 * 1024 * 1024, 255);
    expect(
      decodeMcpBase64(maxImage.toString('base64'), maxImage.length).length,
    ).toBe(maxImage.length);
  });
  it('抓取完成后返回本次目标文章数据，同时限定 topicId、NoteId 和运行 ID', async () => {
    const f = toolsFixture();
    const result = await f.service.execute(f.principal, 'article_crawl', {
      articleId: 2,
    });
    expect(result).toMatchObject({
      completed: true,
      taskId: 4,
      items: [{ likeCount: 5 }],
    });
    expect(f.stats.find).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 3,
        crawlRunId: 4,
        postUrl: { $regex: 'abcdef0123456789abcdef01', $options: 'i' },
      }),
      expect.anything(),
    );
    expect(f.tasks.findOne).toHaveBeenCalledWith({
      id: 4,
      topicId: 3,
      tenantId: f.principal.tenantId,
    });
  });
  it('异步抓取返回 pending 和轮询工具，不能将历史数据误报为本次完成', async () => {
    const f = toolsFixture();
    f.crawl.createCrawlTask.mockResolvedValue({ id: 4, status: 'pending' });
    const result = await f.service.execute(f.principal, 'article_crawl', {
      articleId: 2,
    });
    expect(result).toMatchObject({
      completed: false,
      taskId: 4,
      pollTool: 'article_recent_data',
    });
    f.tasks.findOne.mockResolvedValue(null);
    await expect(
      f.service.execute(f.principal, 'article_recent_data', {
        articleId: 2,
        taskId: 99,
      }),
    ).rejects.toThrow('MCP_CRAWL_TASK_NOT_FOUND');
  });

  it('MCP 文章扫码发布后首次抓取补建监控绑定和计划', async () => {
    const f = toolsFixture();
    f.articles.get.mockResolvedValueOnce({
      id: 2,
      libraryId: 1,
      tenantId: f.principal.tenantId,
      title: 'MCP文章',
      publishStatus: 'published',
      meta: { NoteId: 'abcdef0123456789abcdef01' },
    });
    f.crawl.getScheduleStatus.mockResolvedValue(null);
    await f.service.execute(f.principal, 'article_crawl', { articleId: 2 });
    expect(f.rawArticles.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        tenantId: f.principal.tenantId,
        'meta.xhsTopicId': { $exists: false },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          source: 'xhs-topic',
          'meta.xhsTopicId': 3,
        }),
      }),
    );
    expect(f.crawl.syncArticlePublishSchedule).toHaveBeenCalledWith({
      topicId: 3,
      articleId: 2,
      libraryId: 1,
      status: 'published',
    });
    expect(f.topics.deleteMany).not.toHaveBeenCalled();
  });

  it('并发监控绑定失败时清理多余选题，已有计划不改排', async () => {
    const f = toolsFixture();
    f.articles.get.mockResolvedValueOnce({
      id: 2,
      libraryId: 1,
      tenantId: f.principal.tenantId,
      title: '文章',
      publishStatus: 'published',
      meta: { NoteId: 'abcdef0123456789abcdef01' },
    });
    f.rawArticles.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await f.service.execute(f.principal, 'article_crawl', { articleId: 2 });
    expect(f.topics.deleteMany).toHaveBeenCalledWith([3], {
      tenantId: f.principal.tenantId,
      userId: f.principal.userId,
    });
    expect(f.crawl.syncArticlePublishSchedule).not.toHaveBeenCalled();
  });

  it('真实 PNG 上传被重新编码为 JPEG，并限定到认证租户和随机文件名', async () => {
    const f = toolsFixture();
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const write = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    const png = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    await f.service.execute(f.principal, 'image_upload', {
      base64: png.toString('base64'),
      originalName: '../../fake.html',
      tags: ['红色'],
    });
    const uploaded = f.gallery.createMany.mock.calls[0][0][0];
    expect(uploaded).toMatchObject({
      tenantId: f.principal.tenantId,
      userId: f.principal.username,
      width: 2,
      height: 3,
      mimeType: 'image/jpeg',
      scope: 'tenant',
    });
    expect(uploaded.fileName).toMatch(/^mcp-[a-f0-9-]+\.jpg$/);
    expect(
      (await sharp(write.mock.calls[0][1] as Buffer).metadata()).format,
    ).toBe('jpeg');
  });
});
