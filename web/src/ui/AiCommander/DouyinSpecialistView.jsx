import React, { useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  Clock3,
  Eye,
  Heart,
  MessageCircle,
  Play,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  Zap,
} from 'lucide-react';

const MOCK_CHAT_MESSAGES = [
  {
    id: 'c1',
    role: 'user',
    text: '下周端午小长假，想给景区抖音做一波短视频预热，主推夜游和亲子票。',
    time: '09:12',
  },
  {
    id: 'c2',
    role: 'assistant',
    text: '我建议拆成「夜游氛围感」「亲子路线」「本地生活套餐」三条内容线。先用 15 秒强钩子视频测试完播，再把高完播脚本改成长版团购种草。',
    time: '09:13',
    card: {
      title: '本轮内容策略',
      items: ['3 条短视频脚本', '2 个团购口播版本', '1 组直播间引流话术'],
    },
  },
  {
    id: 'c3',
    role: 'user',
    text: '先给我生成一条适合抖音的夜游视频脚本，要能带到门票转化。',
    time: '09:15',
  },
  {
    id: 'c4',
    role: 'assistant',
    text: '已生成「晚上 7 点后的景区才是真正隐藏玩法」脚本，并模拟匹配了 6 个镜头：入口灯光、NPC 互动、亲子打卡、夜市小吃、演出高潮、购票 CTA。',
    time: '09:16',
  },
  {
    id: 'c5',
    role: 'assistant',
    text: '视频草稿已进入右侧「生成视频」Tab，预计可作为抖音本地生活投放素材 A/B 测试第一版。',
    time: '09:17',
  },
];

const MOCK_VIDEOS = [
  {
    id: 'v1',
    title: '晚上 7 点后的景区隐藏玩法',
    status: '已生成',
    duration: '00:18',
    color: 'from-slate-900 via-cyan-900 to-blue-700',
    hook: '别白天来，这个景区晚上才开大招',
    views: '12.8w',
    likes: '8,420',
    completion: '43%',
  },
  {
    id: 'v2',
    title: '亲子一日游不踩雷路线',
    status: '剪辑中',
    duration: '00:26',
    color: 'from-amber-500 via-rose-500 to-fuchsia-600',
    hook: '带娃来这里，照着这条线走就够了',
    views: '6.1w',
    likes: '3,180',
    completion: '39%',
  },
  {
    id: 'v3',
    title: '99 元夜游套餐口播版',
    status: '待发布',
    duration: '00:15',
    color: 'from-emerald-700 via-teal-600 to-sky-600',
    hook: '本地人周末想放松，直接冲这个夜游套餐',
    views: '3.4w',
    likes: '1,760',
    completion: '36%',
  },
];

const MOCK_METRICS = [
  { label: '今日曝光', value: '28.6w', delta: '+18.4%', icon: Eye, tone: 'blue' },
  { label: '成交线索', value: '426', delta: '+11.2%', icon: TrendingUp, tone: 'emerald' },
  { label: '粉丝增长', value: '3,912', delta: '+7.8%', icon: Users, tone: 'violet' },
  { label: '平均完播', value: '41%', delta: '+5.6%', icon: Video, tone: 'rose' },
];

const MOCK_DATA_ROWS = [
  { topic: '夜游灯光秀', exposure: '12.8w', leads: 186, score: 94 },
  { topic: '亲子路线攻略', exposure: '8.7w', leads: 124, score: 88 },
  { topic: '本地生活团购', exposure: '5.9w', leads: 96, score: 82 },
  { topic: '游客真实反馈', exposure: '3.1w', leads: 20, score: 68 },
];

/**
 * @description 读取抖音数据卡片的 Tailwind 色彩类。
 * @keyword-en douyin-specialist
 * @keyword-en metric-card
 * @param {string} tone - 指标色彩标识。
 * @returns {{ iconBg: string, text: string }}
 */
const getMetricTone = (tone) => {
  const tones = {
    blue: { iconBg: 'bg-blue-50 text-blue-600', text: 'text-blue-600' },
    emerald: { iconBg: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-600' },
    violet: { iconBg: 'bg-violet-50 text-violet-600', text: 'text-violet-600' },
    rose: { iconBg: 'bg-rose-50 text-rose-600', text: 'text-rose-600' },
  };
  return tones[tone] || tones.blue;
};

/**
 * @description 抖音数据指标卡片。
 * @keyword-en douyin-specialist
 * @keyword-en metric-card
 * @param {{ metric: { label: string, value: string, delta: string, icon: React.ComponentType, tone: string } }} props
 * @returns {JSX.Element}
 */
const MetricCard = ({ metric }) => {
  const Icon = metric.icon;
  const tone = getMetricTone(metric.tone);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone.iconBg}`}>
          <Icon size={18} />
        </div>
        <span className={`text-xs font-semibold ${tone.text}`}>{metric.delta}</span>
      </div>
      <div className="mt-4 text-2xl font-black text-slate-900">{metric.value}</div>
      <div className="mt-1 text-xs text-slate-500">{metric.label}</div>
    </div>
  );
};

/**
 * @description 抖音专家模拟聊天气泡。
 * @keyword-en douyin-specialist
 * @keyword-en mock-chat
 * @param {{ message: { role: string, text: string, time: string, card?: { title: string, items: string[] } } }} props
 * @returns {JSX.Element}
 */
const ChatBubble = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-md'
              : 'bg-white border border-slate-100 text-slate-700 rounded-bl-md'
          }`}
        >
          {message.text}
          {message.card && (
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 text-slate-700">
              <div className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <Sparkles size={13} className="text-amber-500" />
                {message.card.title}
              </div>
              <div className="space-y-1.5">
                {message.card.items.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="mt-1 text-[10px] text-slate-400">{message.time}</span>
      </div>
    </div>
  );
};

/**
 * @description 抖音模拟生成视频卡片。
 * @keyword-en douyin-specialist
 * @keyword-en mock-video
 * @param {{ video: { title: string, status: string, duration: string, color: string, hook: string, views: string, likes: string, completion: string } }} props
 * @returns {JSX.Element}
 */
const VideoCard = ({ video }) => (
  <div className="rounded-3xl border border-slate-100 bg-white p-3 shadow-sm hover:shadow-md transition">
    <div className={`relative aspect-[9/16] rounded-2xl overflow-hidden bg-gradient-to-br ${video.color}`}>
      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
        <span className="px-2 py-1 rounded-full bg-white/90 text-[10px] font-semibold text-slate-800">
          {video.status}
        </span>
        <span className="px-2 py-1 rounded-full bg-black/35 text-[10px] font-semibold text-white">
          {video.duration}
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full bg-white/92 text-slate-900 flex items-center justify-center shadow-xl">
          <Play size={24} fill="currentColor" className="ml-1" />
        </div>
      </div>
      <div className="absolute left-3 right-3 bottom-3">
        <div className="text-white text-sm font-bold leading-snug drop-shadow">{video.title}</div>
        <div className="mt-2 text-[11px] text-white/80 line-clamp-2">{video.hook}</div>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
      <div className="rounded-xl bg-slate-50 py-2">
        <div className="text-xs font-bold text-slate-800">{video.views}</div>
        <div className="text-[10px] text-slate-400">播放</div>
      </div>
      <div className="rounded-xl bg-slate-50 py-2">
        <div className="text-xs font-bold text-slate-800">{video.likes}</div>
        <div className="text-[10px] text-slate-400">点赞</div>
      </div>
      <div className="rounded-xl bg-slate-50 py-2">
        <div className="text-xs font-bold text-slate-800">{video.completion}</div>
        <div className="text-[10px] text-slate-400">完播</div>
      </div>
    </div>
  </div>
);

/**
 * @description 抖音专家页面，提供模拟聊天、生成视频和抖音数据 Tab。
 * @keyword-en douyin-specialist
 * @keyword-en mock-chat
 * @keyword-en mock-video
 * @keyword-en douyin-data
 * @param {{ onBack?: Function }} props
 * @returns {JSX.Element}
 */
const DouyinSpecialistView = ({ onBack }) => {
  const [tab, setTab] = useState('chat');
  const tabs = [
    { key: 'chat', label: '抖音专家', icon: MessageCircle },
    { key: 'videos', label: '生成视频', icon: Video },
    { key: 'data', label: '抖音数据', icon: BarChart3 },
  ];

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
        <button
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0 gap-0.5">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                tab === key
                  ? 'bg-white shadow text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto hidden sm:flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          模拟演示数据
        </div>
      </div>

      {tab === 'chat' && (
        <div className="flex-1 min-h-0 bg-slate-50 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
              <div className="mx-auto mb-2 max-w-md text-center">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-br from-slate-900 via-cyan-700 to-rose-500 text-white flex items-center justify-center shadow-lg">
                  <Zap size={28} />
                </div>
                <h2 className="mt-3 text-lg font-black text-slate-900">抖音专家</h2>
                <p className="mt-1 text-sm text-slate-500">
                  模拟短视频选题、脚本生成、视频草稿和本地生活转化分析
                </p>
              </div>
              {MOCK_CHAT_MESSAGES.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 bg-white">
              <div className="max-w-3xl mx-auto flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  readOnly
                  value=""
                  placeholder="输入问题，关于抖音短视频运营..."
                  className="flex-1 bg-transparent text-sm outline-none text-slate-500"
                />
                <button className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          <aside className="hidden xl:flex w-[320px] border-l border-slate-100 bg-white p-4 flex-col gap-3">
            <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-bold text-slate-500 mb-3">本周执行摘要</div>
              <div className="space-y-3">
                {[
                  ['脚本生成', '12 条', 'bg-blue-500'],
                  ['视频草稿', '5 条', 'bg-rose-500'],
                  ['待发布', '3 条', 'bg-amber-500'],
                ].map(([label, value, color]) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {label}
                    </div>
                    <span className="text-sm font-bold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold text-slate-500 mb-2">热点脚本建议</div>
              <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                端午夜游 + 非遗互动 + 本地生活团购，适合先投 15 秒强钩子版本。
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <Clock3 size={13} />
                预计发布时间 18:30-20:30
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'videos' && (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">生成视频草稿</h3>
              <p className="text-xs text-slate-400 mt-1">模拟展示，后续可接入真实视频生成与发布队列</p>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-slate-500">
              <RefreshCw size={13} />
              刷新
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {MOCK_VIDEOS.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {MOCK_METRICS.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">内容线索转化排行</h3>
                  <p className="text-xs text-slate-400 mt-1">按模拟成交线索和完播趋势综合排序</p>
                </div>
                <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-semibold">
                  +12.6%
                </span>
              </div>
              <div className="space-y-3">
                {MOCK_DATA_ROWS.map((row) => (
                  <div key={row.topic} className="rounded-2xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-slate-800">{row.topic}</div>
                      <div className="text-xs text-slate-400">{row.exposure}</div>
                    </div>
                    <div className="h-2 rounded-full bg-white overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-rose-500"
                        style={{ width: `${row.score}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                      <span>线索 {row.leads}</span>
                      <span>热度 {row.score}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-4">互动结构</h3>
              <div className="space-y-3">
                {[
                  { label: '点赞', value: '42%', icon: Heart, color: 'text-rose-500 bg-rose-50' },
                  { label: '评论', value: '18%', icon: MessageCircle, color: 'text-blue-500 bg-blue-50' },
                  { label: '转发', value: '11%', icon: Share2, color: 'text-emerald-500 bg-emerald-50' },
                  { label: '主页访问', value: '29%', icon: Users, color: 'text-violet-500 bg-violet-50' },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.color}`}>
                        <Icon size={17} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{item.label}</span>
                          <span className="font-bold text-slate-900">{item.value}</span>
                        </div>
                        <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-800 rounded-full" style={{ width: item.value }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DouyinSpecialistView;
