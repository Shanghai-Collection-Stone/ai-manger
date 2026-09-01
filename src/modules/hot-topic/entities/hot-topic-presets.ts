import type {
  HotTopicCategory,
  HotTopicRuleFieldPaths,
} from './hot-topic.entity.js';

/**
 * @description 内置采集规则的定义形状，落库时补上作用域、启用状态与可用性快照。
 * @keyword-cn 预置规则定义, 内置榜单
 * @keyword-en preset-rule-definition, builtin-board
 */
export interface HotTopicRulePreset {
  /** 稳定标识，重复初始化按它幂等，不会重复建规则 */
  builtinKey: string;
  name: string;
  category: HotTopicCategory;
  platform: string;
  endpoint: string;
  headers?: Record<string, string>;
  listPath: string;
  fields: HotTopicRuleFieldPaths;
  urlTemplate?: string;
  defaultTags: string[];
  limit: number;
}

/** @type {string} 采集统一使用的桌面浏览器 UA，多数公开榜单接口会按 UA 拒绝空头请求。 */
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * @description 平台内置的公开榜单采集规则，覆盖社会热点与娱乐热点两条线，各 4 条。
 *  全部走 HTTP 直采公开 JSON 接口：不需要登录态、不占节点、不计费。
 *
 *  下列取值路径都是实测过的，但上游随时可能改版式，所以每条规则的地址与路径都是可编辑字段：
 *  失效时由管理页的「自检」标红并给出失败原因，改路径即可恢复，不需要发版。
 *
 *  几条路径上的坑，改动前先看一眼：
 *  - 百度热搜必须用 `platform=pc`。`platform=wise` 返回的是多包一层的
 *    `data.cards.0.content.0.content`，且字段名是 `word` 而不是 `query`，也没有热度和摘要。
 *  - 百度的条目没有稳定的原文直链（`indexUrl` 是跳转包装），所以统一用标题拼百度搜索地址。
 *  - 澎湃新闻只给 `contId`，`link` 恒为空串，用 `{contId}` 占位符拼详情页地址。
 *  - 知乎热榜接口（`/api/v3/feed/topstory/hot-lists/total`）对未登录请求返回 401，
 *    不适合做平台级直采，所以社会线用澎湃新闻代替。
 * @keyword-cn 预置采集规则, 社会热点, 娱乐热点
 * @keyword-en builtin-collect-rules, social-hot-topics, entertainment-hot-topics
 */
export const HOT_TOPIC_RULE_PRESETS: readonly HotTopicRulePreset[] = [
  {
    builtinKey: 'weibo-hot-search',
    name: '微博热搜榜',
    category: 'social',
    platform: '微博',
    endpoint: 'https://weibo.com/ajax/side/hotSearch',
    headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://weibo.com/' },
    listPath: 'data.realtime',
    fields: { title: 'word', heat: 'num', summary: 'label_name' },
    urlTemplate: 'https://s.weibo.com/weibo?q=%23{title}%23',
    defaultTags: ['社会民生', '突发事件'],
    limit: 50,
  },
  {
    builtinKey: 'baidu-hot-realtime',
    name: '百度热搜·实时',
    category: 'social',
    platform: '百度',
    endpoint: 'https://top.baidu.com/api/board?platform=pc&tab=realtime',
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://top.baidu.com/board',
    },
    listPath: 'data.cards.0.content',
    fields: { title: 'query', heat: 'hotScore', summary: 'desc' },
    urlTemplate: 'https://www.baidu.com/s?wd={title}',
    defaultTags: ['社会民生', '突发事件'],
    limit: 50,
  },
  {
    builtinKey: 'toutiao-hot-board',
    name: '今日头条热榜',
    category: 'social',
    platform: '今日头条',
    endpoint: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://www.toutiao.com/' },
    listPath: 'data',
    fields: { title: 'Title', url: 'Url', heat: 'HotValue' },
    defaultTags: ['社会民生', '国际时事'],
    limit: 50,
  },
  {
    builtinKey: 'thepaper-hot-news',
    name: '澎湃新闻热榜',
    category: 'social',
    platform: '澎湃新闻',
    endpoint: 'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar',
    headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://www.thepaper.cn/' },
    listPath: 'data.hotNews',
    fields: { title: 'name', summary: 'pubTime' },
    urlTemplate: 'https://www.thepaper.cn/newsDetail_forward_{contId}',
    defaultTags: ['社会民生', '政策法规'],
    limit: 30,
  },
  {
    builtinKey: 'baidu-hot-movie',
    name: '百度热搜·电影',
    category: 'entertainment',
    platform: '百度',
    endpoint: 'https://top.baidu.com/api/board?platform=pc&tab=movie',
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://top.baidu.com/board',
    },
    listPath: 'data.cards.0.content',
    fields: {
      title: 'query',
      url: 'rawUrl',
      heat: 'hotScore',
      summary: 'desc',
    },
    defaultTags: ['影视剧集', '明星动态'],
    limit: 30,
  },
  {
    builtinKey: 'baidu-hot-teleplay',
    name: '百度热搜·电视剧',
    category: 'entertainment',
    platform: '百度',
    endpoint: 'https://top.baidu.com/api/board?platform=pc&tab=teleplay',
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://top.baidu.com/board',
    },
    listPath: 'data.cards.0.content',
    fields: {
      title: 'query',
      url: 'rawUrl',
      heat: 'hotScore',
      summary: 'desc',
    },
    defaultTags: ['影视剧集', '综艺节目'],
    limit: 30,
  },
  {
    builtinKey: 'bilibili-hot-search',
    name: '哔哩哔哩热搜',
    category: 'entertainment',
    platform: '哔哩哔哩',
    endpoint:
      'https://api.bilibili.com/x/web-interface/search/square?limit=50&platform=web',
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.bilibili.com/',
    },
    listPath: 'data.trending.list',
    fields: { title: 'keyword', summary: 'show_name' },
    urlTemplate: 'https://search.bilibili.com/all?keyword={title}',
    defaultTags: ['动漫二次元', '游戏电竞'],
    limit: 50,
  },
  {
    builtinKey: 'douyin-hot-search',
    name: '抖音热榜',
    category: 'entertainment',
    platform: '抖音',
    endpoint: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
    headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://www.douyin.com/' },
    listPath: 'word_list',
    fields: { title: 'word', heat: 'hot_value' },
    urlTemplate: 'https://www.douyin.com/search/{title}',
    defaultTags: ['明星动态', '综艺节目'],
    limit: 50,
  },
];
