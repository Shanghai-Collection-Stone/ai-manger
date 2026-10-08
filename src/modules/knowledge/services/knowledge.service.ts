import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import {
  KNOWLEDGE_CONTENT_MAX_LENGTH,
  KNOWLEDGE_NAME_MAX_LENGTH,
  type KnowledgeEntity,
  type KnowledgeScope,
  type KnowledgeView,
} from '../entities/knowledge.entity.js';
import { normalizeKnowledgeIds } from './knowledge-ids.js';
import { buildKnowledgePromptBlock } from './knowledge-prompt.js';

/** @type {number} 列表一次最多返回的条数。 */
const LIST_LIMIT = 500;

/**
 * @description 引用知识仓储与提示词服务：租户内共享的知识条目增删改查，并为小红书 / 抖音的母选题生成链路
 *   按引用 ID 拼出注入提示词的知识段落。
 * @keyword-cn 引用知识服务, 知识增删改查
 * @keyword-en knowledge-service, knowledge-crud
 */
@Injectable()
export class KnowledgeService {
  private readonly items: Collection<KnowledgeEntity>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.items = db.collection<KnowledgeEntity>('knowledge_items');
    void this.ensureIndexes();
  }

  /**
   * @description 建立租户时间线索引与租户内名称索引。
   * @keyword-cn 引用知识索引
   * @keyword-en knowledge-indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.items.createIndex({ tenantId: 1, updatedAt: -1 });
    await this.items.createIndex({ tenantId: 1, name: 1 });
  }

  /**
   * @description 列出本租户的引用知识，按最近更新在前；`keyword` 同时匹配名称与内容。
   * @keyword-cn 查询引用知识, 关键词搜索
   * @keyword-en list-knowledge, keyword-search
   * @param keyword 搜索词。
   * @param scope 租户用户作用域。
   * @returns {Promise<KnowledgeView[]>} 知识列表。
   */
  async list(
    keyword: string | undefined,
    scope: KnowledgeScope,
  ): Promise<KnowledgeView[]> {
    const text = String(keyword ?? '').trim();
    const filter: Filter<KnowledgeEntity> = { ...this.tenantFilter(scope) };
    if (text) {
      const regex = new RegExp(
        text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$and = [{ $or: [{ name: regex }, { content: regex }] }];
    }
    const rows = await this.items
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(LIST_LIMIT)
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 新建一条引用知识，同租户内名称不能重复。
   * @keyword-cn 新建引用知识
   * @keyword-en create-knowledge
   * @param input 名称与内容。
   * @param scope 租户用户作用域。
   * @returns {Promise<KnowledgeView>} 新知识。
   * @throws {BadRequestException} KNOWLEDGE_NAME_REQUIRED / KNOWLEDGE_CONTENT_REQUIRED。
   * @throws {ConflictException} KNOWLEDGE_NAME_EXISTS。
   */
  async create(
    input: { name: string; content: string },
    scope: KnowledgeScope,
  ): Promise<KnowledgeView> {
    const name = this.requireName(input.name);
    const content = this.requireContent(input.content);
    await this.assertNameFree(name, null, scope);
    const now = new Date();
    const entity: KnowledgeEntity = {
      _id: new ObjectId(),
      tenantId: String(scope.tenantId ?? '').trim() || null,
      name,
      content,
      createdBy: scope.userId,
      updatedBy: scope.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.items.insertOne(entity);
    return this.toView(entity);
  }

  /**
   * @description 修改引用知识的名称或内容。
   * @keyword-cn 修改引用知识
   * @keyword-en update-knowledge
   * @param id 知识 ID。
   * @param input 要修改的字段。
   * @param scope 租户用户作用域。
   * @returns {Promise<KnowledgeView>} 修改后的知识。
   * @throws {NotFoundException} KNOWLEDGE_NOT_FOUND。
   */
  async update(
    id: string,
    input: { name?: string; content?: string },
    scope: KnowledgeScope,
  ): Promise<KnowledgeView> {
    const current = await this.require(id, scope);
    const set: Partial<KnowledgeEntity> = {
      updatedBy: scope.userId,
      updatedAt: new Date(),
    };
    if (input.name !== undefined) {
      set.name = this.requireName(input.name);
      await this.assertNameFree(set.name, current._id, scope);
    }
    if (input.content !== undefined)
      set.content = this.requireContent(input.content);
    const updated = await this.items.findOneAndUpdate(
      { _id: current._id, ...this.tenantFilter(scope) },
      { $set: set },
      { returnDocument: 'after' },
    );
    if (!updated) throw new NotFoundException('KNOWLEDGE_NOT_FOUND');
    return this.toView(updated);
  }

  /**
   * @description 删除一条引用知识；已引用它的母选题在生成时自动跳过。
   * @keyword-cn 删除引用知识
   * @keyword-en delete-knowledge
   * @param id 知识 ID。
   * @param scope 租户用户作用域。
   * @throws {NotFoundException} KNOWLEDGE_NOT_FOUND。
   */
  async remove(id: string, scope: KnowledgeScope): Promise<void> {
    const current = await this.require(id, scope);
    await this.items.deleteOne({
      _id: current._id,
      ...this.tenantFilter(scope),
    });
  }

  /**
   * @description 按引用 ID 读取本租户知识并拼成注入生成提示词的段落；ID 为空、已删除或不属于本租户时跳过，全都没有时返回空串。
   * @keyword-cn 引用知识提示词, 按引用拼接
   * @keyword-en knowledge-prompt-section, reference-assembly
   * @param ids 母选题引用的知识 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<string>} 提示词段落。
   */
  async buildPromptSection(
    ids: unknown,
    scope: KnowledgeScope,
  ): Promise<string> {
    const normalized = normalizeKnowledgeIds(ids);
    if (!normalized.length) return '';
    const rows = await this.items
      .find({
        _id: { $in: normalized.map((id) => new ObjectId(id)) },
        ...this.tenantFilter(scope),
      })
      .toArray();
    const byId = new Map(rows.map((row) => [row._id.toHexString(), row]));
    return buildKnowledgePromptBlock(
      normalized
        .map((id) => byId.get(id))
        .filter((row): row is KnowledgeEntity => Boolean(row)),
    );
  }

  /**
   * @description 读取本租户一条知识，不存在或 ID 不合法时 404。
   * @keyword-cn 要求引用知识
   * @keyword-en require-knowledge
   * @param id 知识 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<KnowledgeEntity>} 知识实体。
   */
  private async require(
    id: string,
    scope: KnowledgeScope,
  ): Promise<KnowledgeEntity> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('KNOWLEDGE_NOT_FOUND');
    const row = await this.items.findOne({
      _id: new ObjectId(id),
      ...this.tenantFilter(scope),
    });
    if (!row) throw new NotFoundException('KNOWLEDGE_NOT_FOUND');
    return row;
  }

  /**
   * @description 同租户内名称查重，修改时排除自己。
   * @keyword-cn 知识名称查重
   * @keyword-en knowledge-name-unique
   * @param name 名称。
   * @param selfId 正在修改的知识 ID。
   * @param scope 租户用户作用域。
   */
  private async assertNameFree(
    name: string,
    selfId: ObjectId | null,
    scope: KnowledgeScope,
  ): Promise<void> {
    const duplicate = await this.items.findOne({
      ...this.tenantFilter(scope),
      name,
      ...(selfId ? { _id: { $ne: selfId } } : {}),
    });
    if (duplicate) throw new ConflictException('KNOWLEDGE_NAME_EXISTS');
  }

  /**
   * @description 校验并归一名称。
   * @keyword-cn 知识名称校验
   * @keyword-en validate-knowledge-name
   * @param value 原始名称。
   * @returns {string} 名称。
   */
  private requireName(value: string): string {
    const name = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) throw new BadRequestException('KNOWLEDGE_NAME_REQUIRED');
    return name.slice(0, KNOWLEDGE_NAME_MAX_LENGTH);
  }

  /**
   * @description 校验并归一内容。
   * @keyword-cn 知识内容校验
   * @keyword-en validate-knowledge-content
   * @param value 原始内容。
   * @returns {string} 内容。
   */
  private requireContent(value: string): string {
    const content = String(value ?? '').trim();
    if (!content) throw new BadRequestException('KNOWLEDGE_CONTENT_REQUIRED');
    return content.slice(0, KNOWLEDGE_CONTENT_MAX_LENGTH);
  }

  /**
   * @description 构造租户过滤：有租户时精确匹配，母平台只看无租户的平台级知识。
   * @keyword-cn 知识租户过滤
   * @keyword-en knowledge-tenant-filter
   * @param scope 租户用户作用域。
   * @returns {Filter<KnowledgeEntity>} 过滤条件。
   */
  private tenantFilter(scope: KnowledgeScope): Filter<KnowledgeEntity> {
    const tenantId = String(scope.tenantId ?? '').trim();
    return tenantId
      ? { tenantId }
      : {
          $or: [
            { tenantId: { $exists: false } },
            { tenantId: null },
            { tenantId: '' },
          ],
        };
  }

  /**
   * @description 实体转接口视图。
   * @keyword-cn 知识视图转换
   * @keyword-en knowledge-view-mapping
   * @param entity 知识实体。
   * @returns {KnowledgeView} 视图。
   */
  private toView(entity: KnowledgeEntity): KnowledgeView {
    return {
      id: entity._id.toHexString(),
      name: entity.name,
      content: entity.content,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
