import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { tool } from 'langchain';
import * as z from 'zod';

/**
 * @title Gallery Tools Service
 * @description 提供图库操作相关的 LangChain 工具
 * @keywords-cn gallery tools, langchain, image search
 * @keywords-en gallery tools, langchain, image search
 */
@Injectable()
export class GalleryToolsService {
  constructor(private readonly gallery: GalleryService) {}

  /**
   * @description 获取图库工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} LangChain 工具列表
   * @keyword-en get gallery tools handle
   * @since 2026-03-23
   */
  getHandle(
    scope?: { tenantId?: string; userId?: string },
  ): CreateAgentParams['tools'] {
    return [
      this.createSearchImagesTool(scope),
      this.createListTagsTool(scope),
      this.createListImagesTool(scope),
      this.createRandomImagesTool(scope),
    ];
  }

  /**
   * @description 搜索图片工具
   * @keyword-en search images tool
   */
  private createSearchImagesTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { query: string; limit?: number; min_score?: number }) => {
        const { query, limit = 8, min_score = 0.5 } = input;
        try {
          const results = await this.gallery.searchSimilar(
            query,
            scope?.userId,
            scope?.tenantId,
            limit,
            min_score,
          );
          return JSON.stringify({
            images: results.map((r) => ({
              id: r.image.id,
              url: r.image.url,
              thumbUrl: r.image.thumbUrl,
              tags: r.image.tags,
              description: r.image.description,
              score: r.score,
            })),
            total: results.length,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_search_images',
        description:
          'Search images in gallery by text query using vector similarity. Returns images with scores.',
        schema: z.object({
          query: z.string().describe('Text query for image search'),
          limit: z.number().optional().describe('Max results, default 8'),
          min_score: z.number().optional().describe('Min similarity score, default 0.5'),
        }),
      },
    );
  }

  /**
   * @description 列出标签工具
   * @keyword-en list tags tool
   */
  private createListTagsTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { limit?: number }) => {
        const { limit = 500 } = input;
        try {
          const tags = await this.gallery.listDistinctTagsWithTenant(
            scope?.userId,
            scope?.tenantId,
            limit,
          );
          return JSON.stringify({ tags, total: tags.length });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_list_tags',
        description: 'List all distinct tags in gallery, optionally filtered by tenant',
        schema: z.object({
          limit: z.number().optional().describe('Max tags to return, default 500'),
        }),
      },
    );
  }

  /**
   * @description 列出图片工具
   * @keyword-en list images tool
   */
  private createListImagesTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: {
        group_id?: number;
        tag?: string;
        cursor_id?: number;
        limit?: number;
        match_collage?: boolean;
      }) => {
        const { group_id, tag, cursor_id, limit = 24, match_collage } = input;
        try {
          const images = await this.gallery.findAccessibleImages(
            scope?.userId,
            scope?.tenantId,
            {
              groupId: group_id,
              tag,
              includeCollage: match_collage !== false,
              cursorId: cursor_id,
              limit,
            },
          );
          return JSON.stringify({
            images: images.map((img) => ({
              id: img.id,
              url: img.url,
              thumbUrl: img.thumbUrl,
              tags: img.tags,
              description: img.description,
              groupId: img.groupId,
              isCollage: img.isCollage === true,
              collageSourceImageIds: img.collageSourceImageIds,
            })),
            total: images.length,
            has_more: images.length === limit,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_list_images',
        description: 'List images from gallery with optional filters',
        schema: z.object({
          group_id: z.number().optional().describe('Filter by group ID'),
          tag: z.string().optional().describe('Filter by tag'),
          match_collage: z
            .boolean()
            .optional()
            .describe('Whether to include collage images (default true)'),
          cursor_id: z.number().optional().describe('Cursor for pagination'),
          limit: z.number().optional().describe('Max results, default 24'),
        }),
      },
    );
  }

  /**
   * @description 随机获取图片工具
   * @keyword-en random images tool
   */
  private createRandomImagesTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { limit?: number; group_id?: number }) => {
        const { limit = 10, group_id } = input;
        try {
          // Call sampleRandom on gallery service
          const images = await this.gallery.sampleRandom({
            userId: scope?.userId,
            tenantId: scope?.tenantId,
            groupId: group_id,
            limit,
          });
          return JSON.stringify({
            images: images.map((img) => ({
              id: img.id,
              url: img.url,
              thumbUrl: img.thumbUrl,
              tags: img.tags,
              description: img.description,
              groupId: img.groupId,
            })),
            total: images.length,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_random_images',
        description: 'Get random images from gallery. Use this when user asks for random pictures or wants to browse sample images.',
        schema: z.object({
          limit: z.number().optional().describe('Max results, default 10'),
          group_id: z.number().optional().describe('Filter by group ID'),
        }),
      },
    );
  }
}
