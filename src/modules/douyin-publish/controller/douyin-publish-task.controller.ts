import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
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
   * @description 由后端转发作品登记的视频，供小程序直连外链被来源站拒绝时下载；只转发该作品自己的地址并透传 Range，不接受调用方传入地址。
   * @keyword-cn 小程序视频转发接口, 外链下载兜底
   * @keyword-en publish-task-video-endpoint, external-video-fallback
   */
  @Get(':id/video')
  @RequireDouyinPublishTokenAccess('read', 'DouyinWorkbench')
  async streamVideo(
    @Param('id') id: string,
    @Req() req: DouyinPublishTaskRequest,
    @Res() res: Response,
  ): Promise<void> {
    const library = req.douyinPublishLibrary;
    const work = await this.works.getForLibrary(id, library._id);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    const source = this.toAbsoluteUrl(work.videoUrl, req);
    if (!source) {
      throw new NotFoundException('DOUYIN_PUBLISH_VIDEO_NOT_AVAILABLE');
    }
    const range = req.headers.range;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(source, {
        headers: range ? { Range: range } : undefined,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch {
      throw new BadGatewayException('DOUYIN_PUBLISH_VIDEO_FETCH_FAILED');
    }
    if (!upstream.ok || !upstream.body) {
      throw new BadGatewayException(
        `DOUYIN_PUBLISH_VIDEO_FETCH_FAILED_${upstream.status}`,
      );
    }
    res.status(upstream.status);
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const stream = Readable.fromWeb(
      upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    stream.on('error', () => res.destroy());
    stream.pipe(res);
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
      videoDownloadUrl: this.toVideoDownloadUrl(work, req),
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
   * @description 视频登记在外部站点时给出本服务的转发地址，供小程序直连失败后改走后端；站内或相对地址返回空串。
   * @keyword-cn 视频转发地址, 外链下载兜底
   * @keyword-en video-download-url, external-video-fallback
   */
  private toVideoDownloadUrl(
    work: DouyinPublishWorkEntity,
    req: DouyinPublishTaskRequest,
  ): string {
    const source = String(work.videoUrl ?? '').trim();
    const host = typeof req.get === 'function' ? req.get('host') : undefined;
    if (!host || !/^https?:\/\//i.test(source)) return '';
    try {
      if (new URL(source).host === host) return '';
    } catch {
      return '';
    }
    return this.toAbsoluteUrl(
      `api/publish-tasks/${work._id.toHexString()}/video`,
      req,
    );
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
