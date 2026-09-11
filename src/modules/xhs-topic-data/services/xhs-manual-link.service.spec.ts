jest.mock('../../article-library/services/article-library.service', () => ({
  ArticleLibraryService: class {},
}));
jest.mock('../../article-library/services/article.service', () => ({
  ArticleService: class {},
}));
jest.mock('../../xhs-topic/services/xhs-topic-repository.service', () => ({
  XhsTopicRepositoryService: class {},
}));

import { parseXhsNoteId } from './xhs-manual-link.service';

/**
 * @description 手动添加链接的 NoteId 解析回归测试：解析不到就不允许添加，所以各种常见链接形态都要钉死。
 * @keyword-cn 解析笔记ID测试, 链接解析
 * @keyword-en parse-note-id-test, link-parse
 */
describe('parseXhsNoteId', () => {
  const noteId = '66f1c2a3000000001e01a2b3';

  it('解析 explore 链接并忽略 xsec_token 等参数', () => {
    expect(
      parseXhsNoteId(
        `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=ABC&xsec_source=pc_search`,
      ),
    ).toBe(noteId);
  });

  it('解析 discovery/item 链接', () => {
    expect(
      parseXhsNoteId(`https://www.xiaohongshu.com/discovery/item/${noteId}`),
    ).toBe(noteId);
  });

  it('解析个人主页下的笔记链接', () => {
    expect(
      parseXhsNoteId(
        `https://www.xiaohongshu.com/user/profile/5f1a2b3c000000000100abcd/${noteId}?xsec_token=x`,
      ),
    ).toBe(noteId);
  });

  it('解析 noteId 查询参数并统一转小写', () => {
    expect(
      parseXhsNoteId(
        `https://example.com/share?noteId=${noteId.toUpperCase()}`,
      ),
    ).toBe(noteId);
  });

  it('从分享文本里的完整链接解析', () => {
    expect(
      parseXhsNoteId(
        `看看这篇 https://www.xiaohongshu.com/explore/${noteId} 复制本条信息打开小红书`,
      ),
    ).toBe(noteId);
  });

  it('短链、位数不对或空串解析不到', () => {
    expect(parseXhsNoteId('http://xhslink.com/a/AbCdEf')).toBeNull();
    expect(
      parseXhsNoteId('https://www.xiaohongshu.com/explore/66f1c2a3'),
    ).toBeNull();
    expect(parseXhsNoteId('')).toBeNull();
  });
});
