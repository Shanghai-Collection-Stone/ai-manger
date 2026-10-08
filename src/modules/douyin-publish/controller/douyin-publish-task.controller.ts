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
import {
  RequireDouyinPublishTokenAccess,
  type DouyinPublishTaskRequest,
} from '../guards/douyin-publish-token.guard.js';
import { DouyinPublishWorkService } from '../services/douyin-publish-work.service.js';
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
  constructor(private readonly works: DouyinPublishWorkService) {}

  /**
   * @description 原子领取二维码 token 所属库的下一条未发布作品，无可领取作品返回 404。
   * @keyword-cn 小程序领取接口, FIFO领取
   * @keyword-en lease-next-endpoint, fifo-lease
   */
  @Post('lease-next')
  @RequireDouyinPublishTokenAccess('update', 'DouyinWorkbench')
  async leaseNext(@Req() req: DouyinPublishTaskRequest) {
    const library = req.douyinPublishLibrary;
    const work = await this.works.leaseNext(library._id);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_AVAILABLE');
    return this.toTaskView(work, req);
  }

  /**
   * @description 读取二维码 token 所属库内指定作品，不跨库暴露。
   * @keyword-cn 小程序作品详情接口
   * @keyword-en publish-task-detail-endpoint
   */
  @Get(':id')
  @RequireDouyinPublishTokenAccess('read', 'DouyinWorkbench')
  async getWork(@Param('id') id: string, @Req() req: DouyinPublishTaskRequest) {
    const library = req.douyinPublishLibrary;
    const work = await this.works.getForLibrary(id, library._id);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    return this.toTaskView(work, req);
  }

  /**
   * @description 回写抖音原生发布器的成功或失败结果并释放租约。
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
    return { ok: true };
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
