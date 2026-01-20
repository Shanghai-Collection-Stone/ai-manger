import { createHash } from 'crypto';

/**
 * @title 模块描述 Title Function-Call Tip
 * @description 提供关键词中英对照、文件映射与函数哈希，用于快速检索。
 * @keywords-cn 标题, 函数调用, 关键词对照
 * @keywords-en title, function-call, keywords mapping
 */
export const moduleTip = {
  keywordsCn: ['标题', '函数调用', '首轮问答', '持久化'],
  keywordsEn: ['title', 'function-call', 'first turn', 'persist'],
  files: {
    '服务/Service': 'src/modules/function-call/title/services/title.service.ts',
    '模块/Module': 'src/modules/function-call/title/title.module.ts',
  },
  fileMap: {
    标题: 'src/modules/function-call/title/services/title.service.ts',
    title: 'src/modules/function-call/title/services/title.service.ts',
    模块: 'src/modules/function-call/title/title.module.ts',
    module: 'src/modules/function-call/title/title.module.ts',
  },
  functionMap: {
    '生成标题/generate title': {
      name: 'getHandle.title_generate',
      hash: sha(
        'src/modules/function-call/title/services/title.service.ts#title_generate',
      ),
    },
    '首轮自动/ensure first turn': {
      name: 'ensureFirstTurnTitle',
      hash: sha(
        'src/modules/function-call/title/services/title.service.ts#ensureFirstTurnTitle',
      ),
    },
  },
  description: 'Title函数模块：根据首轮问答生成简洁标题，并写入上下文会话。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
