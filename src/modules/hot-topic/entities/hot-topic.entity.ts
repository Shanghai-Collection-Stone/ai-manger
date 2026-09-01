/**
 * @description 热点采集规则的内容分类，决定榜单归属与推荐时的候选范围。
 * @keyword-cn 热点分类, 榜单分类
 * @keyword-en hot-topic-category, board-category
 */
export const HOT_TOPIC_CATEGORIES = [
  'social',
  'entertainment',
  'tech',
  'finance',
  'lifestyle',
  'other',
] as const;

/**
 * @description 热点分类字面量类型。
 * @keyword-cn 热点分类类型
 * @keyword-en hot-topic-category-type
 */
export type HotTopicCategory = (typeof HOT_TOPIC_CATEGORIES)[number];

/**
 * @description 分类中文展示名，接口与后台表格共用同一份口径。
 * @keyword-cn 分类展示名, 中文标签
 * @keyword-en category-label, display-name
 */
export const HOT_TOPIC_CATEGORY_LABELS: Record<HotTopicCategory, string> = {
  social: '社会热点',
  entertainment: '娱乐热点',
  tech: '科技热点',
  finance: '财经热点',
  lifestyle: '生活热点',
  other: '其他',
};

/**
 * @description 采集规则可用性状态：从未自检 / 自检通过 / 自检失败。
 * @keyword-cn 规则可用状态, 自检结果
 * @keyword-en rule-health-status, probe-result
 */
export type HotTopicRuleHealthStatus = 'unknown' | 'ok' | 'failed';

/**
 * @description 采集规则可用性快照，管理页「是否可用」列直接读这一份。
 * @keyword-cn 规则可用性, 采集自检
 * @keyword-en rule-health, collect-probe
 */
export interface HotTopicRuleHealth {
  /** 可用性状态 */
  status: HotTopicRuleHealthStatus;
  /** 最近一次自检或采集时间 */
  checkedAt?: Date;
  /** 最近一次解析出的条目数 */
  sampleCount?: number;
  /** 失败原因或成功摘要 */
  message?: string;
  /** 最近一次解析出的前几条标题，用于人工确认解析路径是否配对 */
  sampleTitles?: string[];
}

/**
 * @description 榜单条目字段在响应 JSON 里的取值路径（点号路径，支持数组下标）。
 * @keyword-cn 字段取值路径, 解析配置
 * @keyword-en field-path, parse-config
 */
export interface HotTopicRuleFieldPaths {
  /** 标题路径，必填 */
  title: string;
  /** 原文链接路径 */
  url?: string;
  /** 热度值路径 */
  heat?: string;
  /** 摘要或标签路径 */
  summary?: string;
}

/**
 * @description 一条热点采集规则：一个公开榜单地址 + 一组取值路径 + 启用开关 + 可用性快照。
 * @keyword-cn 采集规则, 榜单规则
 * @keyword-en collect-rule, board-rule
 */
export interface HotTopicRuleEntity {
  /** 规则业务自增 ID */
  id: number;
  /** 租户隔离标识 */
  tenantId?: string;
  /** 创建人后台用户 ID */
  userId: string;
  /** 规则展示名 */
  name: string;
  /** 内容分类 */
  category: HotTopicCategory;
  /** 来源平台名，例如「微博」「百度」 */
  platform: string;
  /** 榜单 JSON 接口地址，只允许 http/https 公网地址 */
  endpoint: string;
  /** 附加请求头，通常是 Referer；User-Agent 缺省会自动补 */
  headers?: Record<string, string>;
  /** 榜单数组在响应里的点号路径，留空时自动探测第一个对象数组 */
  listPath: string;
  /** 条目内各字段的取值路径 */
  fields: HotTopicRuleFieldPaths;
  /** 榜单不给链接时用标题拼出的检索地址模板，占位符 `{title}` */
  urlTemplate?: string;
  /** AI 归类失败时兜底写入的标签 */
  defaultTags: string[];
  /** 单次采集最多保留条数 */
  limit: number;
  /** 是否启用；停用的规则不参与采集 */
  enabled: boolean;
  /** 是否平台内置预置规则 */
  builtin: boolean;
  /** 内置规则的稳定标识，用于重复初始化时幂等 */
  builtinKey?: string;
  /** 可用性快照 */
  health: HotTopicRuleHealth;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 一条已采集的热点条目，`tags` 由 AI 归类写入。
 * @keyword-cn 热点条目, 榜单条目
 * @keyword-en hot-topic-item, board-item
 */
export interface HotTopicItemEntity {
  /** 条目业务自增 ID */
  id: number;
  tenantId?: string;
  userId: string;
  /** 来源规则 ID */
  ruleId: number;
  /** 采集时的规则名快照 */
  ruleName: string;
  category: HotTopicCategory;
  platform: string;
  /** 本次采集批次号，同一次采集的全部条目共用 */
  batchId: string;
  /** 榜单内名次，从 1 开始 */
  rank: number;
  title: string;
  url?: string;
  /** 热度原值，保持采集端原样，不强转数字 */
  heat?: string;
  summary?: string;
  /** 归类标签 */
  tags: string[];
  /** 标签来源：AI 归类 / 规则兜底 / 未归类 */
  tagSource: 'ai' | 'rule' | 'none';
  collectedAt: Date;
}

/**
 * @description 单条规则在一次采集中的执行结果。
 * @keyword-cn 单规则采集结果, 采集回执
 * @keyword-en rule-collect-outcome, collect-receipt
 */
export interface HotTopicCollectRuleOutcome {
  ruleId: number;
  ruleName: string;
  /** 本条规则是否采到数据 */
  ok: boolean;
  /** 实际入库条数 */
  collected: number;
  /** 失败原因或跳过原因 */
  message?: string;
}

/**
 * @description 一次采集的整体结果，包含清库条数、批次号与逐规则回执。
 * @keyword-cn 采集结果, 采集批次
 * @keyword-en collect-result, collect-batch
 */
export interface HotTopicCollectResult {
  batchId: string;
  /** 采集前清掉的历史条数；未选择清除时为 0 */
  cleared: number;
  /** 本次入库总条数 */
  collected: number;
  /** 被 AI 成功归类的条数 */
  tagged: number;
  rules: HotTopicCollectRuleOutcome[];
  startedAt: Date;
  finishedAt: Date;
}

/**
 * @description 采集标签的线性汇总项，供后台「查看采集标签」弹窗逐条展示。
 * @keyword-cn 标签汇总, 标签清单
 * @keyword-en tag-summary, tag-list
 */
export interface HotTopicTagSummary {
  tag: string;
  /** 命中该标签的条目数 */
  count: number;
  /** 该标签出现过的分类 */
  categories: HotTopicCategory[];
  /** 该标签最近一次出现时间 */
  latestAt: Date;
  /** 若干条示例标题，帮助人工判断归类是否合理 */
  sampleTitles: string[];
}

/**
 * @description 按母选题推荐出的单条热点，`matchScore` 为 0-100 的契合度。
 * @keyword-cn 热点推荐项, 母选题匹配
 * @keyword-en hot-topic-recommendation, parent-topic-match
 */
export interface HotTopicRecommendation {
  hotTopicId: number;
  title: string;
  platform: string;
  category: HotTopicCategory;
  url?: string;
  heat?: string;
  tags: string[];
  /** 契合度 0-100 */
  matchScore: number;
  /** 为什么这条热点适合该母选题 */
  reason: string;
  /** 建议的切入角度 */
  angle: string;
}

/**
 * @description 推荐接口的结构化返回体，全部字段由 Agent 工具写入，模型最终文本不参与解析。
 * @keyword-cn 推荐结果, 结构化返回
 * @keyword-en recommend-result, structured-response
 */
export interface HotTopicRecommendResult {
  /** 请求时传入的母选题 */
  parentTopic: string;
  /** 送进模型的候选热点条数 */
  candidateCount: number;
  /** 第一阶段粗筛选中的标签（调用方显式传 tags 时即为该值）；一个都没选中时为空数组 */
  matchedTags: string[];
  /** 候选是否真的按 `matchedTags` 收窄过；false 表示粗筛没生效、走的是全量候选池 */
  tagFiltered: boolean;
  recommendations: HotTopicRecommendation[];
  /** 生成时间 ISO 字符串 */
  generatedAt: string;
}

/**
 * @description 数据作用域：租户 + 后台用户，全部查询与写入都按此隔离。
 * @keyword-cn 数据作用域, 租户隔离
 * @keyword-en data-scope, tenant-isolation
 */
export interface HotTopicScope {
  tenantId?: string;
  userId: string;
}
