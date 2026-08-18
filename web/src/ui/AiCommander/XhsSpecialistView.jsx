import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertCircle,
  BookOpen,
  X,
  CircleDot,
  User,
  ArrowLeft,
  XCircle,
  Timer,
  ChevronRight,
  LayoutGrid,
  FileText,
  Images,
  Lightbulb,
  PenLine,
  BarChart3,
  Search,
  MoreHorizontal,
  Plus,
  Heart,
  Star,
  MessageCircle,
  Share2,
  Smartphone,
  Video,
  Radio,
  Sparkles,
  ImagePlus,
  Tag,
} from 'lucide-react';
import ChatBIView from './ChatBIView';
import XhsDataTab from './XhsDataTab';
import CanvasFeedView from './CanvasFeedView';
import ImageGroupCanvasView from './ImageGroupCanvasView';
import DesignEditorView from './design-editor/DesignEditorView';
import XhsPublishingView from './XhsPublishingView';
import XhsWorkspaceShell from './XhsWorkspaceShell';
import { chatService } from './chatService';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/** 图库选择面板一次最多铺多少个标签胶囊，标签成百上千时靠搜索框收敛而不是全渲染。 */
const GALLERY_TAG_CHIP_LIMIT = 60;
/** 图库选择面板一页拉多少张，滚到底再按游标追加下一页。 */
const GALLERY_PAGE_SIZE = 40;
/**
 * 图库类型筛选档位，直接对应后端 `imageType`。
 * `regular` 在后端 `buildImageTypeFilter` 里排掉 `isCollage=true` **和**全部封面标签
 * （封面/拼图封面/自动封面/canvas封面），所以它等于「只看自己的照片」。
 */
const GALLERY_TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'regular', label: '普通图' },
  { key: 'collage', label: '拼图' },
];
/** 距离列表底部多少像素就预取下一页，留出余量避免滚到底才开始转圈。 */
const GALLERY_SCROLL_THRESHOLD = 240;

/**
 * @description 获取认证 token
 * @keyword-en get auth token
 */
function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('admin_token') || '';
}

/**
 * @description 获取认证 header
 * @keyword-en get auth headers
 */
function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** @description 小红书专家会话配置，main 走后端 supervisor 自动分派，其他项供专业用户手动直达。 */
const XHS_SUBAGENTS = [
  {
    id: 'main',
    label: '小红书专家',
    assignee: null,
    sessionType: 'xhs-specialist',
    sessionStorageKey: 'ai_commander_xhs_session',
    welcomeTitle: '小红书专家',
    welcomeDesc: '基于 Canvas 和图库，帮你生成、追踪和发布小红书内容',
    quickPrompts: [
      '生成一组小红书文章',
      '查看我的 Canvas 列表',
      '创建发布计划',
    ],
    inputPlaceholder: '输入问题，关于小红书内容创作...',
  },
  {
    id: 'tracker',
    label: '数据追踪',
    assignee: 'robot:xhs_tracker',
    sessionType: 'xhs-tracker',
    sessionStorageKey: 'ai_commander_xhs_tracker_session',
    welcomeTitle: '数据追踪',
    welcomeDesc: '分析账号互动、爆文规律与粉丝增长趋势',
    quickPrompts: [
      '分析近期爆款笔记特点',
      '查看账号粉丝增长趋势',
      '对比竞品账号数据',
    ],
    inputPlaceholder: '输入分析需求，关于小红书账号数据...',
  },
  {
    id: 'publish',
    label: '发文执行',
    assignee: 'robot:xhs_publisher',
    sessionType: 'xhs-publisher',
    sessionStorageKey: 'ai_commander_xhs_publish_session',
    welcomeTitle: '发文执行',
    welcomeDesc: '将内容推入发布流程，批量派单执行',
    quickPrompts: [
      '发布当前 Canvas 文章',
      '查看发布任务进度',
      '批量派发发布任务',
    ],
    inputPlaceholder: '输入发布指令...',
  },
  {
    id: 'article-expert',
    label: '生文专家',
    assignee: null,
    sessionType: 'xhs-article-expert',
    sessionStorageKey: 'ai_commander_xhs_article_expert_session',
    welcomeTitle: '生文专家',
    welcomeDesc: '基于 Canvas 画布生成小红书图文内容，从主题到文章一键生成',
    quickPrompts: [
      '生成一批图文 Canvas',
      '基于已有 Canvas 补充文章',
      '查看图文 Canvas 列表',
    ],
    inputPlaceholder: '输入主题或要求，生成小红书图文...',
  },
  {
    id: 'image-expert',
    label: '生图专家',
    assignee: null,
    sessionType: 'xhs-image-expert',
    sessionStorageKey: 'ai_commander_xhs_image_expert_session',
    welcomeTitle: '生图专家',
    welcomeDesc: '基于图库和 Canvas 生成小红书图片组，匹配标签配图',
    quickPrompts: [
      '生成一组图片 Canvas',
      '为 Canvas 生成图片组',
      '查看图组 Canvas 列表',
    ],
    inputPlaceholder: '输入要求，生成小红书图片组...',
  },
];

/**
 * @description 从接口响应或 Todo taskResult 中读取并规范化带题目类型的候选列表
 * @keyword-cn 读取选题结果, 题目类型
 * @keyword-en read-topic-result, topic-type
 */
function readGeneratedTopicCandidates(response) {
  if (response?.todo?.status && response.todo.status !== 'done') return [];
  let candidates = response?.result?.candidates;
  if (
    !Array.isArray(candidates) &&
    typeof response?.todo?.taskResult === 'string'
  ) {
    try {
      candidates = JSON.parse(response.todo.taskResult)?.candidates;
    } catch {
      candidates = [];
    }
  }
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((candidate) => ({
      title: String(candidate?.title ?? '').trim(),
      topicType: String(candidate?.topicType ?? '').trim() || '其他',
    }))
    .filter(
      (candidate, index, list) =>
        candidate.title &&
        list.findIndex((item) => item.title === candidate.title) === index,
    );
}

/**
 * @description 根据正文实际内容高度撑开输入框，避免正文区域出现独立滚动条。
 * @keyword-cn 正文自动撑高, 平铺内容
 * @keyword-en auto-grow-article-body, flat-content
 */
function resizeArticleBodyTextarea(element) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

/**
 * @description 渲染左侧提示词输入、右侧纯文字候选多选列表的 AI 选题弹层
 * @keyword-cn AI选题弹层, 多项选择, 文字候选列表
 * @keyword-en ai-topic-dialog, multi-select, text-candidate-list
 */
const TopicCandidateDialog = ({
  title,
  description,
  prompt,
  promptLabel,
  promptPlaceholder,
  generateLabel,
  candidates,
  selectedCandidates,
  emptyTitle,
  emptyDescription,
  contextLabel,
  contextValue,
  confirmLabel,
  generating,
  saving,
  error,
  theme = 'blue',
  recommendationLoading = false,
  onRecommend,
  onPromptChange,
  onGenerate,
  onToggle,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-[78] flex items-center justify-center bg-slate-950/40 p-6 backdrop-blur-sm">
    <div className="flex h-[min(700px,calc(100vh-48px))] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_28px_90px_rgba(26,43,92,0.28)]">
      <div
        className={`flex w-[370px] shrink-0 flex-col border-r border-slate-100 bg-gradient-to-b to-white p-7 ${theme === 'rose' ? 'from-rose-50/90' : 'from-blue-50/80'}`}
      >
        <div className="mb-7 flex items-start gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${theme === 'rose' ? 'from-rose-500 to-orange-400 shadow-rose-200' : 'from-[#3266d5] to-[#7196e8] shadow-blue-200'}`}
          >
            <Sparkles size={20} />
          </span>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {description}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-slate-600">
            {promptLabel}
          </label>
          {onRecommend && (
            <button
              disabled={recommendationLoading || generating || saving}
              onClick={onRecommend}
              className={`flex items-center gap-1 text-[11px] font-semibold disabled:cursor-wait disabled:opacity-50 ${theme === 'rose' ? 'text-rose-500 hover:text-rose-600' : 'text-blue-600 hover:text-blue-700'}`}
            >
              <Sparkles
                size={12}
                className={recommendationLoading ? 'animate-pulse' : ''}
              />
              {recommendationLoading ? 'AI 推荐中…' : '换一条 AI 推荐'}
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          className={`mt-2 min-h-[220px] resize-none rounded-2xl border bg-white p-4 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:ring-4 ${theme === 'rose' ? 'border-rose-200 focus:border-rose-400 focus:ring-rose-100' : 'border-blue-200 focus:border-blue-400 focus:ring-blue-100'}`}
          placeholder={promptPlaceholder}
        />
        {contextValue && (
          <div
            className={`mt-4 rounded-xl border bg-white/80 px-3 py-2.5 text-xs text-slate-500 ${theme === 'rose' ? 'border-rose-100' : 'border-blue-100'}`}
          >
            <span
              className={`font-semibold ${theme === 'rose' ? 'text-rose-500' : 'text-blue-600'}`}
            >
              {contextLabel}：
            </span>
            {contextValue}
          </div>
        )}
        <button
          disabled={generating || saving}
          onClick={onGenerate}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white shadow-lg disabled:cursor-wait disabled:opacity-65 ${theme === 'rose' ? 'bg-gradient-to-r from-rose-500 to-red-500 shadow-rose-200 hover:from-rose-600 hover:to-red-600' : 'bg-[#3261c9] shadow-blue-200 hover:bg-[#2852ad]'}`}
        >
          {generating ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {generating ? '生成中…' : generateLabel}
        </button>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-500">
            {error}
          </p>
        )}
        <button
          onClick={onCancel}
          className="mt-auto pt-6 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          取消
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">选择候选题目</h3>
            <p className="mt-1 text-xs text-slate-500">
              可选择多项，选中的题目会一次性加入列表。
            </p>
          </div>
          {candidates.length > 0 && (
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${theme === 'rose' ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-600'}`}
            >
              已选 {selectedCandidates.length}/{candidates.length}
            </span>
          )}
        </div>
        {candidates.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-400 shadow-sm">
              {generating ? (
                <RefreshCw size={23} className="animate-spin" />
              ) : (
                <Lightbulb size={23} />
              )}
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-600">
              {generating ? 'AI 正在生成候选题目' : emptyTitle}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {generating
                ? '会按提示词数量逐项写入，并在完成后返回'
                : emptyDescription}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {candidates.map((candidate, index) => {
              const title =
                typeof candidate === 'string' ? candidate : candidate.title;
              const topicType =
                typeof candidate === 'string' ? '' : candidate.topicType;
              const selected = selectedCandidates.includes(title);
              return (
                <button
                  key={`${title}-${index}`}
                  onClick={() => onToggle(title)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${selected ? (theme === 'rose' ? 'border-rose-400 bg-rose-50' : 'border-blue-400 bg-blue-50') : theme === 'rose' ? 'border-slate-200 bg-white hover:border-rose-200 hover:bg-rose-50/40' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'}`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? (theme === 'rose' ? 'border-rose-500 bg-rose-500 text-white' : 'border-[#3261c9] bg-[#3261c9] text-white') : 'border-slate-300 bg-white'}`}
                  >
                    {selected && <CheckCircle size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-5 text-slate-800">
                      {title}
                    </span>
                    {topicType && (
                      <span className="mt-1 block text-xs text-slate-400">
                        题目类型：{topicType}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
          <button
            disabled={generating || saving || selectedCandidates.length === 0}
            onClick={onConfirm}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40 ${theme === 'rose' ? 'bg-gradient-to-r from-rose-500 to-red-500 shadow-rose-200 hover:from-rose-600 hover:to-red-600' : 'bg-[#3261c9] shadow-blue-200 hover:bg-[#2852ad]'}`}
          >
            {saving && <RefreshCw size={15} className="animate-spin" />}
            {saving
              ? '保存中…'
              : `${confirmLabel}（${selectedCandidates.length}）`}
          </button>
        </div>
      </div>
    </div>
  </div>
);

/**
 * @description 输入针对当前文章的修改或重写要求，并确认交给具备当前文章读取工具的 Agent 执行。
 * @keyword-cn 文章重新生成弹层, 读取当前文章
 * @keyword-en article-regenerate-dialog, read-current-article
 */
const ArticleRegenerateDialog = ({
  prompt,
  generating,
  error,
  onPromptChange,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-[79] flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
    <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_28px_90px_rgba(26,43,92,0.3)]">
      <div className="bg-gradient-to-br from-rose-50 via-white to-orange-50 px-7 pb-5 pt-7">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 text-white shadow-lg shadow-rose-200">
            <RefreshCw size={19} className={generating ? 'animate-spin' : ''} />
          </span>
          <div>
            <h3 className="text-lg font-bold text-slate-900">重新生成正文</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              AI
              会先读取当前文章，再按你的要求局部修改或完全重写；现有配图默认保留。
            </p>
          </div>
        </div>
      </div>
      <div className="px-7 pb-7">
        <label className="text-xs font-semibold text-slate-600">
          本次修改提示词
        </label>
        <textarea
          autoFocus
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="例如：保留地点和项目介绍，把正文压缩到 500 字左右，语气更自然；或完全重写一个更偏亲子攻略的版本"
          className="mt-2 min-h-[180px] w-full resize-none rounded-2xl border border-rose-200 bg-rose-50/30 p-4 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-100"
        />
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-500">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            disabled={generating}
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            disabled={generating || !prompt.trim()}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-200 hover:from-rose-600 hover:to-red-600 disabled:cursor-wait disabled:opacity-50"
          >
            {generating && <RefreshCw size={15} className="animate-spin" />}
            {generating ? '处理中…' : '提交给 AI'}
          </button>
        </div>
      </div>
    </div>
  </div>
);

/**
 * @description 小红书专家主视图，组织真实选题、文章库发文与数据工作台三个业务页面。
 * @keyword-cn 小红书专家, 选题发文, 数据工作台
 * @keyword-en xhs-specialist, topic-publishing, data-workspace
 */
const XhsSpecialistView = ({ onBack }) => {
  const [tab, setTab] = useState('chat'); // 'chat' | 'tasks'(发文) | 'canvas'(数据)
  const [activeAgent, setActiveAgent] = useState('main');
  const [agentDropOpen, setAgentDropOpen] = useState(false);
  const agentDropRef = useRef(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskItems, setTaskItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsFetched, setItemsFetched] = useState(false);
  // 详情页内部 tab: 'info' | 'timeline' | 'xhs-data'
  const [detailTab, setDetailTab] = useState('info');
  // Canvas tab state 画布列表状态
  const [canvases, setCanvases] = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasTypeFilter, setCanvasTypeFilter] = useState('all'); // 'all' | 'article' | 'image-group'
  const [selectedCanvas, setSelectedCanvas] = useState(null); // { id, type } 打开的 canvas
  const [topicGroups, setTopicGroups] = useState([]);
  const [topicGroupsLoading, setTopicGroupsLoading] = useState(true);
  const [topicWorkspaceError, setTopicWorkspaceError] = useState('');
  const [selectedTopicGroup, setSelectedTopicGroup] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [publishedTopicIds, setPublishedTopicIds] = useState([]);
  const [selectedMotherTopicIds, setSelectedMotherTopicIds] = useState([]);
  const [motherTopicPage, setMotherTopicPage] = useState(1);
  const [childTopicPage, setChildTopicPage] = useState(1);
  const [childTopicQuery, setChildTopicQuery] = useState('');
  const [previewContentType, setPreviewContentType] = useState('图文');
  const [previewTypeDropdownOpen, setPreviewTypeDropdownOpen] = useState(false);
  const [topicListGeneratorOpen, setTopicListGeneratorOpen] = useState(false);
  const [topicPrompt, setTopicPrompt] = useState(
    '围绕年轻人逛菜市场的真实生活感，给我一些有传播力的内容方向',
  );
  const [childTopicCandidates, setChildTopicCandidates] = useState([]);
  const [selectedChildTopicCandidates, setSelectedChildTopicCandidates] =
    useState([]);
  const [topicCandidateGenerating, setTopicCandidateGenerating] =
    useState(false);
  const [topicCandidateSaving, setTopicCandidateSaving] = useState(false);
  const [topicCandidateError, setTopicCandidateError] = useState('');
  const [childCandidateTodoId, setChildCandidateTodoId] = useState();
  const [childCandidateParentId, setChildCandidateParentId] = useState();
  const [childPromptRecommending, setChildPromptRecommending] = useState(false);
  /**
   * @description 切换 AI 选题弹层中纯文字候选题目的多选状态
   * @keyword-cn 题目候选, 多项选择
   * @keyword-en topic-candidates, multi-select
   */
  const toggleCandidateSelection = (setSelected, value) => {
    setSelected((selected) =>
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  };
  const [motherTopicGeneratorOpen, setMotherTopicGeneratorOpen] =
    useState(false);
  const [motherTopicPrompt, setMotherTopicPrompt] = useState(
    '关注年轻人的日常生活方式，兼顾情绪共鸣与内容传播性',
  );
  const [motherTopicCandidates, setMotherTopicCandidates] = useState([]);
  const [selectedMotherTopicCandidates, setSelectedMotherTopicCandidates] =
    useState([]);
  const [motherCandidateTodoId, setMotherCandidateTodoId] = useState();
  const [inspirationCanvasOpen, setInspirationCanvasOpen] = useState(false);
  const [articleImages, setArticleImages] = useState([]);
  const [activeArticleImageIndex, setActiveArticleImageIndex] = useState(0);
  const [articleGalleryImages, setArticleGalleryImages] = useState([]);
  const [articleGalleryLoading, setArticleGalleryLoading] = useState(false);
  const [articleGalleryLoadingMore, setArticleGalleryLoadingMore] =
    useState(false);
  const [articleGalleryHasMore, setArticleGalleryHasMore] = useState(true);
  const [articleGalleryTags, setArticleGalleryTags] = useState([]);
  const [articleGalleryTag, setArticleGalleryTag] = useState('');
  const [articleGalleryTagQuery, setArticleGalleryTagQuery] = useState('');
  const [articleGalleryType, setArticleGalleryType] = useState('all');
  const [articleTitle, setArticleTitle] = useState('');
  const [articleBody, setArticleBody] = useState('');
  const [articleTags, setArticleTags] = useState([]);
  const [articleTagDraft, setArticleTagDraft] = useState('');
  const [articleGenerationsByTopic, setArticleGenerationsByTopic] = useState(
    {},
  );
  const articleGenerationsRef = useRef({});
  const dismissedArticleGenerationErrorsRef = useRef({});
  const articleGenerationPollInFlightRef = useRef(false);
  const [articleRegeneratorOpen, setArticleRegeneratorOpen] = useState(false);
  const [articleRegenerateTopicId, setArticleRegenerateTopicId] = useState();
  const [articleRegeneratePrompt, setArticleRegeneratePrompt] = useState('');
  const [articleRegenerateError, setArticleRegenerateError] = useState('');
  const articleGalleryUploadRef = useRef(null);
  const articleBodyInputRef = useRef(null);

  /**
   * @description 用接口返回的真实母子选题刷新工作台，并保持仍存在的当前选择
   * @keyword-cn 应用真实选题, 保持选择
   * @keyword-en apply-persisted-topics, preserve-selection
   */
  const applyTopicWorkspace = useCallback((groups) => {
    const nextGroups = Array.isArray(groups) ? groups : [];
    setTopicGroups(nextGroups);
    setSelectedTopicGroup((currentGroupId) => {
      const nextGroup =
        nextGroups.find((item) => item.id === currentGroupId) ?? nextGroups[0];
      setSelectedTopicId((currentTopicId) =>
        nextGroup?.children?.some((item) => item.id === currentTopicId)
          ? currentTopicId
          : '',
      );
      return nextGroup?.id ?? '';
    });
    setPublishedTopicIds(
      nextGroups.flatMap((group) =>
        group.children
          .filter((item) => item.status === 'published')
          .map((item) => item.id),
      ),
    );
  }, []);

  /**
   * @description 从数据库加载当前用户真实母选题和子选题列表
   * @keyword-cn 加载真实选题, 数据库列表
   * @keyword-en load-persisted-topics, database-list
   */
  const loadTopicWorkspace = useCallback(async () => {
    setTopicGroupsLoading(true);
    setTopicWorkspaceError('');
    try {
      const response = await chatService.listXhsTopics();
      applyTopicWorkspace(response?.groups);
    } catch {
      setTopicWorkspaceError('选题数据加载失败，请稍后重试。');
    } finally {
      setTopicGroupsLoading(false);
    }
  }, [applyTopicWorkspace]);

  /**
   * @description 合并服务端返回的文章生成状态，并识别刚从运行中转为完成的子选题。
   * @keyword-cn 合并文章生成状态, 识别生成完成
   * @keyword-en merge-article-generation-state, detect-generation-completion
   */
  const applyArticleGenerationStates = useCallback((generations) => {
    const current = articleGenerationsRef.current;
    const next = { ...current };
    let hasNewCompletion = false;
    for (const generation of Array.isArray(generations) ? generations : []) {
      const topicId = Number(generation?.topicId);
      if (!Number.isInteger(topicId) || topicId < 1) continue;
      const status =
        generation?.status === 'done' || generation?.status === 'failed'
          ? generation.status
          : 'running';
      const generationKey =
        generation?.todoId ?? generation?.updatedAt ?? 'local-error';
      if (
        status === 'failed' &&
        dismissedArticleGenerationErrorsRef.current[topicId] === generationKey
      ) {
        delete next[topicId];
        continue;
      }
      if (current[topicId]?.status === 'running' && status === 'done') {
        hasNewCompletion = true;
      }
      next[topicId] = { ...generation, topicId, status };
    }
    articleGenerationsRef.current = next;
    setArticleGenerationsByTopic(next);
    return hasNewCompletion;
  }, []);

  /**
   * @description 拉取每个子选题最近一次文章生成状态；发现后台任务完成时刷新真实文章工作台。
   * @keyword-cn 轮询文章生成状态, 完成后刷新文章
   * @keyword-en poll-article-generation-state, refresh-completed-article
   */
  const syncArticleGenerationStates = useCallback(
    async (refreshWorkspaceOnCompletion = true) => {
      if (articleGenerationPollInFlightRef.current) return;
      articleGenerationPollInFlightRef.current = true;
      try {
        const response = await chatService.listXhsArticleGenerations();
        const hasNewCompletion = applyArticleGenerationStates(
          response?.generations,
        );
        if (refreshWorkspaceOnCompletion && hasNewCompletion) {
          await loadTopicWorkspace();
        }
      } catch {
        // 状态轮询失败不覆盖具体选题的已有进度或错误，下一轮继续尝试。
      } finally {
        articleGenerationPollInFlightRef.current = false;
      }
    },
    [applyArticleGenerationStates, loadTopicWorkspace],
  );

  /**
   * @description 仅关闭指定子选题下的文章生成错误，不影响其他并发任务。
   * @keyword-cn 关闭单条生成错误, 保留并发任务
   * @keyword-en dismiss-topic-generation-error, preserve-concurrent-tasks
   */
  const dismissArticleGenerationError = useCallback((topicId) => {
    const generation = articleGenerationsRef.current[topicId];
    dismissedArticleGenerationErrorsRef.current[topicId] =
      generation?.todoId ?? generation?.updatedAt ?? 'local-error';
    const next = { ...articleGenerationsRef.current };
    delete next[topicId];
    articleGenerationsRef.current = next;
    setArticleGenerationsByTopic(next);
  }, []);

  /**
   * @description 调用 Todo 驱动的选题接口生成当前母题下的文章题目候选
   * @keyword-cn 生成子选题, 待办候选
   * @keyword-en generate-child-topics, todo-candidates
   */
  const handleGenerateChildTopicCandidates = async (parentTopic) => {
    setTopicCandidateGenerating(true);
    setTopicCandidateError('');
    try {
      const response = await chatService.generateXhsTopicCandidates({
        kind: 'child',
        prompt: topicPrompt,
        parentTopic,
        useSearch: true,
      });
      const candidates = readGeneratedTopicCandidates(response);
      if (!candidates.length) throw new Error('NO_TOPIC_CANDIDATES');
      setChildTopicCandidates(candidates);
      setSelectedChildTopicCandidates([]);
      setChildCandidateTodoId(response?.todo?.id);
    } catch {
      setTopicCandidateError('生成失败，请检查 AI 与 Duck MCP 配置后重试。');
    } finally {
      setTopicCandidateGenerating(false);
    }
  };

  /**
   * @description 请求 AI 根据当前母题推荐一条可编辑的子选题生成提示词。
   * @keyword-cn 子选题提示词推荐, 母题上下文
   * @keyword-en child-topic-prompt-recommendation, parent-topic-context
   */
  const handleRecommendChildTopicPrompt = async (parentTopic) => {
    const normalizedParent = String(parentTopic || '').trim();
    if (!normalizedParent) return;
    setChildPromptRecommending(true);
    setTopicCandidateError('');
    try {
      const response =
        await chatService.recommendXhsChildTopicPrompt(normalizedParent);
      const recommendation = String(response?.prompt || '').trim();
      if (recommendation) setTopicPrompt(recommendation);
    } catch {
      setTopicCandidateError(
        'AI 推荐暂时不可用，已保留基于当前母题的默认提示词。',
      );
    } finally {
      setChildPromptRecommending(false);
    }
  };

  /**
   * @description 打开子选题弹窗，同一母题保留关闭前候选，切换母题时请求新的 AI 推荐提示词。
   * @keyword-cn 保留子题弹窗, 母题隔离, 子选题提示词推荐
   * @keyword-en preserve-child-dialog, parent-isolation, child-topic-prompt-recommendation
   */
  const openChildTopicGenerator = (parentId) => {
    const parentTopic =
      topicGroups.find((item) => item.id === parentId)?.title ||
      topicGroups.find((item) => item.id === selectedTopicGroup)?.title ||
      '';
    if (childCandidateParentId !== parentId) {
      setChildTopicCandidates([]);
      setSelectedChildTopicCandidates([]);
      setChildCandidateTodoId(undefined);
      setChildCandidateParentId(parentId);
      setTopicPrompt(
        `围绕母题“${parentTopic || '当前母题'}”，生成 8 个角度不同、可直接用于小红书图文创作的子选题，兼顾真实体验、实用信息、情绪共鸣与传播性。`,
      );
      void handleRecommendChildTopicPrompt(parentTopic);
    }
    setTopicCandidateError('');
    setTopicListGeneratorOpen(true);
  };

  /**
   * @description 调用 Todo 驱动的选题接口生成可多选的母选题候选
   * @keyword-cn 生成母选题, 待办候选
   * @keyword-en generate-mother-topics, todo-candidates
   */
  const handleGenerateMotherTopicCandidates = async () => {
    setTopicCandidateGenerating(true);
    setTopicCandidateError('');
    try {
      const response = await chatService.generateXhsTopicCandidates({
        kind: 'mother',
        prompt: motherTopicPrompt,
        useSearch: true,
      });
      const candidates = readGeneratedTopicCandidates(response);
      if (!candidates.length) throw new Error('NO_TOPIC_CANDIDATES');
      setMotherTopicCandidates(candidates);
      setSelectedMotherTopicCandidates([]);
      setMotherCandidateTodoId(response?.todo?.id);
    } catch {
      setTopicCandidateError('生成失败，请检查 AI 与 Duck MCP 配置后重试。');
    } finally {
      setTopicCandidateGenerating(false);
    }
  };

  /**
   * @description 将弹窗选中的母选题批量写入数据库并刷新真实列表
   * @keyword-cn 保存母选题, 批量入库
   * @keyword-en save-mother-topics, bulk-persistence
   */
  const handleSaveMotherTopicCandidates = async () => {
    const candidates = motherTopicCandidates.filter((candidate) =>
      selectedMotherTopicCandidates.includes(candidate.title),
    );
    if (!candidates.length) return;
    setTopicCandidateSaving(true);
    setTopicCandidateError('');
    try {
      const response = await chatService.createXhsTopics({
        kind: 'mother',
        sourceTodoId: motherCandidateTodoId,
        candidates,
      });
      applyTopicWorkspace(response?.groups);
      setMotherTopicGeneratorOpen(false);
    } catch {
      setTopicCandidateError('保存失败，候选仍会保留，可稍后重试。');
    } finally {
      setTopicCandidateSaving(false);
    }
  };

  /**
   * @description 将弹窗选中的子选题批量写入当前母题并刷新真实列表
   * @keyword-cn 保存子选题, 父题关联
   * @keyword-en save-child-topics, parent-relation
   */
  const handleSaveChildTopicCandidates = async (parentId) => {
    const candidates = childTopicCandidates.filter((candidate) =>
      selectedChildTopicCandidates.includes(candidate.title),
    );
    if (!candidates.length || !parentId) return;
    setTopicCandidateSaving(true);
    setTopicCandidateError('');
    try {
      const response = await chatService.createXhsTopics({
        kind: 'child',
        parentId,
        sourceTodoId: childCandidateTodoId,
        candidates,
      });
      applyTopicWorkspace(response?.groups);
      setTopicListGeneratorOpen(false);
    } catch {
      setTopicCandidateError('保存失败，候选仍会保留，可稍后重试。');
    } finally {
      setTopicCandidateSaving(false);
    }
  };

  /**
   * @description 删除勾选的真实母选题并由服务端级联删除所属子题
   * @keyword-cn 删除母选题, 级联子题
   * @keyword-en delete-mother-topics, cascade-children
   */
  const handleDeleteSelectedMotherTopics = async () => {
    if (!selectedMotherTopicIds.length) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `确定删除选中的 ${selectedMotherTopicIds.length} 个母选题及其全部子选题吗？`,
      )
    )
      return;
    setTopicWorkspaceError('');
    try {
      const response = await chatService.deleteXhsTopics({
        ids: selectedMotherTopicIds,
      });
      setSelectedMotherTopicIds([]);
      applyTopicWorkspace(response?.groups);
    } catch {
      setTopicWorkspaceError('删除失败，请稍后重试。');
    }
  };

  /**
   * @description 为指定子选题异步启动文章 Agent，并把启动状态或错误只写入该选题的状态桶。
   * @keyword-cn 异步生成真实文章, 并发生成, 单条失败原因
   * @keyword-en start-persisted-article, concurrent-generation, per-topic-failure
   */
  const handleGenerateArticleForTopic = async (topicId, prompt = '') => {
    try {
      const response = await chatService.generateXhsArticle(topicId, {
        ...(String(prompt).trim() ? { prompt: String(prompt).trim() } : {}),
        useSearch: true,
      });
      applyArticleGenerationStates([
        {
          topicId,
          todoId: response?.todo?.id,
          status:
            response?.todo?.status === 'done'
              ? 'done'
              : response?.todo?.status === 'failed'
                ? 'failed'
                : 'running',
          errorMessage: response?.todo?.abnormalReason,
          updatedAt:
            response?.todo?.updatedAt ?? response?.todo?.createdAt ?? '',
        },
      ]);
      setSelectedTopicId(topicId);
      return { ok: true };
    } catch (error) {
      const message =
        error?.message || '文章生成失败，右侧不会解锁，请稍后重试。';
      applyArticleGenerationStates([
        {
          topicId,
          todoId: error?.todoId,
          status: 'failed',
          error: error?.code,
          errorMessage: message,
          updatedAt: new Date().toISOString(),
        },
      ]);
      return { ok: false, message };
    }
  };

  /**
   * @description 打开文章重新生成弹层并绑定目标文章，提示词用于局部修改或完全重写。
   * @keyword-cn 打开文章重生成, 文章提示词
   * @keyword-en open-article-regenerator, article-rewrite-prompt
   */
  const openArticleRegenerator = (topicId = selectedTopicId) => {
    const targetGroup = topicGroups.find(
      (item) => item.id === selectedTopicGroup,
    );
    const targetTopic = targetGroup?.children?.find(
      (item) => item.id === topicId,
    );
    if (!targetTopic?.article) return;
    setSelectedTopicId(topicId);
    setArticleRegenerateTopicId(topicId);
    setArticleRegeneratePrompt(
      '先读取当前文章，保留其中可靠的事实、地点信息和现有配图，优化标题与正文结构，让表达更自然、更有信息量。',
    );
    setArticleRegenerateError('');
    setArticleRegeneratorOpen(true);
  };

  /**
   * @description 提交文章修改提示词，让 Agent 先读取当前文章后执行局部修改或重新生成。
   * @keyword-cn 提交文章重生成, 读取当前文章
   * @keyword-en submit-article-regeneration, read-current-article
   */
  const handleRegenerateCurrentArticle = async () => {
    const topicId = articleRegenerateTopicId || selectedTopicId;
    const prompt = articleRegeneratePrompt.trim();
    if (!topicId || !prompt) {
      setArticleRegenerateError('请先填写本次希望 AI 如何修改文章。');
      return;
    }
    setArticleRegenerateError('');
    const outcome = await handleGenerateArticleForTopic(topicId, prompt);
    if (outcome.ok) {
      setArticleRegeneratorOpen(false);
      setArticleRegenerateTopicId(undefined);
    } else {
      setArticleRegenerateError(
        outcome.message || '文章处理失败，请稍后重试。',
      );
    }
  };

  /**
   * @description 将当前已生成文章的编辑补丁写回数据库并刷新工作台。
   * @keyword-cn 保存真实文章, 数据库编辑
   * @keyword-en persist-article-edit, database-update
   */
  const persistCurrentArticle = async (patch) => {
    const group = topicGroups.find((item) => item.id === selectedTopicGroup);
    const topic = group?.children?.find((item) => item.id === selectedTopicId);
    if (!topic?.article) return;
    setTopicWorkspaceError('');
    try {
      const response = await chatService.updateXhsArticle(topic.id, patch);
      applyTopicWorkspace(response?.groups);
    } catch {
      setTopicWorkspaceError('文章修改保存失败，请稍后重试。');
    }
  };

  /**
   * @description 将真实图库图片加入或替换当前文章图组并立即持久化；整张换掉拼图时同步清掉该槽位的拼图画布格式。
   * @keyword-cn 选择真实配图, 保存文章图组, 拼图画布格式
   * @keyword-en select-persisted-image, save-article-images, collage-canvas-format
   */
  const handleSelectArticleImage = (sourceUrl) => {
    if (!sourceUrl) return;
    const nextImages =
      articleImages.length > 0
        ? articleImages.map((image, index) =>
            index === activeArticleImageIndex ? sourceUrl : image,
          )
        : [sourceUrl];
    setArticleImages(nextImages);
    setActiveArticleImageIndex(
      Math.min(activeArticleImageIndex, nextImages.length - 1),
    );
    // 这个槽位已经整张换成别的图，旧拼图的格子不再成立；留着会让灵感画布
    // 拿上一张拼图的坐标去拆一张全新的图。
    const boards = Array.isArray(selectedTopic?.article?.canvasBoards)
      ? selectedTopic.article.canvasBoards
      : [];
    const hasStaleBoardLayers = boards.some(
      (board) =>
        Number(board?.imageIndex) === activeArticleImageIndex &&
        (board?.collage || board?.baseSrc || board?.materials?.length),
    );
    void persistCurrentArticle(
      hasStaleBoardLayers
        ? {
            images: nextImages,
            canvasBoards: boards.map((board) => {
              if (Number(board?.imageIndex) !== activeArticleImageIndex)
                return board;
              const {
                collage: _replacedCollage,
                baseSrc: _replacedBase,
                materials: _replacedMaterials,
                ...rest
              } = board;
              return rest;
            }),
          }
        : { images: nextImages },
    );
  };

  /**
   * @description 切换真实文章的发布形式并写回数据库。
   * @keyword-cn 更新发布形式, 保存真实文章
   * @keyword-en update-content-type, persist-article-edit
   */
  const handleSelectPreviewContentType = (contentType) => {
    setPreviewContentType(contentType);
    setPreviewTypeDropdownOpen(false);
    void persistCurrentArticle({ contentType });
  };

  /**
   * @description 删除真实文章标签并写回数据库。
   * @keyword-cn 删除真实标签, 保存文章标签
   * @keyword-en remove-persisted-tag, save-article-tags
   */
  const handleRemoveArticleTag = (tag) => {
    const nextTags = articleTags.filter((item) => item !== tag);
    setArticleTags(nextTags);
    void persistCurrentArticle({ tags: nextTags });
  };

  /**
   * @description 回车添加真实文章标签并写回数据库。
   * @keyword-cn 添加真实标签, 保存文章标签
   * @keyword-en add-persisted-tag, save-article-tags
   */
  const handleArticleTagKeyDown = (event) => {
    if (event.key !== 'Enter' || !articleTagDraft.trim()) return;
    event.preventDefault();
    const tag = articleTagDraft.trim();
    const nextTags = articleTags.includes(tag)
      ? articleTags
      : [...articleTags, tag];
    setArticleTags(nextTags);
    setArticleTagDraft('');
    void persistCurrentArticle({ tags: nextTags });
  };

  useEffect(() => {
    void loadTopicWorkspace();
  }, [loadTopicWorkspace]);

  useEffect(() => {
    void syncArticleGenerationStates(false);
  }, [syncArticleGenerationStates]);

  const hasRunningArticleGeneration = Object.values(
    articleGenerationsByTopic,
  ).some((generation) => generation?.status === 'running');

  useEffect(() => {
    if (!hasRunningArticleGeneration) return undefined;
    const timer = window.setInterval(() => {
      void syncArticleGenerationStates();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasRunningArticleGeneration, syncArticleGenerationStates]);

  useEffect(() => {
    resizeArticleBodyTextarea(articleBodyInputRef.current);
  }, [articleBody]);

  useEffect(() => {
    const group = topicGroups.find((item) => item.id === selectedTopicGroup);
    const topic = group?.children?.find((item) => item.id === selectedTopicId);
    if (!topic?.article) {
      setArticleTitle('');
      setArticleBody('');
      setArticleTags([]);
      setArticleImages([]);
      setActiveArticleImageIndex(0);
      return;
    }
    setArticleTitle(topic.article.title ?? '');
    setArticleBody(topic.article.body ?? '');
    setArticleTags(Array.isArray(topic.article.tags) ? topic.article.tags : []);
    setArticleImages(
      Array.isArray(topic.article.images) ? topic.article.images : [],
    );
    setPreviewContentType(topic.article.contentType ?? '图文');
    setActiveArticleImageIndex(0);
  }, [selectedTopicGroup, selectedTopicId, topicGroups]);

  useEffect(() => {
    if (!agentDropOpen) return;
    const close = (e) => {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target)) {
        setAgentDropOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [agentDropOpen]);

  /**
   * @description 拉取图库标签供图库选择面板做快速筛选。
   * @keyword-cn 图库选择, 标签筛选
   * @keyword-en gallery-picker, image-tag-filter
   */
  useEffect(() => {
    let cancelled = false;
    chatService
      .listGalleryTags({ limit: 2000 })
      .then((result) => {
        if (cancelled) return;
        const tags = Array.isArray(result?.tags) ? result.tags : [];
        setArticleGalleryTags(
          Array.from(
            new Set(
              tags.map((tag) => String(tag ?? '').trim()).filter(Boolean),
            ),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setArticleGalleryTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * @description 拉取图库首页图片；选中标签或类型档位变化即回到第一页重拉。
   * @keyword-cn 图库选择, 标签筛选, 类型筛选, 上拉加载
   * @keyword-en gallery-picker, image-tag-filter, image-type-filter, infinite-scroll
   */
  useEffect(() => {
    let cancelled = false;
    setArticleGalleryLoading(true);
    setArticleGalleryHasMore(true);
    chatService
      .listGalleryImages({
        imageType: articleGalleryType,
        tag: articleGalleryTag || undefined,
        limit: GALLERY_PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled) return;
        const rows = Array.isArray(result?.images) ? result.images : [];
        setArticleGalleryImages(rows);
        setArticleGalleryHasMore(rows.length >= GALLERY_PAGE_SIZE);
      })
      .catch(() => {
        if (cancelled) return;
        setArticleGalleryImages([]);
        setArticleGalleryHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setArticleGalleryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleGalleryTag, articleGalleryType]);

  /**
   * @description 上拉加载下一页图库图片：以列表末尾图片 id 作游标向后取，
   *   返回不足一页即认为到底。按 id 去重，避免上传插入的新图和分页结果重复。
   * @keyword-cn 图库选择, 上拉加载, 游标分页
   * @keyword-en gallery-picker, infinite-scroll, cursor-pagination
   * @returns {Promise<void>} 加载流程。
   */
  const loadMoreArticleGallery = useCallback(async () => {
    if (
      articleGalleryLoading ||
      articleGalleryLoadingMore ||
      !articleGalleryHasMore
    )
      return;
    const cursorId = articleGalleryImages[articleGalleryImages.length - 1]?.id;
    if (!Number.isFinite(Number(cursorId))) {
      setArticleGalleryHasMore(false);
      return;
    }
    setArticleGalleryLoadingMore(true);
    try {
      const result = await chatService.listGalleryImages({
        imageType: articleGalleryType,
        tag: articleGalleryTag || undefined,
        cursorId,
        limit: GALLERY_PAGE_SIZE,
      });
      const rows = Array.isArray(result?.images) ? result.images : [];
      setArticleGalleryImages((images) => {
        const seen = new Set(images.map((image) => image?.id));
        return [...images, ...rows.filter((row) => !seen.has(row?.id))];
      });
      setArticleGalleryHasMore(rows.length >= GALLERY_PAGE_SIZE);
    } catch {
      setArticleGalleryHasMore(false);
    } finally {
      setArticleGalleryLoadingMore(false);
    }
  }, [
    articleGalleryImages,
    articleGalleryLoading,
    articleGalleryLoadingMore,
    articleGalleryHasMore,
    articleGalleryTag,
    articleGalleryType,
  ]);

  /**
   * @description 图库列表滚动到底部附近时预取下一页。
   * @keyword-cn 图库选择, 上拉加载
   * @keyword-en gallery-picker, infinite-scroll
   * @param {React.UIEvent} event - 滚动事件。
   */
  const handleArticleGalleryScroll = useCallback(
    (event) => {
      const el = event.currentTarget;
      const remain = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remain > GALLERY_SCROLL_THRESHOLD) return;
      void loadMoreArticleGallery();
    },
    [loadMoreArticleGallery],
  );

  /**
   * @description 按搜索词过滤图库标签并截断成可见胶囊列表；没搜索词时把当前选中标签顶到最前，
   *   保证它不会被截断挤出可见范围。
   * @keyword-cn 标签筛选, 标签搜索
   * @keyword-en image-tag-filter, tag-search
   */
  const visibleArticleGalleryTags = useMemo(() => {
    const query = articleGalleryTagQuery.trim().toLowerCase();
    const matched = query
      ? articleGalleryTags.filter((tag) => tag.toLowerCase().includes(query))
      : articleGalleryTags;
    if (query || !articleGalleryTag)
      return matched.slice(0, GALLERY_TAG_CHIP_LIMIT);
    return [
      articleGalleryTag,
      ...matched.filter((tag) => tag !== articleGalleryTag),
    ].slice(0, GALLERY_TAG_CHIP_LIMIT);
  }, [articleGalleryTags, articleGalleryTagQuery, articleGalleryTag]);

  /**
   * @description 加载小红书任务列表，始终按 category=xhs 过滤。
   * @keyword-en load xhs tasks by category
   */
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/todo?limit=100&category=xhs`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const allTasks = Array.isArray(data.todos) ? data.todos : [];
        allTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setTasks(allTasks);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error('Failed to load XHS tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * @description 加载小红书 Canvas 列表，支持按类型过滤
   * @keyword-en load xhs canvas list by type filter
   */
  const loadCanvases = useCallback(async () => {
    setCanvasLoading(true);
    try {
      const opts =
        canvasTypeFilter !== 'all'
          ? { type: canvasTypeFilter, limit: 50 }
          : { limit: 50 };
      const data = await chatService.listCanvases(opts);
      const list = Array.isArray(data.canvases) ? data.canvases : [];
      list.sort(
        (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0),
      );
      setCanvases(list);
    } catch {
      setCanvases([]);
    } finally {
      setCanvasLoading(false);
    }
  }, [canvasTypeFilter]);

  useEffect(() => {
    if (tab === 'canvas') loadCanvases();
  }, [tab, loadCanvases]);

  // Load task items when a task is selected
  useEffect(() => {
    if (!selectedTask?.id || itemsFetched) return;

    let cancelled = false;
    setItemsLoading(true);

    fetch(`${API_BASE}/todo/${selectedTask.id}/items`, {
      headers: getAuthHeaders(),
    })
      .then((res) => {
        if (cancelled) return null;
        if (!res.ok) return { items: [] };
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setTaskItems(Array.isArray(data.items) ? data.items : []);
        setItemsFetched(true);
      })
      .catch(() => {
        if (!cancelled) setTaskItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id, itemsFetched]);

  const handleSelectTask = (task) => {
    setSelectedTask(task);
    setTaskItems([]);
    setItemsFetched(false);
  };

  const handleCloseDetail = () => {
    setSelectedTask(null);
    setTaskItems([]);
    setItemsFetched(false);
    setDetailTab('info');
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'in_progress':
        return <CircleDot size={16} className="text-blue-500" />;
      case 'pending':
        return <Clock size={16} className="text-slate-400" />;
      default:
        return <AlertCircle size={16} className="text-slate-400" />;
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return {
          icon: <CheckCircle size={14} />,
          color: 'text-green-600',
          bgColor: 'bg-green-50 border-green-200',
        };
      case 'in_progress':
        return {
          icon: <CircleDot size={14} />,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50 border-blue-200',
        };
      case 'failed':
      case 'cancelled':
        return {
          icon: <X size={14} />,
          color: 'text-red-600',
          bgColor: 'bg-red-50 border-red-200',
        };
      default:
        return {
          icon: <Clock size={14} />,
          color: 'text-slate-400',
          bgColor: 'bg-slate-50 border-slate-200',
        };
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return '已完成';
      case 'in_progress':
        return '执行中';
      case 'pending':
        return '待接单';
      case 'failed':
        return '失败';
      default:
        return status || '未知';
    }
  };

  const getStatusDotColor = (status) => {
    if (status === 'in_progress') return 'bg-blue-500';
    if (status === 'pending') return 'bg-orange-500';
    if (status === 'done' || status === 'completed') return 'bg-green-500';
    return 'bg-slate-300';
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Task List Content
  const renderTaskList = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw size={20} className="animate-spin mr-2" />
          <span className="text-sm">加载中...</span>
        </div>
      );
    }
    if (tasks.length === 0) {
      const agentLabel =
        XHS_SUBAGENTS.find((a) => a.id === activeAgent)?.label ?? '小红书';
      return (
        <div className="text-center py-12 text-slate-400">
          <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无{agentLabel}相关任务</p>
          <p className="text-xs mt-1">在对话中创建任务后会自动显示在这里</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => handleSelectTask(task)}
            className="p-3 bg-slate-50 rounded-lg border border-slate-100 hover:border-rose-200 transition cursor-pointer"
          >
            <div className="flex items-start gap-2">
              {getStatusIcon(task.status)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {task.title || `任务 #${task.id}`}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500">
                    {getStatusText(task.status)}
                  </span>
                  {task.canvasId && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                      Canvas#{task.canvasId}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ─── 任务详情全屏页面（含小红书数据 Tab） ───

  /**
   * @description 节点状态样式
   * @keyword-en item status style
   */
  const getItemStatusStyle = (status) => {
    switch (status) {
      case 'done':
        return {
          icon: <CheckCircle size={14} />,
          color: 'text-green-600',
          bg: 'bg-green-50 border-green-200',
        };
      case 'in_progress':
        return {
          icon: <CircleDot size={14} />,
          color: 'text-blue-600',
          bg: 'bg-blue-50 border-blue-200',
        };
      case 'failed':
      case 'cancelled':
        return {
          icon: <XCircle size={14} />,
          color: 'text-red-600',
          bg: 'bg-red-50 border-red-200',
        };
      default:
        return {
          icon: <Timer size={14} />,
          color: 'text-slate-400',
          bg: 'bg-slate-50 border-slate-200',
        };
    }
  };

  /**
   * @description 详情页执行节点时间轴
   * @keyword-en DetailTimeline task items timeline
   */
  const renderDetailTimeline = () => {
    if (itemsLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-rose-200 border-t-rose-500 rounded-full animate-spin" />
        </div>
      );
    }
    if (taskItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Clock size={32} className="mb-2 opacity-30" />
          <p className="text-sm">暂无执行节点</p>
        </div>
      );
    }
    return (
      /* 执行节点时间轴 区域 */
      <div className="p-4 pb-24">
        <div className="relative">
          <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-slate-200" />
          <div className="space-y-3">
            {taskItems.map((item) => {
              const style = getItemStatusStyle(item.status);
              return (
                <div key={item.id} className="relative flex gap-3">
                  <div
                    className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bg}`}
                  >
                    <span className={style.color}>{style.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium text-slate-800 line-clamp-2">
                          {item.title || '未命名节点'}
                        </h4>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${style.bg} ${style.color}`}
                        >
                          {getStatusText(item.status)}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 mb-1">
                          {item.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        {item.plannedAt && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(item.plannedAt)}{' '}
                            {formatTime(item.plannedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-center text-[10px] text-slate-400 mt-4">
          共 {taskItems.length} 个节点
        </p>
      </div>
    );
  };

  /**
   * @description 详情页任务信息 Tab
   * @keyword-en DetailInfo task basic info
   */
  const renderDetailInfo = () => {
    const typeLabelMap = {
      auto_execute: '自动执行',
      offline_execute: '线下执行',
      long_task: '长时任务',
      other: '其他',
    };
    return (
      /* 任务详情信息主体 区域 */
      <div className="p-4 space-y-4 pb-24">
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            任务名称
          </div>
          <p className="text-sm font-semibold text-slate-800">
            {selectedTask.title}
          </p>
        </div>
        {selectedTask.description && (
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              任务描述
            </div>
            <div className="mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-3 border border-slate-100 max-h-40 overflow-y-auto">
              {selectedTask.description}
            </div>
          </div>
        )}
        {selectedTask.aiPlan && (
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              执行计划
            </div>
            <div className="mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-white rounded-xl p-3 border border-slate-200 max-h-56 overflow-y-auto">
              {selectedTask.aiPlan}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              接单人
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-700">
              <User size={14} className="text-slate-400 shrink-0" />
              {selectedTask.assigneeDisplayName ||
                selectedTask.assignee ||
                '待分配'}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              任务类型
            </div>
            <span className="text-sm text-slate-700">
              {typeLabelMap[selectedTask.type] || '其他'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderTaskDetail = () => {
    if (!selectedTask) return null;
    const dotColor = getStatusDotColor(selectedTask.status);
    const typeLabelMap = {
      auto_execute: '自动执行',
      offline_execute: '线下执行',
      long_task: '长时任务',
      other: '其他',
    };

    return (
      /* 任务详情全屏页面 区域 */
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* 详情页头部 区域 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
          <button
            onClick={handleCloseDetail}
            className="p-1.5 -ml-1 rounded-full hover:bg-slate-100 text-slate-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`}
              />
              <h2 className="font-bold text-slate-800 text-base truncate">
                {selectedTask.title || `任务 #${selectedTask.id}`}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
                {typeLabelMap[selectedTask.type] || '其他'}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">
                {getStatusText(selectedTask.status)}
              </span>
              {selectedTask.category === 'xhs' && (
                <span className="text-[10px] px-2 py-0.5 rounded border bg-rose-50 text-rose-600 border-rose-200">
                  小红书
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 详情页 Tab 导航 区域 */}
        <div className="border-b border-slate-100 px-4 bg-white shrink-0">
          <div className="flex space-x-5 overflow-x-auto">
            {[
              ['info', '任务详情'],
              ['timeline', '执行节点'],
              ['xhs-data', '小红书数据'],
            ].map(([tabKey, label]) => (
              <button
                key={tabKey}
                onClick={() => setDetailTab(tabKey)}
                className={`py-3 text-sm font-bold transition-colors relative whitespace-nowrap ${detailTab === tabKey ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {label}
                {detailTab === tabKey && (
                  <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 详情页内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {detailTab === 'info' && renderDetailInfo()}
          {detailTab === 'timeline' && renderDetailTimeline()}
          {detailTab === 'xhs-data' && <XhsDataTab task={selectedTask} />}
        </div>
      </div>
    );
  };

  // Chat Tab Content — main 自动路由；其他项为专业用户手动直达会话
  const renderChatTab = () => {
    const cfg =
      XHS_SUBAGENTS.find((a) => a.id === activeAgent) ?? XHS_SUBAGENTS[0];
    return (
      <div className="flex-1 min-h-0">
        {/* key 绑定 sessionType，切换手动专家时强制重载 ChatBIView */}
        <ChatBIView
          key={cfg.sessionType}
          sessionType={cfg.sessionType}
          sessionStorageKey={cfg.sessionStorageKey}
          welcomeTitle={cfg.welcomeTitle}
          welcomeDesc={cfg.welcomeDesc}
          quickPrompts={cfg.quickPrompts}
          inputPlaceholder={cfg.inputPlaceholder}
          showInlineSessionPicker
        />
      </div>
    );
  };

  /**
   * @description Canvas 列表 Tab，展示小红书画布（图文 / 图组），支持类型过滤
   * @keyword-en xhs canvas list tab article image-group
   */
  const renderCanvasTab = () => {
    const TYPE_OPTS = [
      { value: 'all', label: '全部', icon: <LayoutGrid size={13} /> },
      { value: 'article', label: '图文', icon: <FileText size={13} /> },
      { value: 'image-group', label: '图组', icon: <Images size={13} /> },
    ];
    const statusColor = (s) => {
      if (s === 'completed')
        return 'text-green-600 bg-green-50 border-green-200';
      if (s === 'generating') return 'text-blue-600 bg-blue-50 border-blue-200';
      if (s === 'failed') return 'text-red-600 bg-red-50 border-red-200';
      return 'text-slate-400 bg-slate-50 border-slate-200';
    };
    const statusText = (s) =>
      ({ completed: '完成', generating: '生成中', failed: '失败' })[s] ??
      s ??
      '';
    const typeLabel = (t) => (t === 'image-group' ? '图组' : '图文');
    const countLabel = (cv) => {
      if (cv.type === 'image-group') {
        const n = Array.isArray(cv.imageGroups) ? cv.imageGroups.length : 0;
        return `${n} 组`;
      }
      const n = Array.isArray(cv.articles) ? cv.articles.length : 0;
      return `${n} 篇`;
    };
    const formatDate = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      return isNaN(dt.getTime())
        ? ''
        : dt.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    };

    return (
      /* Canvas Tab 主容器 区域 */
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 类型过滤栏 canvas type filter bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
          <div className="flex rounded-full bg-slate-100 p-0.5 gap-0.5 text-xs">
            {TYPE_OPTS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCanvasTypeFilter(opt.value)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full transition ${canvasTypeFilter === opt.value ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={loadCanvases}
            disabled={canvasLoading}
            className="ml-auto p-1.5 hover:bg-slate-100 rounded-full text-slate-500 disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={canvasLoading ? 'animate-spin' : ''}
            />
          </button>
        </div>

        {/* Canvas 列表内容 canvas list content */}
        <div className="p-4">
          {canvasLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <RefreshCw size={18} className="animate-spin mr-2" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : canvases.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <LayoutGrid size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">暂无画布</p>
              <p className="text-xs mt-1">在对话中生成 Canvas 后会显示在这里</p>
            </div>
          ) : (
            <div className="space-y-2">
              {canvases.map((cv) => (
                /* 单个 Canvas 卡片 canvas card */
                <div
                  key={cv.id}
                  onClick={() =>
                    setSelectedCanvas({ id: cv.id, type: cv.type })
                  }
                  className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-rose-200 transition cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        {/* 类型徽章 type badge */}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 text-rose-600 border-rose-100">
                          {typeLabel(cv.type)}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColor(cv.status)}`}
                        >
                          {statusText(cv.status)}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {cv.title || `Canvas #${cv.id}`}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                        <span>{countLabel(cv)}</span>
                        {formatDate(cv.createdAt) && (
                          <span>{formatDate(cv.createdAt)}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight
                      size={16}
                      className="text-slate-300 shrink-0 mt-1"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Tasks Tab Content
  const renderTasksTab = () => {
    const agentLabel =
      XHS_SUBAGENTS.find((a) => a.id === activeAgent)?.label ?? '小红书';
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          {/* 任务列表标题 tasks tab title */}
          <h3 className="text-sm font-semibold text-slate-700">
            {agentLabel}任务
          </h3>
          <button
            onClick={loadTasks}
            disabled={loading}
            className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {renderTaskList()}
      </div>
    );
  };

  /**
   * @description 渲染紧凑母题/子题双列表、可搜索子题、创作引导空态与文章编辑图库工作区
   * @keyword-cn 选题工作台, 帖子预览, 双列表, 灵感画布, 选题生成, 文字候选列表, 母选题生成, 多选, 图库选择, 文章编辑
   * @keyword-en topic-workspace, post-preview, dual-list, inspiration-canvas, topic-generation, text-candidate-list, mother-topic-generation, multi-select, gallery-picker, article-editor
   */
  const renderTopicWorkspace = () => {
    const group = topicGroups.find((item) => item.id === selectedTopicGroup) ??
      topicGroups[0] ?? { id: '', title: '', topicCount: 0, children: [] };
    const selectedTopic = group.children.find(
      (item) => item.id === selectedTopicId,
    );
    const selectedArticleGeneration = selectedTopic
      ? articleGenerationsByTopic[selectedTopic.id]
      : undefined;
    const selectedArticleGenerating =
      selectedArticleGeneration?.status === 'running';
    const articleReady = Boolean(selectedTopic?.article);
    const isPublished =
      selectedTopic && publishedTopicIds.includes(selectedTopic.id);
    const topicStatus = isPublished
      ? '已发布'
      : (selectedTopic?.status ?? '待生成');
    const motherTopicPageSize = 5;
    const childTopicPageSize = 5;
    const normalizedChildTopicQuery = childTopicQuery.trim().toLowerCase();
    const filteredChildTopics = normalizedChildTopicQuery
      ? group.children.filter((item) =>
          `${item.title} ${item.topicType}`
            .toLowerCase()
            .includes(normalizedChildTopicQuery),
        )
      : group.children;
    const motherTopicPageTotal = Math.max(
      1,
      Math.ceil(topicGroups.length / motherTopicPageSize),
    );
    const childTopicPageTotal = Math.max(
      1,
      Math.ceil(filteredChildTopics.length / childTopicPageSize),
    );
    const pagedTopicGroups = topicGroups.slice(
      (motherTopicPage - 1) * motherTopicPageSize,
      motherTopicPage * motherTopicPageSize,
    );
    const pagedChildTopics = filteredChildTopics.slice(
      (childTopicPage - 1) * childTopicPageSize,
      childTopicPage * childTopicPageSize,
    );
    const previewTypeOptions = [
      {
        value: '图文',
        label: '小红书 · 图文',
        description: '多图笔记与长图文内容',
        Icon: Images,
        tone: 'bg-rose-50 text-rose-500',
      },
      {
        value: '视频',
        label: '小红书 · 视频',
        description: '短视频内容与封面预览',
        Icon: Video,
        tone: 'bg-violet-50 text-violet-500',
      },
      {
        value: '直播',
        label: '小红书 · 直播',
        description: '直播预告与实时内容',
        Icon: Radio,
        tone: 'bg-orange-50 text-orange-500',
      },
    ];
    const activePreviewType =
      previewTypeOptions.find((item) => item.value === previewContentType) ??
      previewTypeOptions[0];
    const activeArticleImage = articleImages[activeArticleImageIndex];
    const activeArticleCanvasBoard = Array.isArray(
      selectedTopic?.article?.canvasBoards,
    )
      ? selectedTopic.article.canvasBoards.find(
          (board) => Number(board?.imageIndex) === activeArticleImageIndex,
        )
      : undefined;
    return (
      <>
        <main className="min-w-0 flex-1 overflow-hidden p-3 lg:p-4">
          <div className="flex h-full min-w-0 gap-3 lg:gap-4">
            <section className="flex h-full w-[240px] xl:w-[250px] 2xl:w-[286px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_4px_22px_rgba(24,45,93,0.04)]">
              <div className="flex h-[70px] items-center justify-between border-b border-slate-100 px-5">
                <div>
                  <h2 className="font-bold">
                    母选题{' '}
                    <span className="ml-2 text-sm font-normal text-slate-400">
                      {topicGroups.length}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    管理内容母题与延展方向
                  </p>
                </div>
                <button
                  onClick={() => {
                    setTopicCandidateError('');
                    setMotherTopicGeneratorOpen(true);
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-[#21459a]"
                >
                  <Plus size={16} />
                  添加选题
                </button>
              </div>
              <div className="flex h-11 items-center border-b border-slate-100 px-5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={
                    topicGroups.length > 0 &&
                    selectedMotherTopicIds.length === topicGroups.length
                  }
                  onChange={(event) =>
                    setSelectedMotherTopicIds(
                      event.target.checked
                        ? topicGroups.map((item) => item.id)
                        : [],
                    )
                  }
                  className="mr-4 accent-red-500"
                />{' '}
                <span className="mr-4">全选</span>
                <button
                  disabled={selectedMotherTopicIds.length === 0}
                  onClick={handleDeleteSelectedMotherTopics}
                  className="hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  删除
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {topicGroupsLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    <RefreshCw size={17} className="mr-2 animate-spin" />
                    加载真实选题中
                  </div>
                ) : topicWorkspaceError && topicGroups.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-red-400">
                    <AlertCircle size={24} className="mb-2" />
                    <p>{topicWorkspaceError}</p>
                    <button
                      onClick={loadTopicWorkspace}
                      className="mt-3 text-xs font-semibold text-[#244fa7]"
                    >
                      重新加载
                    </button>
                  </div>
                ) : pagedTopicGroups.length > 0 ? (
                  pagedTopicGroups.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setSelectedTopicGroup(item.id);
                        setSelectedTopicId('');
                        setChildTopicQuery('');
                        setChildTopicPage(1);
                      }}
                      className={`flex w-full items-center gap-3 border-l-2 px-4 py-4 text-left transition ${group.id === item.id ? 'border-red-500 bg-gradient-to-r from-red-50 to-rose-50/30' : 'border-transparent border-b border-slate-100 hover:bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          toggleCandidateSelection(
                            setSelectedMotherTopicIds,
                            item.id,
                          )
                        }
                        checked={selectedMotherTopicIds.includes(item.id)}
                        className="h-4 w-4 accent-red-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {item.topicCount}个子选题
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-slate-400">
                    <Lightbulb size={32} className="mb-3 opacity-40" />
                    <p className="text-sm">还没有已保存的母选题</p>
                    <button
                      onClick={() => setMotherTopicGeneratorOpen(true)}
                      className="mt-3 text-xs font-semibold text-[#244fa7]"
                    >
                      生成第一组选题
                    </button>
                  </div>
                )}
              </div>
              <div className="flex h-14 shrink-0 items-center justify-center gap-4 border-t border-slate-100 text-xs text-[#23458f]">
                <button
                  onClick={() =>
                    setMotherTopicPage((page) => Math.max(1, page - 1))
                  }
                  disabled={motherTopicPage === 1}
                  className="disabled:opacity-30"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {motherTopicPage} / {motherTopicPageTotal}
                </span>
                <button
                  onClick={() =>
                    setMotherTopicPage((page) =>
                      Math.min(motherTopicPageTotal, page + 1),
                    )
                  }
                  disabled={motherTopicPage === motherTopicPageTotal}
                  className="disabled:opacity-30"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>

            <section className="flex h-full min-w-[270px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_4px_22px_rgba(24,45,93,0.04)]">
              <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold">子选题</h2>
                  <div className="relative w-[156px]">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={childTopicQuery}
                      onChange={(event) => {
                        setChildTopicQuery(event.target.value);
                        setChildTopicPage(1);
                      }}
                      placeholder="搜索子选题"
                      className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-7 text-[11px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                    />
                    {childTopicQuery && (
                      <button
                        type="button"
                        aria-label="清空子选题搜索"
                        onClick={() => {
                          setChildTopicQuery('');
                          setChildTopicPage(1);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {group.id &&
                  (group.children.length > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() =>
                          setChildTopicPage((page) =>
                            page === childTopicPageTotal ? 1 : page + 1,
                          )
                        }
                        className="flex min-w-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-medium text-[#23458f] transition hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <RefreshCw size={13} />
                        再来一组
                      </button>
                      <button
                        onClick={() => openChildTopicGenerator(group.id)}
                        className="min-w-0 rounded-lg border border-red-300 px-2.5 py-2 text-[11px] font-semibold text-red-500 transition hover:bg-red-50"
                      >
                        重新生成选题
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openChildTopicGenerator(group.id)}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-red-500 to-rose-500 px-3 py-2 text-[11px] font-semibold text-white shadow-sm shadow-rose-200 hover:from-red-600 hover:to-rose-600"
                    >
                      <Sparkles size={13} />
                      生成选题
                    </button>
                  ))}
                {topicWorkspaceError && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-600">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1 break-words">
                      {topicWorkspaceError}
                    </span>
                    <button
                      onClick={() => setTopicWorkspaceError('')}
                      className="shrink-0 font-semibold text-red-400 transition hover:text-red-600"
                    >
                      知道了
                    </button>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredChildTopics.length > 0 ? (
                  pagedChildTopics.map((item) => {
                    const published =
                      publishedTopicIds.includes(item.id) &&
                      Boolean(item.article);
                    const articleGenerated = Boolean(item.article);
                    const articleGeneration =
                      articleGenerationsByTopic[item.id];
                    const articleGenerating =
                      articleGeneration?.status === 'running';
                    const articleGenerationError =
                      articleGeneration?.status === 'failed'
                        ? articleGeneration.errorMessage ||
                          '文章生成失败，请稍后重试。'
                        : '';
                    const active = selectedTopic?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedTopicId(item.id)}
                        className={`flex cursor-pointer items-start gap-2.5 border-l-2 border-b border-slate-100 px-3 py-4 transition ${active ? 'border-l-red-500 bg-gradient-to-r from-red-50 to-rose-50/30' : 'border-l-transparent hover:bg-slate-50'}`}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={active}
                          className="mt-1.5 h-4 w-4 shrink-0 accent-red-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="mt-0.5 shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                              {item.topicType}
                            </span>
                            <p className="min-w-0 text-[13px] font-medium leading-5 text-slate-800">
                              {item.title}
                            </p>
                          </div>
                          <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                            <p
                              className={`min-w-0 text-[11px] ${published ? 'text-emerald-500' : 'text-slate-400'}`}
                            >
                              {published
                                ? '已生成 · 已发布'
                                : articleGenerating
                                  ? '文章生成中'
                                  : articleGenerated
                                    ? '文章已生成'
                                    : '待生成文章'}
                            </p>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                disabled={articleGenerating}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (articleGenerated) {
                                    openArticleRegenerator(item.id);
                                  } else {
                                    void handleGenerateArticleForTopic(item.id);
                                  }
                                }}
                                className="flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1.5 text-[11px] font-semibold text-red-500 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                              >
                                {articleGenerating && (
                                  <RefreshCw
                                    size={12}
                                    className="animate-spin"
                                  />
                                )}
                                {articleGenerating
                                  ? '生成中'
                                  : articleGenerated
                                    ? '重新生成'
                                    : '生成文章'}
                              </button>
                              <MoreHorizontal
                                size={17}
                                className="text-slate-400"
                              />
                            </div>
                          </div>
                          {articleGenerationError && (
                            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-600">
                              <AlertCircle
                                size={13}
                                className="mt-0.5 shrink-0"
                              />
                              <span className="min-w-0 flex-1 break-words">
                                {articleGenerationError}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  dismissArticleGenerationError(item.id);
                                }}
                                className="shrink-0 font-semibold text-red-400 transition hover:text-red-600"
                              >
                                知道了
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : childTopicQuery ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-400">
                    <Search size={32} className="mb-3 opacity-35" />
                    <p className="text-sm">没有匹配的子选题</p>
                    <button
                      onClick={() => setChildTopicQuery('')}
                      className="mt-3 text-xs font-semibold text-[#244fa7]"
                    >
                      清空搜索
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-slate-400">
                    <Lightbulb size={36} className="mb-3 opacity-40" />
                    <p className="text-sm">
                      选择母选题后，AI 会为你生成延展方向
                    </p>
                  </div>
                )}
              </div>
              <div className="flex h-14 shrink-0 items-center justify-center gap-4 border-t border-slate-100 text-xs text-[#23458f]">
                <button
                  onClick={() =>
                    setChildTopicPage((page) => Math.max(1, page - 1))
                  }
                  disabled={childTopicPage === 1}
                  className="disabled:opacity-30"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {childTopicPage} / {childTopicPageTotal}
                </span>
                <button
                  onClick={() =>
                    setChildTopicPage((page) =>
                      Math.min(childTopicPageTotal, page + 1),
                    )
                  }
                  disabled={childTopicPage === childTopicPageTotal}
                  className="disabled:opacity-30"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>
          </div>
        </main>

        <div className="relative hidden min-w-[420px] flex-1 xl:flex">
          <aside className="flex w-full min-[1400px]:w-[46%] min-w-[310px] shrink-0 flex-col overflow-hidden border-l border-slate-200/80 bg-white shadow-[-8px_0_30px_rgba(24,45,93,0.025)]">
            <div className="relative z-20 mx-5 my-4">
              <button
                onClick={() => setPreviewTypeDropdownOpen((open) => !open)}
                aria-expanded={previewTypeDropdownOpen}
                className={`flex w-full items-center gap-3 rounded-2xl border bg-white px-3.5 py-2.5 text-left shadow-sm transition ${previewTypeDropdownOpen ? 'border-[#6c89df] ring-4 ring-blue-50' : 'border-slate-200 hover:border-[#9ab0e9] hover:shadow-md'}`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${activePreviewType.tone}`}
                >
                  <activePreviewType.Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-slate-400">
                    发布形式
                  </span>
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {activePreviewType.label}
                  </span>
                </span>
                <ChevronDown
                  size={18}
                  className={`text-[#173b88] transition-transform ${previewTypeDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {previewTypeDropdownOpen && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_36px_rgba(23,52,118,0.18)]">
                  <div className="px-2.5 pb-2 pt-1 text-[11px] font-semibold tracking-wide text-slate-400">
                    选择预览类型
                  </div>
                  {previewTypeOptions.map(
                    ({ value, label, description, Icon, tone }) => {
                      const active = previewContentType === value;
                      return (
                        <button
                          key={value}
                          onClick={() => handleSelectPreviewContentType(value)}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                        >
                          <span
                            className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}
                          >
                            <Icon size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block text-sm font-semibold ${active ? 'text-[#264b9f]' : 'text-slate-700'}`}
                            >
                              {label}
                            </span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {description}
                            </span>
                          </span>
                          {active && (
                            <CheckCircle
                              size={18}
                              className="shrink-0 text-[#4570cf]"
                            />
                          )}
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>
            <article className="mx-auto mb-4 min-h-0 w-[calc(100%-24px)] overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-[0_9px_30px_rgba(19,43,95,0.12)]">
              <div className="flex h-12 items-center gap-3 px-4">
                <ChevronLeft size={19} />
                <span className="h-7 w-7 rounded-full bg-gradient-to-br from-rose-400 via-orange-300 to-violet-400" />
                <span className="flex-1 truncate text-sm font-medium">
                  {group.title || '小红书文章'}
                </span>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-600">
                  {topicStatus}
                </span>
                <Share2 size={18} />
              </div>
              <div className="relative aspect-[3/4] overflow-hidden bg-slate-100">
                {activeArticleImage ? (
                  <img
                    src={activeArticleImage}
                    alt="文章图片"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-slate-400">
                    <Images size={30} className="mb-2 opacity-40" />
                    <p className="text-xs">从真实图库选择文章配图</p>
                  </div>
                )}
                {activeArticleCanvasBoard?.kind === 'cover' && (
                  <div className="pointer-events-none absolute inset-0">
                    {activeArticleCanvasBoard.title && (
                      <div
                        className="absolute inset-x-6 top-[37.5%] whitespace-pre-line text-center text-[clamp(24px,3.1vw,38px)] font-black leading-[.98] tracking-[-.04em] text-white"
                        style={{
                          textShadow:
                            '3px 0 #20222b,-3px 0 #20222b,0 3px #20222b,0 -3px #20222b,2px 2px #20222b,-2px 2px #20222b,2px -2px #20222b,-2px -2px #20222b,5px 6px rgba(32,34,43,.3)',
                        }}
                      >
                        {activeArticleCanvasBoard.title}
                      </div>
                    )}
                    {activeArticleCanvasBoard.subtitle && (
                      <div
                        className="absolute inset-x-8 top-[64.5%] text-center text-sm font-extrabold tracking-[.04em] text-white"
                        style={{
                          textShadow:
                            '2px 0 #20222b,-2px 0 #20222b,0 2px #20222b,0 -2px #20222b,1.5px 1.5px #20222b,-1.5px 1.5px #20222b,1.5px -1.5px #20222b,-1.5px -1.5px #20222b',
                        }}
                      >
                        {activeArticleCanvasBoard.subtitle}
                      </div>
                    )}
                  </div>
                )}
                {articleImages.length > 0 && (
                  <span className="absolute right-3 top-3 rounded bg-black/55 px-2 py-1 text-xs text-white">
                    {previewContentType === '图文'
                      ? `${activeArticleImageIndex + 1}/${articleImages.length}`
                      : previewContentType === '视频'
                        ? '视频'
                        : '直播'}
                  </span>
                )}
                <button
                  disabled={articleImages.length === 0}
                  onClick={() => setInspirationCanvasOpen(true)}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/65 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Images size={15} />
                  进入灵感画布
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-3 py-3">
                {articleImages.map((image, index) => (
                  <button
                    key={`${image}-${index}`}
                    onClick={() => setActiveArticleImageIndex(index)}
                    className={`relative h-12 w-10 shrink-0 overflow-hidden rounded-lg border-2 transition ${activeArticleImageIndex === index ? 'border-red-500 ring-2 ring-rose-100' : 'border-transparent hover:border-slate-300'}`}
                  >
                    <img
                      src={image}
                      alt={`图组 ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    {activeArticleImageIndex === index && (
                      <span className="absolute inset-x-0 bottom-0 bg-red-500/90 py-0.5 text-[9px] text-white">
                        编辑
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="space-y-3 px-4 py-4">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    文章标题
                  </label>
                  <textarea
                    value={articleTitle}
                    onChange={(event) => setArticleTitle(event.target.value)}
                    onBlur={() =>
                      void persistCurrentArticle({ title: articleTitle })
                    }
                    rows={2}
                    className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-[17px] font-bold leading-6 outline-none hover:border-slate-200 focus:border-red-200 focus:bg-rose-50/40"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      正文内容
                    </label>
                    <button
                      type="button"
                      disabled={!articleReady || selectedArticleGenerating}
                      onClick={() => openArticleRegenerator(selectedTopic?.id)}
                      className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-50"
                    >
                      <RefreshCw
                        size={11}
                        className={
                          selectedArticleGenerating ? 'animate-spin' : ''
                        }
                      />
                      重新生成
                    </button>
                  </div>
                  <textarea
                    ref={articleBodyInputRef}
                    value={articleBody}
                    onChange={(event) => {
                      setArticleBody(event.target.value);
                      resizeArticleBodyTextarea(event.currentTarget);
                    }}
                    onBlur={() =>
                      void persistCurrentArticle({ body: articleBody })
                    }
                    rows={1}
                    className="block h-auto w-full resize-none overflow-hidden rounded-lg border border-transparent bg-transparent px-1 py-1 text-xs leading-5 text-slate-700 outline-none hover:border-slate-200 focus:border-red-200 focus:bg-rose-50/40"
                  />
                </div>
                <div>
                  <label className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <Tag size={12} />
                    文章标签
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {articleTags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-500"
                      >
                        #{tag}
                        <button
                          onClick={() => handleRemoveArticleTag(tag)}
                          className="rounded-full hover:bg-rose-100"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <input
                      value={articleTagDraft}
                      onChange={(event) =>
                        setArticleTagDraft(event.target.value)
                      }
                      onKeyDown={handleArticleTagKeyDown}
                      className="w-20 bg-transparent text-[11px] outline-none placeholder:text-slate-400"
                      placeholder="+ 添加"
                    />
                  </div>
                </div>
                <p className="pt-1 text-[10px] text-slate-400">
                  {selectedTopic?.article?.updatedAt
                    ? new Date(selectedTopic.article.updatedAt).toLocaleString()
                    : ''}{' '}
                  · {topicStatus}
                </p>
              </div>
            </article>
          </aside>
          <aside className="hidden min-[1400px]:flex min-w-[320px] flex-1 flex-col overflow-hidden border-l border-slate-200/80 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">图库选择</h3>
                <p className="mt-1 text-[11px] text-slate-400">
                  选择真实图片加入或替换文章图组
                </p>
              </div>
              <button
                onClick={() => articleGalleryUploadRef.current?.click()}
                className="flex items-center gap-1 rounded-lg bg-[#244fa7] px-2.5 py-2 text-xs font-semibold text-white hover:bg-[#1c408d]"
              >
                <ImagePlus size={14} />
                上传
              </button>
              <input
                ref={articleGalleryUploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const files = Array.from(event.target.files || []);
                  if (!files.length) return;
                  try {
                    const result = await chatService.uploadGalleryImages({
                      files,
                      tags: ['小红书文章'],
                    });
                    const uploaded = Array.isArray(result?.images)
                      ? result.images
                      : [];
                    setArticleGalleryImages((images) => [
                      ...uploaded,
                      ...images,
                    ]);
                    const firstUrl = uploaded[0]?.url || uploaded[0]?.thumbUrl;
                    if (firstUrl) handleSelectArticleImage(firstUrl);
                  } catch {
                    /* 上传失败时保留当前真实文章 */
                  } finally {
                    event.target.value = '';
                  }
                }}
              />
            </div>
            <div className="shrink-0 border-b border-slate-100 px-4 py-3">
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={articleGalleryTagQuery}
                  onChange={(event) =>
                    setArticleGalleryTagQuery(event.target.value)
                  }
                  placeholder="搜索标签"
                  className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-7 text-xs text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {articleGalleryTagQuery && (
                  <button
                    title="清空搜索"
                    onClick={() => setArticleGalleryTagQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex rounded-lg bg-slate-100 p-0.5">
                {GALLERY_TYPE_TABS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setArticleGalleryType(item.key)}
                    className={`flex-1 rounded-[6px] py-1 text-[11px] font-medium transition ${articleGalleryType === item.key ? 'bg-white text-[#244fa7] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto">
                <button
                  onClick={() => setArticleGalleryTag('')}
                  className={`rounded-lg border px-2 py-1 text-[11px] transition ${articleGalleryTag ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-[#244fa7] bg-blue-50 text-[#244fa7]'}`}
                >
                  全部
                </button>
                {visibleArticleGalleryTags.map((tag) => (
                  <button
                    key={tag}
                    title={tag}
                    onClick={() =>
                      setArticleGalleryTag(articleGalleryTag === tag ? '' : tag)
                    }
                    className={`max-w-[132px] truncate rounded-lg border px-2 py-1 text-[11px] transition ${articleGalleryTag === tag ? 'border-[#244fa7] bg-blue-50 text-[#244fa7]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    {tag}
                  </button>
                ))}
                {articleGalleryTagQuery &&
                  visibleArticleGalleryTags.length === 0 && (
                    <span className="px-1 py-1 text-[11px] text-slate-400">
                      没有匹配的标签
                    </span>
                  )}
              </div>
            </div>
            <div
              onScroll={handleArticleGalleryScroll}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
            >
              <div className="grid auto-rows-[220px] grid-cols-2 content-start items-stretch gap-3 2xl:auto-rows-[260px]">
                {articleGalleryLoading ? (
                  <div className="col-span-2 flex items-center justify-center py-12 text-xs text-slate-400">
                    <RefreshCw size={16} className="mr-2 animate-spin" />
                    加载图库中
                  </div>
                ) : articleGalleryImages.length > 0 ? (
                  articleGalleryImages.map((image) => {
                    const previewUrl = image?.thumbUrl || image?.url;
                    const sourceUrl = image?.url || image?.thumbUrl;
                    return previewUrl ? (
                      <button
                        key={image.id || previewUrl}
                        onClick={() => handleSelectArticleImage(sourceUrl)}
                        className="group relative h-full min-h-[220px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left shadow-sm transition hover:border-[#4e70c6] hover:ring-2 hover:ring-blue-100 2xl:min-h-[260px]"
                      >
                        <img
                          src={previewUrl}
                          alt={image.originalName || '图库图片'}
                          className="block h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        />
                        {image.isCollage === true && (
                          <span className="absolute left-2 top-2 rounded-md bg-violet-600/90 px-2 py-1 text-[10px] font-semibold text-white shadow-sm">
                            拼图
                          </span>
                        )}
                        <span className="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/65 px-2 py-1.5 text-center text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                          {articleImages.length > 0
                            ? '替换当前图'
                            : '用作第一张图'}
                        </span>
                      </button>
                    ) : null;
                  })
                ) : (
                  <div className="col-span-2 flex flex-col items-center py-14 text-center text-slate-400">
                    <Images size={28} className="mb-3 opacity-40" />
                    <p className="text-xs">
                      {articleGalleryTag || articleGalleryType !== 'all'
                        ? '当前筛选下暂时没有图片'
                        : '真实图库暂时没有图片'}
                    </p>
                    <button
                      onClick={() => {
                        if (articleGalleryTag || articleGalleryType !== 'all') {
                          setArticleGalleryTag('');
                          setArticleGalleryType('all');
                          return;
                        }
                        articleGalleryUploadRef.current?.click();
                      }}
                      className="mt-3 text-xs font-semibold text-[#244fa7]"
                    >
                      {articleGalleryTag || articleGalleryType !== 'all'
                        ? '清除筛选'
                        : '上传第一张图片'}
                    </button>
                  </div>
                )}
              </div>
              {!articleGalleryLoading && articleGalleryImages.length > 0 && (
                <div className="flex items-center justify-center py-3 text-[11px] text-slate-400">
                  {articleGalleryLoadingMore ? (
                    <>
                      <RefreshCw size={13} className="mr-1.5 animate-spin" />
                      加载更多
                    </>
                  ) : articleGalleryHasMore ? (
                    <button
                      onClick={() => void loadMoreArticleGallery()}
                      className="font-semibold text-[#244fa7]"
                    >
                      加载更多
                    </button>
                  ) : (
                    '没有更多了'
                  )}
                </div>
              )}
            </div>
          </aside>
          {!articleReady && (
            <div
              role="status"
              className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden border-l border-slate-200 bg-white/90 px-7 text-center backdrop-blur-[10px]"
            >
              <div className="w-full max-w-[550px]">
                <div className="relative mx-auto mb-7 h-24 w-32 text-[#3f70d6]">
                  <span className="absolute left-8 top-1 h-[76px] w-[76px] rotate-3 rounded-xl border border-blue-100 bg-white/75 shadow-[0_12px_30px_rgba(45,86,170,0.10)]" />
                  <span className="absolute left-4 top-3 h-[76px] w-[76px] -rotate-3 rounded-xl border border-blue-100 bg-white/85 shadow-[0_12px_30px_rgba(45,86,170,0.11)]" />
                  <span className="absolute left-0 top-5 flex h-[76px] w-[76px] items-center justify-center rounded-xl border border-blue-100 bg-white shadow-[0_14px_34px_rgba(45,86,170,0.15)]">
                    <FileText size={34} strokeWidth={1.7} />
                  </span>
                  <span className="absolute bottom-0 right-1 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-400 to-rose-500 text-white shadow-lg shadow-rose-200">
                    {selectedArticleGenerating ? (
                      <RefreshCw size={17} className="animate-spin" />
                    ) : (
                      <PenLine size={17} />
                    )}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#10275f]">
                  {selectedArticleGenerating
                    ? '文章正在生成'
                    : !selectedTopic
                      ? '请选择左侧子选题'
                      : '开始创作这篇文章'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {!selectedTopic
                    ? '选择后可查看相关内容并进行创作'
                    : selectedArticleGenerating
                      ? '多个选题可以同时生成，完成并保存后这里会自动显示文章。'
                      : '点击子选题下方的“生成文章”，即可开始 AI 辅助创作。'}
                </p>
                <div className="mt-7 grid grid-cols-3 gap-3">
                  {[
                    [BookOpen, '快速预览', '查看选题要求与相关信息'],
                    [PenLine, '开始创作', 'AI 辅助创作生成高质量内容'],
                    [BarChart3, '效果预测', '预估阅读量与互动数据表现'],
                  ].map(([Icon, title, description]) => (
                    <div
                      key={title}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-4 shadow-[0_10px_28px_rgba(34,62,120,0.08)]"
                    >
                      <Icon
                        size={23}
                        className="mx-auto mb-3 text-[#3d72dc]"
                        strokeWidth={1.8}
                      />
                      <p className="text-xs font-bold text-[#173a87]">
                        {title}
                      </p>
                      <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                        {description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {inspirationCanvasOpen && (
          <div className="fixed inset-0 z-[70] bg-white">
            <DesignEditorView
              initialImageUrls={articleImages}
              initialBoards={selectedTopic?.article?.canvasBoards}
              onBack={() => setInspirationCanvasOpen(false)}
            />
          </div>
        )}
        {articleRegeneratorOpen && (
          <ArticleRegenerateDialog
            prompt={articleRegeneratePrompt}
            generating={
              articleGenerationsByTopic[articleRegenerateTopicId]?.status ===
              'running'
            }
            error={articleRegenerateError}
            onPromptChange={setArticleRegeneratePrompt}
            onCancel={() => {
              setArticleRegeneratorOpen(false);
              setArticleRegenerateTopicId(undefined);
              setArticleRegenerateError('');
            }}
            onConfirm={() => void handleRegenerateCurrentArticle()}
          />
        )}
        {topicListGeneratorOpen && (
          <TopicCandidateDialog
            title="AI 生成子选题"
            description="AI 已根据当前母题推荐可编辑的提示词，你可以调整后再生成文章题目。"
            theme="rose"
            prompt={topicPrompt}
            promptLabel="子选题提示词"
            promptPlaceholder="例如：生成 8 个更偏向下班后女性视角的题目，标题要有情绪张力"
            generateLabel="生成文章题目"
            candidates={childTopicCandidates}
            selectedCandidates={selectedChildTopicCandidates}
            emptyTitle="填写提示词后生成文章题目"
            emptyDescription="AI 会围绕当前母题提供一组可选择的文章标题"
            contextLabel="当前母题"
            contextValue={group.title}
            confirmLabel="添加选中的子选题"
            generating={topicCandidateGenerating}
            recommendationLoading={childPromptRecommending}
            saving={topicCandidateSaving}
            error={topicCandidateError}
            onPromptChange={setTopicPrompt}
            onRecommend={() => handleRecommendChildTopicPrompt(group.title)}
            onGenerate={() => handleGenerateChildTopicCandidates(group.title)}
            onToggle={(candidate) =>
              toggleCandidateSelection(
                setSelectedChildTopicCandidates,
                candidate,
              )
            }
            onCancel={() => setTopicListGeneratorOpen(false)}
            onConfirm={() => handleSaveChildTopicCandidates(group.id)}
          />
        )}
        {motherTopicGeneratorOpen && (
          <TopicCandidateDialog
            title="生成母选题"
            description="描述内容方向，生成后从候选母题中选择多项加入工作台。"
            prompt={motherTopicPrompt}
            promptLabel="选题提示词"
            promptPlaceholder="例如：为 25-35 岁城市女性生成 6 个值得长期创作的生活方式主题"
            generateLabel="生成候选选题"
            candidates={motherTopicCandidates}
            selectedCandidates={selectedMotherTopicCandidates}
            emptyTitle="填写提示词后生成候选"
            emptyDescription="AI 会提供适合长期运营的母选题方向"
            confirmLabel="添加选中的母选题"
            generating={topicCandidateGenerating}
            saving={topicCandidateSaving}
            error={topicCandidateError}
            onPromptChange={setMotherTopicPrompt}
            onGenerate={handleGenerateMotherTopicCandidates}
            onToggle={(candidate) =>
              toggleCandidateSelection(
                setSelectedMotherTopicCandidates,
                candidate,
              )
            }
            onCancel={() => setMotherTopicGeneratorOpen(false)}
            onConfirm={handleSaveMotherTopicCandidates}
          />
        )}
      </>
    );
  };

  const workspaceContent =
    tab === 'chat' ? (
      renderTopicWorkspace()
    ) : tab === 'tasks' ? (
      <XhsPublishingView
        topicGroups={topicGroups}
        topicsLoading={topicGroupsLoading}
      />
    ) : (
      <>
        <main className="min-w-0 flex-1 overflow-hidden bg-white">
          {renderCanvasTab()}
        </main>
        {selectedCanvas && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white">
            {selectedCanvas.type === 'image-group' ? (
              <ImageGroupCanvasView
                canvasId={selectedCanvas.id}
                onClose={() => {
                  setSelectedCanvas(null);
                  loadCanvases();
                }}
              />
            ) : (
              <CanvasFeedView
                canvasId={selectedCanvas.id}
                onClose={() => {
                  setSelectedCanvas(null);
                  loadCanvases();
                }}
              />
            )}
          </div>
        )}
      </>
    );

  return (
    <XhsWorkspaceShell activeTab={tab} onBack={onBack} onNavigate={setTab}>
      {workspaceContent}
    </XhsWorkspaceShell>
  );
};

export default XhsSpecialistView;
