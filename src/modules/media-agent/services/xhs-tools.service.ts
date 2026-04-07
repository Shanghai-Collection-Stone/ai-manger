import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { tool } from 'langchain';
import * as z from 'zod';
import { CanvasService } from '../../canvas/services/canvas.service.js';

/**
 * @title XHS Tools Service
 * @description 提供小红书/Canvas 操作相关的 LangChain 工具，包含 Canvas 列表、详情及图片组创建
 * @keywords-cn xhs tools, canvas, langchain
 * @keywords-en xhs tools, canvas, langchain
 */
@Injectable()
export class XhsToolsService {
  constructor(private readonly canvasService: CanvasService) {}

  /**
   * @description 获取 XHS 工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} LangChain 工具列表
   * @keyword-en get XHS tools handle
   * @since 2026-03-23
   */
  getHandle(
    scope?: { tenantId?: string; userId?: string },
  ): CreateAgentParams['tools'] {
    return [
      this.createListCanvasesTool(scope),
      this.createGetCanvasDetailTool(scope),
      this.createImageGroupCanvasTool(scope),
    ];
  }

  /**
   * @description 列出 Canvas 列表工具
   * @keyword-en list canvases tool
   */
  private createListCanvasesTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { limit?: number }) => {
        const { limit = 50 } = input;
        const canvases = await this.canvasService.list(
          scope?.userId,
          scope?.tenantId,
          limit,
        );
        return JSON.stringify({
          canvases: canvases.map((c) => ({
            id: c.id,
            topic: c.topic,
            status: c.status,
            type: c.type ?? 'article',
            articleCount: Array.isArray(c.articles) ? c.articles.length : 0,
            imageGroupCount: Array.isArray(c.imageGroups) ? c.imageGroups.length : 0,
            createdAt: c.createdAt,
          })),
          total: canvases.length,
        });
      },
      {
        name: 'xhs_list_canvases',
        description: 'List all available Canvas collections for content management',
        schema: z.object({
          limit: z.number().optional().describe('Max results, default 50'),
        }),
      },
    );
  }

  /**
   * @description 获取 Canvas 详情工具
   * @keyword-en get canvas detail tool
   */
  private createGetCanvasDetailTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { canvas_id: number }) => {
        const { canvas_id } = input;
        const canvas = await this.canvasService.get(canvas_id, scope?.tenantId);
        if (!canvas) {
          return JSON.stringify({ error: 'Canvas not found', canvas_id });
        }
        return JSON.stringify({
          id: canvas.id,
          topic: canvas.topic,
          status: canvas.status,
          type: canvas.type ?? 'article',
          articles: (canvas.articles ?? []).map((a) => ({
            id: a.id,
            title: a.title,
            tags: a.tags,
            status: a.status,
            imageUrls: a.imageUrls,
          })),
          imageGroups: Array.isArray(canvas.imageGroups)
            ? canvas.imageGroups.map((g) => ({
                id: g.id,
                layout: g.layout,
                status: g.status,
                imageCount: Array.isArray(g.images) ? g.images.length : 0,
              }))
            : [],
          createdAt: canvas.createdAt,
        });
      },
      {
        name: 'xhs_get_canvas_detail',
        description: 'Get detailed information about a specific Canvas including its articles and image groups',
        schema: z.object({
          canvas_id: z.number().describe('Canvas ID to retrieve'),
        }),
      },
    );
  }

  /**
   * @description 创建图片组 Canvas 工具（异步生成，立即返回 generating 状态）
   * @keyword-en create image group canvas tool
   */
  private createImageGroupCanvasTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: {
        topic?: string;
        groupCount?: number;
        articles: Array<{ title: string; tags?: string[] }>;
      }) => {
        if (!scope?.userId) {
          return JSON.stringify({ error: 'USER_REQUIRED: userId is required for canvas creation' });
        }
        // 自动补全文章到 groupCount
        const targetCount = Math.max(
          typeof input.groupCount === 'number' && input.groupCount > 0 ? input.groupCount : 0,
          Array.isArray(input.articles) ? input.articles.length : 0,
        );
        const articles = Array.isArray(input.articles) ? [...input.articles] : [];
        if (targetCount > articles.length) {
          const topic = input.topic ?? '图组';
          for (let i = articles.length + 1; i <= targetCount; i++) {
            articles.push({ title: `${topic}第${i}组`, tags: [] });
          }
        }
        const canvas = await this.canvasService.createImageGroupCanvas({
          userId: scope.userId,
          tenantId: scope.tenantId,
          topic: input.topic,
          articles: articles.map((a) => ({ title: a.title, tags: a.tags ?? [] })),
        });
        const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: canvas.id, status: 'generating', type: 'image-group', topic: canvas.topic ?? '', articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 })}\n\`\`\``;
        return [
          `图片组 Canvas 已创建（ID=${canvas.id}），正在后台生成图片。`,
          `请将以下代码块原样输出给用户（**必须输出，不能省略**）：`,
          canvasBlock,
          `JSON 详情：${JSON.stringify({ canvas: { id: canvas.id, status: canvas.status, type: canvas.type, topic: canvas.topic, articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 } })}`,
        ].join('\n');
      },
      {
        name: 'xhs_create_image_group_canvas',
        description:
          '创建图片组 Canvas（image-group 类型）。根据文章列表（标题+标签）从图库中匹配图片，自动生成固定布局的图片组。立即返回生成中状态，后台异步完成。用户要“生成 N 组图片”时，传入 groupCount，同时在 articles 里写入每组的标题和标签，让图片匹配更准确。',
        schema: z.object({
          topic: z.string().optional().describe('Canvas 主题，可选'),
          groupCount: z.number().int().min(1).max(20).optional()
            .describe('要生成的图片组数量（默认等于 articles 数量）。若指定此值且大于 articles 数量，后端自动补充展位文章'),
          articles: z
            .array(
              z.object({
                title: z.string().describe('文章标题'),
                tags: z.array(z.string()).optional().describe('标签列表，用于图片匹配（标签越准确匹配越好）'),
              }),
            )
            .describe('文章列表，每篇对应一个图片组。建议尽量填写 title 和 tags'),
        }),
      },
    );
  }
}
