/**
 * @title 检索选项 Retrieval Options
 * @description 关键词检索与滑动窗口的参数定义。
 * @keywords-cn 检索, 关键词, 滑动窗口
 * @keywords-en retrieval, keywords, sliding window
 */
export interface RetrievalOptions {
  keywords: string[];
  matchAll?: boolean;
  windowSize?: number;
  maxMessages?: number;
}
