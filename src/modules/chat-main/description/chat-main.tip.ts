import { createHash } from 'crypto';

/**
 * @title 模块描述 Chat-Main Tip
 * @description 主对话模块关键词、文件映射与函数哈希。
 * @keywords-cn 主对话, 流式, 非流式, 上下文CRUD
 * @keywords-en chat main, streaming, non-streaming, context CRUD
 */
export const moduleTip = {
  keywordsCn: [
    '主对话',
    '流式',
    '非流式',
    '上下文',
    '控制器',
    '服务',
    '图片上传',
  ],
  keywordsEn: [
    'chat main',
    'streaming',
    'non-streaming',
    'context',
    'controller',
    'service',
    'image upload',
  ],
  files: {
    '控制器/Controller': 'src/modules/chat-main/controller/chat.controller.ts',
    '服务/Service': 'src/modules/chat-main/services/chat.service.ts',
    '类型/Types': 'src/modules/chat-main/types/chat.types.ts',
  },
  functionMap: {
    '发送/send': {
      name: 'send',
      hash: sha('src/modules/chat-main/services/chat.service.ts#send'),
    },
    '流式/stream': {
      name: 'stream',
      hash: sha('src/modules/chat-main/services/chat.service.ts#stream'),
    },
    '智能上下文/getSmartContext': {
      name: 'getSmartContext',
      hash: sha(
        'src/modules/chat-main/services/chat.service.ts#getSmartContext',
      ),
    },
    '创建会话/createSession': {
      name: 'createSession',
      hash: sha('src/modules/chat-main/services/chat.service.ts#createSession'),
    },
    '追加用户/appendUser': {
      name: 'appendUser',
      hash: sha('src/modules/chat-main/services/chat.service.ts#appendUser'),
    },
    '追加助手/appendAssistant': {
      name: 'appendAssistant',
      hash: sha(
        'src/modules/chat-main/services/chat.service.ts#appendAssistant',
      ),
    },
    '获取消息/getMessages': {
      name: 'getMessages',
      hash: sha('src/modules/chat-main/services/chat.service.ts#getMessages'),
    },
    '清空会话/clearSession': {
      name: 'clearSession',
      hash: sha('src/modules/chat-main/services/chat.service.ts#clearSession'),
    },
  },
  description:
    '主对话模块：支持流式与非流式交互，并提供上下文会话的增删改查能力。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
