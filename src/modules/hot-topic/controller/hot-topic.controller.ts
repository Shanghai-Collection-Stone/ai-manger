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
import {
  HOT_TOPIC_CATEGORIES,
  HOT_TOPIC_CATEGORY_LABELS,
  type HotTopicScope,
} from '../entities/hot-topic.entity.js';
import { HOT_TOPIC_SUGGESTED_TAGS } from '../services/hot-topic-tagging.service.js';
import {
  ClearHotTopicItemDto,
  CollectHotTopicDto,
  CreateHotTopicRuleDto,
  HotTopicItemQueryDto,
  RecommendHotTopicDto,
  UpdateHotTopicRuleDto,
} from './hot-topic.dto.js';
import { HotTopicCollectService } from '../services/hot-topic-collect.service.js';
import { HotTopicItemService } from '../services/hot-topic-item.service.js';
import { HotTopicRecommendService } from '../services/hot-topic-recommend.service.js';
import { HotTopicRuleService } from '../services/hot-topic-rule.service.js';

/**
 * @description 热点采集榜后台接口：采集规则 CRUD 与可用性自检、触发采集、榜单浏览、
 *  AI 归类标签汇总，以及按母选题推荐热点的结构化 LLM 接口。
 * @keyword-cn 热点采集接口, 采集规则管理, 热点推荐接口
 * @keyword-en hot-topic-controller, collect-rule-admin, hot-topic-recommend-endpoint
 */
@Controller('api/hot-topic')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class HotTopicController {
  constructor(
    private readonly ruleService: HotTopicRuleService,
    private readonly itemService: HotTopicItemService,
    private readonly collectService: HotTopicCollectService,
    private readonly recommendService: HotTopicRecommendService,
  ) {}

  /**
   * @description 返回分类枚举与推荐标签词表，供后台表单下拉与归类说明使用。
   * @keyword-cn 分类元数据, 推荐词表
   * @keyword-en category-metadata, suggested-tags
   */
  @Get('meta')
  @RequirePermission('read', 'HotTopic')
  meta() {
    return {
      categories: HOT_TOPIC_CATEGORIES.map((id) => ({
        id,
        label: HOT_TOPIC_CATEGORY_LABELS[id],
      })),
      suggestedTags: HOT_TOPIC_SUGGESTED_TAGS,
    };
  }

  /**
   * @description 列出全部采集规则，每条带最近一次自检或采集得到的可用性状态。
   * @keyword-cn 采集规则列表, 是否可用
   * @keyword-en list-collect-rules, availability-status
   */
  @Get('rules')
  @RequirePermission('read', 'HotTopic')
  async listRules(@Req() req: AdminRequest) {
    return { rules: await this.ruleService.list(this.requireScope(req)) };
  }

  /**
   * @description 新建一条采集规则。
   * @keyword-cn 新建采集规则, 榜单地址
   * @keyword-en create-collect-rule, board-endpoint
   */
  @Post('rules')
  @RequirePermission('create', 'HotTopic')
  async createRule(
    @Req() req: AdminRequest,
    @Body() dto: CreateHotTopicRuleDto,
  ) {
    try {
      return {
        rule: await this.ruleService.create(this.requireScope(req), dto),
      };
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  /**
   * @description 更新一条采集规则；改动地址或解析路径后可用性会被重置为未知，需要重新自检。
   * @keyword-cn 更新采集规则, 重置可用性
   * @keyword-en update-collect-rule, reset-health
   */
  @Put('rules/:id')
  @RequirePermission('update', 'HotTopic')
  async updateRule(
    @Req() req: AdminRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHotTopicRuleDto,
  ) {
    try {
      const rule = await this.ruleService.update(
        this.requireScope(req),
        id,
        dto,
      );
      if (!rule) throw new NotFoundException('HOT_TOPIC_RULE_NOT_FOUND');
      return { rule };
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  /**
   * @description 删除一条采集规则；内置规则删掉后可通过初始化预置规则补回。
   * @keyword-cn 删除采集规则, 预置可补回
   * @keyword-en delete-collect-rule, preset-restorable
   */
  @Delete('rules/:id')
  @RequirePermission('delete', 'HotTopic')
  async deleteRule(
    @Req() req: AdminRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const removed = await this.ruleService.remove(this.requireScope(req), id);
    if (!removed) throw new NotFoundException('HOT_TOPIC_RULE_NOT_FOUND');
    return { removed: true };
  }

  /**
   * @description 幂等初始化平台内置的社会热点 / 娱乐热点预置规则，已存在的一条都不覆盖。
   * @keyword-cn 初始化预置规则, 幂等补齐
   * @keyword-en seed-builtin-rules, idempotent-fill
   */
  @Post('rules/seed')
  @RequirePermission('create', 'HotTopic')
  async seedRules(@Req() req: AdminRequest) {
    const result = await this.ruleService.seedPresets(this.requireScope(req));
    return {
      ...result,
      rules: await this.ruleService.list(this.requireScope(req)),
    };
  }

  /**
   * @description 对一条规则做真实采集自检并回写可用性，只跑不落库，不污染榜单数据。
   * @keyword-cn 规则自检接口, 可用性探测
   * @keyword-en rule-check-endpoint, availability-probe
   */
  @Post('rules/:id/check')
  @RequirePermission('update', 'HotTopic')
  async checkRule(
    @Req() req: AdminRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const rule = await this.ruleService.checkRule(this.requireScope(req), id);
    if (!rule) throw new NotFoundException('HOT_TOPIC_RULE_NOT_FOUND');
    return { rule };
  }

  /**
   * @description 触发一次热点采集：默认先清除上一轮历史再采，并在采集后自动做 AI 归类。
   * @keyword-cn 触发热点采集, 默认清除历史
   * @keyword-en trigger-collect, clear-previous-default
   */
  @Post('collect')
  @RequirePermission('create', 'HotTopic')
  async collect(@Req() req: AdminRequest, @Body() dto: CollectHotTopicDto) {
    try {
      return {
        result: await this.collectService.collect(this.requireScope(req), dto),
      };
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  /**
   * @description 对尚未被 AI 归类的条目补跑一次归类。
   * @keyword-cn 补跑归类接口, 未归类条目
   * @keyword-en retag-endpoint, untagged-items
   */
  @Post('retag')
  @RequirePermission('update', 'HotTopic')
  async retag(@Req() req: AdminRequest) {
    return await this.collectService.retagPending(this.requireScope(req));
  }

  /**
   * @description 分页返回当前热点采集榜，支持按分类、来源规则、归类标签与标题关键词过滤。
   * @keyword-cn 榜单列表接口, 分页过滤
   * @keyword-en board-list-endpoint, paged-filter
   */
  @Get('items')
  @RequirePermission('read', 'HotTopic')
  async listItems(
    @Req() req: AdminRequest,
    @Query() query: HotTopicItemQueryDto,
  ) {
    const scope = this.requireScope(req);
    const [page, summary] = await Promise.all([
      this.itemService.list(scope, query),
      this.itemService.summarize(scope),
    ]);
    return { ...page, summary };
  }

  /**
   * @description 清空当前榜单条目，可只清指定规则的历史。
   * @keyword-cn 清空榜单接口, 按规则清除
   * @keyword-en clear-items-endpoint, clear-by-rule
   */
  @Delete('items')
  @RequirePermission('delete', 'HotTopic')
  async clearItems(
    @Req() req: AdminRequest,
    @Body() dto: ClearHotTopicItemDto,
  ) {
    const cleared = await this.itemService.clear(
      this.requireScope(req),
      dto?.ruleIds,
    );
    return { cleared };
  }

  /**
   * @description 线性返回全部 AI 归类标签及其条目数、分类与示例标题，供后台弹窗逐条查看。
   * @keyword-cn 采集标签接口, 线性查看标签
   * @keyword-en collected-tags-endpoint, linear-tag-view
   */
  @Get('tags')
  @RequirePermission('read', 'HotTopic')
  async listTags(@Req() req: AdminRequest) {
    return {
      tags: await this.itemService.listTagSummary(this.requireScope(req)),
    };
  }

  /**
   * @description 按用户母选题推荐当前热点采集榜里适合的热点。结果由 Agent 通过工具逐条写入，
   *  接口返回结构化 JSON，模型最终文本不参与解析。
   * @keyword-cn 热点推荐接口, 母选题匹配, 结构化返回
   * @keyword-en recommend-endpoint, parent-topic-match, structured-response
   */
  @Post('recommend')
  @RequirePermission('read', 'HotTopic')
  async recommend(@Req() req: AdminRequest, @Body() dto: RecommendHotTopicDto) {
    try {
      return await this.recommendService.recommend(this.requireScope(req), dto);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  /**
   * @description 取出当前后台用户并组装数据作用域，未登录按 401 处理。
   * @keyword-cn 当前后台用户, 数据作用域
   * @keyword-en require-admin-user, data-scope
   */
  private requireScope(req: AdminRequest): HotTopicScope {
    const user: AdminUserEntity | undefined = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return {
      ...(user.tenantId ? { tenantId: user.tenantId } : {}),
      userId: user._id.toHexString(),
    };
  }

  /**
   * @description 把服务层的业务错误码翻成带可读中文原因的 400，未知错误原样抛出。
   * @keyword-cn 错误码翻译, 可读原因
   * @keyword-en error-code-mapping, readable-reason
   */
  private toHttpError(error: unknown): Error {
    if (!(error instanceof Error))
      return new BadRequestException(String(error));
    const code = error.message;
    if (code.startsWith('HOT_TOPIC_RULE_ENDPOINT_INVALID:')) {
      return new BadRequestException(
        code.slice('HOT_TOPIC_RULE_ENDPOINT_INVALID:'.length),
      );
    }
    const messages: Record<string, string> = {
      HOT_TOPIC_RULE_NAME_REQUIRED: '规则名称不能为空',
      HOT_TOPIC_RULE_TITLE_PATH_REQUIRED: '标题取值路径不能为空',
      HOT_TOPIC_NO_RUNNABLE_RULE: '没有可执行的采集规则，请先启用至少一条规则',
      HOT_TOPIC_PARENT_TOPIC_REQUIRED: '母选题不能为空',
      HOT_TOPIC_NO_CANDIDATE: '当前热点采集榜没有可用候选，请先执行一次采集',
    };
    if (messages[code]) return new BadRequestException(messages[code]);
    return error;
  }
}
