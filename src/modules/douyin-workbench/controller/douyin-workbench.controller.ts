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
  ConcatDouyinShotVideosDto,
  ConfirmDouyinScriptDraftsDto,
  ReportDouyinConcatResultDto,
  CrawlDouyinDataDto,
  CreateDouyinMotherTopicDto,
  DesignDouyinStoreVisitVoiceDto,
  MaskDouyinShotFacesDto,
  GenerateDouyinChildrenDto,
  GenerateDouyinShotImageDto,
  GenerateDouyinShotVideoDto,
  GenerateDouyinStoreVisitKeyframeDto,
  GenerateDouyinStoreVisitLinesDto,
  GenerateDouyinStoreVisitVideoDto,
  GenerateDouyinStoryboardDto,
  GenerateDouyinVideoDto,
  PublishDouyinVideoDto,
  RefineDouyinScriptDto,
  UpdateDouyinTopicDto,
  UseDouyinStoreVisitPresetVoiceDto,
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
  DOUYIN_VOICE_SAMPLE_MAX_BYTES,
  DouyinStoreVisitService,
} from '../services/douyin-store-visit.service.js';
import { DouyinStoreVisitShuyanService } from '../services/douyin-store-visit-shuyan.service.js';
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
    private readonly storeVisitSegments: DouyinStoreVisitShuyanService,
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
   * @description 探店模式上传一段录音克隆音色（multipart 字段 `file`，最多 10MB），音色 ID 写进脚本，录音本身只转交克隆服务不落盘。
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
   * @description 用文字描述设计音色，成功后保存音色与可选试听，并返回当前租户工作台。
   * @keyword-cn 声音设计接口, 探店音色
   * @keyword-en design-store-visit-voice-api, store-visit-voice
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
      dto,
      scope,
    );
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 按脚本正文让 AI 写一版探店台词（出镜人第一人称口播），只返回台词、不落库。
   * @keyword-cn 探店台词接口, 数字人台词
   * @keyword-en store-visit-lines-api, digital-human-lines
   */
  @Post('topics/:id/store-visit/lines')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitLines(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: GenerateDouyinStoreVisitLinesDto,
  ) {
    return await this.childTopics.writeStoreVisitLines(
      this.readId(id),
      dto.prompt,
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 探店模式生成视频：保存台词后把出镜人脸、克隆音色、台词与分镜画面交给数字人服务，按生视频服务扣费，返回调用记录。
   * @keyword-cn 探店视频生成接口, 数字人生视频
   * @keyword-en store-visit-video-api, digital-human-video
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
      dto,
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 列出数眼可灵音色库（「探店数字人视频」节点选了数眼智能时可用），供探店音色步骤试听挑选。
   * @keyword-cn 可灵音色库接口, 预置音色列表
   * @keyword-en kling-preset-voices-api, preset-voice-list
   */
  @Get('store-visit/voices')
  @RequirePermission('read', 'DouyinWorkbench')
  async listStoreVisitPresetVoices() {
    return { voices: await this.storeVisitSegments.listPresetVoices() };
  }

  /**
   * @description 选用可灵音色库里的一个音色作为脚本的固定音色，并返回当前租户工作台。
   * @keyword-cn 选用可灵音色接口, 保存预置音色
   * @keyword-en use-kling-preset-voice-api, save-preset-voice
   */
  @Post('topics/:id/store-visit/voice/preset')
  @RequirePermission('update', 'DouyinWorkbench')
  async useStoreVisitPresetVoice(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: UseDouyinStoreVisitPresetVoiceDto,
  ) {
    const scope = this.scopeOf(this.requireUser(req));
    const topic = await this.storeVisitSegments.usePresetVoice(
      this.readId(id),
      dto,
      scope,
    );
    return {
      topic: { ...topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 为探店某一段生成「人物在这个场景里」的关键帧（按分镜画面节点的生图模型扣费），返回关键帧、更新后的脚本与当前租户工作台。
   * @keyword-cn 探店关键帧接口, 人物进场景
   * @keyword-en store-visit-keyframe-api, person-in-scene
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
    const result = await this.storeVisitSegments.generateKeyframe(
      this.readId(id),
      this.readSegmentId(segmentId),
      dto.prompt,
      scope,
    );
    return {
      ...result,
      topic: { ...result.topic, _id: undefined },
      groups: await this.repository.listWorkspace(scope),
    };
  }

  /**
   * @description 重新生成探店某一段的对口型视频（数眼通道），按生视频服务扣费，返回这一段的调用记录。
   * @keyword-cn 重新生成探店分段接口, 单段重做
   * @keyword-en regenerate-store-visit-segment-api, single-segment-retry
   */
  @Post('topics/:id/store-visit/segments/:segmentId/generate')
  @RequirePermission('create', 'DouyinWorkbench')
  async generateStoreVisitSegment(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('segmentId') segmentId: string,
  ) {
    return await this.storeVisitSegments.startOne(
      this.readId(id),
      this.readSegmentId(segmentId),
      this.scopeOf(this.requireUser(req)),
    );
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
