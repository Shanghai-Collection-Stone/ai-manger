import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import {
  DOUYIN_PERSONA_PERSPECTIVES,
  type DouyinPersonaEntity,
  type DouyinPersonaImage,
  type DouyinPersonaPerspective,
  type DouyinPersonaView,
  type DouyinPersonaVoice,
} from '../entities/douyin-persona.entity.js';

type DouyinPersonaScope = { tenantId?: string; userId: string };

/** @type {number} 一个人物最多保留的形象参考图数量，三视图之外再留一张自定义位。 */
const PERSONA_IMAGE_LIMIT = 4;

/**
 * @description 规整人物音色：非法性别回退中性、非法年龄感回退成年、非法语速回退正常，音色特质限长 120 字。
 * @keyword-cn 规整人物音色, 默认音色
 * @keyword-en normalize-persona-voice, default-voice
 * @param input 前端或旧数据里的音色设置，可为空。
 * @returns {DouyinPersonaVoice} 规整后的音色。
 */
export function normalizePersonaVoice(
  input?: Partial<DouyinPersonaVoice> | null,
): DouyinPersonaVoice {
  const gender = input?.gender;
  const age = input?.age;
  const pace = input?.pace;
  const timbre = String(input?.timbre ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return {
    gender: gender === 'female' || gender === 'male' ? gender : 'neutral',
    age: age === 'young' || age === 'mature' ? age : 'adult',
    pace: pace === 'slow' || pace === 'fast' ? pace : 'normal',
    ...(timbre ? { timbre } : {}),
  };
}

/**
 * @description 规整叙事视角，未登记的取值一律回退为种草介绍。
 * @keyword-cn 规整叙事视角, 默认视角
 * @keyword-en normalize-persona-perspective, default-perspective
 * @param input 前端传入的视角。
 * @returns {DouyinPersonaPerspective} 规整后的视角。
 */
export function normalizePersonaPerspective(
  input?: string | null,
): DouyinPersonaPerspective {
  const key = String(input ?? '') as DouyinPersonaPerspective;
  return key in DOUYIN_PERSONA_PERSPECTIVES
    ? key
    : DOUYIN_PERSONA_PERSPECTIVES.recommend;
}

/**
 * @description 持久化租户内共享的预设人物，并强制租户数据边界。人物按租户共享而不按创建人隔离，
 *   后台管理员维护一次，租户内所有工作台用户都能在脚本上选用。
 * @keyword-cn 预设人物仓储, 租户共享
 * @keyword-en douyin-persona-repository, tenant-shared
 */
@Injectable()
export class DouyinPersonaRepositoryService {
  private readonly personas: Collection<DouyinPersonaEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.personas = db.collection<DouyinPersonaEntity>('douyin_personas');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建人物业务 ID 唯一索引与租户列表查询索引。
   * @keyword-cn 预设人物索引, 租户列表查询
   * @keyword-en douyin-persona-indexes, tenant-list-query
   */
  async ensureIndexes(): Promise<void> {
    await this.personas.createIndex({ id: 1 }, { unique: true });
    await this.personas.createIndex({ tenantId: 1, status: 1, updatedAt: -1 });
  }

  /**
   * @description 列出当前租户的预设人物，默认只返回启用中的，最近更新在前。
   * @keyword-cn 查询预设人物, 启用中人物
   * @keyword-en list-douyin-personas, active-personas
   * @param scope 租户用户作用域。
   * @param options `includeArchived` 为真时连同已归档一起返回，供后台管理页使用。
   * @returns {Promise<DouyinPersonaView[]>} 人物列表。
   */
  async list(
    scope: DouyinPersonaScope,
    options?: { includeArchived?: boolean },
  ): Promise<DouyinPersonaView[]> {
    const rows = await this.personas
      .find({
        ...this.tenantFilter(scope.tenantId),
        ...(options?.includeArchived ? {} : { status: 'active' }),
      })
      .sort({ updatedAt: -1 })
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 按业务 ID 读取本租户的一个人物，越权或不存在时返回 null。
   * @keyword-cn 读取预设人物, 租户校验
   * @keyword-en get-douyin-persona, tenant-check
   * @param id 人物业务 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPersonaEntity|null>} 人物记录。
   */
  async get(
    id: number,
    scope: DouyinPersonaScope,
  ): Promise<DouyinPersonaEntity | null> {
    return this.personas.findOne({
      id,
      ...this.tenantFilter(scope.tenantId),
    });
  }

  /**
   * @description 新建预设人物，形象参考图可留空，之后再用 AI 生成三视图补上。
   * @keyword-cn 新建预设人物, 人设入库
   * @keyword-en create-douyin-persona, persist-persona
   * @param input 人物设定。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPersonaView>} 新建结果。
   */
  async create(
    input: {
      name: string;
      summary?: string;
      appearance: string;
      persona?: string;
      perspective?: string;
      voice?: Partial<DouyinPersonaVoice>;
    },
    scope: DouyinPersonaScope,
  ): Promise<DouyinPersonaView> {
    const now = new Date();
    const doc: DouyinPersonaEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      tenantId: scope.tenantId,
      createdBy: scope.userId,
      name: this.trimLine(input.name, 40),
      summary: this.trimLine(input.summary, 120) || undefined,
      appearance: this.trimText(input.appearance, 1000),
      persona: this.trimText(input.persona, 1000) || undefined,
      perspective: normalizePersonaPerspective(input.perspective),
      voice: normalizePersonaVoice(input.voice),
      referenceImages: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.personas.insertOne(doc);
    return this.toView(doc);
  }

  /**
   * @description 更新人物设定或归档状态，只写传入的字段；形象参考图由专用生成链路写入，不走这里。
   * @keyword-cn 更新预设人物, 归档人物
   * @keyword-en update-douyin-persona, archive-persona
   * @param id 人物业务 ID。
   * @param input 待更新字段。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPersonaView>} 更新后的人物。
   * @throws {NotFoundException} 人物不存在或不属于当前租户时抛出。
   */
  async update(
    id: number,
    input: {
      name?: string;
      summary?: string;
      appearance?: string;
      persona?: string;
      perspective?: string;
      voice?: Partial<DouyinPersonaVoice>;
      status?: 'active' | 'archived';
    },
    scope: DouyinPersonaScope,
  ): Promise<DouyinPersonaView> {
    const patch: Partial<DouyinPersonaEntity> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = this.trimLine(input.name, 40);
    if (input.summary !== undefined) {
      patch.summary = this.trimLine(input.summary, 120);
    }
    if (input.appearance !== undefined) {
      patch.appearance = this.trimText(input.appearance, 1000);
    }
    if (input.persona !== undefined) {
      patch.persona = this.trimText(input.persona, 1000);
    }
    if (input.perspective !== undefined) {
      patch.perspective = normalizePersonaPerspective(input.perspective);
    }
    if (input.voice !== undefined) {
      patch.voice = normalizePersonaVoice(input.voice);
    }
    if (input.status === 'active' || input.status === 'archived') {
      patch.status = input.status;
    }
    const result = await this.personas.findOneAndUpdate(
      { id, ...this.tenantFilter(scope.tenantId) },
      { $set: patch },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value) throw new NotFoundException('DOUYIN_PERSONA_NOT_FOUND');
    return this.toView(result.value);
  }

  /**
   * @description 整组替换人物的形象参考图，供 AI 三视图生成完成后一次性回填。
   * @keyword-cn 回填人物形象图, 三视图入库
   * @keyword-en save-persona-images, persist-reference-sheet
   * @param id 人物业务 ID。
   * @param images 新的形象参考图。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPersonaView>} 更新后的人物。
   * @throws {NotFoundException} 人物不存在或不属于当前租户时抛出。
   */
  async replaceImages(
    id: number,
    images: DouyinPersonaImage[],
    scope: DouyinPersonaScope,
  ): Promise<DouyinPersonaView> {
    const result = await this.personas.findOneAndUpdate(
      { id, ...this.tenantFilter(scope.tenantId) },
      {
        $set: {
          referenceImages: images.slice(0, PERSONA_IMAGE_LIMIT),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value) throw new NotFoundException('DOUYIN_PERSONA_NOT_FOUND');
    return this.toView(result.value);
  }

  /**
   * @description 删除一个预设人物。已被脚本选用的人物删除后，脚本上的引用按「人物已删除」降级处理。
   * @keyword-cn 删除预设人物, 引用降级
   * @keyword-en delete-douyin-persona, dangling-reference
   * @param id 人物业务 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<{ok: true}>} 删除结果。
   * @throws {NotFoundException} 人物不存在或不属于当前租户时抛出。
   */
  async remove(id: number, scope: DouyinPersonaScope): Promise<{ ok: true }> {
    const result = await this.personas.deleteOne({
      id,
      ...this.tenantFilter(scope.tenantId),
    });
    if (!result.deletedCount) {
      throw new NotFoundException('DOUYIN_PERSONA_NOT_FOUND');
    }
    return { ok: true };
  }

  /**
   * @description 生成全局递增的预设人物业务 ID。
   * @keyword-cn 预设人物自增ID, 计数器
   * @keyword-en next-douyin-persona-id, counter
   * @returns {Promise<number>} 新 ID。
   */
  private async nextId(): Promise<number> {
    const result = await this.counters.findOneAndUpdate(
      { _id: 'douyin_personas' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value?.seq ?? 1;
  }

  /**
   * @description 构造租户过滤，母平台只访问无 tenantId 的平台级人物。
   * @keyword-cn 人物租户边界, 母平台数据边界
   * @keyword-en persona-tenant-filter, platform-data-boundary
   * @param tenantId 租户 ID，缺省表示母平台。
   * @returns {Filter<DouyinPersonaEntity>} 过滤条件。
   */
  private tenantFilter(tenantId?: string): Filter<DouyinPersonaEntity> {
    return (
      tenantId
        ? { tenantId }
        : {
            $or: [
              { tenantId: { $exists: false } },
              { tenantId: null },
              { tenantId: '' },
            ],
          }
    ) as Filter<DouyinPersonaEntity>;
  }

  /**
   * @description 压掉换行与多余空白的单行文本裁剪。
   * @keyword-cn 单行文本裁剪, 去空白
   * @keyword-en trim-single-line, collapse-whitespace
   * @param value 原始值。
   * @param max 最大长度。
   * @returns {string} 裁剪结果。
   */
  private trimLine(value: string | undefined | null, max: number): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  /**
   * @description 保留换行的多行文本裁剪。
   * @keyword-cn 多行文本裁剪, 保留换行
   * @keyword-en trim-multiline, keep-newline
   * @param value 原始值。
   * @param max 最大长度。
   * @returns {string} 裁剪结果。
   */
  private trimText(value: string | undefined | null, max: number): string {
    return String(value ?? '')
      .trim()
      .slice(0, max);
  }

  /**
   * @description 移除 Mongo `_id` 后生成前端安全的人物视图。
   * @keyword-cn 预设人物视图, 隐藏数据库ID
   * @keyword-en douyin-persona-view, hide-database-id
   * @param row 数据库记录。
   * @returns {DouyinPersonaView} 前端视图。
   */
  private toView(row: DouyinPersonaEntity): DouyinPersonaView {
    const view = { ...row } as Partial<DouyinPersonaEntity>;
    delete view._id;
    return view as DouyinPersonaView;
  }
}
