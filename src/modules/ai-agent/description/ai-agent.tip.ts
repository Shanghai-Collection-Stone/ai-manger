import { createHash } from 'crypto';

/**
 * @title 模块描述 Ai-Agent Module Tip
 * @description 模块关键词、文件映射与函数哈希描述。
 * @keywords-cn Agent模块, 关键词对照, 函数哈希
 * @keywords-en agent module, keywords mapping, function hash
 */
export const moduleTip = {
  keywordsCn: [
    'Agent',
    '服务',
    '类型',
    '枚举',
    '运行',
    '构建模型',
    '消息转换',
    '函数句柄',
    '流式',
  ],
  keywordsEn: [
    'agent',
    'service',
    'types',
    'enums',
    'run',
    'build model',
    'message convert',
    'handle',
    'stream',
  ],
  files: {
    '服务/Service': 'src/modules/ai-agent/services/agent.service.ts',
    '类型/Types': 'src/modules/ai-agent/types/agent.types.ts',
    '枚举/Enums': 'src/modules/ai-agent/enums/agent.enums.ts',
  },
  fileMap: {
    服务: 'src/modules/ai-agent/services/agent.service.ts',
    service: 'src/modules/ai-agent/services/agent.service.ts',
    类型: 'src/modules/ai-agent/types/agent.types.ts',
    types: 'src/modules/ai-agent/types/agent.types.ts',
    枚举: 'src/modules/ai-agent/enums/agent.enums.ts',
    enums: 'src/modules/ai-agent/enums/agent.enums.ts',
  },
  functionMap: {
    '函数句柄/handle': {
      name: 'getHandle',
      hash: sha('src/modules/ai-agent/services/agent.service.ts#getHandle'),
    },
    '构建模型/build model': {
      name: 'buildChatModel',
      hash: sha(
        'src/modules/ai-agent/services/agent.service.ts#buildChatModel',
      ),
    },
    '运行/run': {
      name: 'run',
      hash: sha('src/modules/ai-agent/services/agent.service.ts#run'),
    },
    '消息转换/message convert': {
      name: 'toMessages',
      hash: sha('src/modules/ai-agent/services/agent.service.ts#toMessages'),
    },
    '流式/stream': {
      name: 'stream',
      hash: sha('src/modules/ai-agent/services/agent.service.ts#stream'),
    },
  },
  description:
    'AI Agent模块：使用LangChain统一封装Gemini与DeepSeek的对话能力。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
