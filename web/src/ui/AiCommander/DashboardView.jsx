import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TrendingUp, Calendar, Loader2, Users, Share2 } from 'lucide-react';
import * as api from './dashboardApi.js';
import { useSwipe } from './useSwipe.js';

/* ━━━ 通用 hook：按 timeRange 加载数据 ━━━ */
function useDashboard(fetcher, timeRange) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(timeRange)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timeRange]);
  return { data, loading, error };
}

/* ━━━ 加载 / 错误占位 ━━━ */
const LoadingBox = ({ height = 120 }) => (
  <div className="flex items-center justify-center bg-white rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]" style={{ minHeight: height }}>
    <Loader2 size={20} className="animate-spin text-indigo-400" />
  </div>
);
const ErrorBox = ({ msg }) => (
  <div className="bg-red-50 text-red-500 text-xs p-4 rounded-3xl">{msg}</div>
);

/* ━━━ 主组件 ━━━ */
const DashboardView = ({ timeRange = '本月' }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [slideDir, setSlideDir] = useState('none');

  const tabs = [
    { id: 'overview', label: '总览' },
    { id: 'rev', label: '营收与订单' },
    { id: 'people', label: '客流与人数' },
    { id: 'demand', label: '需求与渠道' },
    { id: 'events', label: '活动与类型' },
    { id: 'sales', label: '销售与客户' },
  ];

  const tabsOrder = tabs.map(t => t.id);

  const onSwipeLeft = () => {
    const idx = tabsOrder.indexOf(activeTab);
    if (idx < tabsOrder.length - 1) {
      setSlideDir('right');
      setActiveTab(tabsOrder[idx + 1]);
    }
  };

  const onSwipeRight = () => {
    const idx = tabsOrder.indexOf(activeTab);
    if (idx > 0) {
      setSlideDir('left');
      setActiveTab(tabsOrder[idx - 1]);
    }
  };

  const swipeHandlers = useSwipe({ onSwipeLeft, onSwipeRight });

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
        .animate-slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div 
        className="flex space-x-6 overflow-x-auto pb-2 mb-2 no-scrollbar shrink-0"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              const newIdx = tabsOrder.indexOf(tab.id);
              const oldIdx = tabsOrder.indexOf(activeTab);
              setSlideDir(newIdx > oldIdx ? 'right' : 'left');
              setActiveTab(tab.id);
            }}
            className={`text-sm font-bold whitespace-nowrap transition-colors relative ${
              activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-indigo-600 rounded-full"></div>
            )}
          </button>
        ))}
      </div>

      <div 
        key={timeRange} 
        className={`space-y-4 flex-1 pb-24 ${slideDir === 'right' ? 'animate-slide-in-right' : slideDir === 'left' ? 'animate-slide-in-left' : 'animate-fade-in'}`}
        {...swipeHandlers}
      >
        <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
          <OverviewDashboard timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'rev' ? 'block' : 'none' }}>
          <RevenueOrders timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'people' ? 'block' : 'none' }}>
          <PeopleMetrics timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'demand' ? 'block' : 'none' }}>
          <DemandMetrics timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'events' ? 'block' : 'none' }}>
          <EventsMetrics timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'sales' ? 'block' : 'none' }}>
          <SalesCustomer timeRange={timeRange} />
        </div>
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━ 1. 总览 ━━━━━━━━━━━━ */
const OverviewDashboard = ({ timeRange }) => {
  const rev = useDashboard(api.getRevenueOverview, timeRange);
  const daily = useDashboard(api.getDailyRevenue, timeRange);
  const ppl = useDashboard(api.getPeopleStats, timeRange);
  const demand = useDashboard(api.getDemandChannel, timeRange);

  if (rev.loading || daily.loading) return <LoadingBox height={400} />;
  if (rev.error) return <ErrorBox msg={rev.error} />;

  const d = rev.data;
  const wan = (v) => (v / 10000).toFixed(2);
  const [wInt, wDec] = wan(d.totalRevenue).split('.');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* AI 覆盖达成率 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
            <span className="text-xs font-bold text-slate-700">AI 覆盖达成率</span>
          </div>
          <span className="text-xs font-bold text-indigo-600">73%</span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out" 
            style={{ width: '73%' }}
          ></div>
        </div>
      </div>

      {/* 总营收卡片 */}
      <div className="bg-white p-5 rounded-3xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-slate-50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-500 flex items-center">
            <Calendar size={14} className="mr-1" /> 实际总营收
          </span>
          <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg flex items-center">
            <TrendingUp size={12} className="mr-1" /> 转化{d.conversionRate}%
          </span>
        </div>
        <div className="flex items-baseline space-x-1">
          <span className="text-4xl font-black text-slate-900 tracking-tight">{wInt}</span>
          <span className="text-lg font-bold text-slate-500">.{wDec}</span>
          <span className="text-sm text-slate-400 ml-1">万元</span>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>成功订单</span>
            <span className="font-bold text-slate-700">{d.successOrderCount} 单</span>
          </div>
          <ProgressBar value={d.conversionRate} />
          <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
            <span>成功人数</span>
            <span className="font-bold text-slate-700">{d.successOrderPeople} 人</span>
          </div>
        </div>
      </div>

      {/* 人数分析 (优化布局：独占一行，增加高度) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="text-xs text-slate-500 mb-3 font-medium flex items-center gap-2">
          <Users size={14} className="text-indigo-500" />
          人数分析
        </div>
        {ppl.data ? (
          <div className="flex items-center justify-between px-2">
            <div className="flex-1 h-[160px] flex items-center justify-center relative">
               {/* 增加图表容器高度，防止截断 */}
              <EChart
                height={160}
                option={pieOption(ppl.data.categories, ['#6366f1','#818cf8','#a5b4fc','#c7d2fe'])}
              />
               {/* 中间总数显示 (可选) */}
               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-slate-400">总计</span>
                  <span className="text-lg font-bold text-slate-700">
                    {ppl.data.categories.reduce((a, b) => a + b.value, 0)}
                  </span>
               </div>
            </div>
            <div className="w-1/2 pl-4 space-y-2">
              {ppl.data.categories.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: ['#6366f1','#818cf8','#a5b4fc','#c7d2fe'][i] }}></span>
                    <span className="text-slate-600 font-medium">{c.name}</span>
                  </div>
                  <span className="font-bold text-slate-800">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <LoadingBox height={160} />}
      </div>

      {/* 各渠道进入数量 (优化布局：独占一行) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="text-xs text-slate-500 mb-3 font-medium flex items-center gap-2">
          <Share2 size={14} className="text-blue-500" />
          各渠道进入数量
        </div>
        {demand.data ? (
          <div className="flex items-center justify-between px-2">
            <div className="flex-1 h-[160px] flex items-center justify-center relative">
               <EChart
                height={160}
                option={pieOption(demand.data.channels.slice(0,5), ['#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe'])}
              />
            </div>
            <div className="w-1/2 pl-4 space-y-2">
              {demand.data.channels.slice(0,5).map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                   <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: ['#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe'][i] }}></span>
                    <span className="text-slate-600 font-medium">{c.name}</span>
                  </div>
                  <span className="font-bold text-slate-800">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <LoadingBox height={160} />}
      </div>

      {/* 日营收趋势 */}
      {daily.data && (
        <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">日人数&日营收趋势</div>
            <div className="text-[10px] text-slate-400">{timeRange}</div>
          </div>
          <EChart
            height={160}
            option={{
              grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: { type: 'category', data: daily.data.labels },
              yAxis: { type: 'value' },
              series: [
                { type: 'bar', data: daily.data.people, name: '人数', itemStyle: { color: '#c7d2fe' } },
                { type: 'line', data: daily.data.revenue, name: '营收', smooth: true, itemStyle: { color: '#4f46e5' } },
              ],
            }}
          />
        </div>
      )}

      {/* 每日需求趋势 */}
      {demand.data && (
        <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">每日需求进入趋势</div>
            <div className="text-[10px] text-slate-400">{timeRange}</div>
          </div>
          <EChart
            height={150}
            option={{
              grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: { type: 'category', data: demand.data.dailyTrend.labels },
              yAxis: { type: 'value' },
              series: [{ type: 'line', data: demand.data.dailyTrend.values, smooth: true, itemStyle: { color: '#6366f1' } }],
            }}
          />
        </div>
      )}

      {/* 销售榜 */}
      <SalesRankingInline timeRange={timeRange} />
    </div>
  );
};

/* ━━━━━━━━━━━━ 2. 营收与订单 ━━━━━━━━━━━━ */
const RevenueOrders = ({ timeRange }) => {
  const { data, loading, error } = useDashboard(api.getRevenueOverview, timeRange);
  if (loading) return <LoadingBox height={300} />;
  if (error) return <ErrorBox msg={error} />;
  const d = data;
  const wan = (v) => (v / 10000).toFixed(2);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white p-5 rounded-3xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-slate-50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-500 flex items-center">
            <Calendar size={14} className="mr-1" /> 累计营收
          </span>
        </div>
        <div className="flex items-baseline space-x-1">
          <span className="text-4xl font-black text-slate-900 tracking-tight">{wan(d.totalRevenue).split('.')[0]}</span>
          <span className="text-lg font-bold text-slate-500">.{wan(d.totalRevenue).split('.')[1]}</span>
          <span className="text-sm text-slate-400 ml-1">万元</span>
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-600 px-1">营收与订单</div>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="实际总营收" value={`${wan(d.totalRevenue)}万`} />
          <StatCard label="成功订单金额" value={`${wan(d.successTotalAmount)}万`} />
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="text-xs text-slate-500 mb-2">转化率</div>
            <div className="text-2xl font-bold text-slate-900 mb-2">{d.conversionRate}<span className="text-sm text-slate-500">%</span></div>
            <ProgressBar value={d.conversionRate} />
          </div>
          <StatCard label="成功订单数量" value={`${d.successOrderCount}`} />
          <StatCard label="成功订单人数" value={`${d.successOrderPeople}`} />
          <StatCard label="场均价格" value={`${d.avgOrderPrice}元`} />
          <StatCard label="人均价格" value={`${d.avgPerPerson}元`} />
          <StatCard label="需求总量" value={`${d.totalDemand}`} />
        </div>
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━ 3. 客流与人数 ━━━━━━━━━━━━ */
const PeopleMetrics = ({ timeRange }) => {
  const ppl = useDashboard(api.getPeopleStats, timeRange);
  const daily = useDashboard(api.getDailyRevenue, timeRange);
  if (ppl.loading) return <LoadingBox height={300} />;
  if (ppl.error) return <ErrorBox msg={ppl.error} />;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-600 px-1">客群与人数</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-1">总计人数</div>
            <div className="text-2xl font-bold text-slate-900">{ppl.data.total}人</div>
          </div>
          
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-3 font-medium flex items-center gap-2">
              <Users size={14} className="text-indigo-500" />
              人数分析
            </div>
            <div className="flex items-center justify-between px-2">
              <div className="flex-1 h-[160px] flex items-center justify-center relative">
                <EChart height={160} option={pieOption(ppl.data.categories, ['#6366f1','#818cf8','#a5b4fc','#c7d2fe'])} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                   <span className="text-xs text-slate-400">总计</span>
                   <span className="text-lg font-bold text-slate-700">{ppl.data.total}</span>
                </div>
              </div>
              <div className="w-1/2 pl-4 space-y-2">
                {ppl.data.categories.map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: ['#6366f1','#818cf8','#a5b4fc','#c7d2fe'][i] }}></span>
                      <span className="text-slate-600 font-medium">{c.name}</span>
                    </div>
                    <span className="font-bold text-slate-800">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {daily.data && (
            <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">日人数&日营收趋势</div>
                <div className="text-[10px] text-slate-400">{timeRange}</div>
              </div>
              <EChart
                height={160}
                option={{
                  grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
                  tooltip: { trigger: 'axis' },
                  xAxis: { type: 'category', data: daily.data.labels },
                  yAxis: { type: 'value' },
                  series: [
                    { type: 'bar', data: daily.data.people, name: '人数', itemStyle: { color: '#c7d2fe' } },
                    { type: 'line', data: daily.data.revenue, name: '营收', smooth: true, itemStyle: { color: '#4f46e5' } },
                  ],
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━ 4. 需求与渠道 ━━━━━━━━━━━━ */
const DemandMetrics = ({ timeRange }) => {
  const { data, loading, error } = useDashboard(api.getDemandChannel, timeRange);
  if (loading) return <LoadingBox height={300} />;
  if (error) return <ErrorBox msg={error} />;
  const d = data;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-600 px-1">需求与渠道</div>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="需求进入总量" value={`${d.total}`} />
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="text-xs text-slate-500 mb-2">需求进入转化比</div>
            <div className="text-2xl font-bold text-slate-900 mb-2">{d.conversionRate}<span className="text-sm text-slate-500">%</span></div>
            <ProgressBar value={d.conversionRate} />
          </div>

          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">各渠道进入数量</div>
            <div className="flex items-center justify-between px-2">
              <div className="flex-1 h-[140px] flex items-center justify-center">
                <EChart height={140} option={pieOption(d.channels.slice(0,5), ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6'])} />
              </div>
              <div className="w-1/2 pl-4 space-y-1.5">
                {d.channels.slice(0,5).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6'][i] }}></span>
                      <span className="text-slate-600 font-medium truncate">{c.name}</span>
                    </div>
                    <span className="font-bold text-slate-800 ml-2">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">需求类型</div>
            <div className="flex items-center justify-between px-2">
              <div className="flex-1 h-[140px] flex items-center justify-center">
                <EChart height={140} option={pieOption(d.demandTypes.slice(0,4), ['#0ea5e9','#a5b4fc','#6366f1','#fbbf24'])} />
              </div>
              <div className="w-1/2 pl-4 space-y-1.5">
                {d.demandTypes.slice(0,4).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ['#0ea5e9','#a5b4fc','#6366f1','#fbbf24'][i] }}></span>
                      <span className="text-slate-600 font-medium truncate">{c.name}</span>
                    </div>
                    <span className="font-bold text-slate-800 ml-2">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">每日需求进入趋势</div>
              <div className="text-[10px] text-slate-400">{timeRange}</div>
            </div>
            <EChart
              height={150}
              option={{
                grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: d.dailyTrend.labels },
                yAxis: { type: 'value' },
                series: [{ type: 'line', data: d.dailyTrend.values, smooth: true, itemStyle: { color: '#6366f1' } }],
              }}
            />
          </div>
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">客服接收占比</div>
            {d.staffDistribution.slice(0, 5).map((s) => (
              <div key={s.name} className="mb-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                  <span>{s.name}</span>
                  <span className="font-semibold text-slate-700">{s.value}单</span>
                </div>
                <ProgressBar value={d.total > 0 ? Math.round((s.value / d.total) * 100) : 0} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━ 5. 活动与类型 ━━━━━━━━━━━━ */
const EventsMetrics = ({ timeRange }) => {
  const { data, loading, error } = useDashboard(api.getEvents, timeRange);
  if (loading) return <LoadingBox height={300} />;
  if (error) return <ErrorBox msg={error} />;
  const d = data;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-600 px-1">活动与订单质量</div>
        <div className="grid grid-cols-2 gap-4">
          {/* 活动类型成单率 */}
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">活动类型成单率</div>
            <div className="grid grid-cols-2 gap-3">
              {d.activityTypeConversion.map((it) => (
                <div key={it.name} className="bg-slate-50 rounded-xl p-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                    <span>{it.name}</span>
                    <span className="font-semibold text-slate-800">{it.rate}%</span>
                  </div>
                  <ProgressBar value={it.rate} />
                  <div className="text-[10px] text-slate-400 mt-1">{it.success}/{it.total} 单</div>
                </div>
              ))}
            </div>
          </div>

          {/* 主题活动占比 */}
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">主题活动场次占比</div>
            <div className="flex items-center justify-between px-2">
              <div className="flex-1 h-[140px] flex items-center justify-center">
                <EChart
                  height={140}
                  option={pieOption(
                    [{ name: '主题', value: d.themeRatio }, { name: '其他', value: 100 - d.themeRatio }],
                    ['#6366f1', '#e2e8f0']
                  )}
                />
              </div>
              <div className="w-1/2 pl-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: '#6366f1' }}></span>
                    <span className="text-slate-600 font-medium">主题</span>
                  </div>
                  <span className="font-bold text-slate-800">{d.themeRatio}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: '#e2e8f0' }}></span>
                    <span className="text-slate-600 font-medium">其他</span>
                  </div>
                  <span className="font-bold text-slate-800">{100 - d.themeRatio}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">包厢场次占比</div>
             <div className="flex items-center justify-between px-2">
              <div className="flex-1 h-[140px] flex items-center justify-center">
                <EChart
                  height={140}
                  option={pieOption(
                    [{ name: '包厢', value: d.roomRatio }, { name: '其他', value: 100 - d.roomRatio }],
                    ['#6b7280', '#e5e7eb']
                  )}
                />
              </div>
              <div className="w-1/2 pl-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: '#6b7280' }}></span>
                    <span className="text-slate-600 font-medium">包厢</span>
                  </div>
                  <span className="font-bold text-slate-800">{d.roomRatio}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: '#e5e7eb' }}></span>
                    <span className="text-slate-600 font-medium">其他</span>
                  </div>
                  <span className="font-bold text-slate-800">{100 - d.roomRatio}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* 主题活动收入 */}
          {d.themeStats.length > 0 && (
            <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
              <div className="text-xs text-slate-500 mb-1">主题活动收入&人数</div>
              <EChart
                height={160}
                option={{
                  grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
                  tooltip: { trigger: 'axis' },
                  xAxis: { type: 'category', data: d.themeStats.map((s) => s.name) },
                  yAxis: { type: 'value' },
                  series: [
                    { type: 'bar', data: d.themeStats.map((s) => s.revenue), name: '收入', itemStyle: { color: '#c7d2fe' } },
                    { type: 'line', data: d.themeStats.map((s) => s.people), name: '人数', smooth: true, itemStyle: { color: '#4f46e5' } },
                  ],
                }}
              />
            </div>
          )}

          {/* 包厢收入 */}
          {d.roomStats.length > 0 && (
            <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
              <div className="text-xs text-slate-500 mb-1">包厢收入&人数</div>
              <EChart
                height={160}
                option={{
                  grid: { left: 6, right: 6, top: 12, bottom: 8, containLabel: true },
                  tooltip: { trigger: 'axis' },
                  xAxis: { type: 'category', data: d.roomStats.map((s) => s.name) },
                  yAxis: { type: 'value' },
                  series: [
                    { type: 'bar', data: d.roomStats.map((s) => s.revenue), name: '收入', itemStyle: { color: '#c7d2fe' } },
                    { type: 'line', data: d.roomStats.map((s) => s.people), name: '人数', smooth: true, itemStyle: { color: '#4f46e5' } },
                  ],
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━ 6. 销售与客户 ━━━━━━━━━━━━ */
const SalesCustomer = ({ timeRange }) => {
  const { data, loading, error } = useDashboard(api.getSales, timeRange);
  if (loading) return <LoadingBox height={300} />;
  if (error) return <ErrorBox msg={error} />;
  const d = data;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-600 px-1">销售与客户</div>
        <div className="grid grid-cols-2 gap-4">
          {/* 销售榜 */}
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">销售榜</div>
            <div className="space-y-2">
              {d.salesRanking.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <div className="text-[11px] text-slate-600 w-14 truncate">{s.name}</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${d.salesRanking[0]?.success > 0 ? (s.success / d.salesRanking[0].success) * 100 : 0}%` }}></div>
                  </div>
                  <div className="text-[11px] text-slate-500 w-12 text-right">{s.success}单</div>
                </div>
              ))}
            </div>
          </div>

          {/* 客户TAG 词云 */}
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-2">客户TAG</div>
            <div className="rounded-2xl overflow-hidden bg-white">
              <EChart
                height={240}
                plugins={['wordcloud']}
                option={{
                  backgroundColor: '#ffffff',
                  tooltip: { show: true },
                  series: [{
                    type: 'wordCloud',
                    shape: 'circle',
                    gridSize: 8,
                    sizeRange: [14, 48],
                    rotationRange: [0, 0],
                    textStyle: { color: '#475569', fontWeight: 600 },
                    data: d.tagCloud.map((t) => ({ name: t.name, value: t.value })),
                  }],
                }}
              />
            </div>
          </div>

          {/* 人员成单率 */}
          <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] col-span-2">
            <div className="text-xs text-slate-500 mb-1">人员总成单率</div>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {d.salesRanking.map((s) => (
                <div key={s.name} className="bg-slate-50 p-3 rounded-2xl text-center">
                  <div className="text-[10px] text-slate-500 mb-2">{s.name}</div>
                  <div className="mx-auto w-12 h-12 relative flex items-center justify-center">
                    <EChart
                      height={48}
                      option={{
                        animation: false,
                        tooltip: { show: false },
                        legend: { show: false },
                        series: [{
                          type: 'pie',
                          radius: ['80%','100%'],
                          label: { show: false },
                          data: [
                            { value: s.rate, name: '完成', itemStyle: { color: '#6366f1' } },
                            { value: 100 - s.rate, name: '剩余', itemStyle: { color: '#e5e7eb' } },
                          ],
                        }],
                      }}
                    />
                    <div className="absolute text-[10px] font-bold text-slate-700">{s.rate}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ━━━ 内联销售榜 (总览页用) ━━━ */
const SalesRankingInline = ({ timeRange }) => {
  const { data } = useDashboard(api.getSales, timeRange);
  if (!data) return null;
  return (
    <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
      <div className="text-xs text-slate-500 mb-2">销售榜</div>
      <div className="space-y-2">
        {data.salesRanking.slice(0,3).map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="text-[11px] text-slate-600 w-14 truncate">{item.name}</div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${data.salesRanking[0]?.success > 0 ? (item.success / data.salesRanking[0].success) * 100 : 0}%` }}></div>
            </div>
            <div className="text-[11px] text-slate-500 w-12 text-right">{item.success}单</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ━━━ 小卡片工具 ━━━ */
const StatCard = ({ label, value }) => (
  <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
    <div className="text-xs text-slate-500 mb-1">{label}</div>
    <div className="text-2xl font-bold text-slate-900">{value}</div>
  </div>
);

/* ━━━━━━━━━━━━ 图表配置 ━━━━━━━━━━━━ */
const pieOption = (data, colors) => ({
  color: colors,
  tooltip: { trigger: 'item' },
  series: [
    {
      type: 'pie',
      radius: ['55%', '75%'], // 调整圆环粗细和大小，防止过大被切断
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 5,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: { show: false, position: 'center' },
      emphasis: {
        label: { show: true, fontSize: '14', fontWeight: 'bold' },
        scale: true,
        scaleSize: 5
      },
      labelLine: { show: false },
      data: data
    }
  ]
});

/* ━━━ EChart 组件 (上一轮已修复的版本) ━━━ */
let __echartsScriptPromise;
const __echartsPluginPromises = {};
const loadScript = (srcs) =>
  new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= srcs.length) return resolve(false);
      const s = document.createElement('script');
      s.src = srcs[i];
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => {
        s.remove();
        tryNext(i + 1);
      };
      document.head.appendChild(s);
    };
    tryNext(0);
  });

const loadWordcloud = async () => {
  if (typeof window === 'undefined') return false;
  if (window.echartsWordcloud) return true;
  if (!__echartsPluginPromises.wordcloud) {
    __echartsPluginPromises.wordcloud = loadScript([
      'https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js',
      'https://unpkg.com/echarts-wordcloud@2/dist/echarts-wordcloud.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/echarts-wordcloud/2.1.0/echarts-wordcloud.min.js',
    ]).then((loaded) => {
      if (loaded) window.echartsWordcloud = true;
      return loaded;
    });
  }
  return __echartsPluginPromises.wordcloud;
};

const EChart = ({ option, height = 160, plugins = [] }) => {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const readyRef = useRef(false);

  // Load scripts once
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      if (!window.echarts) {
        if (!__echartsScriptPromise) {
          __echartsScriptPromise = loadScript([
            'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js',
            'https://unpkg.com/echarts@5.5.0/dist/echarts.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js',
          ]);
        }
        await __echartsScriptPromise;
      }
      if (!window.echarts || cancelled) return;
      for (const p of plugins) {
        if (p === 'wordcloud') {
          await loadWordcloud();
        }
      }
      if (cancelled) return;
      readyRef.current = true;

      if (ref.current && !chartRef.current) {
        const rect = ref.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          chartRef.current = window.echarts.init(ref.current, undefined, { renderer: 'canvas' });
        }
      }
      if (chartRef.current && option) {
        chartRef.current.setOption(option, true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // When option or height changes
  useEffect(() => {
    if (typeof window === 'undefined' || !readyRef.current || !ref.current) return;
    if (!window.echarts) return;

    if (!chartRef.current) {
      const rect = ref.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        chartRef.current = window.echarts.init(ref.current, undefined, { renderer: 'canvas' });
      }
    }
    if (chartRef.current && option) {
      chartRef.current.setOption(option, true);
    }
  }, [option, height]);

  // Resize handling and cleanup
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const initIfReady = () => {
      if (!chartRef.current && readyRef.current && window.echarts) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          chartRef.current = window.echarts.init(el, undefined, { renderer: 'canvas' });
          if (option) chartRef.current.setOption(option, true);
        }
      }
    };
    const ro = new ResizeObserver(() => {
      if (!chartRef.current) initIfReady();
      if (chartRef.current) chartRef.current.resize();
    });
    ro.observe(el);
    const onResize = () => {
      if (!chartRef.current) initIfReady();
      if (chartRef.current) chartRef.current.resize();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height }} />;
};

const ProgressBar = ({ value = 0 }) => (
  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
    <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }}></div>
  </div>
);

export default DashboardView;
