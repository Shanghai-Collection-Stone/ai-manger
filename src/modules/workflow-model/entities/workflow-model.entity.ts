import { ObjectId } from 'mongodb';

/**
 * @description 工作流节点使用的模型类型，与 AI 提供商的 `modelCategory` 一一对应（节点不用向量模型）；
 *   `audio` 是语音类模型（录音克隆音色、按音色配音）。
 * @keyword-cn 节点模型类型, 提供商类型
 * @keyword-en node-model-category, provider-category
 */
export type WorkflowNodeCategory = 'llm' | 'image' | 'video' | 'audio';

/**
 * @description 代码内固定的一个预设工作流节点：后台只能为它选择提供商与模型，不能增删节点。
 * @keyword-cn 预设工作流节点, 节点定义
 * @keyword-en preset-workflow-node, node-definition
 */
export interface WorkflowNodeDefinition {
  key: string;
  label: string;
  description: string;
  category: WorkflowNodeCategory;
  /** 该节点运行时只接受这些提供商代码；为空时按类型的 `WORKFLOW_RUNTIME_SUPPORT` 判断 */
  runtimeProviders?: string[];
  /** 节点没有指定提供商时后台显示的说明；为空时按类型显示默认提供商 */
  unsetHint?: string;
}

/**
 * @description 代码内固定的一条预设工作流及其节点。
 * @keyword-cn 预设工作流, 工作流定义
 * @keyword-en preset-workflow, workflow-definition
 */
export interface WorkflowDefinition {
  key: string;
  label: string;
  description: string;
  nodes: WorkflowNodeDefinition[];
}

/**
 * @description 预设工作流与节点的 key，业务调用 `resolveNodeRuntime` 时从这里取，避免各处手写字符串。
 *   节点按能力只分四类：思考 `think`、生图 `image`、生视频 `video`、音色克隆 `voice`（小红书只有前两类）。
 *   原来按步骤拆开的节点名（脚本、分镜、选图、探店画面视频……）保留为别名，都指向所属的那一类，业务代码不用改；
 *   旧节点上保存过的设置由 `WORKFLOW_LEGACY_NODE_KEYS` 在启动时并入新节点。
 * @keyword-cn 工作流节点标识, 节点key常量
 * @keyword-en workflow-node-keys, node-key-constants
 */
export const WORKFLOW_NODES = {
  douyinWorkbench: {
    key: 'douyin-workbench',
    think: 'think',
    image: 'image',
    video: 'video',
    voice: 'voice',
    script: 'think',
    storyboard: 'think',
    imageDecision: 'think',
    storeVisitContinuity: 'think',
    storeVisitScene: 'think',
    storeVisitPlanner: 'think',
    shotImage: 'image',
    personaImage: 'image',
    shotVideo: 'video',
    fullVideo: 'video',
    storeVisitVideo: 'video',
    storeVisitAvatar: 'video',
    voiceClone: 'voice',
  },
  xhsArticle: {
    key: 'xhs-article',
    think: 'think',
    image: 'image',
    topic: 'think',
    article: 'think',
    imageDecision: 'think',
    coverCopy: 'think',
    coverImage: 'image',
    coverOverlay: 'image',
    innerImage: 'image',
  },
} as const;

/**
 * @description 合并前按步骤拆开的旧节点 key：新节点还没有设置时，按这里的顺序取第一个有设置的旧节点并入（旧记录保留不删，可回退）。
 *   抖音「思考」优先取探店尾帧衔接 / 场景归类（要看图，并入的模型得是视觉语言模型），「生视频」优先取探店画面 / 人物节点（探店只收数眼与自建 MiniMax-H3）。
 * @keyword-cn 旧节点合并, 节点设置迁移
 * @keyword-en legacy-node-merge, node-binding-migration
 */
export const WORKFLOW_LEGACY_NODE_KEYS: Record<
  string,
  Record<string, readonly string[]>
> = {
  'douyin-workbench': {
    think: [
      'store-visit-continuity',
      'store-visit-scene',
      'script',
      'storyboard',
      'store-visit-planner',
      'image-decision',
    ],
    image: ['shot-image', 'persona-image'],
    video: [
      'store-visit-video',
      'store-visit-avatar',
      'shot-video',
      'full-video',
    ],
    voice: ['voice-clone'],
  },
  'xhs-article': {
    think: ['article', 'topic', 'cover-copy', 'image-decision'],
    image: ['cover-image', 'inner-image', 'cover-overlay'],
  },
};

/**
 * @description 预设工作流目录。节点按能力只分思考 / 生图 / 生视频 / 音色克隆四类，同一类的各个步骤共用一个节点，
 *   不再一步一个节点；新业务步骤直接用所属那一类的节点 key 调 `WorkflowModelService.resolveNodeRuntime(workflowKey, nodeKey)`。
 * @keyword-cn 预设工作流目录, 节点登记
 * @keyword-en preset-workflow-catalog, node-registry
 */
export const WORKFLOW_MODEL_CATALOG: readonly WorkflowDefinition[] = [
  {
    key: 'xhs-article',
    label: '小红书图文',
    description: '母选题 → 子选题 → 文章 → 封面与内页配图（含灵感画布重绘）',
    nodes: [
      {
        key: 'think',
        label: '思考',
        description:
          '选题生成、文章生成（可按需联网搜索）、配图决策、封面文案都用这个模型',
        category: 'llm',
      },
      {
        key: 'image',
        label: '生图',
        description: '封面底图、封面文字海报、灵感画布内页重绘都用这个模型',
        category: 'image',
      },
    ],
  },
  {
    key: 'douyin-workbench',
    label: '抖音视频制作',
    description: '分镜制作，或按场景、音色与台词制作探店视频',
    nodes: [
      {
        key: 'think',
        label: '思考',
        description:
          '写脚本、拆分镜、分镜选图、探店编排与台词、场景图库归类、尾帧衔接、模板规划都用这个模型；场景归类、尾帧衔接和读模板图要看图，请选支持看图的视觉语言模型',
        category: 'llm',
      },
      {
        key: 'image',
        label: '生图',
        description:
          '分镜画面、人物形象图、探店人物首帧、视频模板图都用这个模型',
        category: 'image',
      },
      {
        key: 'video',
        label: '生视频',
        description:
          '分镜视频、整片视频、探店空镜与人物段都用这个模型。可选 PixMax、数眼智能（Seedance、MiniMax-H3、wan2.7-i2v、可灵数字人）或自建 MiniMax-H3（opensource-video）；探店只支持数眼智能与自建 MiniMax-H3',
        category: 'video',
        runtimeProviders: ['pixmax', 'shuyan', 'shuyanai', 'opensource-video'],
        unsetHint:
          '未指定时分镜 / 整片走环境变量配置的直连视频服务，探店不能生成视频',
      },
      {
        key: 'voice',
        label: '音色克隆',
        description:
          '探店的录音克隆音色与配音：选阿里云百炼（dashscope），克隆音色模型填 cosyvoice-v3.5-plus，系统音色固定用 cosyvoice-v3-flash',
        category: 'audio',
        runtimeProviders: ['dashscope'],
        unsetHint: '未指定时探店不能克隆音色、也不能配音',
      },
    ],
  },
];

/**
 * @description 各模型类型当前运行时真正能调用的提供商：`null` 表示除 `excluded` 外都可以。
 *   节点登记了 `runtimeProviders` 时再按节点收窄（例如探店的两个节点只收百炼与数眼智能）。
 *   后台仍允许提前保存不支持的组合，但会标出「运行时暂不支持」，调用时直接报错而不是静默降级。
 * @keyword-cn 运行时支持范围, 提供商兼容
 * @keyword-en runtime-support-matrix, provider-compatibility
 */
export const WORKFLOW_RUNTIME_SUPPORT: Record<
  WorkflowNodeCategory,
  { allowed: string[] | null; excluded: string[] }
> = {
  llm: { allowed: null, excluded: ['pixmax'] },
  image: {
    allowed: ['gemini', 'doubao', 'ark', 'openai', 'shuyan', 'shuyanai'],
    excluded: [],
  },
  video: {
    allowed: ['pixmax', 'shuyan', 'shuyanai', 'opensource-video'],
    excluded: [],
  },
  audio: { allowed: ['dashscope'], excluded: [] },
};

/**
 * @description 持久化的节点模型设置，平台级，每个工作流节点最多一条；没有记录时节点使用该类型的默认提供商。
 * @keyword-cn 节点模型设置, 平台级配置
 * @keyword-en node-model-binding, platform-setting
 */
export interface WorkflowNodeModelEntity {
  _id: ObjectId;
  workflowKey: string;
  nodeKey: string;
  providerId: string;
  model: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 节点实际调用时使用的提供商运行配置。
 * @keyword-cn 节点运行配置, 提供商密钥
 * @keyword-en node-runtime, provider-credential
 */
export interface WorkflowNodeRuntime {
  providerId: string;
  providerCode: string;
  providerName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  tokensPerCredit?: number;
  fixedTokensPerCall?: number;
}

/**
 * @description 后台列表里的一个提供商选项（不含密钥）。
 * @keyword-cn 提供商选项, 隐藏密钥
 * @keyword-en provider-option, hide-api-key
 */
export interface WorkflowProviderOption {
  id: string;
  name: string;
  providerCode: string;
  category: WorkflowNodeCategory;
  model?: string;
  isDefault: boolean;
  runtimeSupported: boolean;
}

/**
 * @description 后台列表里的一个节点：定义 + 当前设置 + 未设置时生效的默认提供商。
 * @keyword-cn 节点设置视图, 默认回退
 * @keyword-en node-setting-view, default-fallback
 */
export interface WorkflowNodeView extends WorkflowNodeDefinition {
  binding: {
    providerId: string;
    providerName: string;
    providerCode: string;
    model: string;
    providerAvailable: boolean;
    runtimeSupported: boolean;
    updatedAt: Date;
  } | null;
  fallback: {
    providerName: string;
    providerCode: string;
    model?: string;
  } | null;
}

/**
 * @description 后台列表里的一条工作流。
 * @keyword-cn 工作流设置视图, 节点列表
 * @keyword-en workflow-setting-view, node-list
 */
export interface WorkflowView extends Omit<WorkflowDefinition, 'nodes'> {
  nodes: WorkflowNodeView[];
}
