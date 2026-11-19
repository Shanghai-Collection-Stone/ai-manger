import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  GalleryTagCategory,
  GalleryTagLibraryEntity,
} from '../entities/gallery-tag-library.entity.js';
import {
  GalleryTagLinkService,
  resolveGalleryTagScopeKey,
} from './gallery-tag-link.service.js';

/**
 * @description 标签库接口的分类与未分类标签响应形状。
 * @keyword-cn 标签库响应, 未分类统计
 * @keyword-en tag-library-response, uncategorized-statistics
 */
export type GalleryTagLibraryView = {
  categories: GalleryTagCategory[];
  uncategorized: Array<{ tag: string; count: number }>;
};

/**
 * @description 图库标签库服务，按图片可见作用域保存分类并统计未分类标签。
 * @keyword-cn 图库标签库, 未分类标签
 * @keyword-en gallery-tag-library, uncategorized-tags
 */
@Injectable()
export class GalleryTagLibraryService {
  private readonly libraries: Collection<GalleryTagLibraryEntity>;

  /**
   * @description 初始化标签库集合，未分类标签统计交给标签关联服务。
   * @keyword-cn 标签库初始化, 数据集合
   * @keyword-en tag-library-initialization, data-collections
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly tagLinks: GalleryTagLinkService,
  ) {
    this.libraries = db.collection<GalleryTagLibraryEntity>(
      'gallery_tag_libraries',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 创建标签库作用域唯一索引。
   * @keyword-cn 标签库索引, 作用域唯一
   * @keyword-en tag-library-index, unique-scope
   */
  async ensureIndexes(): Promise<void> {
    await this.libraries.createIndex({ scopeKey: 1 }, { unique: true });
  }

  /**
   * @description 生成与图片租户可见性一致的标签库作用域键。
   * @keyword-cn 标签库作用域, 租户隔离
   * @keyword-en tag-library-scope, tenant-isolation
   */
  private resolveScopeKey(tenantId?: string): string {
    return resolveGalleryTagScopeKey(tenantId);
  }

  /**
   * @description 读取标签库，不存在时建一个空的：分类由租户自己建或用 JSON 批量导入，不再写入预设。旧租户已有的标签库（包括早期写入的那套门店 / 活动 / 画面）原样保留。
   * @keyword-cn 读取标签库, 未分类统计
   * @keyword-en read-tag-library, uncategorized-statistics
   */
  async get(
    tenantId: string | undefined,
    systemTags: string[],
  ): Promise<GalleryTagLibraryView> {
    const scopeKey = this.resolveScopeKey(tenantId);
    const now = new Date();
    const result = await this.libraries.findOneAndUpdate(
      { scopeKey },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          scopeKey,
          categories: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    const categories = result.value?.categories ?? [];
    const categorized = categories.flatMap((category) => category.tags);
    const excluded = Array.from(
      new Set([...categorized, ...systemTags].map((tag) => String(tag).trim())),
    ).filter(Boolean);
    const uncategorized = await this.tagLinks.countImagesPerTag({
      scopeKey,
      excludeTagNames: excluded,
      limit: 300,
    });
    return { categories, uncategorized };
  }

  /**
   * @description 校验并整体替换当前作用域的标签分类。
   * @keyword-cn 替换标签库, 标签唯一性
   * @keyword-en replace-tag-library, unique-tag-category
   */
  async replace(
    tenantId: string | undefined,
    input: Array<{ id?: string; name: string; tags: string[] }>,
    systemTags: string[],
  ): Promise<GalleryTagLibraryView> {
    if (!Array.isArray(input) || input.length > 20) {
      throw new BadRequestException('标签分类不能超过20个');
    }
    const seen = new Map<string, number>();
    const categories = input.map((raw, index) => {
      const name = String(raw.name ?? '').trim();
      if (!name || name.length > 20) {
        throw new BadRequestException('分类名称长度必须为1到20字');
      }
      if (!Array.isArray(raw.tags) || raw.tags.length > 100) {
        throw new BadRequestException(`分类「${name}」最多包含100个标签`);
      }
      const tags: string[] = [];
      const localTags = new Set<string>();
      for (const value of raw.tags) {
        const tag = String(value ?? '')
          .trim()
          .replace(/^#+/, '');
        if (!tag || tag.length > 30) {
          throw new BadRequestException('标签长度必须为1到30字');
        }
        if (localTags.has(tag)) continue;
        const previous = seen.get(tag);
        if (previous !== undefined && previous !== index) {
          throw new BadRequestException(`标签「${tag}」同时出现在两个分类`);
        }
        localTags.add(tag);
        seen.set(tag, index);
        tags.push(tag);
      }
      return { id: String(raw.id ?? '').trim() || randomUUID(), name, tags };
    });
    const scopeKey = this.resolveScopeKey(tenantId);
    const now = new Date();
    await this.libraries.updateOne(
      { scopeKey },
      {
        $set: { categories, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), scopeKey, createdAt: now },
      },
      { upsert: true },
    );
    return this.get(tenantId, systemTags);
  }
}
