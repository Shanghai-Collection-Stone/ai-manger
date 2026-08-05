import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { NoticeService } from '../services/notice.service.js';
import {
  CreateNoticeDto,
  ListNoticesQueryDto,
  MyNoticesQueryDto,
  UpdateNoticeDto,
} from './notice.dto.js';

/**
 * @description 通知控制器(v2)，后台通知增删改查与发起(发布)/撤销，后台 JWT + CASL 鉴权，租户隔离
 * @keyword-en notice controller
 * @keyword-cn 通知控制器
 */
@Controller('api/v2/notices')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
)
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  /**
   * @description 通知列表(可按状态过滤)
   * @keyword-en list notices endpoint
   * @keyword-cn 通知列表端点
   */
  @RequirePermission('read', 'Notice')
  @Get()
  async list(@Req() req: AdminRequest, @Query() query: ListNoticesQueryDto) {
    const notices = await this.noticeService.list(
      this.requireUser(req),
      query.status,
    );
    return { notices };
  }

  /**
   * @description 创建通知(草稿)
   * @keyword-en create notice endpoint
   * @keyword-cn 创建通知端点
   */
  @RequirePermission('create', 'Notice')
  @Post()
  async create(@Req() req: AdminRequest, @Body() body: CreateNoticeDto) {
    const notice = await this.noticeService.create(this.requireUser(req), body);
    return { notice };
  }

  /**
   * @description 我的通知(接收人视角：已发布且对我可见)，附带已读状态，可仅未读
   * @keyword-en my notices endpoint
   * @keyword-cn 我的通知端点
   */
  @RequirePermission('read', 'NoticeRead')
  @Get('mine')
  async mine(@Req() req: AdminRequest, @Query() query: MyNoticesQueryDto) {
    const notices = await this.noticeService.mine(
      this.requireUser(req),
      query.onlyUnread,
    );
    return { notices };
  }

  /**
   * @description 当前用户未读通知数(前端角标)
   * @keyword-en unread count endpoint
   * @keyword-cn 未读数端点
   */
  @RequirePermission('read', 'NoticeRead')
  @Get('unread-count')
  async unreadCount(@Req() req: AdminRequest) {
    const unreadCount = await this.noticeService.unreadCount(
      this.requireUser(req),
    );
    return { unreadCount };
  }

  /**
   * @description 获取通知详情
   * @keyword-en get notice endpoint
   * @keyword-cn 获取通知端点
   */
  @RequirePermission('read', 'Notice')
  @Get(':id')
  async get(@Req() req: AdminRequest, @Param('id') id: string) {
    const notice = await this.noticeService.get(this.requireUser(req), id);
    return { notice };
  }

  /**
   * @description 更新通知(仅草稿/已撤销可改)
   * @keyword-en update notice endpoint
   * @keyword-cn 更新通知端点
   */
  @RequirePermission('update', 'Notice')
  @Patch(':id')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: UpdateNoticeDto,
  ) {
    const notice = await this.noticeService.update(
      this.requireUser(req),
      id,
      body,
    );
    return { notice };
  }

  /**
   * @description 删除通知
   * @keyword-en delete notice endpoint
   * @keyword-cn 删除通知端点
   */
  @RequirePermission('delete', 'Notice')
  @Delete(':id')
  async remove(@Req() req: AdminRequest, @Param('id') id: string) {
    const ok = await this.noticeService.remove(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 发起/发布通知(draft → published)
   * @keyword-en publish notice endpoint
   * @keyword-cn 发布通知端点
   */
  @RequirePermission('update', 'Notice')
  @Post(':id/publish')
  async publish(@Req() req: AdminRequest, @Param('id') id: string) {
    const notice = await this.noticeService.publish(this.requireUser(req), id);
    return { notice };
  }

  /**
   * @description 撤销通知(published → revoked)
   * @keyword-en revoke notice endpoint
   * @keyword-cn 撤销通知端点
   */
  @RequirePermission('update', 'Notice')
  @Post(':id/revoke')
  async revoke(@Req() req: AdminRequest, @Param('id') id: string) {
    const notice = await this.noticeService.revoke(this.requireUser(req), id);
    return { notice };
  }

  /**
   * @description 标记某条通知已读(幂等，仅对可见已发布通知)
   * @keyword-en mark notice read endpoint
   * @keyword-cn 标记已读端点
   */
  @RequirePermission('update', 'NoticeRead')
  @Post(':id/read')
  async markRead(@Req() req: AdminRequest, @Param('id') id: string) {
    const result = await this.noticeService.markRead(
      this.requireUser(req),
      id,
    );
    return { ok: true, ...result };
  }

  /**
   * @description 读取当前登录后台用户
   * @keyword-en read current admin user
   * @keyword-cn 读取当前用户
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
