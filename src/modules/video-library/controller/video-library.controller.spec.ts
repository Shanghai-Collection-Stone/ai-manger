import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { VideoLibraryController } from './video-library.controller';
import { VideoLibraryService } from '../services/video-library.service';
import { VideoGroupService } from '../services/video-group.service';
import { OssStorageService } from '../services/oss-storage.service';
import { AdminService } from '../../admin/services/admin.service';

/**
 * @description 视频库 HTTP 契约测试：路由路径、鉴权、以及桌面端依赖的响应形状。
 *   服务层全部替身——这里要钉的是"前端按这个形状调用能不能通"，而不是 Mongo 行为。
 * @keyword-cn 视频库接口测试, 契约测试
 * @keyword-en video-library-http-test, contract-test
 */
describe('VideoLibraryController (HTTP)', () => {
  let app: INestApplication;
  let server: Server;
  const videos = {
    list: jest.fn(),
    listTags: jest.fn(),
    register: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const groups = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const oss = {
    maxBytesOf: jest.fn(),
    createUploadTicket: jest.fn(),
  };
  const admin = { getUserByToken: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VideoLibraryController],
      providers: [
        { provide: VideoLibraryService, useValue: videos },
        { provide: VideoGroupService, useValue: groups },
        { provide: OssStorageService, useValue: oss },
        { provide: AdminService, useValue: admin },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    admin.getUserByToken.mockResolvedValue({
      username: 'alice',
      tenantId: 'tenant-1',
    });
  });

  const auth = (req: request.Test) => req.set('Authorization', 'Bearer t0ken');

  it('没有 Bearer token 的请求一律 401', async () => {
    await request(server).get('/api/video-library/videos').expect(401);
    expect(videos.list).not.toHaveBeenCalled();
  });

  it('列表把 groupId / cursorId / limit 透传成数字，租户来自 token', async () => {
    videos.list.mockResolvedValue([{ id: 7 }]);
    const res = await auth(
      request(server).get(
        '/api/video-library/videos?groupId=3&tag=%E5%8F%A3%E6%92%AD&cursorId=42&limit=24',
      ),
    ).expect(200);
    expect(res.body).toEqual({ videos: [{ id: 7 }] });
    expect(videos.list).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      groupId: 3,
      tag: '口播',
      cursorId: 42,
      limit: 24,
    });
  });

  it('分组列表带出 video_count', async () => {
    groups.list.mockResolvedValue([
      { id: 1, name: '口播成片', video_count: 2 },
    ]);
    const res = await auth(
      request(server).get('/api/video-library/groups'),
    ).expect(200);
    const body = res.body as { groups: Array<{ video_count: number }> };
    expect(body.groups[0].video_count).toBe(2);
  });

  it('登记视频只认 key，标签串会被切开', async () => {
    videos.register.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ id: 9, ...input }),
    );
    const res = await auth(
      request(server).post('/api/video-library/videos').send({
        key: 'video-library/video/tenant-1/2026/09/abc.mp4',
        url: 'https://evil.example.com/not-ours.mp4',
        name: '开箱实拍.mp4',
        sizeBytes: 1024,
        durationMs: 95000,
        width: 1080,
        height: 1920,
        tags: '口播, 实拍,口播',
        groupId: '3',
      }),
    ).expect(201);
    const passed = videos.register.mock.calls[0][0] as Record<string, unknown>;
    const body = res.body as { video: { id: number } };
    expect(passed.key).toBe('video-library/video/tenant-1/2026/09/abc.mp4');
    expect(passed.tags).toEqual(['口播', '实拍']);
    expect(passed.groupId).toBe(3);
    expect(passed.tenantId).toBe('tenant-1');
    expect(passed.userId).toBe('alice');
    // 前端传的 url 不进服务层入参，地址由服务端按 key 重算
    expect(passed).not.toHaveProperty('url');
    expect(body.video.id).toBe(9);
  });

  it('缺 key 的登记请求 400', async () => {
    await auth(
      request(server).post('/api/video-library/videos').send({ name: 'a.mp4' }),
    ).expect(400);
    expect(videos.register).not.toHaveBeenCalled();
  });

  it('删除返回 ok 与未清理的对象键', async () => {
    videos.remove.mockResolvedValue({
      deleted: 1,
      deletedIds: [7],
      orphanKeys: ['video-library/video/x.mp4'],
    });
    const res = await auth(
      request(server).post('/api/video-library/videos/7/delete'),
    ).expect(201);
    expect(res.body).toEqual({
      ok: true,
      orphanKeys: ['video-library/video/x.mp4'],
    });
    expect(videos.remove).toHaveBeenCalledWith({
      ids: [7],
      tenantId: 'tenant-1',
    });
  });

  it('批量删除要求非空 ids', async () => {
    await auth(
      request(server)
        .post('/api/video-library/videos/batch-delete')
        .send({ ids: [] }),
    ).expect(400);
  });

  it('签票据前先按场景上限挡一次超大文件', async () => {
    oss.maxBytesOf.mockReturnValue(100);
    await auth(
      request(server)
        .post('/api/video-library/oss/signature')
        .send({ fileName: 'a.mp4', contentType: 'video/mp4', size: 101 }),
    ).expect(400);
    expect(oss.createUploadTicket).not.toHaveBeenCalled();
  });

  it('票据原样返回给前端，scene 非法值落回 video', async () => {
    oss.maxBytesOf.mockReturnValue(1024);
    oss.createUploadTicket.mockReturnValue({ mode: 'post', key: 'k' });
    const res = await auth(
      request(server).post('/api/video-library/oss/signature').send({
        fileName: 'a.mp4',
        contentType: 'video/mp4',
        size: 10,
        scene: 'x',
      }),
    ).expect(201);
    expect(res.body).toEqual({ mode: 'post', key: 'k' });
    expect(oss.createUploadTicket).toHaveBeenCalledWith({
      scene: 'video',
      fileName: 'a.mp4',
      contentType: 'video/mp4',
      tenantId: 'tenant-1',
    });
  });
});
