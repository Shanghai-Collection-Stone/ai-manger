import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { Db } from 'mongodb';

/**
 * @title 前端生成任务控制器 Frontend Jobs Controller
 * @description 提供基于上下文的前端生成任务查询接口。
 * @keywords-cn 前端任务, 上下文, 查询
 * @keywords-en frontend jobs, context, query
 */
@Controller('fc/frontend')
export class FrontendJobsController {
  constructor(@Inject('FC_MONGO_DB') private readonly db: Db) {}

  /**
   * @title 获取会话任务 List Jobs by Session
   * @description 返回指定会话的生成任务列表。
   * @keywords-cn 任务列表, 会话
   * @keywords-en jobs list, session
   */
  @Get('jobs/:sessionId')
  async listBySession(
    @Param('sessionId') sessionId: string,
  ): Promise<Record<string, unknown>[]> {
    const col = this.db.collection('frontend_jobs');
    const rows = await col
      .find({ sessionId }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();
    return rows as Record<string, unknown>[];
  }

  /**
   * @title 获取任务详情 Get Job by Hash
   * @description 返回指定哈希的任务详情。
   * @keywords-cn 任务详情, 哈希
   * @keywords-en job detail, hash
   */
  @Get('job/:hash')
  async getJob(
    @Param('hash') hash: string,
  ): Promise<Record<string, unknown> | null> {
    const col = this.db.collection('frontend_jobs');
    const doc = await col.findOne({ hash }, { projection: { _id: 0 } });
    return doc as Record<string, unknown> | null;
  }

  /**
   * @title 查询任务 Search Jobs
   * @description 支持按会话与状态过滤任务。
   * @keywords-cn 查询任务, 状态过滤
   * @keywords-en search jobs, status filter
   */
  @Get('jobs')
  async search(
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: 'done' | 'updated' | 'error',
  ): Promise<Record<string, unknown>[]> {
    const col = this.db.collection('frontend_jobs');
    const filter: Record<string, unknown> = {};
    if (sessionId) filter.sessionId = sessionId;
    if (status) filter.status = status;
    const rows = await col
      .find(filter, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();
    return rows as Record<string, unknown>[];
  }
}
