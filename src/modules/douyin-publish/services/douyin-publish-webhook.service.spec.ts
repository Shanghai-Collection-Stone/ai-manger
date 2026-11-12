import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ObjectId, type Db } from 'mongodb';
import request from 'supertest';
import { DouyinPublishWebhookController } from '../controller/douyin-publish-webhook.controller';
import { DouyinPublishTaskController } from '../controller/douyin-publish-task.controller';
import type { DouyinPublishTaskRequest } from '../guards/douyin-publish-token.guard';
import { DouyinPublishWebhookGuard } from '../guards/douyin-publish-webhook.guard';
import type { DouyinPublishWorkEntity } from '../entities/douyin-publish.entity';
import { resolveCrawlTarget } from '../../douyin-data/services/douyin-aweme-link';
import { DouyinMiniappSchemaService } from './douyin-miniapp-schema.service';
import { DouyinPublishWebhookService } from './douyin-publish-webhook.service';
import { DouyinPublishWorkService } from './douyin-publish-work.service';

/** 构造真实服务、内存持久层与可控平台 API，验证签名到作品更新全链路。
 * @keyword-cn 发布回调测试, 回调验签
 * @keyword-en publish-webhook-test, webhook-signature
 */
function webhookFixture() {
  const settings: Record<string, string> = {
    DOUYIN_MINIAPP_APP_ID: 'tt-test',
    DOUYIN_MINIAPP_APP_SECRET: 'app-secret',
    DOUYIN_PUBLISH_WEBHOOK_SECRET: 'webhook-secret',
    DOUYIN_PUBLISH_WEBHOOK_ENABLED: 'true',
  };
  const row: DouyinPublishWorkEntity = {
    _id: new ObjectId(),
    libraryId: new ObjectId(),
    userId: 'u1',
    topicId: null,
    videoId: 'local-video',
    title: '原始标题',
    description: '',
    tags: [],
    videoUrl: 'https://media.example/v.mp4',
    coverUrl: '',
    duration: 10,
    status: 'unpublished',
    douyinVideoId: null,
    publishedAt: null,
    lastError: null,
    lockExpireAt: new Date(Date.now() + 600000),
    leaseToken: 'lease',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const slots = new Map<string, Record<string, any>>();
  /** 按 Mongo 精确值及 in 条件匹配，返回快照以验证实际并发比较更新。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  function matches(
    filter: Record<string, any>,
    value: Record<string, any>,
  ): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      const actual = value[key] ?? null;
      if (expected && '$in' in Object(expected)) {
        if (
          !expected.$in.some(
            /** 比较精确候选值。 @name matchesCandidate
             * @keyword-cn 发布回调测试, 回调验签
             * @keyword-en publish-webhook-test, webhook-signature
             */ (candidate: unknown) =>
              JSON.stringify(candidate) === JSON.stringify(actual),
          )
        )
          return false;
      } else if (JSON.stringify(expected) !== JSON.stringify(actual))
        return false;
    }
    return true;
  }
  /** 读取作品快照。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function findTestWork(filter: Record<string, any>) {
    return matches(filter, row) ? { ...row } : null;
  }
  /** 原子应用作品更新。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function writeTestWork(
    filter: Record<string, any>,
    patch: { $set: object },
  ) {
    if (!matches(filter, row)) return { matchedCount: 0 };
    Object.assign(row, patch.$set);
    return { matchedCount: 1 };
  }
  const workCollection = {
    createIndex: jest.fn(),
    findOne: jest.fn(findTestWork),
    updateOne: jest.fn(writeTestWork),
  };
  /** 按作品或平台任务查询关联。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function findSlot(filter: Record<string, any>) {
    for (const slot of slots.values()) {
      if (filter._id && filter._id !== slot._id) continue;
      if (filter.appId && filter.appId !== slot.appId) continue;
      if (
        filter['tasks.id'] &&
        !slot.tasks.some(
          /** 匹配历史平台任务。 @name matchesTask
           * @keyword-cn 发布回调测试, 回调验签
           * @keyword-en publish-webhook-test, webhook-signature
           */ (task: { id: string }) => task.id === filter['tasks.id'],
        )
      )
        continue;
      return { ...slot, tasks: [...slot.tasks] };
    }
    return null;
  }
  /** 模拟跨进程任务创建租约。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function claimSlot(
    filter: Record<string, any>,
    patch: Record<string, any>,
  ) {
    const slot = slots.get(filter._id);
    if (slot?.creatingUntil && slot.creatingUntil.getTime() > Date.now())
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    const updated = {
      ...(slot || { _id: filter._id, ...patch.$setOnInsert }),
      ...patch.$set,
    };
    slots.set(filter._id, updated);
    return { ...updated, tasks: [...updated.tasks] };
  }
  /** 应用任务保存和租约释放。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function writeSlot(
    filter: Record<string, any>,
    patch: Record<string, any>,
  ) {
    const slot = slots.get(filter._id);
    if (!slot || slot.owner !== filter.owner) return { matchedCount: 0 };
    if (patch.$push) slot.tasks.push(patch.$push.tasks);
    Object.assign(slot, patch.$set);
    return { matchedCount: 1 };
  }
  const slotCollection = {
    createIndex: jest.fn(),
    findOne: findSlot,
    findOneAndUpdate: claimSlot,
    updateOne: jest.fn(writeSlot),
  };
  /** 返回请求的测试集合。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  function getWebhookCollection(name: string) {
    return name === 'douyin_publish_works' ? workCollection : slotCollection;
  }
  /** 读取测试配置。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  function getWebhookSetting(key: string) {
    return settings[key];
  }
  const db = { collection: getWebhookCollection } as unknown as Db;
  const config = { get: getWebhookSetting } as unknown as ConfigService;
  const works = new DouyinPublishWorkService(db, {} as any, {} as any);
  const platform = {
    isConfigured: jest.fn().mockReturnValue(true),
    createPublishVideoTask: jest
      .fn()
      .mockResolvedValue({
        id: 'task-1',
        expiresAt: new Date(Date.now() + 86400000),
      }),
  };
  const webhook = new DouyinPublishWebhookService(
    db,
    config,
    platform as unknown as DouyinMiniappSchemaService,
    works,
  );
  /** 构造平台原生通知，content 按官方字符串格式传输。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  function notification(
    status = 1,
    timestamp = 1700000000,
    videoId = '7312345678901234567',
  ) {
    return {
      event: 'douyin_video_task_message',
      client_key: 'tt-test',
      content: JSON.stringify({
        task_id: 'task-1',
        video_id: videoId,
        status,
        time_stamp: timestamp,
      }),
    };
  }
  return {
    settings,
    row,
    works,
    config,
    webhook,
    platform,
    workCollection,
    slotCollection,
    slots,
    notification,
  };
}

/** 验证安全入口、持久化任务关联及乱序回调。
 * @keyword-cn 发布回调测试, 回调验签
 * @keyword-en publish-webhook-test, webhook-signature
 */
function webhookTests() {
  /** 任务按作品持久复用，关闭功能不影响原生发布，启用错误明确阻止发布。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function preparesMappedTasks() {
    const f = webhookFixture();
    expect(await f.webhook.prepareTask(f.row)).toEqual(['task-1']);
    expect(await f.webhook.prepareTask(f.row)).toEqual(['task-1']);
    expect(f.platform.createPublishVideoTask).toHaveBeenCalledTimes(1);
    expect(f.slots.size).toBe(1);
    f.settings.DOUYIN_PUBLISH_WEBHOOK_ENABLED = 'false';
    expect(await f.webhook.prepareTask(f.row)).toEqual([]);
    f.settings.DOUYIN_PUBLISH_WEBHOOK_ENABLED = 'true';
    delete f.settings.DOUYIN_PUBLISH_WEBHOOK_SECRET;
    await expect(f.webhook.prepareTask(f.row)).rejects.toThrow(
      'DOUYIN_PUBLISH_WEBHOOK_NOT_CONFIGURED',
    );
  }
  /** 两次并发准备只有一个平台任务被创建。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function preventsConcurrentTaskCreation() {
    const f = webhookFixture();
    const outcomes = await Promise.allSettled([
      f.webhook.prepareTask(f.row),
      f.webhook.prepareTask(f.row),
    ]);
    expect(
      outcomes.filter(
        /** 统计成功的任务领取。 @name successfulTaskClaim
         * @keyword-cn 发布回调测试, 回调验签
         * @keyword-en publish-webhook-test, webhook-signature
         */ (outcome) => outcome.status === 'fulfilled',
      ),
    ).toHaveLength(1);
    expect(f.platform.createPublishVideoTask).toHaveBeenCalledTimes(1);
    expect(await f.webhook.prepareTask(f.row)).toEqual(['task-1']);
  }
  /** 任务创建失败释放新领取租约，让同一件作品可立即重试。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function releasesLeaseAfterTaskFailure() {
    const f = webhookFixture();
    jest.spyOn(f.works, 'leaseNext').mockResolvedValue({ ...f.row });
    f.platform.createPublishVideoTask.mockRejectedValueOnce(
      new Error('task unavailable'),
    );
    const controller = new DouyinPublishTaskController(f.works, f.webhook);
    await expect(
      controller.leaseNext({
        douyinPublishLibrary: { _id: f.row.libraryId },
      } as DouyinPublishTaskRequest),
    ).rejects.toThrow('task unavailable');
    expect(f.row.leaseToken).toBeNull();
    expect(f.row.lockExpireAt).toBeNull();
    expect(f.row.status).toBe('unpublished');
    expect(await f.webhook.prepareTask(f.row)).toEqual(['task-1']);
  }
  /** 平台通知先到也能接收后来的原生加密ID，不覆盖数字抓取目标。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function handlesWebhookBeforeNativeResult() {
    const f = webhookFixture();
    await f.webhook.prepareTask(f.row);
    // 发布库换库后，平台任务仍关联同一作品。
    f.row.libraryId = new ObjectId();
    await f.webhook.receive(f.notification(), 'msg-1');
    expect(f.row.status).toBe('published');
    expect(f.row.leaseToken).toBeNull();
    expect(f.row.douyinVideoId).toBeNull();
    await f.works.updatePublishResult(
      f.row._id.toHexString(),
      f.row.libraryId,
      {
        status: 'published',
        douyinVideoId: 'native-alias',
        title: '实际发布标题',
      },
    );
    expect(f.row.douyinVideoId).toBe('native-alias');
    expect(f.row.publishedSnapshot?.title).toBe('实际发布标题');
    expect(f.row.douyinWebhook?.videoId).toBe('7312345678901234567');
    expect(resolveCrawlTarget(f.row.douyinVideoId, null, f.row.douyinUrl)).toBe(
      '7312345678901234567',
    );
  }
  /** 重复和旧通知不会降级状态，失败状态不重新进入发布队列。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function handlesDuplicateAndOutOfOrderEvents() {
    const f = webhookFixture();
    await f.webhook.prepareTask(f.row);
    f.row.douyinVideoId = 'native-alias';
    await f.webhook.receive(f.notification(1, 20), 'msg-1');
    const writes = f.workCollection.updateOne.mock.calls.length;
    await f.webhook.receive(f.notification(1, 20), 'msg-1');
    await f.webhook.receive(f.notification(0, 19), 'msg-old');
    await f.webhook.receive(f.notification(0, 20), 'msg-same-second');
    expect(f.workCollection.updateOne).toHaveBeenCalledTimes(writes);
    await f.webhook.receive(f.notification(2, 21), 'msg-failed');
    expect(f.row.lastError).toContain('审核失败');
    expect(f.row.status).toBe('published');
    await f.works.updatePublishResult(
      f.row._id.toHexString(),
      f.row.libraryId,
      { status: 'published', douyinVideoId: 'native-alias' },
    );
    expect(f.row.lastError).toContain('审核失败');
    await f.webhook.receive(f.notification(1, 22), 'msg-public');
    expect(f.row.lastError).toBeNull();
  }
  /** 写入失败不提前标记已消费，平台重试可完成同一条通知。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function retriesFailedPersistence() {
    const f = webhookFixture();
    await f.webhook.prepareTask(f.row);
    f.workCollection.updateOne.mockRejectedValueOnce(
      new Error('db unavailable'),
    );
    await expect(f.webhook.receive(f.notification(), 'retry')).rejects.toThrow(
      'db unavailable',
    );
    await f.webhook.receive(f.notification(), 'retry');
    expect(f.row.douyinWebhook?.messageId).toBe('retry');
    await expect(
      f.webhook.receive(
        f.notification(1, 1700000001, '7312345678901234568'),
        'conflict',
      ),
    ).rejects.toThrow('DOUYIN_PUBLISH_VIDEO_ID_CONFLICT');
    expect(f.row.douyinWebhook?.messageId).toBe('retry');
  }
  /** 不将不透明平台ID假装成可抓取的数字作品ID。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function retainsOpaqueWebhookIdentity() {
    const f = webhookFixture();
    await f.webhook.prepareTask(f.row);
    await f.webhook.receive(f.notification(0, 10, 'platform-alias'), 'opaque');
    expect(f.row.douyinWebhook?.videoId).toBe('platform-alias');
    expect(f.works.toView(f.row).crawlTarget).toBeNull();
    expect(f.row.lastError).toContain('等待公开');
    await expect(
      f.webhook.receive(
        { event: 'douyin_video_task_message', content: '{broken' },
        'bad',
      ),
    ).rejects.toThrow('DOUYIN_WEBHOOK_CONTENT_INVALID');
    expect(
      await f.webhook.receive(
        { ...f.notification(), event: 'another_platform_event' },
        'unknown',
      ),
    ).toEqual({});
  }
  /** 使用真实 HTTP body parser 和路由验证原始字节签名及地址校验响应。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function verifiesHttpSignatures() {
    const f = webhookFixture();
    await f.webhook.prepareTask(f.row);
    const module = await Test.createTestingModule({
      controllers: [DouyinPublishWebhookController],
      providers: [
        DouyinPublishWebhookGuard,
        { provide: ConfigService, useValue: f.config },
        { provide: DouyinPublishWebhookService, useValue: f.webhook },
      ],
    }).compile();
    const app: INestApplication = module.createNestApplication({
      rawBody: true,
    });
    await app.init();
    try {
      const http = request(app.getHttpServer());
      const path = '/api/douyin-publish/webhook';
      const challenge = await http
        .post(path)
        .send({
          event: 'verify_webhook',
          client_key: '',
          content: { challenge: 12345 },
        });
      expect(challenge.status).toBe(200);
      expect(challenge.text).toBe('{"challenge":12345}');
      expect(challenge.headers['content-type']).toContain('text/plain');
      const raw = JSON.stringify(f.notification(), null, 2);
      const signature = createHash('sha1')
        .update('webhook-secret')
        .update(raw)
        .digest('hex');
      expect((await http.post(path).send(f.notification())).status).toBe(401);
      expect(
        (
          await http
            .post(path)
            .set('X-Douyin-Signature', '0'.repeat(40))
            .send(f.notification())
        ).status,
      ).toBe(401);
      expect(
        (
          await http
            .post(path)
            .type('json')
            .set('X-Douyin-Signature', signature)
            .send(raw + ' ')
        ).status,
      ).toBe(401);
      expect(f.row.status).toBe('unpublished');
      const accepted = await http
        .post(path)
        .type('json')
        .set('Msg-Id', 'http-1')
        .set('X-Douyin-Signature', signature)
        .send(raw);
      expect(accepted.status).toBe(200);
      expect(f.row.douyinWebhook?.messageId).toBe('http-1');
      const wrongApp = JSON.stringify({
        ...f.notification(),
        client_key: 'another-app',
      });
      const wrongAppSignature = createHash('sha1')
        .update('webhook-secret')
        .update(wrongApp)
        .digest('hex');
      expect(
        (
          await http
            .post(path)
            .type('json')
            .set('X-Douyin-Signature', wrongAppSignature)
            .send(wrongApp)
        ).status,
      ).toBe(401);
    } finally {
      await app.close();
    }
  }
  /** 平台创建请求使用长期任务类型和公开会客厅路径。
   * @keyword-cn 发布回调测试, 回调验签
   * @keyword-en publish-webhook-test, webhook-signature
   */
  async function createsOfficialLongTermTask() {
    const f = webhookFixture();
    const platform = new DouyinMiniappSchemaService(f.config);
    const mockedFetch = jest.spyOn(globalThis, 'fetch');
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { access_token: 'client-token', expires_in: 7200 },
        }),
      ),
    );
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ err_no: 0, data: { task_id: 'official-task' } }),
      ),
    );
    try {
      const task = await platform.createPublishVideoTask();
      expect(task.id).toBe('official-task');
      const [url, init] = mockedFetch.mock.calls[1];
      expect(url).toBe(
        'https://open.douyin.com/api/apps/v1/douyin/create_task/',
      );
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        rule_type: 2,
        task_type: 2,
        app_id: 'tt-test',
        target_count: 1,
        mount_link: '/pages/home/index',
        publish_type: [1],
      });
      expect(body.end_time - body.start_time).toBeLessThan(365 * 86400);
      expect(init?.headers).toMatchObject({ 'access-token': 'client-token' });
    } finally {
      mockedFetch.mockRestore();
    }
  }
  it(
    'persists and reuses mapped tasks and checks configuration',
    preparesMappedTasks,
  );
  it(
    'prevents concurrent creation across lease holders',
    preventsConcurrentTaskCreation,
  );
  it(
    'releases a new lease when task preparation fails',
    releasesLeaseAfterTaskFailure,
  );
  it(
    'handles webhook arriving before the native callback',
    handlesWebhookBeforeNativeResult,
  );
  it(
    'deduplicates and orders task changes without republishing',
    handlesDuplicateAndOutOfOrderEvents,
  );
  it(
    'retries failed writes and rejects conflicting videos',
    retriesFailedPersistence,
  );
  it(
    'retains opaque IDs and rejects malformed content',
    retainsOpaqueWebhookIdentity,
  );
  it(
    'verifies original HTTP bytes, signatures, app and challenge',
    verifiesHttpSignatures,
  );
  it(
    'creates the documented long-term task through the official API',
    createsOfficialLongTermTask,
  );
}

describe('Douyin publish task Webhooks', webhookTests);
