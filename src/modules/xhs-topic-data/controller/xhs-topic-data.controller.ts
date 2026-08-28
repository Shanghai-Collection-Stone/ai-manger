import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { XhsTopicRepositoryService } from '../../xhs-topic/services/xhs-topic-repository.service.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';
import {
  DeleteXhsTopicDayDto,
  UpdateXhsCrawlSettingsDto,
  UpdateXhsCrawlStatusDto,
  UpdateXhsCrawlWindowDto,
  XhsTopicDataPageDto,
  XhsTopicOpinionQueryDto,
} from './xhs-topic-data.dto.js';
import { XhsTopicCrawlService } from '../services/xhs-topic-crawl.service.js';
import { XhsTopicDataService } from '../services/xhs-topic-data.service.js';
import { XhsTopicOpinionService } from '../services/xhs-topic-opinion.service.js';
import { TikhubConfigService } from '../../tikhub/services/tikhub-config.service.js';
import { TikhubXhsService } from '../../tikhub/services/tikhub-xhs.service.js';

/** @type {number} 明细与任务列表的默认每页条数。 */
const DEFAULT_PAGE_SIZE = 20;

/**
 * @description 小红书子选题数据看板接口：数据总览、数据明细、抓取任务明细、抓取开关与舆论导向分析。
 * @keyword-cn 数据看板接口, 子选题数据, 抓取任务
 * @keyword-en topic-data-controller, subtopic-dashboard, crawl-tasks
 */
@Controller('api/xhs-topic-data')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class XhsTopicDataController {
  constructor(
    private readonly repository: XhsTopicRepositoryService,
    private readonly dataService: XhsTopicDataService,
    private readonly crawlService: XhsTopicCrawlService,
    private readonly opinionService: XhsTopicOpinionService,
    private readonly tikhubConfig: TikhubConfigService,
    private readonly tikhubXhs: TikhubXhsService,
  ) {}

  /**
   * @description 返回数据看板左侧母选题与子选题列表。与选题页不同，这里**保留**已存入文章库的子选题——
   *   已发文的子选题恰恰是最需要看抓取数据的那批，把它们剔掉会让数据页看不到主要数据源。
   * @keyword-cn 看板选题列表, 保留已入库子题
   * @keyword-en dashboard-topic-list, include-stored-topics
   */
  @Get('topics')
  @RequirePermission('read', 'XhsTopic')
  async topics(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    return {
      groups: await this.repository.listWorkspace(
        { tenantId: user.tenantId, userId: user._id.toHexString() },
        { includeStoredArticles: true },
      ),
    };
  }

  /**
   * @description 返回子选题的数据总览：核心指标、派生指标、趋势、最后抓取时间与下次抓取时间。
   * @keyword-cn 数据总览接口, 指标汇总
   * @keyword-en overview-endpoint, metric-summary
   */
  @Get(':topicId/overview')
  @RequirePermission('read', 'XhsTopic')
  async overview(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
  ) {
    const topic = await this.requireTopic(req, topicId);
    return { overview: await this.dataService.buildOverview(topic) };
  }

  /**
   * @description 分页返回子选题的抓取明细，供数据明细表格展示与按天删除定位。
   * @keyword-cn 数据明细接口, 分页明细
   * @keyword-en details-endpoint, paged-details
   */
  @Get(':topicId/details')
  @RequirePermission('read', 'XhsTopic')
  async details(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Query() query: XhsTopicDataPageDto,
  ) {
    await this.requireTopic(req, topicId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.dataService.listDetails(
      topicId,
      page,
      pageSize,
    );
    return { items, total, page, pageSize };
  }

  /**
   * @description 删除子选题某个自然日的全部抓取数据。
   * @keyword-cn 按天删除接口, 清理抓取数据
   * @keyword-en delete-day-endpoint, purge-day-stats
   */
  @Delete(':topicId/details')
  @RequirePermission('delete', 'XhsTopic')
  async deleteDay(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Query() query: DeleteXhsTopicDayDto,
  ) {
    await this.requireTopic(req, topicId);
    const deletedCount = await this.dataService.deleteDay(topicId, query.day);
    return { deletedCount, day: query.day };
  }

  /**
   * @description 分页返回子选题的抓取任务明细，读取前与 Todo 状态对账。
   * @keyword-cn 抓取任务接口, 任务明细
   * @keyword-en crawl-tasks-endpoint, task-details
   */
  @Get(':topicId/crawl-tasks')
  @RequirePermission('read', 'XhsTopic')
  async crawlTasks(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Query() query: XhsTopicDataPageDto,
  ) {
    const topic = await this.requireTopic(req, topicId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.crawlService.listTasks(
      topicId,
      page,
      pageSize,
    );
    const collector = await this.crawlService.getCollectorAvailability({
      tenantId: topic.tenantId,
      userId: topic.userId,
    });
    return {
      items,
      total,
      page,
      pageSize,
      // 兼容字段：老前端只认这个开关，新前端读 collector 才能区分渠道。
      agentAvailable: collector.available,
      collector,
      schedule: await this.crawlService.getScheduleStatus(topicId),
    };
  }

  /**
   * @description 切换子选题的抓取开关。取消时同时停掉在途抓取任务；恢复只是把调度行排到下一个
   *   每日定点，不会立刻开抓——要马上要数据请调手动抓取接口。
   * @keyword-cn 取消抓取接口, 恢复抓取
   * @keyword-en cancel-crawl-endpoint, resume-crawl
   */
  @Post(':topicId/crawl-status')
  @RequirePermission('update', 'XhsTopic')
  async updateCrawlStatus(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Body() dto: UpdateXhsCrawlStatusDto,
  ) {
    const user = this.requireUser(req);
    await this.requireTopic(req, topicId);
    const updated = await this.repository.setCrawlStatus(topicId, dto.status, {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    });
    if (!updated) throw new NotFoundException('XHS_TOPIC_NOT_FOUND');
    if (dto.status === 'cancelled') {
      await this.crawlService.pauseScheduleForTopic(topicId);
      const cancelledTasks =
        await this.crawlService.cancelRunningTasks(topicId);
      return { crawlStatus: dto.status, cancelledTasks };
    }
    const resumedSchedule =
      await this.crawlService.resumeScheduleForTopic(topicId);
    if (resumedSchedule) {
      return { crawlStatus: dto.status, scheduleResumed: true };
    }
    const task = await this.crawlService.createCrawlTask(updated, 'manual');
    return { crawlStatus: dto.status, resumedTaskId: task?.id };
  }

  /**
   * @description 手动触发一次抓取：这是唯一会立刻开抓的入口，发布、恢复、改区间都不再即时开抓。
   *   本次抓取是计划外的一次性补数，不改变抓取开关，也不挪动每日定点的下次执行时间。
   * @keyword-cn 手动抓取接口, 立即抓取
   * @keyword-en manual-crawl-endpoint, crawl-now
   */
  @Post(':topicId/crawl-now')
  @RequirePermission('create', 'XhsTopic')
  async crawlNow(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
  ) {
    const topic = await this.requireTopic(req, topicId);
    const task = await this.crawlService.createCrawlTask(topic, 'manual');
    if (!task) {
      const collector = await this.crawlService.getCollectorAvailability({
        tenantId: topic.tenantId,
        userId: topic.userId,
      });
      throw new NotFoundException(
        collector.channel === 'tikhub' && !collector.available
          ? 'TIKHUB_API_KEY_REQUIRED'
          : 'XHS_CRAWL_AGENT_UNAVAILABLE',
      );
    }
    return {
      taskId: task.id,
      todoId: task.todoId,
      channel: task.channel ?? 'super_claw',
      status: task.status,
      collectedCount: task.collectedCount,
    };
  }

  /**
   * @description 设置已发布子选题的周期抓取起止区间，默认两周区间可在这里覆盖。
   * @keyword-cn 设置抓取区间接口, 采集时限
   * @keyword-en update-crawl-window-endpoint, collection-deadline
   */
  @Put(':topicId/crawl-window')
  @RequirePermission('update', 'XhsTopic')
  async updateCrawlWindow(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Body() dto: UpdateXhsCrawlWindowDto,
  ) {
    await this.requireTopic(req, topicId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('INVALID_CRAWL_WINDOW');
    }
    const schedule = await this.crawlService.setScheduleWindow(
      topicId,
      startAt,
      endAt,
    );
    if (!schedule) throw new NotFoundException('XHS_CRAWL_SCHEDULE_NOT_FOUND');
    return {
      topicId,
      status: schedule.status,
      startAt: schedule.startAt.toISOString(),
      endAt: schedule.endAt.toISOString(),
      nextRunAt: schedule.nextRunAt.toISOString(),
    };
  }

  /**
   * @description 返回子选题的舆论导向分析结果，数据未更新时复用缓存。
   * @keyword-cn 舆论分析接口, 情感关键词
   * @keyword-en opinion-endpoint, sentiment-keywords
   */
  @Get(':topicId/opinion')
  @RequirePermission('read', 'XhsTopic')
  async opinion(
    @Req() req: AdminRequest,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Query() query: XhsTopicOpinionQueryDto,
  ) {
    const topic = await this.requireTopic(req, topicId);
    return {
      opinion: await this.opinionService.getOpinion(
        topic,
        query.force === true,
      ),
    };
  }

  /**
   * @description 读取当前用户生效的每日抓取时刻、采集渠道与 TikHub 配置。
   * @keyword-cn 读取抓取时刻, 调度设置
   * @keyword-en read-crawl-settings, schedule-config
   */
  @Get('crawl-settings')
  @RequirePermission('read', 'XhsTopic')
  async readCrawlSettings(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    const scope = { tenantId: user.tenantId, userId: user._id.toHexString() };
    return {
      dailyCrawlAt: await this.crawlService.getDailyCrawlAt(scope),
      channel: await this.crawlService.getChannel(scope),
      tikhub: await this.tikhubConfig.getView(scope),
      collector: await this.crawlService.getCollectorAvailability(scope),
    };
  }

  /**
   * @description 保存每日抓取时刻与采集渠道，并透传 TikHub 凭证；时刻变更会同时改排等待中的调度行。
   * @keyword-cn 保存抓取时刻, 同步设置
   * @keyword-en save-crawl-settings, sync-daily-time
   */
  @Put('crawl-settings')
  @RequirePermission('update', 'XhsTopic')
  async saveCrawlSettings(
    @Req() req: AdminRequest,
    @Body() dto: UpdateXhsCrawlSettingsDto,
  ) {
    const user = this.requireUser(req);
    const scope = { tenantId: user.tenantId, userId: user._id.toHexString() };
    const dailyCrawlAt = dto.dailyCrawlAt
      ? await this.crawlService.saveDailyCrawlAt(dto.dailyCrawlAt, scope)
      : await this.crawlService.getDailyCrawlAt(scope);
    if (dto.tikhubApiKey !== undefined || dto.tikhubBaseUrl !== undefined) {
      await this.tikhubConfig.save(scope, {
        apiKey: dto.tikhubApiKey,
        baseUrl: dto.tikhubBaseUrl,
      });
    }
    // 切到 TikHub 前先确认 Key 已经在库里，否则调度器只会一轮轮空跑。
    if (
      dto.channel === 'tikhub' &&
      !(await this.tikhubConfig.resolveApiKey(scope))
    ) {
      throw new BadRequestException('TIKHUB_API_KEY_REQUIRED');
    }
    const channel = dto.channel
      ? await this.crawlService.saveChannel(dto.channel, scope)
      : await this.crawlService.getChannel(scope);
    return {
      dailyCrawlAt,
      channel,
      tikhub: await this.tikhubConfig.getView(scope),
      collector: await this.crawlService.getCollectorAvailability(scope),
    };
  }

  /**
   * @description 用当前保存的 Key 与域名做一次 TikHub 连通性自检，配置页保存后点「测试连接」调用。
   * @keyword-cn 测试TikHub连接, 密钥自检
   * @keyword-en test-tikhub-connection, api-key-probe
   */
  @Post('crawl-settings/test-tikhub')
  @RequirePermission('update', 'XhsTopic')
  async testTikhubConnection(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    return this.tikhubXhs.probe({
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    });
  }

  /**
   * @description 读取当前用户拥有的子选题，越权或不存在都按 404 处理，避免泄露他人选题的存在性。
   * @keyword-cn 校验选题归属, 越权防护
   * @keyword-en require-owned-topic, ownership-guard
   * @param req 携带后台用户的请求。
   * @param topicId 子选题业务 ID。
   * @returns {Promise<XhsTopicEntity>} 当前用户拥有的子选题。
   */
  private async requireTopic(
    req: AdminRequest,
    topicId: number,
  ): Promise<XhsTopicEntity> {
    const user = this.requireUser(req);
    const topic = await this.repository.getOwnedTopic(topicId, {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    });
    if (!topic || topic.kind !== 'child') {
      throw new NotFoundException('XHS_TOPIC_NOT_FOUND');
    }
    return topic;
  }

  /**
   * @description 取出当前后台用户，未登录直接 401。
   * @keyword-cn 当前后台用户, 登录校验
   * @keyword-en require-admin-user, auth-check
   * @param req 携带后台用户的请求。
   * @returns {AdminUserEntity} 当前后台用户。
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
