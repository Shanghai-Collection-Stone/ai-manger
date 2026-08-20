/**
 * @description 默认 Agent 种子模板(不含租户/时间字段)
 * @keyword-en workspace agent seed
 * @keyword-cn Agent种子模板
 */
export interface WorkspaceAgentSeed {
  key: string;
  name: string;
  description: string;
  /** 通讯录图标类名 */
  icon: string;
  /** 会话图标类名 */
  accent: string;
  /** 是否接入 AI 运行时自动回复 */
  aiEnabled: boolean;
  sortOrder: number;
}

/**
 * @description AI 运行时默认提供商编码(与 chat 控制器默认值保持一致)
 * @keyword-en workspace agent default provider
 * @keyword-cn Agent默认提供商
 */
export const WORKSPACE_AGENT_DEFAULT_PROVIDER = 'nvidia';

/**
 * @description AI 运行时默认模型(与 chat 控制器默认值保持一致)
 * @keyword-en workspace agent default model
 * @keyword-cn Agent默认模型
 */
export const WORKSPACE_AGENT_DEFAULT_MODEL =
  'deepseek-ai/deepseek-v3.1-terminus';

/**
 * @description 租户首次读取通讯录时写入的默认 Agent 目录。
 *   仅通用助手默认接入 AI 运行时(chat-main),其余先只记录会话,可按需 PATCH 开启。
 * @keyword-en default workspace agents
 * @keyword-cn 默认Agent目录
 */
export const DEFAULT_WORKSPACE_AGENTS: readonly WorkspaceAgentSeed[] = [
  {
    key: 'general',
    name: '通用助手',
    description: '智能对话与通用问答',
    icon: 'bot',
    accent: 'chat',
    aiEnabled: true,
    sortOrder: 1,
  },
  {
    key: 'sheet',
    name: 'AI 表格',
    description: '智能处理表格与数据分析',
    icon: 'sheet',
    accent: 'table',
    aiEnabled: false,
    sortOrder: 2,
  },
  {
    key: 'image',
    name: 'AI 图像',
    description: '图像生成与编辑',
    icon: 'picture',
    accent: 'image',
    aiEnabled: false,
    sortOrder: 3,
  },
  {
    key: 'article',
    name: 'AI 文章',
    description: '文章生成与优化',
    icon: 'article',
    accent: 'doc',
    aiEnabled: false,
    sortOrder: 4,
  },
  {
    key: 'analysis',
    name: '数据分析师',
    description: '数据分析与洞察',
    icon: 'chart',
    accent: 'table',
    aiEnabled: false,
    sortOrder: 5,
  },
  {
    key: 'code',
    name: '编程助手',
    description: '代码编写与调试',
    icon: 'dev',
    accent: 'code',
    aiEnabled: false,
    sortOrder: 6,
  },
];
