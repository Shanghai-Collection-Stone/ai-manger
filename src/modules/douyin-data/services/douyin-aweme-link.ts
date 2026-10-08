/** @type {string[]} 允许服务端跟随跳转的抖音域名，避免被当成任意地址的代理。 */
const DOUYIN_LINK_HOSTS = [
  'v.douyin.com',
  'douyin.com',
  'www.douyin.com',
  'iesdouyin.com',
  'www.iesdouyin.com',
];

/** @type {number} 短链最多跟随的跳转次数。 */
const MAX_REDIRECT_HOPS = 3;

/** @type {number} 单次短链跳转请求超时（毫秒）。 */
const REDIRECT_TIMEOUT_MS = 8_000;

/**
 * @description 从抖音作品链接、分享口令或纯数字里解析作品 ID（aweme_id，15-21 位数字）。
 *   支持 `douyin.com/video/<id>`、`/note/<id>`、`iesdouyin.com/share/video/<id>`、`?modal_id=<id>` 与裸 ID；短链返回空串。
 * @keyword-cn 解析抖音作品ID, 链接解析
 * @keyword-en parse-douyin-aweme-id, link-parse
 * @param text 用户粘贴的链接、分享文本或作品 ID。
 * @returns {string} 作品 ID，解析不到时为空串。
 */
export function parseDouyinAwemeId(text: string): string {
  const value = String(text ?? '').trim();
  if (/^\d{15,21}$/.test(value)) return value;
  const patterns = [
    /\/(?:video|note|slides)\/(\d{15,21})(?!\d)/i,
    /[?&#](?:modal_id|aweme_id|item_id|vid)=(\d{15,21})(?!\d)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return '';
}

/**
 * @description 从分享文本里取出第一个抖音域名链接（分享口令常把短链夹在一段文字中间）。
 * @keyword-cn 提取抖音链接, 分享口令
 * @keyword-en extract-douyin-url, share-text
 * @param text 用户粘贴的文本。
 * @returns {string} 链接，找不到或不是抖音域名时为空串。
 */
export function extractDouyinUrl(text: string): string {
  const match = /https?:\/\/[^\s"'<>，。]+/i.exec(String(text ?? ''));
  if (!match) return '';
  return isDouyinHost(match[0]) ? match[0] : '';
}

/**
 * @description 判断链接是否属于允许跟随跳转的抖音域名。
 * @keyword-cn 抖音域名白名单, 防止外发
 * @keyword-en douyin-host-allowlist, exfiltration-guard
 * @param url 链接。
 * @returns {boolean} 是否是抖音域名。
 */
export function isDouyinHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      DOUYIN_LINK_HOSTS.includes(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * @description 解析作品 ID：能直接从文本解析就不发请求；`v.douyin.com` 短链由服务端逐跳读取 Location（只跟随抖音域名）。
 * @keyword-cn 解析抖音短链, 跟随跳转
 * @keyword-en resolve-douyin-short-link, follow-redirect
 * @param text 用户粘贴的链接、分享文本或作品 ID。
 * @returns {Promise<string>} 作品 ID，解析不到时为空串。
 */
export async function resolveDouyinAwemeId(text: string): Promise<string> {
  const direct = parseDouyinAwemeId(text);
  if (direct) return direct;
  let current = extractDouyinUrl(text);
  for (let hop = 0; current && hop < MAX_REDIRECT_HOPS; hop += 1) {
    let location: string | null = null;
    try {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        },
        signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
      });
      location = response.headers.get('location');
    } catch {
      return '';
    }
    if (!location) return '';
    const next = new URL(location, current).toString();
    const awemeId = parseDouyinAwemeId(next);
    if (awemeId) return awemeId;
    current = isDouyinHost(next) ? next : '';
  }
  return '';
}

/**
 * @description 取实际用于抓取的作品 ID：用户绑定的链接优先，其次是发布回写的 douyinVideoId（只接受纯数字作品 ID）。
 * @keyword-cn 抓取目标作品ID, 绑定链接优先
 * @keyword-en resolve-crawl-target, bound-link-first
 * @param douyinVideoId 小程序发布回写或手动链接建作品时写入的作品 ID。
 * @param boundAwemeId 用户在数据监控里绑定链接解析出的作品 ID。
 * @returns {string | null} 作品 ID；两者都不可用时为 null。
 */
export function resolveCrawlTarget(
  douyinVideoId: string | null | undefined,
  boundAwemeId: string | null | undefined,
): string | null {
  return (
    parseDouyinAwemeId(boundAwemeId ?? '') ||
    parseDouyinAwemeId(douyinVideoId ?? '') ||
    null
  );
}
