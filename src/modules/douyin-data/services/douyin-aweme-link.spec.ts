import {
  extractDouyinUrl,
  parseDouyinAwemeId,
  resolveCrawlTarget,
} from './douyin-aweme-link';

/**
 * @description 抖音作品 ID 解析回归测试：解析不到就不能绑定或添加链接，常见链接形态都要钉死。
 * @keyword-cn 解析抖音作品ID测试, 链接解析
 * @keyword-en parse-douyin-aweme-id-test, link-parse
 */
describe('parseDouyinAwemeId', () => {
  const awemeId = '7312345678901234567';

  it('解析网页作品链接并忽略查询参数', () => {
    expect(
      parseDouyinAwemeId(
        `https://www.douyin.com/video/${awemeId}?previous_page=app_code_link`,
      ),
    ).toBe(awemeId);
  });

  it('解析分享页与图文链接', () => {
    expect(
      parseDouyinAwemeId(`https://www.iesdouyin.com/share/video/${awemeId}/`),
    ).toBe(awemeId);
    expect(parseDouyinAwemeId(`https://www.douyin.com/note/${awemeId}`)).toBe(
      awemeId,
    );
  });

  it('解析 modal_id 参数与裸作品 ID', () => {
    expect(
      parseDouyinAwemeId(
        `https://www.douyin.com/user/MS4wLjABAAAA?modal_id=${awemeId}`,
      ),
    ).toBe(awemeId);
    expect(parseDouyinAwemeId(` ${awemeId} `)).toBe(awemeId);
  });

  it('短链、加密 ID 与过短数字返回空串', () => {
    expect(parseDouyinAwemeId('https://v.douyin.com/iAbCdEfG/')).toBe('');
    expect(parseDouyinAwemeId('@9VwL2uyFU8wtNXvkaclgR')).toBe('');
    expect(parseDouyinAwemeId('12345')).toBe('');
  });
});

/**
 * @description 分享口令里的短链提取与抓取目标优先级。
 * @keyword-cn 提取抖音链接测试, 抓取目标优先级
 * @keyword-en extract-douyin-url-test, crawl-target-priority
 */
describe('extractDouyinUrl / resolveCrawlTarget', () => {
  it('从分享口令里取出短链，非抖音域名不取', () => {
    expect(
      extractDouyinUrl(
        '7.94 复制打开抖音，看看【某某的作品】好看 https://v.douyin.com/iAbCdEfG/ HDu:/ 01/12',
      ),
    ).toBe('https://v.douyin.com/iAbCdEfG/');
    expect(extractDouyinUrl('看看 https://example.com/video/1')).toBe('');
  });

  it('绑定链接优先，其次纯数字 douyinVideoId，加密 ID 不可用', () => {
    expect(
      resolveCrawlTarget('7000000000000000001', '7312345678901234567'),
    ).toBe('7312345678901234567');
    expect(resolveCrawlTarget('7000000000000000001', null)).toBe(
      '7000000000000000001',
    );
    expect(resolveCrawlTarget('@9VwL2uyFU8wtNXvkaclgR', null)).toBeNull();
  });
});
