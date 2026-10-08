import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  GalleryTagCategory,
  GalleryTagLibraryEntity,
} from '../entities/gallery-tag-library.entity.js';
import type { GalleryImageEntity } from '../entities/gallery-image.entity.js';

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
  private readonly images: Collection<GalleryImageEntity>;

  /**
   * @description 初始化标签库与图库图片集合。
   * @keyword-cn 标签库初始化, 数据集合
   * @keyword-en tag-library-initialization, data-collections
   */
  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.libraries = db.collection<GalleryTagLibraryEntity>(
      'gallery_tag_libraries',
    );
    this.images = db.collection<GalleryImageEntity>('gallery_images');
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
    const tid = String(tenantId ?? '').trim();
    return tid ? `tenant:${tid}` : 'platform';
  }

  /**
   * @description 构造与图库图片查询一致的租户过滤条件。
   * @keyword-cn 图片可见范围, 租户过滤
   * @keyword-en image-visibility, tenant-filter
   */
  private buildImageScopeFilter(tenantId?: string): Record<string, unknown> {
    const tid = String(tenantId ?? '').trim();
    if (tid) return { tenantId: tid };
    return {
      $or: [
        { tenantId: { $exists: false } },
        { tenantId: null },
        { tenantId: '' },
      ],
    };
  }

  /**
   * @description 返回首次使用图库时写入的默认标签分类。
   * @keyword-cn 默认标签分类, 标签库初始化
   * @keyword-en default-tag-categories, tag-library-bootstrap
   */
  private defaultCategories(): GalleryTagCategory[] {
    return [
      {
        id: randomUUID(),
        name: '门店',
        tags: ['月亮湾店', '诺瓦城店', '丽宝店', '其他'],
      },
      {
        id: randomUUID(),
        name: '活动',
        tags: ['团建', '生日派对', '快闪活动', '主理人活动', '大厅潮玩'],
      },
      {
        id: randomUUID(),
        name: '画面',
        tags: ['人像', '群像', '特写', '亲子', '情侣', '餐食', '环境'],
      },
    ];
  }

  /**
   * @description 读取标签库，不存在时原子写入默认分类。
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
          categories: this.defaultCategories(),
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    const categories = result.value?.categories ?? this.defaultCategories();
    const categorized = categories.flatMap((category) => category.tags);
    const excluded = Array.from(
      new Set([...categorized, ...systemTags].map((tag) => String(tag).trim())),
    ).filter(Boolean);
    const pipeline: Record<string, unknown>[] = [
      { $match: this.buildImageScopeFilter(tenantId) },
      { $unwind: '$tags' },
      { $match: { tags: { $nin: excluded, $type: 'string', $ne: '' } } },
      { $group: { _id: { tag: '$tags', imageId: '$id' } } },
      { $group: { _id: '$_id.tag', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 300 },
      { $project: { _id: 0, tag: '$_id', count: 1 } },
    ];
    const uncategorized = await this.images
      .aggregate<{ tag: string; count: number }>(pipeline)
      .toArray();
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
        const tag = String(value ?? '').trim().replace(/^#+/, '');
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
