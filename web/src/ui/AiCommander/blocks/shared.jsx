import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * @description 加载占位框
 * @keyword-en loading box placeholder
 */
export const LoadingBox = ({ height = 120 }) => (
  <div
    className="flex items-center justify-center bg-white rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
    style={{ minHeight: height }}
  >
    <Loader2 size={20} className="animate-spin text-indigo-400" />
  </div>
);

/**
 * @description 错误提示框
 * @keyword-en error message box
 */
export const ErrorBox = ({ msg }) => (
  <div className="bg-red-50 text-red-500 text-xs p-4 rounded-3xl">{msg}</div>
);

/**
 * @description 进度条组件
 * @keyword-en progress bar
 */
export const ProgressBar = ({ value = 0 }) => (
  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
    <div
      className="h-full bg-indigo-600 rounded-full transition-all"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    ></div>
  </div>
);

/**
 * @description 生成环形饼图 ECharts option
 * @keyword-en pie chart option builder
 */
export const pieOption = (data, colors) => ({
  color: colors,
  tooltip: { trigger: 'item' },
  series: [
    {
      type: 'pie',
      radius: ['55%', '75%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
      label: { show: false, position: 'center' },
      emphasis: {
        label: { show: true, fontSize: '14', fontWeight: 'bold' },
        scale: true,
        scaleSize: 5,
      },
      labelLine: { show: false },
      data,
    },
  ],
});

/* ━━━ EChart CDN 懒加载 + 渲染 ━━━ */

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

/**
 * @description EChart 图表组件，懒加载 echarts CDN 库并渲染
 * @keyword-en echart lazy-load chart component
 */
export const EChart = ({ option, height = 160, plugins = [] }) => {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const readyRef = useRef(false);

  /* 首次加载脚本 */
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
        if (p === 'wordcloud') await loadWordcloud();
      }
      if (cancelled) return;
      readyRef.current = true;
      if (ref.current && !chartRef.current) {
        const rect = ref.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          chartRef.current = window.echarts.init(ref.current, undefined, { renderer: 'canvas' });
        }
      }
      if (chartRef.current && option) chartRef.current.setOption(option, true);
    })();
    return () => { cancelled = true; };
  }, []);

  /* option / height 变化时重绘 */
  useEffect(() => {
    if (typeof window === 'undefined' || !readyRef.current || !ref.current || !window.echarts) return;
    if (!chartRef.current) {
      const rect = ref.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        chartRef.current = window.echarts.init(ref.current, undefined, { renderer: 'canvas' });
      }
    }
    if (chartRef.current && option) chartRef.current.setOption(option, true);
  }, [option, height]);

  /* resize 监听 + 清理 */
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

/** @description 通用卡片样式常量 @keyword-en card style constant */
export const CARD = 'bg-white rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]';
