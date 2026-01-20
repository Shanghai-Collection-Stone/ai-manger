import { createHash } from 'crypto';

/**
 * @title 模块描述 Format Tip
 * @description 文本格式化模块关键词与函数映射。
 * @keywords-cn 格式化, 代码围栏, 文本
 * @keywords-en format, code fence, text
 */
export const moduleTip = {
  keywordsCn: ['格式化', '代码围栏', '文本', '清理'],
  keywordsEn: ['format', 'code-fence', 'text', 'cleanup'],
  files: {
    '服务/FormatService': 'src/modules/format/services/format.service.ts',
  },
  functionMap: {
    '去围栏/strip fences': {
      name: 'stripCodeFences',
      hash: sha(
        'src/modules/format/services/format.service.ts#stripCodeFences',
      ),
    },
    '前缀/strip json label': {
      name: 'stripLeadingJsonLabel',
      hash: sha(
        'src/modules/format/services/format.service.ts#stripLeadingJsonLabel',
      ),
    },
    '规范化/normalize json': {
      name: 'normalizeJsonText',
      hash: sha(
        'src/modules/format/services/format.service.ts#normalizeJsonText',
      ),
    },
  },
  description: '提供去除 ```json 围栏与文本规范化的工具服务。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
