/**
 * @description Dashboard API 服务层，与 NestJS 后端通信（支持预置接口 + 通用 Mongo 查询）
 * @keyword-en dashboard api service layer
 */

const API_BASE = window.location.port === '4322'
  ? 'http://localhost:3011'  // Astro dev → 后端
  : '';                       // 同源部署

/* ━━━ 内部工具 ━━━ */

/**
 * @description 获取当前 Bearer token
 * @keyword-en get auth token
 */
function getToken() {
  return localStorage.getItem('admin_token') || '';
}

/**
 * @description 执行前端 JS 数据转换（用于看板 query 自定义规则）
 * @keyword-en run dashboard query transform js
 */
function runTransformJs(script, data, context) {
  const code = typeof script === 'string' ? script.trim() : '';
  if (!code) return data;

  // 1) 支持传入函数表达式： (data, ctx) => ...
  try {
    const asFn = new Function(
      'data',
      'context',
      `"use strict"; const __fn = (${code}); return typeof __fn === 'function' ? __fn(data, context) : data;`,
    );
    const out = asFn(data, context);
    return typeof out === 'undefined' ? data : out;
  } catch {
    // ignore and fallback to function body mode
  }

  // 2) 支持传入函数体：可直接 return 新数据
  try {
    const asBody = new Function('data', 'context', `"use strict"; ${code}`);
    const out = asBody(data, context);
    return typeof out === 'undefined' ? data : out;
  } catch (err) {
    console.warn('[dashboardApi] transformJs failed:', err);
    return data;
  }
}

/**
 * @description 通用数据接口请求（预置 /dashboard/* 路由）
 * @keyword-en fetch dashboard data api
 */
async function fetchApi(path, timeRange) {
  const url = `${API_BASE}/dashboard/${path}?timeRange=${encodeURIComponent(timeRange)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
  return res.json();
}

/* ━━━ 时间范围 → Mongo Where DSL ━━━ */

const DAY_MS = 86400000;

/**
 * @description 将中文时间范围转为 Mongo Where 节点（timeField >= start AND < end）
 * @keyword-en convert time range to mongo where dsl
 */
export function timeRangeToWhere(timeField, timeRange) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (timeRange) {
    case '今天':
      start = today; end = new Date(today.getTime() + DAY_MS); break;
    case '明天':
      start = new Date(today.getTime() + DAY_MS); end = new Date(today.getTime() + 2 * DAY_MS); break;
    case '昨天':
      start = new Date(today.getTime() - DAY_MS); end = today; break;
    case '过去7天内':
      start = new Date(today.getTime() - 7 * DAY_MS); end = new Date(today.getTime() + DAY_MS); break;
    case '未来7天内':
      start = today; end = new Date(today.getTime() + 8 * DAY_MS); break;
    case '过去30天内':
      start = new Date(today.getTime() - 30 * DAY_MS); end = new Date(today.getTime() + DAY_MS); break;
    case '未来30天内':
      start = today; end = new Date(today.getTime() + 31 * DAY_MS); break;
    case '本周': {
      const d = now.getDay() || 7;
      start = new Date(today.getTime() - (d - 1) * DAY_MS);
      end = new Date(start.getTime() + 7 * DAY_MS); break;
    }
    case '上周': {
      const d = now.getDay() || 7;
      end = new Date(today.getTime() - (d - 1) * DAY_MS);
      start = new Date(end.getTime() - 7 * DAY_MS); break;
    }
    case '本月':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1); break;
    case '上月':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1); break;
    default:
      return undefined;
  }

  return {
    and: [
      { field: timeField, op: 'gte', value: start.toISOString() },
      { field: timeField, op: 'lt', value: end.toISOString() },
    ],
  };
}

/* ━━━ 通用 Mongo 查询 ━━━ */

/**
 * @description 执行 config.queries 中定义的查询（支持 Mongo / 飞书），并可做前端 JS 转换
 * @keyword-en fetch dashboard query from config
 */
export async function fetchDashboardQuery(queryDef, timeRange) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const sourceType = queryDef.sourceType || (String(queryDef.sourceCode || '').includes('feishu') ? 'feishu-bitable' : 'mongo');

  const body = {
    collection: queryDef.collection || queryDef.tableId,
    mode: queryDef.mode || 'list',
    sourceType,
    sourceCode: queryDef.sourceCode,
    filter: queryDef.filter,
    pipeline: queryDef.pipeline,
    joins: queryDef.joins,
    tenantField: queryDef.tenantField,
    feishuFilter: queryDef.feishuFilter,
    feishuSort: queryDef.feishuSort,
    sort: queryDef.sort,
    limit: queryDef.limit,
    skip: queryDef.skip,
    projection: queryDef.projection,
  };

  // 时间范围过滤
  if (queryDef.timeField && timeRange) {
    const tw = timeRangeToWhere(queryDef.timeField, timeRange);
    if (tw) body.where = tw;
  }

  // 合并额外 where 条件
  if (queryDef.where) {
    body.where = body.where ? { and: [body.where, queryDef.where] } : queryDef.where;
  }

  const res = await fetch(`${API_BASE}/mongo/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mongo query error: ${res.status}`);
  const raw = await res.json();
  return runTransformJs(queryDef.transformJs || queryDef.transform, raw, {
    queryDef,
    timeRange,
    sourceType,
  });
}

/**
 * @description 兼容旧命名（历史调用仍可用）
 * @keyword-en backward compatible mongo query alias
 */
export const fetchMongoQuery = fetchDashboardQuery;

/* ━━━ 预置 Dashboard 数据接口 ━━━ */

export const getRevenueOverview = (timeRange) => fetchApi('revenue-overview', timeRange);
export const getDailyRevenue = (timeRange) => fetchApi('daily-revenue', timeRange);
export const getPeopleStats = (timeRange) => fetchApi('people-stats', timeRange);
export const getDemandChannel = (timeRange) => fetchApi('demand-channel', timeRange);
export const getEvents = (timeRange) => fetchApi('events', timeRange);
export const getSales = (timeRange) => fetchApi('sales', timeRange);

/**
 * @description 获取看板 JSON 配置（按当前登录用户 / 租户返回）
 * @keyword-en get dashboard json config
 */
export const getDashboardConfig = async (dashboardCode = 'ai-commander') => {
  const url = `${API_BASE}/dashboard-config/current?dashboardCode=${encodeURIComponent(dashboardCode)}`;
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`DashboardConfig API error: ${res.status}`);
  return res.json();
};

/**
 * @description query key → 数据 fetcher 映射（预置接口），供 DashboardView 按 block.query 动态调用
 * @keyword-en query key to fetcher map
 */
export const queryFetchers = {
  revenueOverview: getRevenueOverview,
  dailyRevenue: getDailyRevenue,
  peopleStats: getPeopleStats,
  demandChannel: getDemandChannel,
  events: getEvents,
  sales: getSales,
};
