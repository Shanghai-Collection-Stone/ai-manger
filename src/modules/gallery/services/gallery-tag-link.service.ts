import { Inject, Injectable } from '@nestjs/common';
import {
  AnyBulkWriteOperation,
  Collection,
  Db,
  Filter,
  ObjectId,
} from 'mongodb';
import type {
  GalleryImageTagEntity,
  GalleryTagEntity,
} from '../entities/gallery-tag.entity.js';

/**
 * @description 母平台（无租户）图片的标签作用域键。
 * @keyword-cn 母平台作用域, 标签作用域
 * @keyword-en platform-scope-key, tag-scope
 */
export const GALLERY_PLATFORM_SCOPE_KEY = 'platform';

/**
 * @description 生成与图片租户可见范围一致的标签作用域键：有租户为 `tenant:<tenantId>`，无租户为 `platform`；标签库与迁移脚本共用同一口径。
 * @keyword-cn 标签作用域键, 租户隔离
 * @keyword-en resolve-tag-scope-key, tenant-isolation
 */
export function resolveGalleryTagScopeKey(tenantId?: string | null): string {
  const tid = String(tenantId ?? '').trim();
  return tid ? `tenant:${tid}` : GALLERY_PLATFORM_SCOPE_KEY;
}

/**
 * @description 判断写入错误是否全部是唯一索引冲突；并发写同一标签或同一关联时另一方已写成功，可安全忽略。
 * @keyword-cn 唯一冲突判断, 并发写入
 * @keyword-en duplicate-key-check, concurrent-write
 */
function isDuplicateKeyOnly(error: unknown): boolean {
  const e = error as {
    code?: number;
    writeErrors?: Array<{ code?: number }> | { code?: number };
  };
  const list = Array.isArray(e?.writeErrors)
    ? e.writeErrors
    : e?.writeErrors
      ? [e.writeErrors]
      : [];
  if (list.length > 0) return list.every((item) => item?.code === 11000);
  return e?.code === 11000;
}

/**
 * @description 去重并过滤非法图片 ID。
 * @keyword-cn 图片ID去重, 输入清洗
 * @keyword-en unique-image-ids, input-sanitize
 */
function uniqueImageIds(ids: number[]): number[] {
  return Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
  );
}

/**
 * @description 图库标签字典与图片标签关联服务：图片标签只存在 `gallery_tags` + `gallery_image_tags` 两张表里，
 *   负责按图片当前标签整体同步关联、按图片回填标签、把标签条件换算成图片 ID 集合，以及只扫索引的标签统计。
 * @keyword-cn 图片标签关联服务, 标签中间表
 * @keyword-en gallery-tag-link-service, tag-junction
 */
@Injectable()
export class GalleryTagLinkService {
  private readonly tags: Collection<GalleryTagEntity>;
  private readonly links: Collection<GalleryImageTagEntity>;

  /**
   * @description 初始化标签字典与关联集合并建立索引。
   * @keyword-cn 初始化标签关联, 标签集合
   * @keyword-en init-tag-links, tag-collections
   */
  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.tags = db.collection<GalleryTagEntity>('gallery_tags');
    this.links = db.collection<GalleryImageTagEntity>('gallery_image_tags');
    void this.ensureIndexes();
  }

  /**
   * @description 建立标签字典作用域唯一索引、关联唯一索引，以及按作用域与标签统计、筛图的覆盖索引。
   * @keyword-cn 标签关联索引, 覆盖索引
   * @keyword-en tag-link-indexes, covering-index
   */
  async ensureIndexes(): Promise<void> {
    await this.tags.createIndex({ scopeKey: 1, name: 1 }, { unique: true });
    await this.links.createIndex({ imageId: 1, tagId: 1 }, { unique: true });
    await this.links.createIndex({ scopeKey: 1, tagId: 1, imageId: 1 });
  }

  /**
   * @description 查已有标签 ID；`scopeKey` 为空时跨所有作用域按名字查（只给按用户而非租户过滤的旧接口用）。
   * @keyword-cn 查询标签ID, 标签名解析
   * @keyword-en find-tag-ids, resolve-tag-names
   */
  private async findTagIds(
    scopeKey: string | null,
    names: string[],
  ): Promise<Map<string, ObjectId[]>> {
    const list = Array.from(new Set(names.filter(Boolean)));
    const out = new Map<string, ObjectId[]>();
    if (list.length === 0) return out;
    const filter: Filter<GalleryTagEntity> = scopeKey
      ? { scopeKey, name: { $in: list } }
      : { name: { $in: list } };
    const rows = await this.tags
      .find(filter, { projection: { _id: 1, name: 1 } })
      .toArray();
    for (const row of rows) {
      out.set(row.name, [...(out.get(row.name) ?? []), row._id]);
    }
    return out;
  }

  /**
   * @description 确保作用域内的标签都已在字典中，缺的新建，返回标签名到 ID 的映射。
   * @keyword-cn 确保标签存在, 标签字典写入
   * @keyword-en ensure-tag-ids, upsert-tag-dictionary
   */
  private async ensureTagIds(
    scopeKey: string,
    names: string[],
  ): Promise<Map<string, ObjectId>> {
    const list = Array.from(new Set(names.filter(Boolean)));
    const out = new Map<string, ObjectId>();
    if (list.length === 0) return out;
    const existing = await this.findTagIds(scopeKey, list);
    const missing = list.filter((name) => !existing.has(name));
    if (missing.length > 0) {
      const now = new Date();
      try {
        await this.tags.bulkWrite(
          missing.map((name) => ({
            updateOne: {
              filter: { scopeKey, name },
              update: { $setOnInsert: { createdAt: now, updatedAt: now } },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      } catch (error) {
        if (!isDuplicateKeyOnly(error)) throw error;
      }
      const created = await this.findTagIds(scopeKey, missing);
      for (const [name, ids] of created) existing.set(name, ids);
    }
    for (const [name, ids] of existing) out.set(name, ids[0]);
    return out;
  }

  /**
   * @description 把每张图片的关联整体同步为给定的标签列表（已规整、按顺序）：缺的补上、多的删掉、顺序变化时更新；
   *   传空数组即清空该图标签。按"图片当前状态"同步，不依赖改前改后差集，并发也不会重复计数。
   * @keyword-cn 同步图片标签, 关联整体替换
   * @keyword-en replace-image-tags, sync-tag-links
   */
  async replaceImageTags(
    entries: Array<{
      imageId: number;
      tenantId?: string | null;
      tags: string[];
    }>,
  ): Promise<void> {
    const list = (Array.isArray(entries) ? entries : []).filter((entry) =>
      Number.isFinite(Number(entry?.imageId)),
    );
    if (list.length === 0) return;
    const namesByScope = new Map<string, Set<string>>();
    for (const entry of list) {
      const scopeKey = resolveGalleryTagScopeKey(entry.tenantId);
      const names = namesByScope.get(scopeKey) ?? new Set<string>();
      for (const name of entry.tags) if (name) names.add(name);
      namesByScope.set(scopeKey, names);
    }
    const tagIdByKey = new Map<string, ObjectId>();
    for (const [scopeKey, names] of namesByScope) {
      const ids = await this.ensureTagIds(scopeKey, Array.from(names));
      for (const [name, id] of ids)
        tagIdByKey.set(`${scopeKey}\u0000${name}`, id);
    }
    const imageIds = uniqueImageIds(list.map((entry) => entry.imageId));
    const existing = await this.links
      .find(
        { imageId: { $in: imageIds } },
        { projection: { _id: 0, imageId: 1, tagId: 1, order: 1, scopeKey: 1 } },
      )
      .toArray();
    const existingByImage = new Map<number, typeof existing>();
    for (const row of existing) {
      existingByImage.set(row.imageId, [
        ...(existingByImage.get(row.imageId) ?? []),
        row,
      ]);
    }
    const now = new Date();
    const ops: AnyBulkWriteOperation<GalleryImageTagEntity>[] = [];
    for (const entry of list) {
      const imageId = Number(entry.imageId);
      const scopeKey = resolveGalleryTagScopeKey(entry.tenantId);
      const desired = Array.from(new Set(entry.tags.filter(Boolean)))
        .map((name, order) => ({
          tagId: tagIdByKey.get(`${scopeKey}\u0000${name}`),
          order,
        }))
        .filter((item): item is { tagId: ObjectId; order: number } =>
          Boolean(item.tagId),
        );
      const desiredKeys = new Set(desired.map((d) => d.tagId.toHexString()));
      const current = existingByImage.get(imageId) ?? [];
      const currentByKey = new Map(
        current.map((row) => [row.tagId.toHexString(), row]),
      );
      for (const item of desired) {
        const row = currentByKey.get(item.tagId.toHexString());
        if (row && row.order === item.order && row.scopeKey === scopeKey) {
          continue;
        }
        ops.push({
          updateOne: {
            filter: { imageId, tagId: item.tagId },
            update: {
              $set: { order: item.order, scopeKey },
              $setOnInsert: { createdAt: now },
            },
            upsert: true,
          },
        });
      }
      const stale = current
        .filter((row) => !desiredKeys.has(row.tagId.toHexString()))
        .map((row) => row.tagId);
      if (stale.length > 0) {
        ops.push({
          deleteMany: { filter: { imageId, tagId: { $in: stale } } },
        });
      }
    }
    if (ops.length === 0) return;
    try {
      await this.links.bulkWrite(ops, { ordered: false });
    } catch (error) {
      if (!isDuplicateKeyOnly(error)) throw error;
    }
  }

  /**
   * @description 删除图片时清掉它的全部标签关联；标签字典保留，下次同名标签复用原 ID。
   * @keyword-cn 删除图片关联, 清理关联
   * @keyword-en remove-image-links, cleanup-links
   */
  async removeImages(imageIds: number[]): Promise<void> {
    const ids = uniqueImageIds(imageIds);
    if (ids.length === 0) return;
    await this.links.deleteMany({ imageId: { $in: ids } });
  }

  /**
   * @description 按图片 ID 批量读取标签名，按图片上原有顺序返回；没有标签的图片不出现在结果里。
   * @keyword-cn 回填图片标签, 按图读标签
   * @keyword-en tags-by-image-ids, hydrate-image-tags
   */
  async tagsByImageIds(imageIds: number[]): Promise<Map<number, string[]>> {
    const ids = uniqueImageIds(imageIds);
    const out = new Map<number, string[]>();
    if (ids.length === 0) return out;
    const rows = await this.links
      .find(
        { imageId: { $in: ids } },
        { projection: { _id: 0, imageId: 1, tagId: 1, order: 1 } },
      )
      .toArray();
    if (rows.length === 0) return out;
    const nameById = await this.tagNamesByIds(rows.map((row) => row.tagId));
    const grouped = new Map<number, Array<{ name: string; order: number }>>();
    for (const row of rows) {
      const name = nameById.get(row.tagId.toHexString());
      if (!name) continue;
      grouped.set(row.imageId, [
        ...(grouped.get(row.imageId) ?? []),
        { name, order: Number(row.order) || 0 },
      ]);
    }
    for (const [imageId, items] of grouped) {
      out.set(
        imageId,
        items.sort((a, b) => a.order - b.order).map((item) => item.name),
      );
    }
    return out;
  }

  /**
   * @description 按标签 ID 读取标签名。
   * @keyword-cn 标签名读取, 字典查询
   * @keyword-en tag-names-by-ids, dictionary-lookup
   */
  private async tagNamesByIds(
    tagIds: ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = Array.from(
      new Map(tagIds.map((id) => [id.toHexString(), id])).values(),
    );
    if (unique.length === 0) return new Map();
    const rows = await this.tags
      .find({ _id: { $in: unique } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    return new Map(rows.map((row) => [row._id.toHexString(), row.name]));
  }

  /**
   * @description 作用域内带有任一给定标签的图片 ID；`scopeKey` 为空时跨所有作用域（只给旧的按用户过滤接口用）。
   * @keyword-cn 任一标签图片, 标签换算图片ID
   * @keyword-en image-ids-with-any-tag, tag-to-image-ids
   */
  async imageIdsWithAnyTag(
    scopeKey: string | null,
    names: string[],
  ): Promise<number[]> {
    const found = await this.findTagIds(scopeKey, names);
    const tagIds = Array.from(found.values()).flat();
    if (tagIds.length === 0) return [];
    const filter: Filter<GalleryImageTagEntity> = scopeKey
      ? { scopeKey, tagId: { $in: tagIds } }
      : { tagId: { $in: tagIds } };
    const ids = await this.links.distinct('imageId', filter);
    return ids.map((id) => Number(id));
  }

  /**
   * @description 作用域内同时带有全部给定标签的图片 ID；有任一标签不存在时直接为空。
   * @keyword-cn 全部标签图片, 多标签且筛选
   * @keyword-en image-ids-with-all-tags, multi-tag-and
   */
  async imageIdsWithAllTags(
    scopeKey: string,
    names: string[],
  ): Promise<number[]> {
    const list = Array.from(new Set(names.filter(Boolean)));
    if (list.length === 0) return [];
    if (list.length === 1) return this.imageIdsWithAnyTag(scopeKey, list);
    const found = await this.findTagIds(scopeKey, list);
    if (found.size < list.length) return [];
    const tagIds = Array.from(found.values()).map((ids) => ids[0]);
    const rows = await this.links
      .aggregate<{ _id: number }>([
        { $match: { scopeKey, tagId: { $in: tagIds } } },
        { $group: { _id: '$imageId', n: { $sum: 1 } } },
        { $match: { n: tagIds.length } },
        { $project: { _id: 1 } },
      ])
      .toArray();
    return rows.map((row) => Number(row._id));
  }

  /**
   * @description 作用域内实际被图片使用的不同标签数量（只扫索引）。
   * @keyword-cn 标签总数统计, 作用域去重
   * @keyword-en count-distinct-tags, scope-distinct
   */
  async countDistinctTags(scopeKey: string): Promise<number> {
    const ids = await this.links.distinct('tagId', { scopeKey });
    return ids.length;
  }

  /**
   * @description 列出被图片使用过的标签名：可按作用域或图片 ID 范围限定，都不传时为全部作用域。
   * @keyword-cn 已用标签列表, 按图片范围列标签
   * @keyword-en list-used-tag-names, tags-in-image-range
   */
  async listTagNames(input: {
    scopeKey?: string;
    imageIds?: number[];
  }): Promise<string[]> {
    const filter: Filter<GalleryImageTagEntity> = {};
    if (input.scopeKey) filter.scopeKey = input.scopeKey;
    if (Array.isArray(input.imageIds)) {
      const ids = uniqueImageIds(input.imageIds);
      if (ids.length === 0) return [];
      filter.imageId = { $in: ids };
    }
    const tagIds = await this.links.distinct('tagId', filter);
    const nameById = await this.tagNamesByIds(tagIds);
    return Array.from(new Set(nameById.values()));
  }

  /**
   * @description 按标签统计图片数并按数量倒序、同数按标签名升序返回；可排除指定标签，可只统计或排除指定图片。
   * @keyword-cn 按标签计数, 热门标签排行
   * @keyword-en count-images-per-tag, top-tag-ranking
   */
  async countImagesPerTag(input: {
    scopeKey: string;
    excludeTagNames?: string[];
    excludeImageIds?: number[];
    onlyImageIds?: number[];
    limit?: number;
  }): Promise<Array<{ tag: string; count: number }>> {
    const match: Record<string, unknown> = { scopeKey: input.scopeKey };
    const excludedNames = Array.from(
      new Set((input.excludeTagNames ?? []).filter(Boolean)),
    );
    if (excludedNames.length > 0) {
      const found = await this.findTagIds(input.scopeKey, excludedNames);
      const excludedIds = Array.from(found.values()).flat();
      if (excludedIds.length > 0) match.tagId = { $nin: excludedIds };
    }
    if (Array.isArray(input.onlyImageIds)) {
      const only = uniqueImageIds(input.onlyImageIds);
      if (only.length === 0) return [];
      match.imageId = { $in: only };
    } else if (input.excludeImageIds && input.excludeImageIds.length > 0) {
      match.imageId = { $nin: uniqueImageIds(input.excludeImageIds) };
    }
    const rows = await this.links
      .aggregate<{ _id: ObjectId; count: number }>([
        { $match: match },
        { $group: { _id: '$tagId', count: { $sum: 1 } } },
      ])
      .toArray();
    const nameById = await this.tagNamesByIds(rows.map((row) => row._id));
    const ranked = rows
      .map((row) => ({
        tag: nameById.get(row._id.toHexString()) ?? '',
        count: row.count,
      }))
      .filter((row) => row.tag)
      .sort(
        (a, b) =>
          b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
      );
    const limit = Math.max(1, Math.floor(input.limit ?? ranked.length) || 1);
    return ranked.slice(0, limit);
  }

  /**
   * @description 统计作用域内其他图片与给定标签的共同标签数，用于相似图无向量时的兜底排序。
   * @keyword-cn 共同标签计数, 相似图兜底
   * @keyword-en count-shared-tags, similar-image-fallback
   */
  async countSharedTagsByImage(
    scopeKey: string,
    names: string[],
    excludeImageId: number,
  ): Promise<Map<number, number>> {
    const found = await this.findTagIds(scopeKey, names);
    const tagIds = Array.from(found.values()).flat();
    if (tagIds.length === 0) return new Map();
    const rows = await this.links
      .aggregate<{ _id: number; n: number }>([
        {
          $match: {
            scopeKey,
            tagId: { $in: tagIds },
            imageId: { $ne: excludeImageId },
          },
        },
        { $group: { _id: '$imageId', n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [Number(row._id), row.n]));
  }
}
