import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import {
  CrawlDouyinDataDto,
  CreateDouyinMotherTopicDto,
  GenerateDouyinChildrenDto,
  GenerateDouyinStoryboardDto,
  GenerateDouyinVideoDto,
  PublishDouyinVideoDto,
  UpdateDouyinTopicDto,
} from './douyin-workbench.dto.js';
import { DouyinOperationService } from '../services/douyin-operation.service.js';
import { DouyinChildTopicGenerationService } from '../services/douyin-child-topic-generation.service.js';
import { DouyinGenerationJobService } from '../services/douyin-generation-job.service.js';
import { DouyinWorkbenchRepositoryService } from '../services/douyin-workbench-repository.service.js';

/**
 * @description 抖音母子选题、分镜、视频生成、发布和抓取的鉴权 HTTP 接口。
 * @keyword-cn 抖音工作台接口, 真实业务接口
 * @keyword-en douyin-workbench-controller, real-business-api
 */
@Controller('api/douyin-workbench')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinWorkbenchController {
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly childTopics: DouyinChildTopicGenerationService,
    private readonly generationJobs: DouyinGenerationJobService,
    private readonly operations: DouyinOperationService,
  ) {}

  /**
   * @description 查询当前用户真实母子选题与持久化分镜。
   * @keyword-cn 查询抖音工作台, 分镜列表
   * @keyword-en get-douyin-workspace, storyboard-list
   */
  @Get()
  @RequirePermission('read', 'DouyinWorkbench')
  async list(@Req() req: AdminRequest) {
    const user = this.requireUser(req);
    return { groups: await this.repository.listWorkspace(this.scopeOf(user)) };
  }

  /**
   * @description 人工新建真实抖音母选题并返回刷新后的工作台。
   * @keyword-cn 新建抖音母题接口, 返回工作台
   * @keyword-en create-douyin-mother-api, return-workspace
   */
  @Post('topics')
  @RequirePermission('create', 'DouyinWorkbench')
  async create(
    @Req() req: AdminRequest,
    @Body() dto: CreateDouyinMotherTopicDto,
  ) {
    const user = this.requireUser(req);
    const scope = this.scopeOf(user);
    const topic = await this.repository.create(dto, scope);
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 在后台综合母选题、平台 AI 补充提示和用户要求生成并保存短视频子选题，立即返回运行中任务，进度走任务轮询。
   * @keyword-cn AI生成抖音子题接口, 平台提示词
   * @keyword-en generate-douyin-children-api, platform-ai-prompt
   */
  @Post('topics/:id/children/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateChildren(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinChildrenDto,
  ) {
    return {
      job: await this.generationJobs.start(
        'children',
        this.readId(id),
        dto.prompt,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 查询当前用户运行中与最近 24 小时的分镜 / 子选题后台生成任务，前端据此渲染进度条。
   * @keyword-cn 查询生成任务接口, 进度轮询
   * @keyword-en list-generation-jobs-api, progress-polling
   */
  @Get('generation-jobs')
  @RequirePermission('read', 'DouyinWorkbench')
  async listGenerationJobs(@Req() req: AdminRequest) {
    return {
      jobs: await this.generationJobs.list(this.scopeOf(this.requireUser(req))),
    };
  }

  /**
   * @description 根据母选题与平台 AI 提示词推荐一条可编辑的短视频子题生成要求。
   * @keyword-cn 推荐抖音子题提示接口, AI生成要求
   * @keyword-en recommend-douyin-child-prompt-api, ai-generation-requirement
   */
  @Post('topics/:id/children/prompt/recommend')
  @RequirePermission('create', 'DouyinWorkbench')
  async recommendChildPrompt(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return await this.childTopics.recommendPrompt(
      this.readId(id),
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 更新真实选题、分镜或最终视频素材绑定。
   * @keyword-cn 更新抖音选题接口, 保存分镜接口
   * @keyword-en update-douyin-topic-api, save-storyboard-api
   */
  @Patch('topics/:id')
  @RequirePermission('update', 'DouyinWorkbench')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDouyinTopicDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.repository.update(this.readId(id), dto, scope);
    if (!topic) throw new BadRequestException('DOUYIN_TOPIC_NOT_FOUND');
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 删除选题并在删除母题时级联清理子题。
   * @keyword-cn 删除抖音选题接口, 级联清理
   * @keyword-en delete-douyin-topic-api, cascade-cleanup
   */
  @Delete('topics/:id')
  @RequirePermission('delete', 'DouyinWorkbench')
  async remove(@Req() req: AdminRequest, @Param('id') id: string) {
    const scope = this.scopeOf(this.requireUser(req));
    return {
      deletedCount: await this.repository.remove(this.readId(id), scope),
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 在后台调用真实 LLM 为子选题生成并持久化逐段分镜，立即返回运行中任务，进度走任务轮询。
   * @keyword-cn 生成抖音分镜接口, 真实LLM
   * @keyword-en generate-douyin-storyboard-api, real-llm
   */
  @Post('topics/:id/storyboard/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoryboard(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinStoryboardDto,
  ) {
    return {
      job: await this.generationJobs.start(
        'storyboard',
        this.readId(id),
        dto.prompt,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 按已保存分镜创建真实视频生成任务并进行服务级扣费。
   * @keyword-cn 生成视频任务接口, 服务扣费
   * @keyword-en generate-video-task-api, service-charge
   */
  @Post('topics/:id/video/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateVideo(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinVideoDto,
  ) {
    return await this.operations.createGeneration(
      this.readId(id),
      dto.prompt,
      this.requireUser(req),
    );
  }

  /**
   * @description 用真实视频库素材创建抖音发布任务。
   * @keyword-cn 发布抖音视频接口, 真实视频素材
   * @keyword-en publish-douyin-video-api, real-video-asset
   */
  @Post('topics/:id/publish')
  @RequirePermission('create', 'DouyinWorkbench')
  async publish(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: PublishDouyinVideoDto,
  ) {
    return await this.operations.createPublish(
      this.readId(id),
      dto,
      this.requireUser(req),
    );
  }

  /**
   * @description 对真实抖音作品 ID 创建数据抓取任务。
   * @keyword-cn 抓取抖音数据接口, 真实作品
   * @keyword-en crawl-douyin-data-api, real-published-video
   */
  @Post('topics/:id/crawl')
  @RequirePermission('create', 'DouyinWorkbench')
  async crawl(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: CrawlDouyinDataDto,
  ) {
    return await this.operations.createCrawl(
      this.readId(id),
      dto.platformVideoId,
      this.requireUser(req),
    );
  }

  /**
   * @description 查询视频生成、发布、抓取直连接口的真实状态与供应商响应。
   * @keyword-cn 查询抖音任务接口, 供应商响应
   * @keyword-en list-douyin-operations-api, provider-response
   */
  @Get('operations')
  @RequirePermission('read', 'DouyinWorkbench')
  async listOperations(@Req() req: AdminRequest) {
    return {
      operations: await this.operations.list(
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 从直连供应商状态接口同步一次异步业务调用。
   * @keyword-cn 同步抖音任务接口, 供应商状态
   * @keyword-en sync-douyin-operation-api, provider-status
   */
  @Post('operations/:id/sync')
  @RequirePermission('update', 'DouyinWorkbench')
  async syncOperation(@Req() req: AdminRequest, @Param('id') id: string) {
    return { operation: await this.operations.sync(id, this.requireUser(req)) };
  }

  /**
   * @description 解析并校验路由中的正整数业务 ID。
   * @keyword-cn 解析抖音业务ID, 路由校验
   * @keyword-en parse-douyin-business-id, route-validation
   */
  private readId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1)
      throw new BadRequestException('DOUYIN_TOPIC_ID_INVALID');
    return id;
  }

  /**
   * @description 从鉴权请求读取当前后台用户。
   * @keyword-cn 读取抖音用户, 鉴权上下文
   * @keyword-en read-douyin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把当前用户转换成仓储使用的租户用户作用域。
   * @keyword-cn 构造抖音作用域, 用户边界
   * @keyword-en build-douyin-scope, user-boundary
   */
  private scopeOf(user: AdminUserEntity) {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }
}
