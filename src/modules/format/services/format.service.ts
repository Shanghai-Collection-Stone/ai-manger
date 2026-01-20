/**
 * @title 文本格式化服务 Text Format Service
 * @description 处理模型输出文本的规范化，如去除 ```json 围栏与多余前后缀。
 * @keywords-cn 格式化, 代码围栏, 文本清理
 * @keywords-en format, code fence, text cleanup
 */
export class TextFormatService {
  stripCodeFences(input: string): string {
    let s = input.trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```[a-zA-Z]*\s*/g, '');
    }
    if (s.endsWith('```')) {
      s = s.replace(/```\s*$/g, '');
    }
    return s.trim();
  }

  stripLeadingJsonLabel(input: string): string {
    return input.replace(/^json\s*/i, '').trim();
  }

  normalizeJsonText(input: string): string {
    return this.stripLeadingJsonLabel(this.stripCodeFences(input));
  }
}
