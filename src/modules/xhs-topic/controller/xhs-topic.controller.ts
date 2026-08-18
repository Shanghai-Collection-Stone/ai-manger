import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
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
  CreateXhsTopicsDto,
  DeleteXhsTopicsDto,
  GenerateXhsArticleDto,
  GenerateXhsTopicDto,
  RecommendXhsTopicPromptDto,
  UpdateXhsArticleDto,
  UpdateXhsTopicDto,
} from './xhs-topic.dto.js';
import {
  describeXhsArticleError,
  XhsArticleGenerationService,
} from '../services/xhs-article-generation.service.js';
import { XhsTopicService } from '../services/xhs-topic.service.js';
import { XhsTopicRepositoryService } from '../services/xhs-topic-repository.service.js';

/**
 * @description 小红书 AI 选题接口，返回携带结构化 taskResult 的 Todo。
 * @keyword-cn 小红书选题接口, 待办返回
 * @keyword-en xhs-topic-controller, todo-response
 */
@Controller('api/xhs-topic')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class XhsTopicController {
  constructor(
    private readonly xhsTopicService: XhsTopicService,
    private readonly articleGenerationService: XhsArticleGenerationService,
    private readonly repository: XhsTopicRepositoryService,
  ) {}

  /**
   * @description 根据当前母题生成一条可编辑的子选题推荐提示词。
   * @keyword-cn 推荐子选题提示词, 母题上下文
   * @keyword-en recommend-child-topic-prompt, parent-topic-context
   */
  @Post('prompt/recommend')
  @RequirePermission('create', 'XhsTopic')
  async recommendPrompt(
    @Req() req: AdminRequest,
    @Body() dto: RecommendXhsTopicPromptDto,
  ) {
    const user = this.requireUser(req);
    return await this.xhsTopicService.recommendPrompt(dto.parentTopic, {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    });
  }

  /**
   * @description 返回当前租户用户已入库的真实母选题及子选题工作台数据。
   * @keyword-cn 查询真实选题, 母子列表
   * @keyword-en list-persisted-topics, workspace-list
   */
  @Get()
  @RequirePermission('read', 'XhsTopic')
  async list(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    return {
      groups: await this.repository.listWorkspace({
        tenantId: user.tenantId,
        userId: user._id.toHexString(),
      }),
    };
  }

  /**
   * @description 批量保存弹窗中确认的母选题或子选题，并返回刷新后的真实工作台。
   * @keyword-cn 保存真实选题, 批量创建
   * @keyword-en persist-selected-topics, bulk-create
   */
  @Post()
  @RequirePermission('create', 'XhsTopic')
  async create(@Req() req: AdminRequest, @Body() dto: CreateXhsTopicsDto) {
    if (dto.kind === 'child' && !dto.parentId) {
      throw new BadRequestException('XHS_TOPIC_PARENT_REQUIRED');
    }
    const user = this.requireUser(req);
    const scope = {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    };
    try {
      const created = await this.repository.createMany(dto, scope);
      return {
        created: created.map((entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          userId: entity.userId,
          kind: entity.kind,
          parentId: entity.parentId,
          title: entity.title,
          topicType: entity.topicType,
          status: entity.status,
          sourceTodoId: entity.sourceTodoId,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        })),
        groups: await this.repository.listWorkspace(scope),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }
  }

  /**
   * @description 批量删除当前用户选题，母题删除时级联清理子题并返回真实工作台。
   * @keyword-cn 删除真实选题, 级联删除
   * @keyword-en delete-persisted-topics, cascade-delete
   */
  @Delete()
  @RequirePermission('delete', 'XhsTopic')
  async remove(@Req() req: AdminRequest, @Body() dto: DeleteXhsTopicsDto) {
    const user = this.requireUser(req);
    const scope = {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    };
    return {
      deletedCount: await this.repository.deleteMany(dto.ids, scope),
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 修改真实选题的标题、类型或状态，并返回刷新后的工作台。
   * @keyword-cn 更新真实选题, 发布状态
   * @keyword-en update-persisted-topic, publish-status
   */
  @Patch(':id')
  @RequirePermission('update', 'XhsTopic')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateXhsTopicDto,
  ) {
    const topicId = Number(id);
    if (!Number.isInteger(topicId) || topicId < 1) {
      throw new BadRequestException('XHS_TOPIC_ID_INVALID');
    }
    const user = this.requireUser(req);
    const scope = {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    };
    const topic = await this.repository.update(topicId, dto, scope);
    if (!topic) throw new BadRequestException('XHS_TOPIC_NOT_FOUND');
    return {
      topic: {
        id: topic.id,
        kind: topic.kind,
        parentId: topic.parentId,
        title: topic.title,
        topicType: topic.topicType,
        status: topic.status,
        sourceTodoId: topic.sourceTodoId,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt,
      },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 汇总当前用户每个子选题最近一次文章生成任务的状态，供前端轮询进度与失败原因。
   * @keyword-cn 文章生成状态接口, 逐条进度
   * @keyword-en article-generation-state-api, per-topic-progress
   */
  @Get('article/generations')
  @RequirePermission('read', 'XhsTopic')
  async listArticleGenerations(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    return {
      generations: await this.articleGenerationService.listGenerations({
        tenantId: user.tenantId,
        userId: user._id.toHexString(),
      }),
    };
  }

  /**
   * @description 为指定子选题异步启动文章生成，立即返回 in_progress 的 Todo，进度与失败原因由状态接口轮询。
   * @keyword-cn 生成真实文章接口, 异步生成文章, 并发生成
   * @keyword-en generate-persisted-article-api, start-article-generation, concurrent-generation
   */
  @Post(':id/article/generate')
  @RequirePermission('create', 'XhsTopic')
  async generateArticle(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateXhsArticleDto,
  ) {
    const topicId = Number(id);
    if (!Number.isInteger(topicId) || topicId < 1) {
      throw new BadRequestException('XHS_TOPIC_ID_INVALID');
    }
    const user = this.requireUser(req);
    try {
      const response = await this.articleGenerationService.start(topicId, dto, {
        tenantId: user.tenantId,
        userId: user._id.toHexString(),
      });
      return { todo: { ...response.todo, _id: undefined } };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        code,
        message: describeXhsArticleError(code),
      });
    }
  }

  /**
   * @description 修改当前用户已生成文章的真实内容、标签、配图或内容形式。
   * @keyword-cn 更新真实文章接口, 文章配图
   * @keyword-en update-persisted-article-api, article-images
   */
  @Patch(':id/article')
  @RequirePermission('update', 'XhsTopic')
  async updateArticle(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateXhsArticleDto,
  ) {
    const topicId = Number(id);
    if (!Number.isInteger(topicId) || topicId < 1) {
      throw new BadRequestException('XHS_TOPIC_ID_INVALID');
    }
    const user = this.requireUser(req);
    const scope = {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    };
    const topic = await this.repository.updateArticle(topicId, dto, scope);
    if (!topic) throw new BadRequestException('XHS_ARTICLE_NOT_FOUND');
    return { groups: await this.repository.listWorkspace(scope) };
  }

  /**
   * @description 生成母选题或子选题候选，并等待生成结果写入 Todo 后返回。
   * @keyword-cn 生成选题接口, 待办结果
   * @keyword-en generate-topic-api, todo-result
   */
  @Post('generate')
  @RequirePermission('create', 'XhsTopic')
  async generate(@Req() req: AdminRequest, @Body() dto: GenerateXhsTopicDto) {
    const user = this.requireUser(req);
    const response = await this.xhsTopicService.generate(dto, {
      tenantId: user.tenantId,
      userId: user._id.toHexString(),
    });
    return {
      todo: {
        ...response.todo,
        _id: undefined,
      },
    };
  }

  /**
   * @description 从鉴权请求读取当前后台用户，缺失时拒绝生成。
   * @keyword-cn 读取后台用户, 鉴权上下文
   * @keyword-en read-admin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
