import { ObjectId, type Db } from 'mongodb';
import { DouyinPublishTaskController } from '../controller/douyin-publish-task.controller';
import type { DouyinPublishTaskRequest } from '../guards/douyin-publish-token.guard';
import type { DouyinPublishWorkEntity } from '../entities/douyin-publish.entity';
import { resolveCrawlTarget } from '../../douyin-data/services/douyin-aweme-link';
import { DouyinDataService } from '../../douyin-data/services/douyin-data.service';
import { DouyinPublishWorkService } from './douyin-publish-work.service';

/** 构造内存发布作品及真实服务，用于验证回写与抓取标识衔接。
 * @keyword-cn 发布回写测试, 抓取衔接
 * @keyword-en publish-result-test, crawl-handoff
 */
function publishFixture() {
  const row: DouyinPublishWorkEntity = {
    _id: new ObjectId(),
    libraryId: new ObjectId(),
    userId: 'u1',
    topicId: null,
    videoId: 'local-video',
    videoUrl: 'https://media.example/sample.mp4',
    coverUrl: '',
    duration: 12,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'unpublished',
    title: '标题',
    description: '正文',
    tags: ['话题'],
    douyinVideoId: null,
    douyinUrl: null,
    publishedAt: null,
    lockExpireAt: new Date(Date.now() + 600000),
    leaseToken: 'lease',
    lastError: null,
  };
  /** 返回当前内存作品。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function findWork() {
    return row;
  }
  /** 将真实服务的数据库更新应用到内存作品。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function updateWork(
    filter: Record<string, unknown>,
    patch: { $set: Partial<DouyinPublishWorkEntity> },
  ) {
    for (const key of ['status', 'douyinVideoId', 'douyinUrl'] as const) {
      if (!(key in filter)) continue;
      const expected = filter[key];
      const actual = row[key] ?? null;
      if (expected && typeof expected === 'object' && '$in' in expected) {
        if (!(expected.$in as unknown[]).includes(actual))
          return { matchedCount: 0 };
      } else if (actual !== expected) return { matchedCount: 0 };
    }
    Object.assign(row, patch.$set);
    return { matchedCount: 1 };
  }
  const collection = {
    createIndex: jest.fn().mockResolvedValue('index'),
    findOne: findWork,
    updateOne: updateWork,
  };
  /** 为服务构造内存集合。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  function getCollection() {
    return collection;
  }
  const service = new DouyinPublishWorkService(
    { collection: getCollection } as unknown as Db,
    {} as ConstructorParameters<typeof DouyinPublishWorkService>[1],
    {} as ConstructorParameters<typeof DouyinPublishWorkService>[2],
  );
  return { service, row };
}

/** 验证数字ID、加密ID与补链接均保持作品身份，缺ID不能伪报成功。
 * @keyword-cn 发布回写测试, 抓取衔接
 * @keyword-en publish-result-test, crawl-handoff
 */
function publishIdentityTests() {
  /** 缺ID成功回写不落库。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function rejectsMissingId() {
    const { service, row } = publishFixture();
    await expect(
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
      }),
    ).rejects.toThrow('DOUYIN_PUBLISH_VIDEO_ID_REQUIRED');
    expect(row.status).toBe('unpublished');
  }
  /** 数字原生ID直接提供后续抓取目标。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function numericIdIsCrawlable() {
    const { service, row } = publishFixture();
    const id = '7312345678901234567';
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinVideoId: id,
    });
    expect(row.status).toBe('published');
    expect(row.douyinVideoId).toBe(id);
    expect(resolveCrawlTarget(row.douyinVideoId, null, row.douyinUrl)).toBe(id);
    expect(row.leaseToken).toBeNull();
  }
  /** 加密ID原样保留，补链接后供监控读取且不改变首次发布时间。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function completesEncryptedId() {
    const { service, row } = publishFixture();
    const alias = 'encrypted-video-id';
    const id = '7312345678901234567';
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinVideoId: alias,
    });
    expect(
      resolveCrawlTarget(row.douyinVideoId, null, row.douyinUrl),
    ).toBeNull();
    const publishedAt = row.publishedAt;
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinVideoId: alias,
      douyinUrl: `https://www.douyin.com/video/${id}`,
    });
    expect(row.douyinVideoId).toBe(alias);
    expect(row.publishedAt).toBe(publishedAt);
    expect(resolveCrawlTarget(row.douyinVideoId, null, row.douyinUrl)).toBe(id);
    const controller = new DouyinPublishTaskController(service);
    const result = await controller.publishResult(
      row._id.toHexString(),
      { status: 'published', douyinVideoId: alias },
      {
        douyinPublishLibrary: { _id: row.libraryId },
      } as DouyinPublishTaskRequest,
    );
    expect(result.crawlTarget).toBe(id);
    expect(result.douyinVideoId).toBe(alias);
    const detail = await controller.getWork(row._id.toHexString(), {
      douyinPublishLibrary: { _id: row.libraryId },
    } as DouyinPublishTaskRequest);
    expect(detail.status).toBe('published');
    expect(detail.douyinVideoId).toBe(alias);
    expect(detail.crawlTarget).toBe(id);
  }
  /** 未回传原生ID时可由作品链接恢复一次发布结果。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function recoversMissingIdWithLink() {
    const { service, row } = publishFixture();
    const id = '7312345678901234567';
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'identity-pending',
    });
    expect(row.status).toBe('published');
    expect(row.douyinVideoId).toBeNull();
    expect(row.lastError).toContain('等待补全作品ID');
    expect(row.leaseToken).toBeNull();
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinUrl: id,
    });
    expect(row.douyinVideoId).toBe(id);
    expect(resolveCrawlTarget(row.douyinVideoId, null, row.douyinUrl)).toBe(id);
    expect(row.lastError).toBeNull();
  }
  /** 幂等补全不允许覆盖成另一个作品或将已发布降级为失败。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function protectsPublishedIdentity() {
    const { service, row } = publishFixture();
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinVideoId: '7312345678901234567',
    });
    await expect(
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
        douyinVideoId: '7312345678901234568',
      }),
    ).rejects.toThrow('DOUYIN_PUBLISH_VIDEO_ID_CONFLICT');
    await expect(
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
        douyinUrl: '7312345678901234568',
      }),
    ).rejects.toThrow('DOUYIN_PUBLISH_VIDEO_ID_CONFLICT');
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'failed',
      errorMessage: 'late failure',
    });
    expect(row.status).toBe('published');
    expect(row.lastError).toBeNull();
  }
  /** 非抖音链接不可作为作品身份。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function rejectsInvalidLink() {
    const { service, row } = publishFixture();
    await expect(
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
        douyinUrl: 'not-a-link',
      }),
    ).rejects.toThrow('DOUYIN_PUBLISH_VIDEO_LINK_INVALID');
  }
  /** 并发冲突回调只允许一个作品ID落库。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function rejectsConcurrentIdentityOverwrite() {
    const { service, row } = publishFixture();
    const results = await Promise.allSettled([
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
        douyinVideoId: '7312345678901234567',
      }),
      service.updatePublishResult(row._id.toHexString(), row.libraryId, {
        status: 'published',
        douyinVideoId: '7312345678901234568',
      }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(row.douyinVideoId).toBe('7312345678901234567');
  }
  /** 桌面端绑定链接可补齐发布库身份，且不改变已明确的原始作品。
   * @keyword-cn 发布回写测试, 抓取衔接
   * @keyword-en publish-result-test, crawl-handoff
   */
  async function bindsDesktopLinkToPublishedWork() {
    const { service, row } = publishFixture();
    await service.updatePublishResult(row._id.toHexString(), row.libraryId, {
      status: 'published',
      douyinVideoId: 'native-alias',
    });
    /** 模拟监控行的原子upsert。
     * @keyword-cn 发布回写测试, 抓取衔接
     * @keyword-en publish-result-test, crawl-handoff
     */
    async function writeMonitor(
      _query: unknown,
      patch: { $set: object; $setOnInsert: object },
    ) {
      return { value: { ...patch.$setOnInsert, ...patch.$set } };
    }
    const monitors = {
      createIndex: jest.fn().mockResolvedValue('index'),
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: writeMonitor,
    };
    /** 提供测试监控集合。
     * @keyword-cn 发布回写测试, 抓取衔接
     * @keyword-en publish-result-test, crawl-handoff
     */
    function getMonitorCollection() {
      return monitors;
    }
    const data = new DouyinDataService(
      { collection: getMonitorCollection } as unknown as Db,
      service,
      {} as ConstructorParameters<typeof DouyinDataService>[2],
    );
    const id = '7312345678901234567';
    const bound = await data.bindLink(row._id.toHexString(), id, {
      userId: 'u1',
    });
    expect(bound.awemeId).toBe(id);
    expect(row.douyinVideoId).toBe('native-alias');
    expect(service.toView(row).crawlTarget).toBe(id);
    const override = await data.bindLink(
      row._id.toHexString(),
      '7312345678901234568',
      { userId: 'u1' },
    );
    expect(override.awemeId).toBe('7312345678901234568');
    expect(service.toView(row).crawlTarget).toBe(id);
  }
  it('requires video identity on successful reporting', rejectsMissingId);
  it(
    'makes numeric callback IDs available to the crawler',
    numericIdIsCrawlable,
  );
  it(
    'preserves encrypted callback IDs and enriches the published work for crawling',
    completesEncryptedId,
  );
  it(
    'recovers a missing callback ID from the published share link',
    recoversMissingIdWithLink,
  );
  it(
    'protects the published video identity and terminal status',
    protectsPublishedIdentity,
  );
  it('rejects an invalid published video link', rejectsInvalidLink);
  it(
    'pairs desktop link binding with the published work identity',
    bindsDesktopLinkToPublishedWork,
  );
  it(
    'rejects concurrent conflicting video identities',
    rejectsConcurrentIdentityOverwrite,
  );
}

describe('Douyin publish identity → crawler handoff', publishIdentityTests);
