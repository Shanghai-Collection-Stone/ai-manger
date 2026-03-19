import React, { useEffect, useState } from 'react';
import * as api from './dashboardApi.js';
import { useSwipe } from './useSwipe.js';
import { BlockRenderer } from './blocks/BlockRegistry.jsx';
import { LoadingBox, ErrorBox } from './blocks/shared.jsx';

/* ━━━ query key → API fetcher 映射（预置接口） ━━━ */
const PRESET_FETCHERS = api.queryFetchers;

/**
 * @description 按当前 Tab 的 blocks 收集所有 query key 并批量请求数据（兼容预置接口 + config.queries Mongo 查询）
 * @keyword-en use tab data batch fetch hook with mongo query support
 */
function useTabData(tab, timeRange, configQueries) {
  const [dataMap, setDataMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!tab?.blocks?.length) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataMap({});

    // 收集 query key（含 dependencies）
    const queryKeys = [...new Set(
      tab.blocks.flatMap((b) => [b.query, ...(b.dependencies || [])].filter(Boolean)),
    )];

    Promise.all(
      queryKeys.map((key) => {
        // 优先 config.queries 中定义的 Mongo 查询
        const mqDef = configQueries?.[key];
        if (mqDef) {
          return api.fetchMongoQuery(mqDef, timeRange).then((d) => ({ key, data: d }));
        }
        // 回退到预置 fetcher
        const fetcher = PRESET_FETCHERS[key];
        if (!fetcher) return Promise.resolve({ key, data: null });
        return fetcher(timeRange).then((d) => ({ key, data: d }));
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const map = {};
        results.forEach((r) => { map[r.key] = r.data; });
        setDataMap(map);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab?.id, timeRange]);

  return { dataMap, loading, error };
}

/**
 * @description 看板 Tab + Blocks 网格渲染器（纯 JSON 配置驱动）
 * @keyword-en dashboard content renderer by json config
 */
const DashboardContent = ({ config, timeRange }) => {
  const tabs = config?.tabs || [];
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || '');
  const [slideDir, setSlideDir] = useState('none');
  const tabsOrder = tabs.map((t) => t.id);
  const currentTab = tabs.find((t) => t.id === activeTab) || tabs[0];
  const { dataMap, loading, error } = useTabData(currentTab, timeRange, config?.queries);

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
        @keyframes slideInRight { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @keyframes slideInLeft { from { transform: translateX(-20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        .animate-slide-in-right { animation: slideInRight 0.3s ease-out forwards }
        .animate-slide-in-left { animation: slideInLeft 0.3s ease-out forwards }
        .no-scrollbar::-webkit-scrollbar { display: none }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none }
      `}</style>

      {/* ── Tab 水平导航条（sticky，滚动时保持可见）── */}
      <div
        className="flex space-x-6 overflow-x-auto pt-4 pb-2 mb-2 no-scrollbar shrink-0 sticky top-0 bg-[#F7F9FC] z-10"
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

      {/* ── Blocks CSS Grid 区域 ── */}
      <div
        key={`${activeTab}-${timeRange}`}
        className={`flex-1 pb-24 ${
          slideDir === 'right'
            ? 'animate-slide-in-right'
            : slideDir === 'left'
              ? 'animate-slide-in-left'
              : 'animate-fade-in'
        }`}
        {...swipeHandlers}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${currentTab?.layout?.cols || 2}, 1fr)`,
          gap: `${currentTab?.layout?.gap || 16}px`,
          alignContent: 'start',
        }}
      >
        {loading && !Object.keys(dataMap).length ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <LoadingBox height={300} />
          </div>
        ) : error ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorBox msg={error} />
          </div>
        ) : (
          currentTab?.blocks?.map((block) => (
            <div
              key={block.id}
              style={{
                gridColumn: `span ${block.layout?.colSpan || 1}`,
                gridRow: `span ${block.layout?.rowSpan || 1}`,
              }}
            >
              <BlockRenderer block={block} data={dataMap[block.query]} timeRange={timeRange} dataMap={dataMap} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/**
 * @description 仪表盘视图入口（自动加载 JSON 配置后渲染）
 * @keyword-en dashboard view json config driven entry
 */
const DashboardView = ({ timeRange = '本月' }) => {
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(null);

  useEffect(() => {
    api
      .getDashboardConfig()
      .then((res) => setConfig(res.config))
      .catch((e) => setConfigError(e.message))
      .finally(() => setConfigLoading(false));
  }, []);

  if (configLoading) return <LoadingBox height={400} />;
  if (configError || !config) return <ErrorBox msg={configError || '看板配置加载失败'} />;

  return <DashboardContent config={config} timeRange={timeRange} />;
};

export default DashboardView;
