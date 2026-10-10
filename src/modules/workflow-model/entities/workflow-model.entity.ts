import { ObjectId } from 'mongodb';

/**
 * @description 工作流节点使用的模型类型，与 AI 提供商的 `modelCategory` 一一对应（节点不用向量模型）；
 *   `audio` 是克隆或设计音色类模型（录音或描述 → 音色 ID）。
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
 * @description 预设工作流与节点的 key，业务调用 `resolveNodeRuntime` 时从这里取，避免各处手写字符串；
 *   上线后不要改名，否则已保存的设置会失效。
 * @keyword-cn 工作流节点标识, 节点key常量
 * @keyword-en workflow-node-keys, node-key-constants
 */
export const WORKFLOW_NODES = {
  douyinWorkbench: {
    key: 'douyin-workbench',
    script: 'script',
    storyboard: 'storyboard',
    imageDecision: 'image-decision',
    shotImage: 'shot-image',
    personaImage: 'persona-image',
    shotVideo: 'shot-video',
    fullVideo: 'full-video',
    voiceClone: 'voice-clone',
    voiceDesign: 'voice-design',
    storeVisitVideo: 'store-visit-video',
  },
  xhsArticle: {
    key: 'xhs-article',
    topic: 'topic',
    article: 'article',
    imageDecision: 'image-decision',
    coverCopy: 'cover-copy',
    coverImage: 'cover-image',
    coverOverlay: 'cover-overlay',
    innerImage: 'inner-image',
  },
} as const;

/**
 * @description 预设工作流目录。新增会调用模型的业务节点时先在 `WORKFLOW_NODES` 与这里登记，再在调用处用
 *   `WorkflowModelService.resolveNodeRuntime(workflowKey, nodeKey)` 取模型。
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
        key: 'topic',
        label: '选题生成',
        description: '生成母 / 子选题候选，并推荐子选题提示词',
        category: 'llm',
      },
      {
        key: 'article',
        label: '文章生成',
        description:
          '按子选题写标题、正文与文章标签（首次生文与重写，可按需联网搜索）',
        category: 'llm',
      },
      {
        key: 'image-decision',
        label: '配图决策',
        description:
          '从真实图库标签里挑出本篇配图标签，关闭思考并与写正文同时进行；建议指定响应快的模型',
        category: 'llm',
      },
      {
        key: 'cover-copy',
        label: '封面文案',
        description: '为图组封面生成主标题与副标题（关闭思考）',
        category: 'llm',
      },
      {
        key: 'cover-image',
        label: '封面底图',
        description: 'AI 封面的无字底图，含灵感画布里的封面重绘',
        category: 'image',
      },
      {
        key: 'cover-overlay',
        label: '封面文字海报',
        description: '「AI 素材」封面策略里文字与装饰融合的海报素材层',
        category: 'image',
      },
      {
        key: 'inner-image',
        label: '内页重绘',
        description: '灵感画布里基于所选图片重新生成内页图',
        category: 'image',
      },
    ],
  },
  {
    key: 'douyin-workbench',
    label: '抖音视频制作',
    description: '分镜制作，或按人物、场景、音色与台词制作探店视频',
    nodes: [
      {
        key: 'script',
        label: '脚本生成',
        description: '按母选题写候选脚本，并推荐生成要求',
        category: 'llm',
      },
      {
        key: 'storyboard',
        label: '分镜拆解',
        description: '把脚本正文拆成逐段分镜与配图提示词',
        category: 'llm',
      },
      {
        key: 'image-decision',
        label: '分镜选图',
        description:
          '图库自找配图时为每段分镜挑选图库图片，关闭思考；建议指定响应快的模型',
        category: 'llm',
      },
      {
        key: 'shot-image',
        label: '分镜画面',
        description: '按分镜的配图提示词文生图',
        category: 'image',
      },
      {
        key: 'persona-image',
        label: '人物形象图',
        description: '为预设人物生成正面 / 侧身 / 特写三视图形象图',
        category: 'image',
      },
      {
        key: 'shot-video',
        label: '分镜视频',
        description:
          '分镜模式：每段分镜单独生成一段视频（有画面时以画面为首帧）',
        category: 'video',
        runtimeProviders: ['pixmax', 'shuyan', 'shuyanai'],
      },
      {
        key: 'full-video',
        label: '整片视频',
        description:
          '整片模式：所有分镜写进一条提示词、带上各镜画面作参考，一次生成一条完整视频；建议选单次时长长的模型',
        category: 'video',
        runtimeProviders: ['pixmax', 'shuyan', 'shuyanai'],
      },
      {
        key: 'voice-clone',
        label: '音色克隆',
        description:
          '探店模式：用户上传一段本人录音，克隆出音色 ID，数字人按这个声音念台词',
        category: 'audio',
        runtimeProviders: ['digital-human'],
        unsetHint: '未指定时探店模式不能克隆音色',
      },
      {
        key: 'voice-design',
        label: '声音设计（固定音色，可选）',
        description:
          '可选：按声音提示词额外生成固定音色与试听；纯提示词声音随视频生成，无需此节点',
        category: 'audio',
        runtimeProviders: ['digital-human'],
        unsetHint: '未指定时不能额外生成固定音色，纯提示词声音仍可使用',
      },
      {
        key: 'store-visit-video',
        label: '探店数字人视频',
        description:
          '探店模式：选 digital-human 时按人脸 + 音色 + 台词交给通用数字人服务；选数眼智能时按场景分段，可灵语音合成配音后用可灵数字人（模型填 kling-avatar-std / kling-avatar-pro）或万相数字人（wan2.2-s2v）逐段对口型，再在客户端拼接',
        category: 'video',
        runtimeProviders: ['digital-human', 'shuyan', 'shuyanai'],
        unsetHint: '未指定时探店模式不能生成视频',
      },
    ],
  },
];

/**
 * @description 各模型类型当前运行时真正能调用的提供商：`null` 表示除 `excluded` 外都可以。
 *   节点登记了 `runtimeProviders` 时再按节点收窄（例如 `digital-human` 只能用在探店节点，不能挂到分镜 / 整片视频）。
 *   后台仍允许提前保存不支持的组合，但会标出「运行时暂不支持」，调用时直接报错而不是静默降级。
 * @keyword-cn 运行时支持范围, 提供商兼容
 * @keyword-en runtime-support-matrix, provider-compatibility
 */
export const WORKFLOW_RUNTIME_SUPPORT: Record<
  WorkflowNodeCategory,
  { allowed: string[] | null; excluded: string[] }
> = {
  llm: { allowed: null, excluded: ['pixmax', 'digital-human'] },
  image: {
    allowed: ['gemini', 'doubao', 'ark', 'openai', 'shuyan', 'shuyanai'],
    excluded: [],
  },
  video: {
    allowed: ['pixmax', 'shuyan', 'shuyanai', 'digital-human'],
    excluded: [],
  },
  audio: { allowed: ['digital-human'], excluded: [] },
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
