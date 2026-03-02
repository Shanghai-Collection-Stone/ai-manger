/**
 * Dashboard API 服务层
 * 与 NestJS 后端 /dashboard/* 接口通信
 */

const API_BASE = window.location.port === '4322'
  ? 'http://localhost:3011'  // Astro dev → 后端
  : '';                       // 同源部署

async function fetchApi(path, timeRange) {
  const url = `${API_BASE}/dashboard/${path}?timeRange=${encodeURIComponent(timeRange)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
  return res.json();
}

export const getRevenueOverview = (timeRange) => fetchApi('revenue-overview', timeRange);
export const getDailyRevenue = (timeRange) => fetchApi('daily-revenue', timeRange);
export const getPeopleStats = (timeRange) => fetchApi('people-stats', timeRange);
export const getDemandChannel = (timeRange) => fetchApi('demand-channel', timeRange);
export const getEvents = (timeRange) => fetchApi('events', timeRange);
export const getSales = (timeRange) => fetchApi('sales', timeRange);
