import { Controller, Get, Param, Query } from '@nestjs/common';
import { RetrievalService } from '../services/retrieval.service';
import { ContextMessage } from '../../context/types/context.types';

/**
 * @title 检索控制器 Retrieval Controller
 * @description 提供关键词检索与滑动窗口上下文的接口。
 * @keywords-cn 检索, 关键词, 滑动窗口
 * @keywords-en retrieval, keywords, sliding window
 */
@Controller('context/retrieval')
export class RetrievalController {
  constructor(private readonly retrieval: RetrievalService) {}

  /**
   * @title 滑动上下文 Get Sliding Context
   * @description 通过关键词获取滑动窗口上下文。
   * @keywords-cn 滑动窗口, 上下文
   * @keywords-en sliding window, context
   * @param sessionId 会话ID，路径参数 `GET /context/retrieval/:sessionId`
   * @param keywords 逗号分隔的关键词，如 `k1,k2`
   * @param matchAll 当为 `true` 时要求全部命中
   * @param windowSize 每个命中点左右扩展的窗口大小
   * @param max 返回的最大消息条数
   * @returns `ContextMessage[]` 按时间排序的上下文消息片段
   */
  @Get(':sessionId')
  async get(
    @Param('sessionId') sessionId: string,
    @Query('keywords') keywords: string,
    @Query('matchAll') matchAll?: string,
    @Query('windowSize') windowSize?: string,
    @Query('max') max?: string,
  ): Promise<ContextMessage[]> {
    const list = (keywords ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const result = await this.retrieval.getSlidingContext(sessionId, {
      keywords: list,
      matchAll: matchAll === 'true',
      windowSize: windowSize ? Number(windowSize) : undefined,
      maxMessages: max ? Number(max) : undefined,
    });
    return result;
  }
}
