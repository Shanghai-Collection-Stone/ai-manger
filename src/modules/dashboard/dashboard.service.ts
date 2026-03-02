import { Injectable } from '@nestjs/common';
import { FeishuBitableSourceService } from '../data-source/sources/feishu-bitable/feishu-bitable-source.service.js';

/* ─── 表 ID 常量 ─── */
const TABLE_DEMAND = 'tbl8gGo7QwYfNTbC'; // 需求进入工作流
const TABLE_DAILY = 'tblz1A10mzaLM2pQ'; // 日台账
const TABLE_MALL = 'tblDxSPwNpi51DPe'; // 商城业绩

/* ─── 工具函数 ─── */

/** 解析 timeRange 字符串 → { start, end } 毫秒时间戳 */
function parseTimeRange(timeRange: string): { start: number; end: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const dayMs = 86400000;

  switch (timeRange) {
    case '今天':
      return { start: todayMs, end: todayMs + dayMs - 1 };
    case '明天':
      return { start: todayMs + dayMs, end: todayMs + 2 * dayMs - 1 };
    case '昨天':
      return { start: todayMs - dayMs, end: todayMs - 1 };
    case '过去7天内':
      return { start: todayMs - 7 * dayMs, end: todayMs + dayMs - 1 };
    case '未来7天内':
      return { start: todayMs, end: todayMs + 7 * dayMs - 1 };
    case '过去30天内':
      return { start: todayMs - 30 * dayMs, end: todayMs + dayMs - 1 };
    case '未来30天内':
      return { start: todayMs, end: todayMs + 30 * dayMs - 1 };
    case '本周': {
      const dow = now.getDay() || 7; // 周一=1 … 周日=7
      const monday = todayMs - (dow - 1) * dayMs;
      return { start: monday, end: monday + 7 * dayMs - 1 };
    }
    case '上周': {
      const dow = now.getDay() || 7;
      const thisMonday = todayMs - (dow - 1) * dayMs;
      return { start: thisMonday - 7 * dayMs, end: thisMonday - 1 };
    }
    case '上月': {
      const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        start: firstLastMonth.getTime(),
        end: firstThisMonth.getTime() - 1,
      };
    }
    case '本月':
    default: {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start: firstOfMonth.getTime(), end: firstOfNext.getTime() - 1 };
    }
  }
}

/** 安全提取数值 —— 处理飞书数字/公式/货币字段的各种返回格式 */
function num(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val) || 0;
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // 公式字段: { type: 2, value: [123] }
    if (Array.isArray(obj.value)) return num(obj.value[0]);
    if ('value' in obj) return num(obj.value);
  }
  return 0;
}

/** 安全提取字符串 */
function str(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(str).join(', ');
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
  }
  return String(val);
}

/** 安全提取数组字段（多选、人员等） */
function arr(val: unknown): string[] {
  if (val == null) return [];
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) {
    return val.map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && v != null) {
        return ((v as Record<string, unknown>).name as string) ?? str(v);
      }
      return String(v);
    });
  }
  return [str(val)];
}

/** 拉取所有记录(分页) */
async function fetchAll(
  feishu: FeishuBitableSourceService,
  tableId: string,
  filter?: {
    conjunction?: 'and' | 'or';
    conditions?: Array<{
      field_name: string;
      operator: string;
      value?: string[];
    }>;
  },
): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await feishu.listRecords(tableId, {
      pageSize: 500,
      pageToken,
      filter: filter as never,
    });
    for (const r of res.records) all.push(r.fields);
    hasMore = res.hasMore;
    pageToken = res.pageToken;
  }
  return all;
}

/* ─── 服务 ─── */

@Injectable()
export class DashboardService {
  constructor(private readonly feishu: FeishuBitableSourceService) {}

  /* ────────────────────── 1. 营收总览 ────────────────────── */
  async getRevenueOverview(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);

    // ① 日台账：总营收、人数
    const dailyRecords = await fetchAll(this.feishu, TABLE_DAILY, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '日期',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '日期',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    let totalRevenue = 0; // 总营收当日
    let totalPeople = 0; // 总计人数
    for (const r of dailyRecords) {
      totalRevenue += num(r['总营收当日']);
      totalPeople += num(r['总计人数']);
    }

    // ② 需求表：成功订单
    const demandRecords = await fetchAll(this.feishu, TABLE_DEMAND, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '来电时间',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '来电时间',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    const successOrders = demandRecords.filter(
      (r) => str(r['交易结果']) === '成功',
    );
    const successCount = successOrders.length;
    const totalDemand = demandRecords.length;

    let successTotalAmount = 0;
    let successTotalPeople = 0;
    for (const r of successOrders) {
      successTotalAmount += num(r['实际总金额']);
      successTotalPeople += num(r['最终人数']);
    }

    const avgOrderPrice =
      successCount > 0 ? Math.round(successTotalAmount / successCount) : 0;
    const avgPerPerson =
      successTotalPeople > 0
        ? Math.round(successTotalAmount / successTotalPeople)
        : 0;
    const conversionRate =
      totalDemand > 0 ? Math.round((successCount / totalDemand) * 100) : 0;

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalPeople,
      successOrderCount: successCount,
      successOrderPeople: successTotalPeople,
      successTotalAmount: Math.round(successTotalAmount * 100) / 100,
      avgOrderPrice,
      avgPerPerson,
      conversionRate,
      totalDemand,
    };
  }

  /* ────────────────────── 2. 日营收趋势 ────────────────────── */
  async getDailyRevenue(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);
    const dailyRecords = await fetchAll(this.feishu, TABLE_DAILY, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '日期',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '日期',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    // 按日期排序
    const items = dailyRecords
      .map((r) => ({
        date: num(r['日期']),
        revenue: num(r['总营收当日']),
        people: num(r['总计人数']),
      }))
      .sort((a, b) => a.date - b.date);

    return {
      labels: items.map((i) => {
        const d = new Date(i.date);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }),
      revenue: items.map((i) => Math.round(i.revenue * 100) / 100),
      people: items.map((i) => i.people),
    };
  }

  /* ────────────────────── 3. 人数统计 ────────────────────── */
  async getPeopleStats(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);
    const dailyRecords = await fetchAll(this.feishu, TABLE_DAILY, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '日期',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '日期',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    let memberPeople = 0; // 会员半价人数
    let platformPeople = 0; // 点评全天畅玩人数 + 点评夜场人数
    let partyPeople = 0; // 生日派对/团建人数
    let otherPeople = 0; // 其他
    let total = 0;

    for (const r of dailyRecords) {
      const mem = num(r['会员半价人数']);
      const dp = num(r['点评全天畅玩人数']) + num(r['点评夜场人数']);
      const party = num(r['生日派对/团建人数']);
      const third = num(r['麦淘/UNIGHT/父母帮/抖音/彩贝壳 人数']);
      const mall = num(r['商场畅玩券']);
      const t = num(r['总计人数']);

      memberPeople += mem;
      platformPeople += dp;
      partyPeople += party;
      otherPeople += third + mall;
      total += t;
    }

    return {
      total,
      categories: [
        { name: '会员', value: memberPeople },
        { name: '团购/点评', value: platformPeople },
        { name: '派对/团建', value: partyPeople },
        { name: '其他渠道', value: otherPeople },
      ],
    };
  }

  /* ────────────────────── 4. 需求与渠道 ────────────────────── */
  async getDemandChannel(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);
    const records = await fetchAll(this.feishu, TABLE_DEMAND, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '来电时间',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '来电时间',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    const total = records.length;
    const successCount = records.filter(
      (r) => str(r['交易结果']) === '成功',
    ).length;
    const conversionRate =
      total > 0 ? Math.round((successCount / total) * 100) : 0;

    // 按来源平台分组
    const channelMap: Record<string, number> = {};
    // 按活动类型分组 (需求类型)
    const demandTypeMap: Record<string, number> = {};
    // 按客服分组 (客服接收)
    const staffMap: Record<string, number> = {};
    // 按日期分组 (每日需求趋势)
    const dailyMap: Record<string, number> = {};

    for (const r of records) {
      const platform = str(r['来源平台']) || '未知';
      channelMap[platform] = (channelMap[platform] ?? 0) + 1;

      const types = arr(r['活动类型']);
      for (const t of types) {
        demandTypeMap[t] = (demandTypeMap[t] ?? 0) + 1;
      }
      if (types.length === 0) {
        demandTypeMap['未分类'] = (demandTypeMap['未分类'] ?? 0) + 1;
      }

      const staffArr = arr(r['客服']);
      const staffName = staffArr[0] || '未分配';
      staffMap[staffName] = (staffMap[staffName] ?? 0) + 1;

      const ts = num(r['来电时间']);
      if (ts > 0) {
        const d = new Date(ts);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        dailyMap[key] = (dailyMap[key] ?? 0) + 1;
      }
    }

    // 用排序好的日期
    const sortedDays = Object.entries(dailyMap).sort((a, b) => {
      const [am, ad] = a[0].split('/').map(Number);
      const [bm, bd] = b[0].split('/').map(Number);
      return am !== bm ? am - bm : ad - bd;
    });

    return {
      total,
      successCount,
      conversionRate,
      channels: Object.entries(channelMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
      demandTypes: Object.entries(demandTypeMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
      staffDistribution: Object.entries(staffMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
      dailyTrend: {
        labels: sortedDays.map((d) => d[0]),
        values: sortedDays.map((d) => d[1]),
      },
    };
  }

  /* ────────────────────── 5. 活动与类型 ────────────────────── */
  async getEvents(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);
    const records = await fetchAll(this.feishu, TABLE_DEMAND, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '来电时间',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '来电时间',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    // 活动类型成单率
    const typeStats: Record<string, { total: number; success: number }> = {};
    // 主题活动统计
    const themeStats: Record<
      string,
      { count: number; revenue: number; people: number }
    > = {};
    // 包厢统计
    const roomStats: Record<
      string,
      { count: number; revenue: number; people: number }
    > = {};

    let hasThemeCount = 0;
    let hasRoomCount = 0;
    let totalEvents = 0;

    for (const r of records) {
      const types = arr(r['活动类型']);
      const result = str(r['交易结果']);
      const isSuccess = result === '成功';
      const revenue = num(r['实际总金额']);
      const people = num(r['最终人数']);

      for (const t of types) {
        if (!typeStats[t]) typeStats[t] = { total: 0, success: 0 };
        typeStats[t].total++;
        if (isSuccess) typeStats[t].success++;
      }

      // 主题活动
      const themes = arr(r['主题活动']);
      if (themes.length > 0) {
        hasThemeCount++;
        for (const theme of themes) {
          if (!themeStats[theme])
            themeStats[theme] = { count: 0, revenue: 0, people: 0 };
          themeStats[theme].count++;
          if (isSuccess) {
            themeStats[theme].revenue += revenue;
            themeStats[theme].people += people;
          }
        }
      }

      // 包厢
      const rooms = arr(r['包厢']);
      if (rooms.length > 0) {
        hasRoomCount++;
        for (const room of rooms) {
          if (!roomStats[room])
            roomStats[room] = { count: 0, revenue: 0, people: 0 };
          roomStats[room].count++;
          if (isSuccess) {
            roomStats[room].revenue += revenue;
            roomStats[room].people += people;
          }
        }
      }

      totalEvents++;
    }

    const themeRatio =
      totalEvents > 0 ? Math.round((hasThemeCount / totalEvents) * 100) : 0;
    const roomRatio =
      totalEvents > 0 ? Math.round((hasRoomCount / totalEvents) * 100) : 0;

    return {
      activityTypeConversion: Object.entries(typeStats)
        .map(([name, s]) => ({
          name,
          total: s.total,
          success: s.success,
          rate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total),
      themeRatio,
      roomRatio,
      themeStats: Object.entries(themeStats)
        .map(([name, s]) => ({
          name,
          count: s.count,
          revenue: Math.round(s.revenue * 100) / 100,
          people: s.people,
        }))
        .sort((a, b) => b.count - a.count),
      roomStats: Object.entries(roomStats)
        .map(([name, s]) => ({
          name,
          count: s.count,
          revenue: Math.round(s.revenue * 100) / 100,
          people: s.people,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /* ────────────────────── 6. 销售与客户 ────────────────────── */
  async getSales(timeRange: string) {
    const { start, end } = parseTimeRange(timeRange);
    const records = await fetchAll(this.feishu, TABLE_DEMAND, {
      conjunction: 'and',
      conditions: [
        {
          field_name: '来电时间',
          operator: 'isGreater',
          value: ['ExactDate', String(start - 1)],
        },
        {
          field_name: '来电时间',
          operator: 'isLess',
          value: ['ExactDate', String(end + 1)],
        },
      ],
    });

    // 销售榜 (按客服统计成单数)
    const salesMap: Record<string, { total: number; success: number }> = {};
    // 客户 Tag 词云
    const tagMap: Record<string, number> = {};

    for (const r of records) {
      const staffArr = arr(r['客服']);
      const staffName = staffArr[0] || '未分配';
      const isSuccess = str(r['交易结果']) === '成功';

      if (!salesMap[staffName]) salesMap[staffName] = { total: 0, success: 0 };
      salesMap[staffName].total++;
      if (isSuccess) salesMap[staffName].success++;

      // 客户Tag
      const tags = arr(r['客户Tag']);
      for (const tag of tags) {
        tagMap[tag] = (tagMap[tag] ?? 0) + 1;
      }
    }

    const salesRanking = Object.entries(salesMap)
      .map(([name, s]) => ({
        name,
        total: s.total,
        success: s.success,
        rate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.success - a.success);

    const tagCloud = Object.entries(tagMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      salesRanking,
      tagCloud,
    };
  }
}
