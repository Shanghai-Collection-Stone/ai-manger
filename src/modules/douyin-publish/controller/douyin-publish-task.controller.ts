import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { DouyinPublishWorkEntity } from '../entities/douyin-publish.entity.js';
import { parseDouyinAwemeId } from '../../douyin-data/services/douyin-aweme-link.js';
import {
  RequireDouyinPublishTokenAccess,
  type DouyinPublishTaskRequest,
} from '../guards/douyin-publish-token.guard.js';
import { DouyinPublishWorkService } from '../services/douyin-publish-work.service.js';
import { DouyinPublishWebhookService } from '../services/douyin-publish-webhook.service.js';
import { DouyinPublishResultDto } from './douyin-publish.dto.js';

/**
 * @description 抖音小程序通过发布库二维码 token 领取作品和回写结果的公开接口。
 * @keyword-cn 小程序发布接口, 扫码令牌鉴权
 * @keyword-en publish-task-controller, qr-token-auth
 */
@Controller('api/publish-tasks')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinPublishTaskController {
  /** 注入作品服务和可选的平台任务准备服务。
   * @keyword-cn 小程序发布接口, 扫码令牌鉴权
   * @keyword-en publish-task-controller, qr-token-auth
   */
  constructor(
    private readonly works: DouyinPublishWorkService,
    private readonly webhook?: DouyinPublishWebhookService,
  ) {}

  /**
   * @description 原子领取库内下一条未发布作品并准备平台任务；准备失败释放本次租约，无作品返回404。
   * @keyword-cn 小程序领取接口, FIFO领取
   * @keyword-en lease-next-endpoint, fifo-lease
   */
  @Post('lease-next')
  @RequireDouyinPublishTokenAccess('update', 'DouyinWorkbench')
  async leaseNext(@Req() req: DouyinPublishTaskRequest) {
    const library = req.douyinPublishLibrary;
    const work = await this.works.leaseNext(library._id);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_AVAILABLE');
    try {
      return {
        ...this.toTaskView(work, req),
        douyinTaskIds: (await this.webhook?.prepareTask(work)) ?? [],
      };
    } catch (error) {
      await this.works.releaseUnstartedLease(work);
      throw error;
    }
  }

  /**
   * @description 读取扫码库内指定作品及平台状态，为未发布作品准备任务，不跨库暴露。
   * @keyword-cn 小程序作品详情接口
   * @keyword-en publish-task-detail-endpoint
   */
  @Get(':id')
  @RequireDouyinPublishTokenAccess('read', 'DouyinWorkbench')
  async getWork(@Param('id') id: string, @Req() req: DouyinPublishTaskRequest) {
    const library = req.douyinPublishLibrary;
    const work = await this.works.getForLibrary(id, library._id);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    return {
      ...this.toTaskView(work, req),
      douyinTaskIds: (await this.webhook?.prepareTask(work)) ?? [],
    };
  }

  /**
   * @description 回写原生发布结果或待补ID状态，返回原始ID、平台状态与数字抓取目标。
   * @keyword-cn 小程序发布回写接口, 释放租约
   * @keyword-en publish-result-endpoint, release-lease
   */
  @Post(':id/publish-result')
  @RequireDouyinPublishTokenAccess('update', 'DouyinWorkbench')
  async publishResult(
    @Param('id') id: string,
    @Body() body: DouyinPublishResultDto,
    @Req() req: DouyinPublishTaskRequest,
  ) {
    const library = req.douyinPublishLibrary;
    await this.works.updatePublishResult(id, library._id, body);
    const work = await this.works.getForLibrary(id, library._id);
    return {
      ok: true,
      douyinVideoId: work?.douyinVideoId ?? null,
      platformStatus: work?.douyinWebhook?.status ?? null,
      crawlTarget:
        parseDouyinAwemeId(work?.douyinUrl ?? '') ||
        parseDouyinAwemeId(work?.douyinVideoId ?? '') ||
        null,
    };
  }

  /**
   * @description 转换为小程序领取字段，并按当前请求 origin 补全视频和封面绝对地址。
   * @keyword-cn 小程序任务视图, 绝对媒体地址
   * @keyword-en publish-task-view, absolute-media-url
   */
  private toTaskView(
    work: DouyinPublishWorkEntity,
    req: DouyinPublishTaskRequest,
  ) {
    return {
      id: work._id.toHexString(),
      title: work.title,
      description: work.description,
      tags: work.tags,
      videoUrl: this.toAbsoluteUrl(work.videoUrl, req),
      coverUrl: this.toAbsoluteUrl(work.coverUrl, req),
      duration: work.duration,
      status: work.status,
      douyinVideoId: work.douyinVideoId,
      platformStatus: work.douyinWebhook?.status ?? null,
      crawlTarget:
        parseDouyinAwemeId(work.douyinUrl ?? '') ||
        parseDouyinAwemeId(work.douyinVideoId ?? '') ||
        null,
    };
  }

  /**
   * @description 使用 x-forwarded-proto 与 host 把相对媒体路径转换为绝对地址。
   * @keyword-cn 媒体地址补全, 代理协议识别
   * @keyword-en absolute-media-url, forwarded-protocol
   */
  private toAbsoluteUrl(value: string, req: DouyinPublishTaskRequest): string {
    const url = String(value ?? '').trim();
    if (!url || /^https?:\/\//i.test(url)) return url;
    const forwarded = req.headers['x-forwarded-proto'];
    const protocol = String(
      Array.isArray(forwarded) ? forwarded[0] : forwarded || req.protocol,
    )
      .split(',')[0]
      .trim();
    const host = req.get('host');
    return `${protocol || 'https'}://${host}/${url.replace(/^\/+/, '')}`;
  }
}
