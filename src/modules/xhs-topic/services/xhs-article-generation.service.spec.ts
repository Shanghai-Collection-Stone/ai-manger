import type { XhsArticleMemoryDraft } from '../entities/xhs-topic.entity.js';
import { XhsArticleGenerationService } from './xhs-article-generation.service.js';

type SubmitTool = {
  invoke: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * @description 不走依赖注入直接取文章交付工具：交付工具只依赖 `applyArticleSubmission`，不需要数据库与模型。
 * @keyword-cn 交付工具测试, 文章交付
 * @keyword-en article-submit-tool-test, article-submission
 */
function buildSubmitTool() {
  const service = Object.create(
    XhsArticleGenerationService.prototype,
  ) as XhsArticleGenerationService;
  const draft: XhsArticleMemoryDraft = {
    tags: [],
    imageTags: [],
    contentType: '图文',
  };
  const state = { submitted: false, problem: '' };
  const submitTool = (
    service as unknown as {
      createArticleSubmitTool: (
        draft: XhsArticleMemoryDraft,
        state: { submitted: boolean; problem: string },
      ) => SubmitTool;
    }
  ).createArticleSubmitTool(draft, state);
  return { submitTool, draft, state };
}

const body = '诺瓦城的活动场地是真的多，热门的几个周末去人挤人。'.repeat(8);

describe('文章交付工具 xhs_article_submit', () => {
  it('标签交成逗号分隔的一整串时拆开收下', async () => {
    const { submitTool, draft, state } = buildSubmitTool();
    await submitTool.invoke({
      title: '诺瓦城场地实测',
      body,
      tags: '诺瓦城,场地推荐，出片技巧、#探店实测',
    });
    expect(state).toEqual({ submitted: true, problem: '' });
    expect(draft.tags).toEqual(['诺瓦城', '场地推荐', '出片技巧', '探店实测']);
  });

  it('字符串数组照常收下', async () => {
    const { submitTool, draft, state } = buildSubmitTool();
    await submitTool.invoke({
      title: '诺瓦城场地实测',
      body,
      tags: ['诺瓦城', '场地推荐', '出片技巧'],
    });
    expect(state.submitted).toBe(true);
    expect(draft.tags).toEqual(['诺瓦城', '场地推荐', '出片技巧']);
  });

  it('标签不足 3 个时不交付并说明原因', async () => {
    const { submitTool, draft, state } = buildSubmitTool();
    await submitTool.invoke({
      title: '诺瓦城场地实测',
      body,
      tags: '诺瓦城,场地推荐',
    });
    expect(state.submitted).toBe(false);
    expect(state.problem).toContain('至少 3 个不重复的文章标签');
    expect(draft.tags).toEqual([]);
  });
});
