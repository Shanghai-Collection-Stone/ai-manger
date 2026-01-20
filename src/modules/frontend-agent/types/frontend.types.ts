import { z } from 'zod';

/**
 * @title 页面元素类型 Page Element Types
 * @description 定义图表、表格与Markdown的结构。
 * @keywords-cn 页面元素, 图表, 表格, Markdown
 * @keywords-en page element, chart, table, markdown
 */
export const ZChartElement = z.object({
  kind: z.literal('chart'),
  title: z.string().optional(),
  chartType: z.enum(['bar', 'line', 'pie', 'area', 'scatter']).optional(),
  spec: z.record(z.string(), z.any()).optional(),
});

export const ZTableElement = z.object({
  kind: z.literal('table'),
  title: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))),
});

export const ZMarkdownElement = z.object({
  kind: z.literal('markdown'),
  title: z.string().optional(),
  content: z.string(),
});

export const ZPageElement = z.union([
  ZChartElement,
  ZTableElement,
  ZMarkdownElement,
]);

export const ZPageResult = z.object({
  title: z.string().optional(),
  elements: z.array(ZPageElement),
});

export type ChartElement = z.infer<typeof ZChartElement>;
export type TableElement = z.infer<typeof ZTableElement>;
export type MarkdownElement = z.infer<typeof ZMarkdownElement>;
export type PageElement = z.infer<typeof ZPageElement>;
export type PageResult = z.infer<typeof ZPageResult>;
