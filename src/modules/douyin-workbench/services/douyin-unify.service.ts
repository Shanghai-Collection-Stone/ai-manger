import { Injectable, NotFoundException } from '@nestjs/common';
import type { DouyinTopicEntity } from '../entities/douyin-workbench.entity.js';
import { storyboardToStoreVisit } from './douyin-unify.js';
import { DouyinVideoDirectorService } from './douyin-video-director.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 旧分镜脚本转统一出片流程：打开旧分镜脚本或 AI 操作到它时转一次（已经是统一流程的不动），原分镜数据保留作备份，
 *   以前出的视频还在视频库里，分段要在新流程里重新出片；转完让 AI 导演按新画面重新规划。
 * @keyword-cn 旧分镜转换服务, 打开时转换
 * @keyword-en unify-storyboard-service, convert-on-open
 */
@Injectable()
export class DouyinUnifyService {
  /**
   * @description 注入选题仓库与 AI 导演。
   * @keyword-cn 初始化旧分镜转换, 转换依赖
   * @keyword-en init-unify-service, unify-dependencies
   */
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly director: DouyinVideoDirectorService,
  ) {}

  /**
   * @description 把一条旧分镜脚本转成统一出片流程（从脚本开始）并返回最新选题；已经是统一流程时原样返回。
   * @keyword-cn 转成统一流程, 旧分镜转换
   * @keyword-en unify-topic, convert-storyboard
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{topic: DouyinTopicEntity, converted: boolean}>} 最新选题与这次是否转了。
   * @throws {NotFoundException} 脚本不存在。
   */
  async unify(
    topicId: number,
    scope: DouyinScope,
  ): Promise<{ topic: DouyinTopicEntity; converted: boolean }> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    if (topic.productionMode === 'store-visit')
      return { topic, converted: false };
    const converted = await this.repository.convertToUnified(
      topicId,
      storyboardToStoreVisit(topic),
      scope,
    );
    if (!converted) {
      const latest = await this.repository.get(topicId, scope);
      if (!latest) throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
      return { topic: latest, converted: false };
    }
    await this.director.schedule(topicId, scope);
    return {
      topic: (await this.repository.get(topicId, scope)) ?? converted,
      converted: true,
    };
  }
}
