import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { Response } from 'express';
import {
  ClassifyDouyinStoreVisitSpotsDto,
  ConcatDouyinShotVideosDto,
  CreateDouyinStoreVisitStoreDto,
  DouyinStoreVisitSimilarityDto,
  SaveDouyinStoreVisitSpotsDto,
  UpdateDouyinStoreVisitStoreDto,
  ContinueDouyinStoreVisitDto,
  FailDouyinStoreVisitContinuationDto,
  ConfirmDouyinScriptDraftsDto,
  ReportDouyinConcatResultDto,
  CrawlDouyinDataDto,
  CreateDouyinMotherTopicDto,
  DesignDouyinStoreVisitVoiceDto,
  DouyinStoreVisitVoiceDto,
  MaskDouyinShotFacesDto,
  GenerateDouyinChildrenDto,
  GenerateDouyinShotImageDto,
  GenerateDouyinShotVideoDto,
  GenerateDouyinStoreVisitKeyframeDto,
  GenerateDouyinStoreVisitLinesDto,
  GenerateDouyinStoryboardDto,
  GenerateDouyinStoreVisitVideoDto,
  SaveDouyinStoreVisitVoiceAnchorDto,
  GenerateDouyinVideoDto,
  PublishDouyinVideoDto,
  RecommendDouyinStoreVisitPlanDto,
  RefineDouyinScriptDto,
  UpdateDouyinTopicDto,
} from './douyin-workbench.dto.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinScriptStyle,
} from '../entities/douyin-workbench.entity.js';
import { DouyinOperationService } from '../services/douyin-operation.service.js';
import { DouyinChildTopicGenerationService } from '../services/douyin-child-topic-generation.service.js';
import { DouyinGenerationJobService } from '../services/douyin-generation-job.service.js';
import { DouyinShotConcatService } from '../services/douyin-shot-concat.service.js';
import { DouyinShotImageService } from '../services/douyin-shot-image.service.js';
import {
  DOUYIN_VOICE_ANCHOR_MAX_BYTES,
  DOUYIN_VOICE_SAMPLE_MAX_BYTES,
  DouyinStoreVisitService,
} from '../services/douyin-store-visit.service.js';
import { DouyinStoreVisitPlannerService } from '../services/douyin-store-visit-planner.service.js';
import { DouyinStoreVisitSpotService } from '../services/douyin-store-visit-spot.service.js';
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
    private readonly shotImages: DouyinShotImageService,
    private readonly shotConcat: DouyinShotConcatService,
    private readonly storeVisit: DouyinStoreVisitService,
    private readonly spots: DouyinStoreVisitSpotService,
    private readonly planner: DouyinStoreVisitPlannerService,
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
   * @description 在后台综合母选题、平台 AI 补充提示和用户要求生成候选脚本，立即返回运行中任务；候选在任务结果里，挑选后经 drafts/confirm 入库。
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
        {
          personaId: dto.personaId,
          scriptStyle: dto.scriptStyle as DouyinScriptStyle | undefined,
        },
      ),
    };
  }

  /**
   * @description 返回脚本风格登记表，供前端渲染风格下拉，取值与后端校验同源。
   * @keyword-cn 脚本风格选项接口, 风格登记表
   * @keyword-en script-style-options-api, style-registry
   */
  @Get('script-styles')
  @RequirePermission('read', 'DouyinWorkbench')
  listScriptStyles() {
    return {
      styles: Object.entries(DOUYIN_SCRIPT_STYLES).map(([key, value]) => ({
        key,
        ...value,
      })),
    };
  }

  /**
   * @description 按一句话指令 AI 微调一段口播正文，只返回改写结果，不落库。
   * @keyword-cn 脚本微调接口, 按指令改写
   * @keyword-en refine-script-api, instruction-rewrite
   */
  @Post('script/refine')
  @RequirePermission('update', 'DouyinWorkbench')
  async refineScript(
    @Req() req: AdminRequest,
    @Body() dto: RefineDouyinScriptDto,
  ) {
    return this.childTopics.refineScript(
      dto,
      this.scopeOf(this.requireUser(req)),
    );
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
   * @description 保存用户从子选题任务里挑中的候选脚本及各自配图偏向，并为每条新脚本启动后台分镜任务。
   * @keyword-cn 保存挑选脚本接口, 启动分镜任务
   * @keyword-en confirm-script-drafts-api, start-storyboard-jobs
   */
  @Post('generation-jobs/:jobId/drafts/confirm')
  @RequirePermission('create', 'DouyinWorkbench')
  async confirmScriptDrafts(
    @Req() req: AdminRequest,
    @Param('jobId') jobId: string,
    @Body() dto: ConfirmDouyinScriptDraftsDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const result = await this.generationJobs.confirmDrafts(
      this.readJobId(jobId),
      dto.items,
      scope,
    );
    return {
      ...result,
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 放弃子选题任务生成的全部候选脚本。
   * @keyword-cn 放弃候选脚本接口, 候选已处理
   * @keyword-en discard-script-drafts-api, drafts-settled
   */
  @Post('generation-jobs/:jobId/drafts/discard')
  @RequirePermission('update', 'DouyinWorkbench')
  async discardScriptDrafts(
    @Req() req: AdminRequest,
    @Param('jobId') jobId: string,
  ) {
    await this.generationJobs.discardDrafts(
      this.readJobId(jobId),
      this.scopeOf(this.requireUser(req)),
    );
    return { success: true };
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
   * @description 按分镜的画面描述重新生成这一镜的竖屏配图，新图入图库后直接绑定到该段分镜。
   * @keyword-cn 重新生成分镜画面接口, 文生图配图
   * @keyword-en regenerate-shot-image-api, text-to-image-shot
   */
  @Post('topics/:id/storyboard/:shotId/image/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateShotImage(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body() dto: GenerateDouyinShotImageDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const result = await this.shotImages.regenerate(
      this.readId(id),
      this.readShotId(shotId),
      dto.prompt,
      scope,
    );
    return {
      topic: { ...result.topic, _id: undefined },
      shotId: result.shotId,
      imageId: result.imageId,
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 按所选风格处理这一镜画面里的真人（3D 卡通大头 / 动画大头 / 拟人风格 / AI 去除真人特征，以当前画面为底图做图像编辑），处理前的原图留在分镜上可一键恢复。
   *   火山系视频模型不收带真人的参考图，实拍镜头喂进去之前先过这一道。
   * @keyword-cn 分镜卡通换头接口, 遮挡真人
   * @keyword-en shot-face-mask-api, cover-real-person
   */
  @Post('topics/:id/storyboard/:shotId/image/mask-faces')
  @RequirePermission('create', 'DouyinWorkbench')
  async maskShotFaces(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body() dto: MaskDouyinShotFacesDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const result = await this.shotImages.maskFaces(
      this.readId(id),
      this.readShotId(shotId),
      scope,
      dto.style,
    );
    return {
      topic: { ...result.topic, _id: undefined },
      shotId: result.shotId,
      imageId: result.imageId,
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 把这一镜的画面换回卡通换头前的原图。
   * @keyword-cn 恢复分镜原图接口, 撤销换头
   * @keyword-en restore-shot-image-api, undo-face-mask
   */
  @Post('topics/:id/storyboard/:shotId/image/restore')
  @RequirePermission('update', 'DouyinWorkbench')
  async restoreShotImage(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const result = await this.shotImages.restoreOriginalImage(
      this.readId(id),
      this.readShotId(shotId),
      scope,
    );
    return {
      topic: { ...result.topic, _id: undefined },
      shotId: result.shotId,
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 只为一段分镜创建视频生成任务，调用记录带 shotId 供前端按镜头展示生成历史。
   * @keyword-cn 单镜头视频生成接口, 分镜视频历史
   * @keyword-en generate-shot-video-api, shot-video-history
   */
  @Post('topics/:id/storyboard/:shotId/video/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateShotVideo(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body() dto: GenerateDouyinShotVideoDto,
  ) {
    return await this.operations.createShotGeneration(
      this.readId(id),
      this.readShotId(shotId),
      dto.prompt,
      this.requireUser(req),
    );
  }

  /**
   * @description 准备一次客户端合成：校验每一镜都已出片、写运行中的调用记录，返回按分镜顺序的各镜视频地址，
   *   由桌面端用内置 ffmpeg 合成、直传视频库后经 `operations/:id/concat-result` 回报。`auto` 表示领取「全部出片后自动合成」。
   * @keyword-cn 准备客户端合成接口, 分镜视频地址
   * @keyword-en prepare-client-concat-api, shot-video-urls
   */
  @Post('topics/:id/video/concat')
  @RequirePermission('create', 'DouyinWorkbench')
  async concatShotVideos(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: ConcatDouyinShotVideosDto,
  ) {
    return await this.shotConcat.prepare(
      this.readId(id),
      this.scopeOf(this.requireUser(req)),
      { auto: dto.auto },
    );
  }

  /**
   * @description 桌面端回报客户端合成的进度、结果或失败原因；完成时把成片设为脚本当前整片。
   * @keyword-cn 回报合成结果接口, 设为当前整片
   * @keyword-en report-concat-result-api, bind-merged-video
   */
  @Post('operations/:id/concat-result')
  @RequirePermission('update', 'DouyinWorkbench')
  async reportConcatResult(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: ReportDouyinConcatResultDto,
  ) {
    const operationId = String(id ?? '').trim();
    if (!/^[0-9a-f-]{8,64}$/i.test(operationId))
      throw new BadRequestException('DOUYIN_OPERATION_ID_INVALID');
    return {
      operation: await this.shotConcat.report(
        operationId,
        dto,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 探店模式上传一段录音克隆音色（multipart 字段 `file`，最多 10MB），录音临时传 OSS 交给百炼声音复刻、克隆完即删，音色 ID 写进脚本。
   * @keyword-cn 克隆探店音色接口, 上传录音
   * @keyword-en clone-store-visit-voice-api, upload-voice-sample
   */
  @Post('topics/:id/store-visit/voice')
  @RequirePermission('create', 'DouyinWorkbench')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOUYIN_VOICE_SAMPLE_MAX_BYTES },
    }),
  )
  async cloneStoreVisitVoice(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.storeVisit.cloneVoice(
      this.readId(id),
      file,
      scope,
    );
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 按场景与台词让 AI 写一版探店画外音台词（按场景分段，每段约 60 字内），只返回台词、不落库；选了门店的点位模式按重点推荐点位写，并为每段挑同一点位的 1～3 张参考图。
   * @keyword-cn 探店台词接口, 画外音台词
   * @keyword-en store-visit-lines-api, voiceover-lines
   */
  @Post('topics/:id/store-visit/lines')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitLines(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinStoreVisitLinesDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topicId = this.readId(id);
    // 选了门店的点位模式按点位写台词并为每段挑参考图，旧版逐张选素材的选题照旧
    const topic = await this.repository.get(topicId, scope);
    if (topic?.storeVisit?.storeId)
      return await this.planner.writeSpotLines(topicId, dto.prompt, scope);
    return await this.childTopics.writeStoreVisitLines(
      topicId,
      dto.prompt,
      scope,
    );
  }

  /**
   * @description 探店 AI 编排推荐：按门店与重点推荐点位挑出镜人物（要出镜时）与音色，只返回不落库。
   * @keyword-cn 编排推荐接口, 推荐人物音色
   * @keyword-en plan-recommend-api, recommend-persona-voice
   */
  @Post('topics/:id/store-visit/plan/recommend')
  @RequirePermission('create', 'DouyinWorkbench')
  async recommendStoreVisitPlan(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: RecommendDouyinStoreVisitPlanDto,
  ) {
    return await this.planner.recommend(
      this.readId(id),
      { presenter: dto.presenter },
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 探店模式生成视频：每段生成原生声画，按生视频服务逐段扣费，返回各段调用记录；`voiceAnchor` 为真时第 1 段先出片，其余段等桌面端取出它的声音作参考音色；
   *   `onlyMissing` 为真时只补没出片的段，已出片的不重做也不重复扣费。
   * @keyword-cn 探店视频生成接口, 画外音生成
   * @keyword-en store-visit-video-api, voiceover-generation
   */
  @Post('topics/:id/store-visit/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitVideo(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinStoreVisitVideoDto,
  ) {
    return await this.storeVisit.start(
      this.readId(id),
      this.scopeOf(this.requireUser(req)),
      {
        voiceAnchor: dto.voiceAnchor === true,
        onlyMissing: dto.onlyMissing === true,
      },
    );
  }

  /**
   * @description 上传音色锚点：桌面端从第 1 段出片视频取出的 WAV 声音（multipart 字段 `file`，2～15 秒），后面各段拿它作参考音色。
   * @keyword-cn 音色锚点接口, 统一音色
   * @keyword-en voice-anchor-api, unified-voice
   */
  @Post('topics/:id/store-visit/voice-anchor')
  @RequirePermission('update', 'DouyinWorkbench')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOUYIN_VOICE_ANCHOR_MAX_BYTES },
    }),
  )
  async saveStoreVisitVoiceAnchor(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: SaveDouyinStoreVisitVoiceAnchorDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.storeVisit.saveVoiceAnchor(
      this.readId(id),
      dto,
      file,
      scope,
    );
    return { topic: { ...topic, _id: undefined } };
  }

  /**
   * @description 列出探店音色库：百炼预置音色（名称、特质、性别、风格分类与方言）与风格分类目录。
   * @keyword-cn 音色库接口, 探店音色库
   * @keyword-en preset-voices-api, store-visit-voice-library
   */
  @Get('store-visit/voices')
  @RequirePermission('read', 'DouyinWorkbench')
  listStoreVisitPresetVoices() {
    return {
      voices: this.storeVisit.listPresetVoices(),
      categories: this.storeVisit.listPresetCategories(),
    };
  }

  /**
   * @description 列出当前租户的探店门店与点位。
   * @keyword-cn 门店列表接口, 探店点位
   * @keyword-en store-list-api, store-visit-spots
   */
  @Get('store-visit/stores')
  @RequirePermission('read', 'DouyinWorkbench')
  async listStoreVisitStores(@Req() req: AdminRequest) {
    return {
      stores: await this.spots.listStores(this.scopeOf(this.requireUser(req))),
    };
  }

  /**
   * @description 新建探店门店（同租户同名直接返回已有门店）。
   * @keyword-cn 新建门店接口, 同名去重
   * @keyword-en create-store-api, dedupe-store-name
   */
  @Post('store-visit/stores')
  @RequirePermission('create', 'DouyinWorkbench')
  async createStoreVisitStore(
    @Req() req: AdminRequest,
    @Body() dto: CreateDouyinStoreVisitStoreDto,
  ) {
    return {
      store: await this.spots.createStore(
        dto,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 修改探店门店名称或整体说明。
   * @keyword-cn 修改门店接口, 门店改名
   * @keyword-en update-store-api, rename-store
   */
  @Patch('store-visit/stores/:storeId')
  @RequirePermission('update', 'DouyinWorkbench')
  async updateStoreVisitStore(
    @Req() req: AdminRequest,
    @Param('storeId') storeId: string,
    @Body() dto: UpdateDouyinStoreVisitStoreDto,
  ) {
    return {
      store: await this.spots.updateStore(
        this.readId(storeId),
        dto,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 删除探店门店与它的点位（图库图片保留）。
   * @keyword-cn 删除门店接口, 保留图库
   * @keyword-en delete-store-api, keep-gallery
   */
  @Delete('store-visit/stores/:storeId')
  @RequirePermission('delete', 'DouyinWorkbench')
  async deleteStoreVisitStore(
    @Req() req: AdminRequest,
    @Param('storeId') storeId: string,
  ) {
    return await this.spots.deleteStore(
      this.readId(storeId),
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 整体保存门店点位，描述写回图库备注，高分图自动收藏。
   * @keyword-cn 保存点位接口, 图库备注收藏
   * @keyword-en save-spots-api, gallery-note-favorite
   */
  @Put('store-visit/stores/:storeId/spots')
  @RequirePermission('update', 'DouyinWorkbench')
  async saveStoreVisitSpots(
    @Req() req: AdminRequest,
    @Param('storeId') storeId: string,
    @Body() dto: SaveDouyinStoreVisitSpotsDto,
  ) {
    return {
      store: await this.spots.saveSpots(
        this.readId(storeId),
        dto.spots,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 相似度预归类：按图片视觉签名把相似的图先分到一组。
   * @keyword-cn 相似度预归类接口, 图片相似度
   * @keyword-en similarity-api, image-similarity
   */
  @Post('store-visit/stores/:storeId/similarity')
  @RequirePermission('read', 'DouyinWorkbench')
  async storeVisitSpotSimilarity(
    @Req() req: AdminRequest,
    @Param('storeId') storeId: string,
    @Body() dto: DouyinStoreVisitSimilarityDto,
  ) {
    return await this.spots.similarity(
      this.readId(storeId),
      dto.imageIds,
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description AI 归类一批图片到点位，写描述并打分，不落库；按 NDJSON 逐行推送（模型每调用一次归类工具推一行 `spot` / `assign`，结束推 `done`，出错推 `error`），前端断开时中止模型。
   * @keyword-cn AI归类接口, 看图归类
   * @keyword-en classify-spots-api, vision-classification
   */
  @Post('store-visit/stores/:storeId/classify')
  @RequirePermission('create', 'DouyinWorkbench')
  async classifyStoreVisitSpots(
    @Req() req: AdminRequest,
    @Param('storeId') storeId: string,
    @Body() dto: ClassifyDouyinStoreVisitSpotsDto,
    @Res() res: Response,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const id = this.readId(storeId);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const write = (event: unknown) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await this.spots.classify(id, dto, scope, write, abort.signal);
    } catch (error) {
      write({
        type: 'error',
        message: error instanceof Error ? error.message : 'AI 归类失败，请重试',
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * @description 按一段声音描述定制音色（百炼声音设计），写进脚本并返回当前租户工作台。
   * @keyword-cn 提示词定制音色接口, 声音设计
   * @keyword-en design-voice-api, voice-design
   */
  @Post('topics/:id/store-visit/voice/design')
  @RequirePermission('create', 'DouyinWorkbench')
  async designStoreVisitVoice(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: DesignDouyinStoreVisitVoiceDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.storeVisit.designVoice(
      this.readId(id),
      { prompt: dto.prompt, name: dto.name },
      scope,
    );
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 选用音色库里的一个百炼预置音色作为脚本的音色，并返回当前租户工作台。
   * @keyword-cn 选用系统音色接口, 保存预置音色
   * @keyword-en use-preset-voice-api, save-preset-voice
   */
  @Post('topics/:id/store-visit/voice/preset')
  @RequirePermission('update', 'DouyinWorkbench')
  async useStoreVisitPresetVoice(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: DouyinStoreVisitVoiceDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.storeVisit.usePresetVoice(
      this.readId(id),
      dto.voiceId,
      scope,
    );
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 合成一句音色试听（音色库预置音色或这条脚本克隆、定制的音色），返回试听地址。
   * @keyword-cn 音色试听接口, 合成试听
   * @keyword-en voice-preview-api, synthesize-trial
   */
  @Post('topics/:id/store-visit/voice/preview')
  @RequirePermission('read', 'DouyinWorkbench')
  async previewStoreVisitVoice(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: DouyinStoreVisitVoiceDto,
  ) {
    return await this.storeVisit.previewVoice(
      this.readId(id),
      dto.voiceId,
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 为人物出镜的一段生成首帧（出镜人物放进这段场景，按「分镜画面」节点生图计费），写进分段并返回脚本、首帧与工作台。
   * @keyword-cn 人物首帧接口, 人物进场景
   * @keyword-en segment-keyframe-api, person-in-scene
   */
  @Post('topics/:id/store-visit/segments/:segmentId/keyframe')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitKeyframe(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('segmentId') segmentId: string,
    @Body() dto: GenerateDouyinStoreVisitKeyframeDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const result = await this.storeVisit.generateKeyframe(
      this.readId(id),
      this.readSegmentId(segmentId),
      dto.prompt,
      scope,
    );
    return {
      topic: { ...result.topic, _id: undefined },
      segmentId: result.segmentId,
      keyframe: result.keyframe,
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 重新生成探店某一段（及接它尾帧的续段），按生视频服务扣费，返回这一段的调用记录；`voiceAnchor` 为真时用第 1 段的声音统一音色。
   * @keyword-cn 重新生成探店分段接口, 单段重做
   * @keyword-en regenerate-store-visit-segment-api, single-segment-retry
   */
  @Post('topics/:id/store-visit/segments/:segmentId/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitSegment(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('segmentId') segmentId: string,
    @Body() dto: GenerateDouyinStoreVisitVideoDto,
  ) {
    return await this.storeVisit.startOne(
      this.readId(id),
      this.readSegmentId(segmentId),
      this.scopeOf(this.requireUser(req)),
      { voiceAnchor: dto.voiceAnchor === true },
    );
  }

  /** @description 校验当前用户权限并用上一段实际尾帧继续生成待处理片段。 @keyword-cn 续段生成接口, 尾帧衔接 @keyword-en continue-segment-api, tail-frame-continuity */
  @Post('operations/:operationId/store-visit/continue')
  @RequirePermission('create', 'DouyinWorkbench')
  async continueStoreVisitSegment(@Req() req: AdminRequest, @Param('operationId') operationId: string, @Body() dto: ContinueDouyinStoreVisitDto) {
    return this.storeVisit.continueOperation(operationId, dto, this.scopeOf(this.requireUser(req)));
  }

  /** @description 截取尾帧或上传失败时，只终止当前用户尚在等待的调用，不覆盖已开始生成的任务。 @keyword-cn 续段失败接口, 等待状态保护 @keyword-en continuation-failure-api, waiting-state-guard */
  @Post('operations/:operationId/store-visit/continuation-failure')
  @RequirePermission('update', 'DouyinWorkbench')
  async failStoreVisitContinuation(@Req() req: AdminRequest, @Param('operationId') operationId: string, @Body() dto: FailDouyinStoreVisitContinuationDto) {
    return this.storeVisit.failPendingContinuation(operationId, dto.error, this.scopeOf(this.requireUser(req)));
  }

  /** @description 读取待衔接片段的真实前段素材，权限和素材归属同时校验。 @keyword-cn 续段素材接口, 前段视频鉴权 @keyword-en continuation-input-api, predecessor-video-auth */
  @Get('operations/:operationId/store-visit/continuation-input')
  @RequirePermission('read', 'DouyinWorkbench')
  async readStoreVisitContinuationInput(@Req() req: AdminRequest, @Param('operationId') operationId: string) {
    return this.storeVisit.readContinuationInput(operationId, this.scopeOf(this.requireUser(req)));
  }

  /**
   * @description 读取整片 / 分镜视频节点的通道、模型与可选时长。
   * @keyword-cn 视频生成选项接口, 可选时长
   * @keyword-en video-generation-options-api, duration-choices
   */
  @Get('video/options')
  @RequirePermission('read', 'DouyinWorkbench')
  async videoOptions() {
    return this.operations.getVideoOptions();
  }

  /**
   * @description 代理下载一条视频库视频（整片或分镜成片），以附件形式返回，前端不受视频域名跨域限制。
   * @keyword-cn 下载视频接口, 代理下载
   * @keyword-en download-video-api, proxy-download
   */
  @Get('videos/:videoId/download')
  @RequirePermission('read', 'DouyinWorkbench')
  async downloadVideo(
    @Req() req: AdminRequest,
    @Param('videoId') videoId: string,
    @Res() res: Response,
  ) {
    const file = await this.operations.openVideoDownload(
      this.readId(videoId),
      this.requireUser(req),
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    if (file.size) res.setHeader('Content-Length', String(file.size));
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
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
   * @description 解析并校验路由中的探店分段 ID（字母数字、下划线、短横线，最多 40 位）。
   * @keyword-cn 解析探店分段ID, 路由校验
   * @keyword-en parse-segment-id, route-validation
   */
  private readSegmentId(value: string): string {
    const id = String(value ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id))
      throw new BadRequestException('DOUYIN_STORE_VISIT_SEGMENT_ID_INVALID');
    return id;
  }

  /**
   * @description 解析并校验路由中的分镜段落 ID。
   * @keyword-cn 解析分镜ID, 路由校验
   * @keyword-en parse-shot-id, route-validation
   */
  private readShotId(value: string): string {
    const shotId = String(value ?? '').trim();
    if (!shotId || shotId.length > 80)
      throw new BadRequestException('DOUYIN_STORYBOARD_SHOT_ID_INVALID');
    return shotId;
  }

  /**
   * @description 解析并校验路由中的生成任务 ID（UUID）。
   * @keyword-cn 解析生成任务ID, 路由校验
   * @keyword-en parse-generation-job-id, route-validation
   */
  private readJobId(value: string): string {
    const jobId = String(value ?? '').trim();
    if (!/^[0-9a-f-]{8,64}$/i.test(jobId))
      throw new BadRequestException('DOUYIN_GENERATION_JOB_ID_INVALID');
    return jobId;
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
