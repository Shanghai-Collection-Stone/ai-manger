import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, BarChart3, Table2, TrendingUp, MessageCircle, Heart, Bookmark } from 'lucide-react';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 获取认证 header
 * @keyword-en get auth headers
 */
function getAuthHeaders() {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('admin_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * @description 格式化日期为简短格式
 * @keyword-en format date short
 */
const fmtDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

/**
 * @description 格式化数字为千/万缩写
 * @keyword-en format number compact
 */
const fmtNum = (n) => {
  if (typeof n !== 'number') return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
};

/* ─── SVG 柱状图组件 ─── */

/**
 * @description 最近N条数据的点赞/评论/收藏柱状对比图（纯 SVG）
 * @keyword-en BarChartSVG recent stats bar chart
 */
const BarChartSVG = ({ data }) => {
  if (!data || data.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-10">暂无数据</div>;
  }

  const W = 600, H = 260, PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 60;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...data.flatMap(d => [d.likeCount || 0, d.commentCount || 0, d.collectCount || 0]), 1);
  const groups = data.length;
  const groupW = chartW / groups;
  const barW = Math.min(groupW * 0.22, 20);
  const gap = barW * 0.3;

  const colors = ['#f43f5e', '#3b82f6', '#f59e0b']; // 点赞-rose, 评论-blue, 收藏-amber
  const labels = ['点赞', '评论', '收藏'];
  const keys = ['likeCount', 'commentCount', 'collectCount'];

  // Y 轴刻度
  const ticks = 5;
  const step = Math.ceil(maxVal / ticks);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px] mx-auto" preserveAspectRatio="xMidYMid meet">
        {/* Y轴刻度线和标签 */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const val = step * i;
          const y = PAD_T + chartH - (val / (step * ticks)) * chartH;
          return (
            <g key={`y-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{fmtNum(val)}</text>
            </g>
          );
        })}

        {/* 柱状图组 */}
        {data.map((item, gi) => {
          const gx = PAD_L + gi * groupW + groupW / 2;
          return (
            <g key={gi}>
              {keys.map((k, ki) => {
                const v = item[k] || 0;
                const barH = (v / (step * ticks)) * chartH;
                const x = gx - (1.5 * barW + gap) + ki * (barW + gap);
                const y = PAD_T + chartH - barH;
                return (
                  <g key={ki}>
                    <rect x={x} y={y} width={barW} height={barH} fill={colors[ki]} rx={2} opacity={0.85}>
                      <title>{`${labels[ki]}: ${v}`}</title>
                    </rect>
                  </g>
                );
              })}
              {/* X 轴标签 */}
              <text x={gx} y={H - PAD_B + 14} textAnchor="middle" fontSize={8} fill="#64748b" className="select-none">
                {(item.postTitle || '').slice(0, 6)}
              </text>
              <text x={gx} y={H - PAD_B + 26} textAnchor="middle" fontSize={7} fill="#94a3b8">
                {fmtDate(item.dataAt)}
              </text>
            </g>
          );
        })}

        {/* 图例 legend */}
        {labels.map((l, i) => (
          <g key={`legend-${i}`} transform={`translate(${PAD_L + i * 70}, ${H - 8})`}>
            <rect width={10} height={10} fill={colors[i]} rx={2} />
            <text x={14} y={9} fontSize={9} fill="#64748b">{l}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

/* ─── SVG 趋势折线图组件 ─── */

/**
 * @description 按 postHash 聚合同文章多次采集数据的趋势折线图（纯 SVG）
 * @keyword-en TrendChartSVG article trend by postHash
 */
const TrendChartSVG = ({ data }) => {
  // 按 postHash 分组
  const grouped = useMemo(() => {
    const map = new Map();
    (data || []).forEach(item => {
      const hash = item.postHash;
      if (!hash) return;
      if (!map.has(hash)) map.set(hash, { title: item.postTitle, points: [] });
      map.get(hash).points.push({ date: new Date(item.dataAt), like: item.likeCount || 0, comment: item.commentCount || 0, collect: item.collectCount || 0 });
    });
    // 仅显示有 >=2 条记录的文章（才有趋势意义）
    const result = [];
    for (const [hash, val] of map.entries()) {
      if (val.points.length >= 2) {
        val.points.sort((a, b) => a.date - b.date);
        result.push({ hash, ...val });
      }
    }
    return result;
  }, [data]);

  if (grouped.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-10">暂无可追踪的趋势数据（需同一文章 ≥2 次采集）</div>;
  }

  const lineColors = ['#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ec4899'];
  const W = 600, H = 280, PAD_L = 50, PAD_R = 30, PAD_T = 20, PAD_B = 50;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // 全局最大值（取各文章点赞总和的最大值）
  const allVals = grouped.flatMap(g => g.points.map(p => p.like + p.comment + p.collect));
  const maxVal = Math.max(...allVals, 1);

  // 全局日期范围
  const allDates = grouped.flatMap(g => g.points.map(p => p.date.getTime()));
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const dateRange = maxDate - minDate || 1;

  const toX = (t) => PAD_L + ((t - minDate) / dateRange) * chartW;
  const toY = (v) => PAD_T + chartH - (v / maxVal) * chartH;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px] mx-auto" preserveAspectRatio="xMidYMid meet">
        {/* Y 轴网格线 */}
        {Array.from({ length: 5 }, (_, i) => {
          const val = (maxVal / 4) * i;
          const y = toY(val);
          return (
            <g key={`g-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{fmtNum(val)}</text>
            </g>
          );
        })}

        {/* 趋势线 */}
        {grouped.map((article, ai) => {
          const color = lineColors[ai % lineColors.length];
          const pts = article.points.map(p => ({
            x: toX(p.date.getTime()),
            y: toY(p.like + p.comment + p.collect),
            total: p.like + p.comment + p.collect,
          }));
          const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
          return (
            <g key={article.hash}>
              <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, pi) => (
                <g key={pi}>
                  <circle cx={p.x} cy={p.y} r={3.5} fill="white" stroke={color} strokeWidth={1.5} />
                  <title>{`${article.title}: 互动${p.total}`}</title>
                </g>
              ))}
            </g>
          );
        })}

        {/* 图例 */}
        {grouped.slice(0, 5).map((a, i) => (
          <g key={`tl-${i}`} transform={`translate(${PAD_L + i * 110}, ${H - 10})`}>
            <line x1={0} y1={5} x2={14} y2={5} stroke={lineColors[i % lineColors.length]} strokeWidth={2} />
            <text x={18} y={8} fontSize={8} fill="#64748b">{(a.title || '').slice(0, 8)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

/* ─── XhsDataTab 主组件 ─── */

/**
 * @description 小红书数据 Tab，支持表格/图表视图切换，渲染 xhs_post_stats
 * @keyword-en XhsDataTab xhs post stats table and chart view
 * @param {object} props.task - 当前任务对象（需包含 id）
 */
const XhsDataTab = ({ task }) => {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  // 视图模式 tag toggle: 'table' | 'chart'
  const [viewMode, setViewMode] = useState('table');

  /**
   * @description 加载帖子数据
   * @keyword-en load xhs post stats
   */
  useEffect(() => {
    if (!task?.id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/todo/${task.id}/xhs-stats`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : { stats: [] })
      .then(d => { if (!cancelled) setStats(Array.isArray(d.stats) ? d.stats : []); })
      .catch(() => { if (!cancelled) setStats([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task?.id]);

  // 最近 10 条数据（图表用）
  const recent10 = useMemo(() => {
    return [...stats].sort((a, b) => new Date(b.dataAt) - new Date(a.dataAt)).slice(0, 10).reverse();
  }, [stats]);

  if (loading) {
    return (
      /* 加载中 区域 */
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-rose-200 border-t-rose-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    /* 小红书数据主体 区域 */
    <div className="p-4 pb-24">
      {/* 视图切换 tag 区域 */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setViewMode('table')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition ${
            viewMode === 'table'
              ? 'bg-rose-50 text-rose-600 border-rose-200 font-medium'
              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
          }`}
        >
          <Table2 size={13} />
          表格数据
        </button>
        <button
          onClick={() => setViewMode('chart')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition ${
            viewMode === 'chart'
              ? 'bg-rose-50 text-rose-600 border-rose-200 font-medium'
              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
          }`}
        >
          <BarChart3 size={13} />
          图表数据
        </button>
        <span className="ml-auto text-[10px] text-slate-400">共 {stats.length} 条</span>
      </div>

      {stats.length === 0 ? (
        /* 暂无数据占位符 区域 */
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <BarChart3 size={36} strokeWidth={1.2} className="mb-3 text-slate-200" />
          <p className="text-sm">暂无小红书帖子数据</p>
          <p className="text-xs mt-1">数据采集完成后会显示在此处</p>
        </div>
      ) : viewMode === 'table' ? (
        /* 表格视图 区域 */
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-left px-3 py-2.5 font-medium">标题</th>
                <th className="text-center px-2 py-2.5 font-medium w-16">
                  <span className="flex items-center justify-center gap-1"><Heart size={11} />点赞</span>
                </th>
                <th className="text-center px-2 py-2.5 font-medium w-16">
                  <span className="flex items-center justify-center gap-1"><MessageCircle size={11} />评论</span>
                </th>
                <th className="text-center px-2 py-2.5 font-medium w-16">
                  <span className="flex items-center justify-center gap-1"><Bookmark size={11} />收藏</span>
                </th>
                <th className="text-center px-2 py-2.5 font-medium w-20">采集时间</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.id || i} className="border-t border-slate-100 hover:bg-slate-50/50 transition">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800 line-clamp-1">{s.postTitle || '-'}</div>
                    {s.tag && <span className="text-[10px] text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">{s.tag}</span>}
                  </td>
                  <td className="text-center px-2 py-2.5 text-rose-600 font-medium">{fmtNum(s.likeCount)}</td>
                  <td className="text-center px-2 py-2.5 text-blue-600 font-medium">{fmtNum(s.commentCount)}</td>
                  <td className="text-center px-2 py-2.5 text-amber-600 font-medium">{fmtNum(s.collectCount)}</td>
                  <td className="text-center px-2 py-2.5 text-slate-500 text-xs">{fmtDate(s.dataAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* 图表视图 区域 */
        <div className="space-y-6">
          {/* 最近10条柱状图 区域 */}
          <div>
            <h4 className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
              <BarChart3 size={13} className="text-rose-500" />
              最近 {recent10.length} 条数据对比
            </h4>
            <div className="bg-white border border-slate-100 rounded-xl p-3">
              <BarChartSVG data={recent10} />
            </div>
          </div>

          {/* 文章趋势折线图 区域 */}
          <div>
            <h4 className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
              <TrendingUp size={13} className="text-emerald-500" />
              文章数据上升趋势（按 postHash 聚合）
            </h4>
            <div className="bg-white border border-slate-100 rounded-xl p-3">
              <TrendChartSVG data={stats} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default XhsDataTab;
