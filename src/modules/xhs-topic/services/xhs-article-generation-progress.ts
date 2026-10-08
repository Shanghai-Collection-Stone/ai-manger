import type { Logger } from '@nestjs/common';
import type { TodoService } from '../../todo/services/todo.service.js';
import type { CanvasGroupImage } from '../../canvas/entities/canvas.entity.js';
import type { XhsArticleGenerationProgress } from '../entities/xhs-topic.entity.js';

/**
 * @description 把图组角色换成预览槽位：封面为 0，`inner-n` 为 n，认不出的角色返回 undefined。
 * @keyword-cn 角色转槽位, 渐进显示
 * @keyword-en role-to-slot, progressive-reveal
 * @param {CanvasGroupImage['role']} role - 图组图片角色。
 * @returns {number | undefined} 预览槽位。
 */
export function toXhsArticleImageSlot(
  role: CanvasGroupImage['role'],
): number | undefined {
  if (role === 'cover') return 0;
  const slot = Number(String(role).replace(/^inner-/, ''));
  return Number.isInteger(slot) && slot > 0 ? slot : undefined;
}

/**
 * @description 生文阶段产出写入器：在内存里累积写好的正文与逐张就绪的配图，合并写进运行中 Todo 的 taskResult。
 *   同一时刻最多一个写请求在途，期间到达的变化合并成下一次写入；`close` 之后不再写，保证终态结果不会被阶段产出覆盖。
 * @keyword-cn 生文阶段产出, 合并写入
 * @keyword-en generation-progress-reporter, coalesced-writes
 */
export class XhsArticleGenerationProgressReporter {
  private readonly snapshot: XhsArticleGenerationProgress;
  private dirty = false;
  private closed = false;
  private writing: Promise<void> | null = null;

  /**
   * @description 以出队时刻为起点建立阶段快照；不出新图（改写保留原图）时配图轨直接标为 skipped。
   * @keyword-cn 生文阶段产出, 出队起点
   * @keyword-en generation-progress-reporter, run-start-time
   */
  constructor(
    private readonly options: {
      todoService: TodoService;
      logger: Logger;
      todoId: number;
      tenantId?: string;
      topicId: number;
      generateImages: boolean;
    },
  ) {
    this.snapshot = {
      startedAt: new Date().toISOString(),
      text: { status: 'running' },
      images: {
        status: options.generateImages ? 'pending' : 'skipped',
        total: 0,
        items: [],
      },
    };
  }

  /**
   * @description 正文完整校验通过后交付标题、正文与文章标签。
   * @keyword-cn 正文先到, 阶段交付
   * @keyword-en text-ready, stage-delivery
   */
  textReady(article: { title: string; body: string; tags: string[] }): void {
    this.snapshot.text = {
      status: 'done',
      title: article.title,
      body: article.body,
      tags: [...article.tags],
    };
    this.schedule();
  }

  /**
   * @description 源图分配完成，记下本篇计划出图张数，配图轨转为渲染中。
   * @keyword-cn 配图计划张数, 阶段交付
   * @keyword-en images-planned, stage-delivery
   */
  imagesPlanned(total: number): void {
    if (this.snapshot.images.status === 'skipped') return;
    this.snapshot.images.status = 'running';
    this.snapshot.images.total = Math.max(0, Math.floor(total));
    this.schedule();
  }

  /**
   * @description 单张图就绪：按槽位覆盖（封面底图会被成品封面替换），认不出的角色忽略。
   * @keyword-cn 配图逐张到达, 封面底图替换
   * @keyword-en image-ready, cover-base-replace
   */
  imageReady(event: {
    role: CanvasGroupImage['role'];
    url: string;
    final: boolean;
  }): void {
    const slot = toXhsArticleImageSlot(event.role);
    const url = String(event.url ?? '').trim();
    if (slot === undefined || !url) return;
    const items = this.snapshot.images.items.filter(
      (item) => item.slot !== slot,
    );
    items.push({ slot, url, final: event.final });
    items.sort((a, b) => a.slot - b.slot);
    this.snapshot.images.items = items;
    this.schedule();
  }

  /**
   * @description 整组配图渲染完成，配图轨置为 done。
   * @keyword-cn 配图整组完成, 阶段交付
   * @keyword-en images-done, stage-delivery
   */
  imagesDone(): void {
    if (this.snapshot.images.status === 'skipped') return;
    this.snapshot.images.status = 'done';
    this.schedule();
  }

  /**
   * @description 停止后续写入并等在途写请求落地，调用方随后再写终态结果。
   * @keyword-cn 关闭阶段写入, 终态防覆盖
   * @keyword-en close-progress-writes, protect-terminal-result
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.writing;
  }

  /**
   * @description 标记有新变化；没有在途写请求时启动写循环，循环直到没有未写的变化或已关闭。
   * @keyword-cn 合并写入, 单路在途
   * @keyword-en coalesced-writes, single-flight
   */
  private schedule(): void {
    if (this.closed) return;
    this.dirty = true;
    if (this.writing) return;
    this.writing = (async () => {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        try {
          await this.options.todoService.update({
            id: this.options.todoId,
            tenantId: this.options.tenantId,
            taskResult: JSON.stringify({
              topicId: this.options.topicId,
              complete: false,
              progress: this.snapshot,
            }),
          });
        } catch (error) {
          this.options.logger.warn(
            `[progress] write failed todo=${this.options.todoId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      this.writing = null;
    })();
  }
}
