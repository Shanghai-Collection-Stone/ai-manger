import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
} from '../entities/douyin-workbench.entity.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 客户端合成记录 30 分钟没有回报进度（客户端关闭、断网）即判定中断。
 * @keyword-cn 合成中断判定, 静默超时
 * @keyword-en concat-stale-threshold, silent-timeout
 */
export const DOUYIN_SHOT_CONCAT_STALE_MS = 30 * 60 * 1000;

/**
 * @description 分镜仍在生成或保存时禁止领取合成，避免把上一版视频合入成片。
 * @keyword-cn 生成中状态, 自动合成等待
 * @keyword-en running-operation-statuses, auto-concat-wait
 */
export const DOUYIN_RUNNING_OPERATION_STATUSES = [
  'pending',
  'accepted',
  'queued',
  'submitted',
  'processing',
  'running',
  'saving',
];

/**
 * @description 交给客户端合成的一段分镜视频：镜号、视频库 ID、下载地址与分镜时长（探测不到时长时兜底）。
 * @keyword-cn 合成片段, 分镜视频地址
 * @keyword-en concat-clip, shot-video-url
 */
export interface DouyinConcatClip {
  shotId: string;
  shotIndex: number;
  videoId: number;
  url: string;
  fallbackSeconds: number;
}

/**
 * @description 客户端回报的合成结果：进行中（进度）、完成（已上传登记的视频库 ID）或失败（中文原因与原始信息）。
 * @keyword-cn 合成结果回报, 客户端回报
 * @keyword-en concat-result-report, client-report
 */
export interface DouyinConcatReport {
  status: 'running' | 'completed' | 'failed';
  progress?: number;
  videoId?: number;
  error?: string;
  errorDetail?: string;
}

/**
 * @description 分镜视频合成（客户端执行）：服务端不跑 ffmpeg，只负责校验每一镜都已出片、写一条运行中的调用记录（`provider=client`、`mode=concat`）
 *   并把各镜视频地址交给桌面端；桌面端用内置 ffmpeg 合成、直传视频库后回报结果，服务端再把成片设为脚本当前整片。
 *   「全部出片后自动合成」由桌面端发现条件满足后带 `auto` 来领，`claimAutoConcat` 保证多个客户端同时在线也只合成一次。
 * @keyword-cn 分镜视频合成, 客户端合成, 自动合成
 * @keyword-en shot-video-concat, client-side-merge, auto-concat
 */
@Injectable()
export class DouyinShotConcatService {
  private readonly operations: Collection<DouyinOperationEntity>;

  /**
   * @description 初始化客户端合成记录集合与租户素材仓储。
   * @keyword-cn 初始化合成服务, 合成仓储
   * @keyword-en init-concat-service, concat-repository
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 准备一次客户端合成：每一镜（探店模式按分段）都要已出片、同一脚本没有正在进行的合成；`auto` 时先原子领走「全部出片后自动合成」标记
   *   （领不到说明已被别的客户端处理或已取消），手动合成顺带清掉标记。写运行中的调用记录并返回按顺序的片段。
   * @keyword-cn 准备客户端合成, 合成前校验
   * @keyword-en prepare-client-concat, concat-precheck
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {{auto?: boolean}} [options] `auto` 表示客户端发现条件满足后自动发起。
   * @returns {Promise<{operation: DouyinOperationView, clips: DouyinConcatClip[]}>} 调用记录与片段。
   * @throws {BadRequestException} 脚本不存在、没有分镜或还有分镜（分段）没出片。
   * @throws {ConflictException} 正在合成，或自动合成标记已被领走。
   */
  async prepare(
    topicId: number,
    scope: DouyinScope,
    options: { auto?: boolean } = {},
  ): Promise<{ operation: DouyinOperationView; clips: DouyinConcatClip[] }> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    const segments =
      topic.productionMode === 'store-visit'
        ? (topic.storeVisit?.segments ?? [])
        : [];
    const bySegments = segments.length > 0;
    const unit = bySegments ? '段' : '镜';
    // 探店分段按台词字数估时长（约 4.5 字/秒），探测不到视频时长时兜底
    const shots: Array<{ id: string; videoId?: number; duration: number }> =
      bySegments
        ? segments.map((segment) => ({
            id: segment.id,
            videoId: segment.videoId,
            duration: Math.max(2, Math.round(segment.lines.length / 4.5)),
          }))
        : (topic.storyboard ?? []);
    if (!shots.length)
      throw new BadRequestException('DOUYIN_STORYBOARD_REQUIRED');
    const missing = shots
      .map((shot, index) => (shot.videoId ? 0 : index + 1))
      .filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(
        bySegments
          ? `还有第 ${missing.join('、')} 段探店视频没有出片，全部出片后才能合成`
          : `还有第 ${missing.join('、')} 镜没有分镜视频，全部出片后才能合成`,
      );
    }
    await this.settleStale();
    const running = await this.operations.findOne({
      topicId,
      provider: 'client',
      mode: 'concat',
      status: 'running',
      userId: scope.userId,
      ...this.tenantFilter(scope.tenantId),
    });
    if (running)
      throw new ConflictException('这条脚本的分镜视频正在合成，完成后再试');
    const generating = await this.operations.findOne({
      topicId,
      operation: 'generate',
      ...(bySegments
        ? { segmentId: { $in: shots.map((shot) => shot.id) } }
        : { shotId: { $in: shots.map((shot) => shot.id) } }),
      status: { $in: DOUYIN_RUNNING_OPERATION_STATUSES },
      userId: scope.userId,
      ...this.tenantFilter(scope.tenantId),
    });
    if (generating)
      throw new ConflictException(
        bySegments
          ? '还有探店分段正在生成，全部出片后再合成'
          : '还有分镜视频正在生成，全部出片后再合成',
      );
    const clips: DouyinConcatClip[] = [];
    for (const [index, shot] of shots.entries()) {
      const video = await this.repository.requireVideo(
        Number(shot.videoId),
        scope,
      );
      const url = typeof video.url === 'string' ? video.url.trim() : '';
      if (!url)
        throw new BadRequestException(`第 ${index + 1} ${unit}的视频没有地址`);
      clips.push({
        shotId: shot.id,
        shotIndex: index + 1,
        videoId: Number(shot.videoId),
        url,
        fallbackSeconds: Number(shot.duration) || 5,
      });
    }
    // 自动合成要先领到标记；手动合成也清掉标记，免得之后重生成某一镜又自动合成一次
    const claimed = await this.repository.claimAutoConcat(topicId, scope);
    if (options.auto && !claimed)
      throw new ConflictException('自动合成已被处理或已取消');
    const now = new Date();
    const doc: DouyinOperationEntity = {
      _id: new ObjectId(),
      id: randomUUID(),
      operation: 'generate',
      topicId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      provider: 'client',
      mode: 'concat',
      progress: 0,
      request: {
        [bySegments ? 'segmentIds' : 'shotIds']: clips.map(
          (clip) => clip.shotId,
        ),
        videoIds: clips.map((clip) => clip.videoId),
        auto: Boolean(options.auto),
      },
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    await this.operations.insertOne(doc);
    return { operation: this.toView(doc), clips };
  }

  /**
   * @description 客户端回报合成结果：进行中只更新进度；完成时校验视频库归属并设为脚本当前整片；失败写中文原因与原始信息。
   *   只接受本人、还在进行中的客户端合成记录。
   * @keyword-cn 回报合成结果, 设为当前整片
   * @keyword-en report-concat-result, bind-merged-video
   * @param {string} operationId 调用记录 ID。
   * @param {DouyinConcatReport} report 回报内容。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinOperationView>} 更新后的调用记录。
   * @throws {NotFoundException} 记录不存在或不是本人的客户端合成。
   * @throws {ConflictException} 记录已经结束（完成、失败或被判中断）。
   * @throws {BadRequestException} 完成时没给视频库 ID。
   */
  async report(
    operationId: string,
    report: DouyinConcatReport,
    scope: DouyinScope,
  ): Promise<DouyinOperationView> {
    const filter = {
      id: operationId,
      provider: 'client' as const,
      mode: 'concat' as const,
      userId: scope.userId,
      ...this.tenantFilter(scope.tenantId),
    };
    const row = await this.operations.findOne(filter);
    if (!row) throw new NotFoundException('DOUYIN_OPERATION_NOT_FOUND');
    if (row.status !== 'running')
      throw new ConflictException('这次合成已经结束，请重新合成');
    const now = new Date();
    if (report.status === 'running') {
      const progress = Math.max(
        0,
        Math.min(99, Math.round(Number(report.progress) || 0)),
      );
      await this.operations.updateOne(
        { ...filter, status: 'running' },
        { $set: { progress, updatedAt: now } },
      );
    } else if (report.status === 'failed') {
      await this.operations.updateOne(
        { ...filter, status: 'running' },
        {
          $set: {
            status: 'failed',
            error:
              String(report.error ?? '').slice(0, 500) ||
              '分镜视频合成失败，请稍后重试。',
            ...(report.errorDetail
              ? { errorDetail: String(report.errorDetail).slice(0, 4000) }
              : {}),
            updatedAt: now,
          },
        },
      );
    } else {
      const videoId = Number(report.videoId);
      if (!Number.isInteger(videoId) || videoId < 1)
        throw new BadRequestException('DOUYIN_CONCAT_VIDEO_REQUIRED');
      const video = await this.repository.requireVideo(videoId, scope);
      const topic = await this.repository.update(
        row.topicId,
        { generatedVideoId: videoId },
        scope,
      );
      const durationMs = Number(video.durationMs);
      await this.operations.updateOne(
        { ...filter, status: 'running' },
        {
          $set: {
            status: 'completed',
            progress: 100,
            result: {
              videoId,
              videoUrl: typeof video.url === 'string' ? video.url : '',
              shotCount: Array.isArray(row.request?.shotIds)
                ? row.request.shotIds.length
                : Array.isArray(row.request?.segmentIds)
                  ? row.request.segmentIds.length
                  : undefined,
              duration:
                Number.isFinite(durationMs) && durationMs > 0
                  ? Math.round(durationMs / 100) / 10
                  : undefined,
            },
            ...(topic
              ? {}
              : { error: '成片已存入视频库，但脚本已被删除，未能回填。' }),
            updatedAt: now,
          },
        },
      );
    }
    const latest = await this.operations.findOne({ id: operationId });
    return this.toView(latest ?? row);
  }

  /**
   * @description 把 30 分钟没有回报的客户端合成记录收成失败（客户端已关闭或断网，不会再有结果）。
   * @keyword-cn 收敛中断合成, 僵尸记录
   * @keyword-en settle-stale-concat, zombie-operation
   */
  async settleStale(): Promise<void> {
    await this.operations.updateMany(
      {
        provider: 'client',
        mode: 'concat',
        status: 'running',
        updatedAt: { $lt: new Date(Date.now() - DOUYIN_SHOT_CONCAT_STALE_MS) },
      },
      {
        $set: {
          status: 'failed',
          error: '合成过程中客户端关闭或断网，请重新合成。',
          updatedAt: new Date(),
        },
      },
    );
  }

  /**
   * @description 构造母平台或租户数据过滤边界。
   * @keyword-cn 合成租户过滤, 母平台边界
   * @keyword-en concat-tenant-filter, platform-boundary
   * @param {string} [tenantId] 租户 ID。
   * @returns {Record<string, unknown>} 过滤条件。
   */
  private tenantFilter(tenantId?: string): Record<string, unknown> {
    return tenantId
      ? { tenantId }
      : {
          $or: [
            { tenantId: { $exists: false } },
            { tenantId: null },
            { tenantId: '' },
          ],
        };
  }

  /**
   * @description 去掉数据库字段与请求正文后的合成调用视图。
   * @keyword-cn 合成调用视图, 隐藏请求
   * @keyword-en concat-operation-view, hide-request
   * @param {DouyinOperationEntity} row 调用记录。
   * @returns {DouyinOperationView} 前端安全视图。
   */
  private toView(row: DouyinOperationEntity): DouyinOperationView {
    return {
      id: row.id,
      operation: row.operation,
      topicId: row.topicId,
      provider: row.provider,
      mode: row.mode,
      progress: row.progress,
      status: row.status,
      result: row.result,
      error: row.error,
      errorDetail: row.errorDetail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
