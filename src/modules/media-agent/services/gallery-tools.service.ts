import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { GalleryGroupService } from '../../gallery/services/gallery-group.service.js';
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
  constructor(
    private readonly gallery: GalleryService,
    private readonly groups: GalleryGroupService,
  ) {}

  /**
   * @description 规范化标签/关键词文本，用于匹配比较。
   * @param {string} value - 原始文本。
   * @returns {string} 规范化后的文本。
   * @keyword-en normalize text for tag matching
   */
  private normalizeTagText(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  /**
   * @description 从用户查询中提取可用于标签匹配的候选词。
   * @param {string} query - 用户输入查询。
   * @returns {string[]} 候选关键词。
   * @keyword-en extract query keywords for tag matching
   */
  private extractQueryKeywords(query: string): string[] {
    const raw = String(query ?? '').trim();
    if (!raw) return [];
    const set = new Set<string>();
    const parts = raw.split(/[\s,，、;；|/]+/g).filter((x) => x.length > 0);
    for (const p of parts) set.add(this.normalizeTagText(p));
    const en = raw.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
    for (const w of en) set.add(this.normalizeTagText(w));
    const zh = raw.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
    for (const w of zh) set.add(this.normalizeTagText(w));
    return Array.from(set).filter((x) => x.length > 0);
  }

  /**
   * @description 根据查询语句在标签集合中选择最可能匹配的标签（精确 + 包含匹配）。
   * @param {string} query - 查询语句。
   * @param {string[]} allTags - 全量标签。
   * @returns {string[]} 匹配标签，按匹配优先级排序。
   * @keyword-en select matched tags from query
   */
  private pickMatchedTags(query: string, allTags: string[]): string[] {
    const normalizedQuery = this.normalizeTagText(query);
    const keywords = this.extractQueryKeywords(query);
    if (!normalizedQuery && keywords.length === 0) return [];

    const exact: string[] = [];
    const partial: string[] = [];

    for (const tag of allTags) {
      const tagNorm = this.normalizeTagText(tag);
      if (!tagNorm) continue;
      if (normalizedQuery && tagNorm === normalizedQuery) {
        exact.push(tag);
        continue;
      }
      const hit =
        (normalizedQuery.length > 0 &&
          (tagNorm.includes(normalizedQuery) ||
            normalizedQuery.includes(tagNorm))) ||
        keywords.some(
          (kw) =>
            kw.length > 0 && (tagNorm.includes(kw) || kw.includes(tagNorm)),
        );
      if (hit) partial.push(tag);
    }

    const ordered = [...exact, ...partial];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of ordered) {
      const key = this.normalizeTagText(t);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  /**
   * @description 在图片列表中基于标签关键词做本地匹配（不依赖向量检索）。
   * @param {Array<{ tags?: string[]; description?: string }>} images - 待匹配图片列表。
   * @param {string} query - 用户查询。
   * @returns {Array<{ tags?: string[]; description?: string }>} 匹配结果。
   * @keyword-en local tag keyword matching
   */
  private matchImagesByTagKeywords<
    T extends { tags?: string[]; description?: string },
  >(images: T[], query: string): T[] {
    const keywords = this.extractQueryKeywords(query);
    const q = this.normalizeTagText(query);
    if (!q && keywords.length === 0) return [];
    return (Array.isArray(images) ? images : []).filter((img) => {
      const tags = Array.isArray(img.tags)
        ? img.tags.map((t) => this.normalizeTagText(String(t ?? '')))
        : [];
      if (tags.some((t) => t === q || t.includes(q) || q.includes(t))) {
        return true;
      }
      if (
        tags.some((t) =>
          keywords.some(
            (kw) => kw.length > 0 && (t.includes(kw) || kw.includes(t)),
          ),
        )
      ) {
        return true;
      }
      return false;
    });
  }

  /**
   * @description 获取图库工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} LangChain 工具列表
   * @keyword-en get gallery tools handle
   * @since 2026-03-23
   */
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    return [
      this.createSearchImagesTool(scope),
      this.createListTagsTool(scope),
      this.createListImagesTool(scope),
      this.createRandomImagesTool(scope),
      this.createListGroupsTool(scope),
      this.createSearchGroupsTool(scope),
    ];
  }

  /**
   * @description 搜索图片工具
   * @keyword-en search images tool
   */
  private createSearchImagesTool(scope?: {
    tenantId?: string;
    userId?: string;
  }) {
    return tool(
      async (input: {
        query: string;
        limit?: number;
        min_score?: number;
        image_type?: 'all' | 'regular' | 'collage';
        tag?: string;
        group_id?: number;
      }) => {
        const {
          query,
          limit = 8,
          min_score = 0.5,
          image_type = 'regular',
          tag,
          group_id,
        } = input;
        try {
          const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
          const type =
            image_type === 'all' ||
            image_type === 'regular' ||
            image_type === 'collage'
              ? image_type
              : 'regular';
          const tagFetchLimit =
            type === 'all'
              ? safeLimit
              : Math.max(safeLimit, Math.min(120, safeLimit * 6));

          // 先走标签匹配：用户图库检索以标签为主，避免向量检索误判“无普通图”。
          const allTags = await this.gallery.listDistinctTagsWithTenant(
            scope?.userId,
            scope?.tenantId,
            5000,
          );
          const matchedTags = this.pickMatchedTags(query, allTags).slice(0, 20);

          let finalResults: Array<{
            id: number;
            url: string;
            thumbUrl?: string;
            tags: string[];
            description?: string;
            isCollage: boolean;
            score?: number;
          }> = [];

          if (matchedTags.length > 0) {
            const tagImages = await this.gallery.searchByTags({
              userId: scope?.userId,
              tenantId: scope?.tenantId,
              tags: matchedTags,
              limit: tagFetchLimit,
              imageType: type,
              groupId: group_id,
            });
            finalResults = tagImages.slice(0, safeLimit).map((img) => ({
              id: img.id,
              url: img.url,
              thumbUrl: img.thumbUrl,
              tags: Array.isArray(img.tags) ? img.tags : [],
              description: img.description,
              isCollage: img.isCollage === true,
            }));
          }

          if (finalResults.length === 0) {
            // 标签集合未直接命中时，先在可见图库内做“标签关键词”本地匹配，再回退向量检索。
            const localPool = await this.gallery.findAccessibleImages(
              scope?.userId,
              scope?.tenantId,
              {
                imageType: type,
                limit: 200,
                groupId: group_id,
                tag,
              },
            );
            const localMatched = this.matchImagesByTagKeywords(
              localPool,
              query,
            );
            if (localMatched.length > 0) {
              finalResults = localMatched.slice(0, safeLimit).map((img) => ({
                id: img.id,
                url: img.url,
                thumbUrl: img.thumbUrl,
                tags: Array.isArray(img.tags) ? img.tags : [],
                description: img.description,
                isCollage: img.isCollage === true,
              }));
            }
          }

          if (finalResults.length === 0) {
            // 标签未命中时再回退向量检索。
            const vectorFetchLimit =
              type === 'all'
                ? safeLimit
                : Math.max(safeLimit, Math.min(120, safeLimit * 6));
            const results = await this.gallery.searchSimilar(
              query,
              scope?.userId,
              scope?.tenantId,
              vectorFetchLimit,
              min_score,
              type,
            );
            finalResults = results.slice(0, safeLimit).map((r) => ({
              id: r.image.id,
              url: r.image.url,
              thumbUrl: r.image.thumbUrl,
              tags: r.image.tags,
              description: r.image.description,
              isCollage: r.image.isCollage === true,
              score: r.score,
            }));
          }

          return JSON.stringify({
            images: finalResults,
            total: finalResults.length,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_search_images',
        description:
          'Search images in gallery. Strategy: tag-first search, then vector similarity fallback. Use image_type to control returned image category: regular (default), collage, or all.',
        schema: z.object({
          query: z.string().describe('Text query for image search'),
          limit: z.number().optional().describe('Max results, default 8'),
          min_score: z
            .number()
            .optional()
            .describe('Min similarity score, default 0.5'),
          image_type: z
            .enum(['all', 'regular', 'collage'])
            .optional()
            .describe('Image type filter: regular (default), collage, all'),
          tag: z.string().optional().describe('Exact tag to filter images by'),
          group_id: z.number().optional().describe('Filter images by group ID'),
        }),
      },
    );
  }

  /**
   * @description 列出标签工具
   * @keyword-en list tags tool
   */
  private createListTagsTool(scope?: { tenantId?: string; userId?: string }) {
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
        description:
          'List all distinct tags in gallery, optionally filtered by tenant',
        schema: z.object({
          limit: z
            .number()
            .optional()
            .describe('Max tags to return, default 500'),
        }),
      },
    );
  }

  /**
   * @description 列出图片工具
   * @keyword-en list images tool
   */
  private createListImagesTool(scope?: { tenantId?: string; userId?: string }) {
    return tool(
      async (input: {
        group_id?: number;
        tag?: string;
        cursor_id?: number;
        limit?: number;
        image_type?: 'all' | 'regular' | 'collage';
      }) => {
        const { group_id, tag, cursor_id, limit = 24, image_type } = input;
        try {
          const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 24)));
          const type: 'all' | 'regular' | 'collage' =
            image_type === 'all' || image_type === 'collage'
              ? image_type
              : 'regular';
          const rawImages = await this.gallery.findAccessibleImages(
            scope?.userId,
            scope?.tenantId,
            {
              groupId: group_id,
              tag,
              imageType: type,
              cursorId: cursor_id,
              limit: safeLimit + 1,
            },
          );

          const has_more = rawImages.length > safeLimit;
          let filteredImages = rawImages.slice(0, safeLimit);

          // DB 搜索无结果时，用 tag 作为向量查询兜底
          if (filteredImages.length === 0 && tag) {
            const vectorFetchLimit =
              type === 'all'
                ? safeLimit
                : Math.max(safeLimit, Math.min(120, safeLimit * 6));
            const vectorResults = await this.gallery.searchSimilar(
              tag,
              scope?.userId,
              scope?.tenantId,
              vectorFetchLimit,
              undefined,
              type,
            );
            filteredImages = vectorResults
              .slice(0, safeLimit)
              .map((r) => r.image);
          }

          return JSON.stringify({
            images: filteredImages.map((img) => ({
              id: img.id,
              url: img.url,
              thumbUrl: img.thumbUrl,
              tags: img.tags,
              description: img.description,
              groupId: img.groupId,
              isCollage: img.isCollage === true,
              collageSourceImageIds: img.collageSourceImageIds,
            })),
            total: filteredImages.length,
            has_more,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_list_images',
        description:
          'List images from gallery. Use the "image_type" parameter to control what kind of images to return: "regular" (default) = only regular/non-collage images; "collage" = only collage/cover images; "all" = all images.',
        schema: z.object({
          group_id: z.number().optional().describe('Filter by group ID'),
          tag: z.string().optional().describe('Filter by tag'),
          image_type: z
            .enum(['all', 'regular', 'collage'])
            .optional()
            .describe(
              'Type of images to return: "regular" (default, excludes collage/cover), "collage" (only collage/cover), "all" (all images)',
            ),
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
  private createRandomImagesTool(scope?: {
    tenantId?: string;
    userId?: string;
  }) {
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
        description:
          'Get random images from gallery. Use this when user asks for random pictures or wants to browse sample images.',
        schema: z.object({
          limit: z.number().optional().describe('Max results, default 10'),
          group_id: z.number().optional().describe('Filter by group ID'),
        }),
      },
    );
  }

  /**
   * @description 列出图库分组工具
   * @keyword-en list gallery groups tool
   */
  private createListGroupsTool(scope?: { tenantId?: string; userId?: string }) {
    return tool(
      async (input: { tag?: string; limit?: number }) => {
        const { tag, limit = 50 } = input;
        try {
          const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
          const groups = await this.groups.listAccessibleGroups(
            scope?.userId,
            scope?.tenantId,
            tag,
            safeLimit,
          );
          return JSON.stringify({
            groups: groups.map((g) => ({
              id: g.id,
              name: g.name,
              description: g.description,
              tags: g.tags,
            })),
            total: groups.length,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_list_groups',
        description:
          'List gallery groups (albums/collections). Optionally filter by tag.',
        schema: z.object({
          tag: z.string().optional().describe('Filter groups by tag'),
          limit: z.number().optional().describe('Max results, default 50'),
        }),
      },
    );
  }

  /**
   * @description 搜索图库分组工具（向量相似度）
   * @keyword-en search gallery groups tool by vector similarity
   */
  private createSearchGroupsTool(scope?: {
    tenantId?: string;
    userId?: string;
  }) {
    return tool(
      async (input: { query: string; limit?: number; min_score?: number }) => {
        const { query, limit = 8, min_score = 0.5 } = input;
        try {
          const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
          const results = await this.groups.searchSimilar(
            query,
            scope?.userId,
            scope?.tenantId,
            safeLimit,
            min_score,
          );
          return JSON.stringify({
            groups: results.map((r) => ({
              id: r.group.id,
              name: r.group.name,
              description: r.group.description,
              tags: r.group.tags,
              score: r.score,
            })),
            total: results.length,
          });
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
      {
        name: 'gallery_search_groups',
        description:
          'Search gallery groups by semantic similarity. Use when user wants to find an album or collection by description.',
        schema: z.object({
          query: z.string().describe('Text query to search groups'),
          limit: z.number().optional().describe('Max results, default 8'),
          min_score: z
            .number()
            .optional()
            .describe('Min similarity score, default 0.5'),
        }),
      },
    );
  }
}
