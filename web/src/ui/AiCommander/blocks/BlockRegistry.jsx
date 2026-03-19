import React from 'react';
import { TrendingUp, Calendar, Users, Share2 } from 'lucide-react';
import { LoadingBox, ProgressBar, EChart, pieOption, CARD } from './shared.jsx';

/* ━━━ 辅助函数 ━━━ */

/**
 * @description 数值转万元显示
 * @keyword-en format number to wan
 */
const wan = (v) => (Number(v) / 10000).toFixed(2);

/**
 * @description 按 path 安全取值 (支持 'a.b.c')
 * @keyword-en get nested value by dot path
 */
const getNestedValue = (obj, path) => {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => o?.[k], obj);
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Block 组件定义
   每个组件接收 { block, data, timeRange }
   block = JSON 配置中的 block 对象
   data  = 对应 query 返回的 API 数据
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ─── ai_progress ─── */

/**
 * @description AI 覆盖达成率进度条
 * @keyword-en ai progress bar block
 */
const AiProgressBlock = ({ block }) => {
  const { title = 'AI 覆盖达成率', value = 0 } = block.props || {};
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
          <span className="text-xs font-bold text-slate-700">{title}</span>
        </div>
        <span className="text-xs font-bold text-indigo-600">{value}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${value}%` }}
        ></div>
      </div>
    </div>
  );
};

/* ─── revenue_overview_card ─── */

/**
 * @description 营收总览卡片（支持简略 / 带转化标签+子指标两种模式）
 * @keyword-en revenue overview card block
 */
const RevenueOverviewBlock = ({ block, data }) => {
  if (!data) return <LoadingBox height={120} />;
  const { title = '实际总营收', showConversionBadge, showSubStats } = block.props || {};
  const [wInt, wDec] = wan(data.totalRevenue).split('.');

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-500 flex items-center">
          <Calendar size={14} className="mr-1" /> {title}
        </span>
        {showConversionBadge && (
          <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg flex items-center">
            <TrendingUp size={12} className="mr-1" /> 转化{data.conversionRate}%
          </span>
        )}
      </div>
      <div className="flex items-baseline space-x-1">
        <span className="text-4xl font-black text-slate-900 tracking-tight">{wInt}</span>
        <span className="text-lg font-bold text-slate-500">.{wDec}</span>
        <span className="text-sm text-slate-400 ml-1">万元</span>
      </div>
      {showSubStats && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>成功订单</span>
            <span className="font-bold text-slate-700">{data.successOrderCount} 单</span>
          </div>
          <ProgressBar value={data.conversionRate} />
          <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
            <span>成功人数</span>
            <span className="font-bold text-slate-700">{data.successOrderPeople} 人</span>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── stat_card ─── */

/**
 * @description 通用统计卡片（支持 format: wan、showProgress 等）
 * @keyword-en stat card block
 */
const StatCardBlock = ({ block, data }) => {
  if (!data) return <LoadingBox height={80} />;
  const { label, valuePath, suffix = '', format, showProgress } = block.props || {};
  let val = getNestedValue(data, valuePath);
  if (format === 'wan') val = wan(val);

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mb-2">
        {val}
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </div>
      {showProgress && <ProgressBar value={Number(val) || 0} />}
    </div>
  );
};

/* ─── people_total_card ─── */

/**
 * @description 总计人数大数字卡片
 * @keyword-en people total card block
 */
const PeopleTotalBlock = ({ block, data }) => {
  if (!data) return <LoadingBox height={60} />;
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-1">{block.props?.title || '总计人数'}</div>
      <div className="text-2xl font-bold text-slate-900">{data.total}人</div>
    </div>
  );
};

/* ─── people_pie_card ─── */

/**
 * @description 人数分析饼图卡片（环形 + 图例 + 中心总数）
 * @keyword-en people pie chart card block
 */
const PeoplePieBlock = ({ block, data }) => {
  const { title = '人数分析' } = block.props || {};
  const colors = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'];
  if (!data) return <LoadingBox height={160} />;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-3 font-medium flex items-center gap-2">
        <Users size={14} className="text-indigo-500" /> {title}
      </div>
      <div className="flex items-center justify-between px-2">
        {/* 饼图区域 */}
        <div className="flex-1 h-[160px] flex items-center justify-center relative">
          <EChart height={160} option={pieOption(data.categories, colors)} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-slate-400">总计</span>
            <span className="text-lg font-bold text-slate-700">
              {data.categories.reduce((a, b) => a + b.value, 0)}
            </span>
          </div>
        </div>
        {/* 图例区域 */}
        <div className="w-1/2 pl-4 space-y-2">
          {data.categories.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shadow-sm"
                  style={{ background: colors[i % colors.length] }}
                ></span>
                <span className="text-slate-600 font-medium">{c.name}</span>
              </div>
              <span className="font-bold text-slate-800">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── demand_channel_pie_card ─── */

/**
 * @description 渠道分布饼图卡片（支持自定义颜色）
 * @keyword-en demand channel pie chart card block
 */
const DemandChannelPieBlock = ({ block, data }) => {
  const { title = '各渠道进入数量', topN = 5, colors } = block.props || {};
  const palette = colors || ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];
  if (!data) return <LoadingBox height={160} />;
  const items = (data.channels || []).slice(0, topN);

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-3 font-medium flex items-center gap-2">
        <Share2 size={14} className="text-blue-500" /> {title}
      </div>
      <div className="flex items-center justify-between px-2">
        {/* 饼图 */}
        <div className="flex-1 h-[160px] flex items-center justify-center relative">
          <EChart height={160} option={pieOption(items, palette)} />
        </div>
        {/* 图例 */}
        <div className="w-1/2 pl-4 space-y-2">
          {items.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className="w-2.5 h-2.5 rounded-full shadow-sm shrink-0"
                  style={{ background: palette[i % palette.length] }}
                ></span>
                <span className="text-slate-600 font-medium truncate">{c.name}</span>
              </div>
              <span className="font-bold text-slate-800 ml-2">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── demand_type_pie_card ─── */

/**
 * @description 需求类型饼图卡片
 * @keyword-en demand type pie chart card block
 */
const DemandTypePieBlock = ({ block, data }) => {
  const { title = '需求类型', topN = 4 } = block.props || {};
  const colors = ['#0ea5e9', '#a5b4fc', '#6366f1', '#fbbf24'];
  if (!data) return <LoadingBox height={140} />;
  const items = (data.demandTypes || []).slice(0, topN);

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="flex items-center justify-between px-2">
        <div className="flex-1 h-[140px] flex items-center justify-center">
          <EChart height={140} option={pieOption(items, colors)} />
        </div>
        <div className="w-1/2 pl-4 space-y-1.5">
          {items.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: colors[i % colors.length] }}
                ></span>
                <span className="text-slate-600 font-medium truncate">{c.name}</span>
              </div>
              <span className="font-bold text-slate-800 ml-2">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── daily_revenue_people_chart ─── */

/**
 * @description 日营收 & 人数趋势柱线混合图
 * @keyword-en daily revenue people bar-line chart block
 */
const DailyRevenuePeopleChartBlock = ({ block, data, timeRange }) => {
  const { title = '日人数&日营收趋势', height = 160 } = block.props || {};
  if (!data) return <LoadingBox height={height} />;

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-[10px] text-slate-400">{timeRange}</div>
      </div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: data.labels },
          yAxis: { type: 'value' },
          series: [
            { type: 'bar', data: data.people, name: '人数', itemStyle: { color: '#c7d2fe' } },
            { type: 'line', data: data.revenue, name: '营收', smooth: true, itemStyle: { color: '#4f46e5' } },
          ],
        }}
      />
    </div>
  );
};

/* ─── daily_demand_trend_chart ─── */

/**
 * @description 每日需求进入趋势折线图
 * @keyword-en daily demand trend line chart block
 */
const DailyDemandTrendBlock = ({ block, data, timeRange }) => {
  const { title = '每日需求进入趋势', height = 150 } = block.props || {};
  if (!data?.dailyTrend) return null;

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-[10px] text-slate-400">{timeRange}</div>
      </div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: data.dailyTrend.labels },
          yAxis: { type: 'value' },
          series: [
            { type: 'line', data: data.dailyTrend.values, smooth: true, itemStyle: { color: '#6366f1' } },
          ],
        }}
      />
    </div>
  );
};

/* ─── staff_distribution_card ─── */

/**
 * @description 客服接收占比进度条列表
 * @keyword-en staff distribution progress card block
 */
const StaffDistributionBlock = ({ block, data }) => {
  const { title = '客服接收占比', topN = 5 } = block.props || {};
  if (!data) return <LoadingBox height={120} />;
  const items = (data.staffDistribution || []).slice(0, topN);

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      {items.map((s) => (
        <div key={s.name} className="mb-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
            <span>{s.name}</span>
            <span className="font-semibold text-slate-700">{s.value}单</span>
          </div>
          <ProgressBar value={data.total > 0 ? Math.round((s.value / data.total) * 100) : 0} />
        </div>
      ))}
    </div>
  );
};

/* ─── sales_ranking_inline ─── */

/**
 * @description 销售榜内联版（总览页简洁展示）
 * @keyword-en sales ranking inline compact block
 */
const SalesRankingInlineBlock = ({ block, data }) => {
  const { title = '销售榜', topN = 3 } = block.props || {};
  if (!data) return null;
  const items = (data.salesRanking || []).slice(0, topN);
  const maxVal = items[0]?.success || 1;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="text-[11px] text-slate-600 w-14 truncate">{item.name}</div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${maxVal > 0 ? (item.success / maxVal) * 100 : 0}%` }}
              ></div>
            </div>
            <div className="text-[11px] text-slate-500 w-12 text-right">{item.success}单</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── activity_type_conversion_card ─── */

/**
 * @description 活动类型成单率网格卡片
 * @keyword-en activity type conversion grid card block
 */
const ActivityTypeConversionBlock = ({ block, data }) => {
  const { title = '活动类型成单率' } = block.props || {};
  if (!data) return <LoadingBox height={200} />;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        {(data.activityTypeConversion || []).map((it) => (
          <div key={it.name} className="bg-slate-50 rounded-xl p-3">
            <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
              <span>{it.name}</span>
              <span className="font-semibold text-slate-800">{it.rate}%</span>
            </div>
            <ProgressBar value={it.rate} />
            <div className="text-[10px] text-slate-400 mt-1">
              {it.success}/{it.total} 单
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── 比例饼图通用内部组件（theme / room 共用） ─── */

/**
 * @description 比例饼图内部组件，用于主题占比 / 包厢占比复用
 * @keyword-en ratio pie internal component
 */
const RatioPieInternal = ({ title, ratioValue, label, color, altColor = '#e2e8f0', altLabel = '其他' }) => (
  <div className={`${CARD} p-4`}>
    <div className="text-xs text-slate-500 mb-2">{title}</div>
    <div className="flex items-center justify-between px-2">
      <div className="flex-1 h-[140px] flex items-center justify-center">
        <EChart
          height={140}
          option={pieOption(
            [
              { name: label, value: ratioValue },
              { name: altLabel, value: 100 - ratioValue },
            ],
            [color, altColor],
          )}
        />
      </div>
      <div className="w-1/2 pl-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: color }}></span>
            <span className="text-slate-600 font-medium">{label}</span>
          </div>
          <span className="font-bold text-slate-800">{ratioValue}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: altColor }}></span>
            <span className="text-slate-600 font-medium">{altLabel}</span>
          </div>
          <span className="font-bold text-slate-800">{100 - ratioValue}%</span>
        </div>
      </div>
    </div>
  </div>
);

/* ─── theme_ratio_card ─── */

/**
 * @description 主题活动场次占比饼图卡片
 * @keyword-en theme ratio pie card block
 */
const ThemeRatioBlock = ({ block, data }) => {
  if (!data) return <LoadingBox height={140} />;
  return (
    <RatioPieInternal
      title={block.props?.title || '主题活动场次占比'}
      ratioValue={data.themeRatio}
      label="主题"
      color="#6366f1"
    />
  );
};

/* ─── room_ratio_card ─── */

/**
 * @description 包厢场次占比饼图卡片
 * @keyword-en room ratio pie card block
 */
const RoomRatioBlock = ({ block, data }) => {
  if (!data) return <LoadingBox height={140} />;
  return (
    <RatioPieInternal
      title={block.props?.title || '包厢场次占比'}
      ratioValue={data.roomRatio}
      label="包厢"
      color="#6b7280"
      altColor="#e5e7eb"
    />
  );
};

/* ─── theme_revenue_people_chart ─── */

/**
 * @description 主题活动收入 & 人数柱线混合图
 * @keyword-en theme revenue people bar-line chart block
 */
const ThemeRevenuePeopleChartBlock = ({ block, data }) => {
  const { title = '主题活动收入&人数', height = 160 } = block.props || {};
  if (!data?.themeStats?.length) return null;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-1">{title}</div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: data.themeStats.map((s) => s.name) },
          yAxis: { type: 'value' },
          series: [
            { type: 'bar', data: data.themeStats.map((s) => s.revenue), name: '收入', itemStyle: { color: '#c7d2fe' } },
            { type: 'line', data: data.themeStats.map((s) => s.people), name: '人数', smooth: true, itemStyle: { color: '#4f46e5' } },
          ],
        }}
      />
    </div>
  );
};

/* ─── room_revenue_people_chart ─── */

/**
 * @description 包厢收入 & 人数柱线混合图
 * @keyword-en room revenue people bar-line chart block
 */
const RoomRevenuePeopleChartBlock = ({ block, data }) => {
  const { title = '包厢收入&人数', height = 160 } = block.props || {};
  if (!data?.roomStats?.length) return null;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-1">{title}</div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: data.roomStats.map((s) => s.name) },
          yAxis: { type: 'value' },
          series: [
            { type: 'bar', data: data.roomStats.map((s) => s.revenue), name: '收入', itemStyle: { color: '#c7d2fe' } },
            { type: 'line', data: data.roomStats.map((s) => s.people), name: '人数', smooth: true, itemStyle: { color: '#4f46e5' } },
          ],
        }}
      />
    </div>
  );
};

/* ─── sales_ranking_card ─── */

/**
 * @description 销售榜完整版（全部销售人员列表）
 * @keyword-en sales ranking full card block
 */
const SalesRankingBlock = ({ block, data }) => {
  const { title = '销售榜' } = block.props || {};
  if (!data) return <LoadingBox height={200} />;
  const items = data.salesRanking || [];
  const maxVal = items[0]?.success || 1;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.name} className="flex items-center gap-2">
            <div className="text-[11px] text-slate-600 w-14 truncate">{s.name}</div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${maxVal > 0 ? (s.success / maxVal) * 100 : 0}%` }}
              ></div>
            </div>
            <div className="text-[11px] text-slate-500 w-12 text-right">{s.success}单</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── customer_tag_cloud_card ─── */

/**
 * @description 客户 TAG 词云图卡片
 * @keyword-en customer tag word cloud card block
 */
const CustomerTagCloudBlock = ({ block, data }) => {
  const { title = '客户TAG', height = 240 } = block.props || {};
  if (!data) return <LoadingBox height={height} />;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="rounded-2xl overflow-hidden bg-white">
        <EChart
          height={height}
          plugins={['wordcloud']}
          option={{
            backgroundColor: '#ffffff',
            tooltip: { show: true },
            series: [
              {
                type: 'wordCloud',
                shape: 'circle',
                gridSize: 8,
                sizeRange: [14, 48],
                rotationRange: [0, 0],
                textStyle: { color: '#475569', fontWeight: 600 },
                data: (data.tagCloud || []).map((t) => ({ name: t.name, value: t.value })),
              },
            ],
          }}
        />
      </div>
    </div>
  );
};

/* ─── sales_rate_grid_card ─── */

/**
 * @description 人员总成单率环形进度网格卡片
 * @keyword-en sales rate grid ring chart card block
 */
const SalesRateGridBlock = ({ block, data }) => {
  const { title = '人员总成单率' } = block.props || {};
  if (!data) return <LoadingBox height={200} />;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-1">{title}</div>
      <div className="grid grid-cols-3 gap-3 mt-1">
        {(data.salesRanking || []).map((s) => (
          <div key={s.name} className="bg-slate-50 p-3 rounded-2xl text-center">
            <div className="text-[10px] text-slate-500 mb-2">{s.name}</div>
            <div className="mx-auto w-12 h-12 relative flex items-center justify-center">
              <EChart
                height={48}
                option={{
                  animation: false,
                  tooltip: { show: false },
                  legend: { show: false },
                  series: [
                    {
                      type: 'pie',
                      radius: ['80%', '100%'],
                      label: { show: false },
                      data: [
                        { value: s.rate, name: '完成', itemStyle: { color: '#6366f1' } },
                        { value: 100 - s.rate, name: '剩余', itemStyle: { color: '#e5e7eb' } },
                      ],
                    },
                  ],
                }}
              />
              <div className="absolute text-[10px] font-bold text-slate-700">{s.rate}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SaaS Mongo 查询型 Block 组件
   data 来自 POST /mongo/query，格式:
   - count模式: { count: number }
   - list模式:  { rows: Record<string, unknown>[] }
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ─── mongo_count_card ─── */

/**
 * @description Mongo 计数卡片（显示 count 查询结果）
 * @keyword-en mongo count card block
 */
const MongoCountCard = ({ block, data }) => {
  if (!data) return <LoadingBox height={80} />;
  const { label = '总数', suffix = '', icon, color = '#6366f1' } = block.props || {};
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-base" style={{ color }}>{icon}</span>}
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">
        {data.count ?? 0}{suffix && <span className="text-sm text-slate-500 ml-1">{suffix}</span>}
      </div>
    </div>
  );
};

/* ─── mongo_sum_card ─── */

/**
 * @description Mongo 求和卡片（对 list 结果的 sumField 字段求和）
 * @keyword-en mongo sum card block
 */
const MongoSumCard = ({ block, data }) => {
  if (!data) return <LoadingBox height={80} />;
  const { label = '合计', sumField, suffix = '', format } = block.props || {};
  const rows = data.rows || [];
  let total = rows.reduce((acc, r) => acc + (Number(r[sumField]) || 0), 0);
  if (format === 'wan') total = (total / 10000).toFixed(2);
  return (
    <div className={`${CARD} p-4`}>
      <span className="text-xs text-slate-500">{label}</span>
      <div className="text-2xl font-bold text-slate-900 mt-1">
        {total}{suffix && <span className="text-sm text-slate-500 ml-1">{suffix}</span>}
      </div>
    </div>
  );
};

/* ─── mongo_rate_card ─── */

/**
 * @description Mongo 比率卡片（分子 count / 分母 count，需 dataMap）
 * @keyword-en mongo rate card block
 */
const MongoRateCard = ({ block, data, dataMap }) => {
  const { label = '比率', denominatorQuery, suffix = '%' } = block.props || {};
  const numerator = data?.count ?? 0;
  const denomData = dataMap?.[denominatorQuery];
  const denominator = denomData?.count ?? 0;
  const rate = denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : '0.0';

  return (
    <div className={`${CARD} p-4`}>
      <span className="text-xs text-slate-500">{label}</span>
      <div className="text-2xl font-bold text-slate-900 mt-1">
        {rate}<span className="text-sm text-slate-500 ml-1">{suffix}</span>
      </div>
      <ProgressBar value={Number(rate)} />
      <div className="text-[10px] text-slate-400 mt-1">{numerator} / {denominator}</div>
    </div>
  );
};

/* ─── mongo_group_pie ─── */

/**
 * @description Mongo 分组饼图（按 groupField 分组计数，展示饼图+图例）
 * @keyword-en mongo group pie chart block
 */
const MongoGroupPie = ({ block, data }) => {
  const { title = '分布', groupField, topN = 6, colors } = block.props || {};
  const palette = colors || ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
  if (!data?.rows) return <LoadingBox height={160} />;

  // 按 groupField 分组计数
  const countMap = {};
  data.rows.forEach((r) => {
    const key = r[groupField] || '未知';
    countMap[key] = (countMap[key] || 0) + 1;
  });
  const items = Object.entries(countMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-3 font-medium">{title}</div>
      <div className="flex items-center justify-between px-2">
        {/* 饼图 */}
        <div className="flex-1 h-[160px] flex items-center justify-center relative">
          <EChart height={160} option={pieOption(items, palette)} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-slate-400">总计</span>
            <span className="text-lg font-bold text-slate-700">
              {items.reduce((a, b) => a + b.value, 0)}
            </span>
          </div>
        </div>
        {/* 图例 */}
        <div className="w-1/2 pl-4 space-y-2">
          {items.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className="w-2.5 h-2.5 rounded-full shadow-sm shrink-0"
                  style={{ background: palette[i % palette.length] }}
                ></span>
                <span className="text-slate-600 font-medium truncate">{c.name}</span>
              </div>
              <span className="font-bold text-slate-800 ml-2">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── mongo_daily_trend ─── */

/**
 * @description Mongo 日趋势折线图（按 timeField 按天分组计数）
 * @keyword-en mongo daily trend line chart block
 */
const MongoDailyTrend = ({ block, data, timeRange }) => {
  const { title = '每日趋势', timeField, height = 150, color = '#6366f1' } = block.props || {};
  if (!data?.rows?.length) return null;

  // 按日期分组
  const dayMap = {};
  data.rows.forEach((r) => {
    const d = r[timeField];
    if (!d) return;
    const key = new Date(d).toISOString().slice(0, 10);
    dayMap[key] = (dayMap[key] || 0) + 1;
  });
  const sorted = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => k.slice(5)); // MM-DD
  const values = sorted.map(([, v]) => v);

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-[10px] text-slate-400">{timeRange}</div>
      </div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: labels },
          yAxis: { type: 'value', minInterval: 1 },
          series: [{ type: 'line', data: values, smooth: true, itemStyle: { color }, areaStyle: { color: color + '20' } }],
        }}
      />
    </div>
  );
};

/* ─── mongo_daily_bar ─── */

/**
 * @description Mongo 日趋势柱状图（按 timeField 按天分组，支持 sumField 求和 / 默认计数）
 * @keyword-en mongo daily bar chart block
 */
const MongoDailyBar = ({ block, data, timeRange }) => {
  const { title = '每日统计', timeField, sumField, height = 150, color = '#818cf8' } = block.props || {};
  if (!data?.rows?.length) return null;

  const dayMap = {};
  data.rows.forEach((r) => {
    const d = r[timeField];
    if (!d) return;
    const key = new Date(d).toISOString().slice(0, 10);
    dayMap[key] = (dayMap[key] || 0) + (sumField ? (Number(r[sumField]) || 0) : 1);
  });
  const sorted = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => k.slice(5));
  const values = sorted.map(([, v]) => v);

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-[10px] text-slate-400">{timeRange}</div>
      </div>
      <EChart
        height={height}
        option={{
          grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: labels },
          yAxis: { type: 'value', minInterval: 1 },
          series: [{ type: 'bar', data: values, itemStyle: { color, borderRadius: [4, 4, 0, 0] } }],
        }}
      />
    </div>
  );
};

/* ─── mongo_ranking ─── */

/**
 * @description Mongo 排行榜（按 groupField 分组计数排序，水平条形展示）
 * @keyword-en mongo group ranking bar block
 */
const MongoRanking = ({ block, data }) => {
  const { title = '排行', groupField, topN = 5, suffix = '单' } = block.props || {};
  if (!data?.rows) return <LoadingBox height={120} />;

  const countMap = {};
  data.rows.forEach((r) => {
    const key = r[groupField] || '未知';
    countMap[key] = (countMap[key] || 0) + 1;
  });
  const items = Object.entries(countMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
  const maxVal = items[0]?.value || 1;

  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 w-4">{i + 1}</span>
            <div className="text-[11px] text-slate-600 w-16 truncate">{item.name}</div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${(item.value / maxVal) * 100}%` }}
              ></div>
            </div>
            <div className="text-[11px] text-slate-500 w-14 text-right">{item.value}{suffix}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── mongo_recent_table ─── */

/**
 * @description Mongo 最近记录表格（展示 list 查询前 N 条记录）
 * @keyword-en mongo recent records table block
 */
const MongoRecentTable = ({ block, data }) => {
  const { title = '最近记录', columns = [], topN = 10 } = block.props || {};
  if (!data?.rows) return <LoadingBox height={120} />;
  const rows = data.rows.slice(0, topN);

  return (
    <div className={`${CARD} p-4 overflow-x-auto`}>
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-100">
            {columns.map((col) => (
              <th key={col.field} className="text-left text-slate-400 font-medium py-1 px-1">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50">
              {columns.map((col) => (
                <td key={col.field} className="text-slate-600 py-1.5 px-1 truncate max-w-[100px]">
                  {col.format === 'date' && r[col.field] ? new Date(r[col.field]).toLocaleDateString('zh-CN') : (r[col.field] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Block 类型注册表
   key = JSON 中 block.type，value = React 组件
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * @description Block 类型 → 组件注册表
 * @keyword-en block type registry map
 */
const BLOCK_REGISTRY = {
  // ── 预置平台 Block ──
  ai_progress: AiProgressBlock,
  revenue_overview_card: RevenueOverviewBlock,
  stat_card: StatCardBlock,
  people_total_card: PeopleTotalBlock,
  people_pie_card: PeoplePieBlock,
  demand_channel_pie_card: DemandChannelPieBlock,
  demand_type_pie_card: DemandTypePieBlock,
  daily_revenue_people_chart: DailyRevenuePeopleChartBlock,
  daily_demand_trend_chart: DailyDemandTrendBlock,
  staff_distribution_card: StaffDistributionBlock,
  sales_ranking_inline: SalesRankingInlineBlock,
  activity_type_conversion_card: ActivityTypeConversionBlock,
  theme_ratio_card: ThemeRatioBlock,
  room_ratio_card: RoomRatioBlock,
  theme_revenue_people_chart: ThemeRevenuePeopleChartBlock,
  room_revenue_people_chart: RoomRevenuePeopleChartBlock,
  sales_ranking_card: SalesRankingBlock,
  customer_tag_cloud_card: CustomerTagCloudBlock,
  sales_rate_grid_card: SalesRateGridBlock,
  // ── SaaS Mongo 查询 Block ──
  mongo_count_card: MongoCountCard,
  mongo_sum_card: MongoSumCard,
  mongo_rate_card: MongoRateCard,
  mongo_group_pie: MongoGroupPie,
  mongo_daily_trend: MongoDailyTrend,
  mongo_daily_bar: MongoDailyBar,
  mongo_ranking: MongoRanking,
  mongo_recent_table: MongoRecentTable,
};

/**
 * @description Block 渲染器，根据 block.type 从注册表获取组件并渲染
 * @keyword-en block renderer dispatch by type
 */
export const BlockRenderer = ({ block, data, timeRange, dataMap }) => {
  const Component = BLOCK_REGISTRY[block.type];
  if (!Component) {
    return (
      <div className="text-xs text-red-400 p-2 bg-red-50 rounded-2xl">
        未知 block 类型: {block.type}
      </div>
    );
  }
  return <Component block={block} data={data} timeRange={timeRange} dataMap={dataMap} />;
};

export default BLOCK_REGISTRY;
