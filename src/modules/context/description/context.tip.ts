import { createHash } from 'crypto';

/**
 * @title 模块描述 Context Module Tip
 * @description 基础上下文模块：文件对照与函数哈希映射。
 * @keywords-cn 上下文, 基础, 关键词对照
 * @keywords-en context, basic, keywords mapping
 */
export const moduleTip = {
  files: {
    '上下文/Context': 'src/modules/context/services/context.service.ts',
    '消息/Message': 'src/modules/context/entities/message.entity.ts',
    '会话/Conversation': 'src/modules/context/entities/conversation.entity.ts',
    '枚举/Enums': 'src/modules/context/enums/context.enums.ts',
    '类型/Types': 'src/modules/context/types/context.types.ts',
    '缓存/Cache': 'src/modules/context/cache/context.cache.ts',
    '控制器/Controller': 'src/modules/context/controller/context.controller.ts',
  },
  functionMap: {
    '创建会话/create session': {
      name: 'createSession',
      hash: sha(
        'src/modules/context/services/context.service.ts#createSession',
      ),
    },
    '追加消息/append message': {
      name: 'appendMessage',
      hash: sha(
        'src/modules/context/services/context.service.ts#appendMessage',
      ),
    },
    '获取消息/get messages': {
      name: 'getMessages',
      hash: sha('src/modules/context/services/context.service.ts#getMessages'),
    },
    '清空会话/clear session': {
      name: 'clearSession',
      hash: sha('src/modules/context/services/context.service.ts#clearSession'),
    },
    '构造内存/build memory': {
      name: 'buildMemory',
      hash: sha('src/modules/context/services/context.service.ts#buildMemory'),
    },
  },
  description: '基础上下文模块：会话与消息的持久化与读取能力。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
