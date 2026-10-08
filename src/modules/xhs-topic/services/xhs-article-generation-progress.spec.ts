import type { Logger } from '@nestjs/common';
import type { TodoService } from '../../todo/services/todo.service.js';
import {
  XhsArticleGenerationProgressReporter,
  toXhsArticleImageSlot,
} from './xhs-article-generation-progress.js';

/**
 * @description 构造可手动放行的 Todo 写入桩，记录每次写入的 taskResult。
 * @keyword-cn 写入桩, 阶段产出测试
 * @keyword-en todo-update-stub, progress-reporter-test
 */
function createTodoStub() {
  const writes: Array<Record<string, unknown>> = [];
  const releases: Array<() => void> = [];
  const update = jest.fn((input: { taskResult: string }) => {
    writes.push(JSON.parse(input.taskResult) as Record<string, unknown>);
    return new Promise<null>((resolve) => releases.push(() => resolve(null)));
  });
  return {
    writes,
    releaseNext: async () => {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
    todoService: { update } as unknown as TodoService,
    update,
  };
}

const logger = { warn: jest.fn() } as unknown as Logger;

describe('toXhsArticleImageSlot', () => {
  it('maps cover to 0 and inner-n to n', () => {
    expect(toXhsArticleImageSlot('cover')).toBe(0);
    expect(toXhsArticleImageSlot('inner-3')).toBe(3);
  });
});

describe('XhsArticleGenerationProgressReporter', () => {
  it('coalesces changes made while a write is in flight into one follow-up write', async () => {
    const stub = createTodoStub();
    const reporter = new XhsArticleGenerationProgressReporter({
      todoService: stub.todoService,
      logger,
      todoId: 7,
      topicId: 3,
      generateImages: true,
    });
    reporter.imagesPlanned(6);
    reporter.imageReady({ role: 'inner-1', url: 'a.png', final: true });
    reporter.imageReady({ role: 'cover', url: 'base.png', final: false });
    expect(stub.update).toHaveBeenCalledTimes(1);
    await stub.releaseNext();
    expect(stub.update).toHaveBeenCalledTimes(2);
    const latest = stub.writes[1] as {
      progress: { images: { total: number; items: unknown[] } };
    };
    expect(latest.progress.images.total).toBe(6);
    expect(latest.progress.images.items).toEqual([
      { slot: 0, url: 'base.png', final: false },
      { slot: 1, url: 'a.png', final: true },
    ]);
    await stub.releaseNext();
  });

  it('replaces the cover base with the final cover in the same slot', async () => {
    const stub = createTodoStub();
    const reporter = new XhsArticleGenerationProgressReporter({
      todoService: stub.todoService,
      logger,
      todoId: 7,
      topicId: 3,
      generateImages: true,
    });
    reporter.imageReady({ role: 'cover', url: 'base.png', final: false });
    reporter.imageReady({ role: 'cover', url: 'final.png', final: true });
    await stub.releaseNext();
    await stub.releaseNext();
    const latest = stub.writes[stub.writes.length - 1] as {
      progress: { images: { items: unknown[] } };
    };
    expect(latest.progress.images.items).toEqual([
      { slot: 0, url: 'final.png', final: true },
    ]);
  });

  it('stops writing after close so the terminal result is not overwritten', async () => {
    const stub = createTodoStub();
    const reporter = new XhsArticleGenerationProgressReporter({
      todoService: stub.todoService,
      logger,
      todoId: 7,
      topicId: 3,
      generateImages: false,
    });
    reporter.textReady({ title: 't', body: 'b', tags: ['x'] });
    reporter.imageReady({ role: 'inner-2', url: 'late.png', final: true });
    const closing = reporter.close();
    await stub.releaseNext();
    await closing;
    reporter.textReady({ title: 't2', body: 'b2', tags: [] });
    expect(stub.update).toHaveBeenCalledTimes(1);
    const only = stub.writes[0] as {
      progress: { text: { status: string }; images: { status: string } };
    };
    expect(only.progress.text.status).toBe('done');
    expect(only.progress.images.status).toBe('skipped');
  });
});
