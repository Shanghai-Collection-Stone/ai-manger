import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, Filter, ObjectId, Sort } from 'mongodb';
import { createHash, randomUUID } from 'crypto';
import type {
  SassSchemaCreateInput,
  SassSchemaEntity,
  SassSchemaUpdateInput,
} from '../entities/sass-schema.entity.js';
import type {
  SassTenantCreateInput,
  SassTenantEntity,
} from '../entities/sass-tenant.entity.js';
import type {
  SassApiKeyCreateInput,
  SassApiKeyEntity,
} from '../entities/sass-api-key.entity.js';
import type { SassDatabaseLogEntity } from '../entities/sass-database-log.entity.js';
import type { PlatformInfoEntity } from '../entities/platform-info.entity.js';

type SassFilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'between'
  | 'exists'
  | 'regex'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

type SassFilterCondition = {
  field: string;
  op?: SassFilterOp;
  value?: unknown;
  values?: unknown[];
  min?: unknown;
  max?: unknown;
  options?: string;
};

type SassFilterGroup = {
  and?: SassFilterNode[];
  or?: SassFilterNode[];
  not?: SassFilterNode;
};

type SassFilterNode = SassFilterCondition | SassFilterGroup;

type SassDataQueryInput = {
  filter?: Record<string, unknown>;
  where?: SassFilterNode;
  projection?: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
};

type SassInsertInput = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

type SassOrderSyncRowInput = {
  orderNo: string;
  orderTime: string;
  channelName: string;
  productName: string;
  productQuantity: number;
  phone: string;
};

type SassUsageSyncRowInput = {
  orderNo: string;
  usageTime: string;
  usageQuantity: number;
};

type SassRefundSyncRowInput = {
  orderNo: string;
  refundTime: string;
  refundQuantity: number;
};

type SassTenantDataRow = Record<string, unknown>;

/**
 * @description 判断值是否为对象记录
 * @keyword-en check object record
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * @description 对API Key进行哈希
 * @keyword-en hash api key
 */
function hashApiKey(value: string): string {
  const digest = createHash('sha256').update(value).digest('base64');
  return digest.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * @description SaaS服务，提供schema、tenant、api-key和租户数据CRUD
 * @keyword-en sass service
 */
@Injectable()
export class SassService {
  private readonly PLATFORM_INFO_SCOPE_TENANT_ID = '__platform__';
  private readonly schemas: Collection<SassSchemaEntity>;
  private readonly tenants: Collection<SassTenantEntity>;
  private readonly apiKeys: Collection<SassApiKeyEntity>;
  private readonly logs: Collection<SassDatabaseLogEntity>;
  private readonly platformInfos: Collection<PlatformInfoEntity>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.schemas = db.collection<SassSchemaEntity>('sass_schema');
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
    this.apiKeys = db.collection<SassApiKeyEntity>('sass_api_keys');
    this.logs = db.collection<SassDatabaseLogEntity>('sass_database_log');
    this.platformInfos = db.collection<PlatformInfoEntity>(
      'sass_platform_infos',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 初始化索引
   * @keyword-en ensure indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.dropLegacyIdIndex('sass_schema');
    await this.dropLegacyIdIndex('sass_tenants');
    await this.dropLegacyIdIndex('sass_api_keys');
    await this.dropLegacyIdIndex('sass_database_log');
    await this.schemas.createIndex({ table: 1 }, { unique: true });
    await this.apiKeys.createIndex({ keyId: 1 }, { unique: true });
    await this.apiKeys.createIndex({ tenantId: 1 });
    await this.logs.createIndex({ tenantId: 1, schemaId: 1, createdAt: -1 });
    await this.logs.createIndex({ operation: 1, createdAt: -1 });
    await this.platformInfos.createIndex({ tenantId: 1 }, { unique: true });
  }

  /**
   * @description 清理历史id唯一索引
   * @keyword-en drop legacy id index
   */
  private async dropLegacyIdIndex(collectionName: string): Promise<void> {
    const collection = this.db.collection(collectionName);
    try {
      const indexes = await collection.listIndexes().toArray();
      for (const index of indexes) {
        if (!isObjectRecord(index)) {
          continue;
        }
        const indexName = index.name;
        const key = index.key;
        if (typeof indexName !== 'string' || !isObjectRecord(key)) {
          continue;
        }
        const keyNames = Object.keys(key);
        const isLegacyIdKey = keyNames.length === 1 && key.id === 1;
        if (indexName === 'id_1' || isLegacyIdKey) {
          await collection.dropIndex(indexName);
        }
      }
    } catch (error) {
      let codeName = '';
      if (isObjectRecord(error) && typeof error.codeName === 'string') {
        codeName = error.codeName;
      }
      if (codeName !== 'NamespaceNotFound' && codeName !== 'IndexNotFound') {
        throw error;
      }
    }
  }

  /**
   * @description 校验schema输入
   * @keyword-en validate schema input
   */
  private validateSchemaInput(input: SassSchemaCreateInput): void {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('INVALID_SCHEMA_PAYLOAD');
    }
    const table = typeof input.table === 'string' ? input.table.trim() : '';
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new BadRequestException('INVALID_TABLE_NAME');
    }
    const tableDesc =
      typeof input.tableDesc === 'string' ? input.tableDesc.trim() : '';
    if (!tableDesc) {
      throw new BadRequestException('TABLE_DESC_REQUIRED');
    }
    const fields = Object.entries(input.tableField ?? {});
    if (fields.length === 0) {
      throw new BadRequestException('TABLE_FIELD_REQUIRED');
    }
    for (const [field, desc] of fields) {
      if (!/^[a-zA-Z0-9_]+$/.test(field)) {
        throw new BadRequestException('INVALID_FIELD_NAME');
      }
      if (!String(desc ?? '').trim()) {
        throw new BadRequestException('FIELD_DESC_REQUIRED');
      }
    }
    const dedupeFieldInput = isObjectRecord(input)
      ? input.dedupeField
      : undefined;
    if (typeof dedupeFieldInput !== 'undefined') {
      if (typeof dedupeFieldInput !== 'string') {
        throw new BadRequestException('DEDUPE_FIELD_REQUIRED');
      }
      const dedupeField = dedupeFieldInput.trim();
      if (!dedupeField) {
        throw new BadRequestException('DEDUPE_FIELD_REQUIRED');
      }
      if (
        !Object.prototype.hasOwnProperty.call(input.tableField, dedupeField)
      ) {
        throw new BadRequestException('DEDUPE_FIELD_NOT_IN_SCHEMA');
      }
    }
  }

  /**
   * @description 创建schema
   * @keyword-en create schema
   */
  async createSchema(input: SassSchemaCreateInput): Promise<SassSchemaEntity> {
    await this.dropLegacyIdIndex('sass_schema');
    this.validateSchemaInput(input);
    const dedupeFieldInput = isObjectRecord(input)
      ? input.dedupeField
      : undefined;
    const now = new Date();
    const doc: SassSchemaEntity = {
      _id: new ObjectId(),
      table: input.table.trim(),
      tableDesc: input.tableDesc.trim(),
      tableField: input.tableField,
      dedupeField:
        typeof dedupeFieldInput === 'string'
          ? dedupeFieldInput.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.schemas.insertOne(doc);
    } catch (error) {
      if (this.isDuplicateTableError(error)) {
        throw new BadRequestException('SCHEMA_TABLE_ALREADY_EXISTS');
      }
      throw error;
    }
    return doc;
  }

  /**
   * @description 更新schema
   * @keyword-en update schema
   */
  async updateSchema(
    input: SassSchemaUpdateInput,
  ): Promise<SassSchemaEntity | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.table === 'string') {
      const table = input.table.trim();
      if (!/^[a-zA-Z0-9_]+$/.test(table)) {
        throw new BadRequestException('INVALID_TABLE_NAME');
      }
      updates.table = table;
    }
    if (typeof input.tableDesc === 'string') {
      const tableDesc = input.tableDesc.trim();
      if (!tableDesc) throw new BadRequestException('TABLE_DESC_REQUIRED');
      updates.tableDesc = tableDesc;
    }
    if (typeof input.tableField !== 'undefined') {
      const fields = Object.entries(input.tableField);
      if (fields.length === 0)
        throw new BadRequestException('TABLE_FIELD_REQUIRED');
      for (const [field, desc] of fields) {
        if (!/^[a-zA-Z0-9_]+$/.test(field)) {
          throw new BadRequestException('INVALID_FIELD_NAME');
        }
        if (!String(desc ?? '').trim()) {
          throw new BadRequestException('FIELD_DESC_REQUIRED');
        }
      }
      updates.tableField = input.tableField;
    }
    const dedupeFieldInput = isObjectRecord(input)
      ? input.dedupeField
      : undefined;
    if (typeof dedupeFieldInput !== 'undefined') {
      if (typeof dedupeFieldInput !== 'string') {
        throw new BadRequestException('DEDUPE_FIELD_REQUIRED');
      }
      const dedupeField = dedupeFieldInput.trim();
      if (!dedupeField) {
        throw new BadRequestException('DEDUPE_FIELD_REQUIRED');
      }
      updates.dedupeField = dedupeField;
    }
    if (
      typeof updates.tableField !== 'undefined' ||
      typeof updates.dedupeField !== 'undefined'
    ) {
      const schemaObjectId = this.toObjectId(input.id, 'INVALID_SCHEMA_ID');
      const current = await this.db
        .collection<Record<string, unknown>>('sass_schema')
        .findOne({ _id: schemaObjectId });
      if (!current) return null;
      const tableFieldCandidate = updates.tableField ?? current['tableField'];
      if (!isObjectRecord(tableFieldCandidate)) {
        throw new BadRequestException('TABLE_FIELD_REQUIRED');
      }
      const tableField = tableFieldCandidate;
      const currentDedupeField = current['dedupeField'];
      const dedupeFieldCandidate = updates.dedupeField ?? currentDedupeField;
      const dedupeField =
        typeof dedupeFieldCandidate === 'string'
          ? dedupeFieldCandidate
          : undefined;
      if (
        typeof dedupeField === 'string' &&
        !Object.prototype.hasOwnProperty.call(tableField, dedupeField)
      ) {
        throw new BadRequestException('DEDUPE_FIELD_NOT_IN_SCHEMA');
      }
    }
    const schemaObjectId = this.toObjectId(input.id, 'INVALID_SCHEMA_ID');
    try {
      const res = await this.schemas.findOneAndUpdate(
        { _id: schemaObjectId },
        { $set: updates },
        { returnDocument: 'after', includeResultMetadata: true },
      );
      return res.value ?? null;
    } catch (error) {
      if (this.isDuplicateTableError(error)) {
        throw new BadRequestException('SCHEMA_TABLE_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  /**
   * @description 删除schema
   * @keyword-en delete schema
   */
  async deleteSchema(id: string): Promise<boolean> {
    const schemaObjectId = this.toObjectId(id, 'INVALID_SCHEMA_ID');
    const res = await this.schemas.deleteOne({ _id: schemaObjectId });
    return res.deletedCount === 1;
  }

  /**
   * @description 获取schema详情
   * @keyword-en get schema
   */
  async getSchema(id: string): Promise<SassSchemaEntity | null> {
    const schemaObjectId = this.toObjectId(id, 'INVALID_SCHEMA_ID');
    return (await this.schemas.findOne({ _id: schemaObjectId })) ?? null;
  }

  /**
   * @description 获取schema列表
   * @keyword-en list schema
   */
  async listSchema(): Promise<SassSchemaEntity[]> {
    return this.schemas.find({}).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 创建租户
   * @keyword-en create tenant
   */
  async createTenant(input: SassTenantCreateInput): Promise<SassTenantEntity> {
    await this.dropLegacyIdIndex('sass_tenants');
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('INVALID_TENANT_PAYLOAD');
    }
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new BadRequestException('TENANT_NAME_REQUIRED');
    const now = new Date();
    const doc: SassTenantEntity = {
      _id: new ObjectId(),
      name,
      description:
        typeof input.description === 'string'
          ? input.description.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.tenants.insertOne(doc);
    return doc;
  }

  /**
   * @description 获取租户详情
   * @keyword-en get tenant
   */
  async getTenant(id: string): Promise<SassTenantEntity | null> {
    const tenantObjectId = this.toObjectId(id, 'INVALID_TENANT_ID');
    return (await this.tenants.findOne({ _id: tenantObjectId })) ?? null;
  }

  /**
   * @description 获取租户列表
   * @keyword-en list tenant
   */
  async listTenant(): Promise<SassTenantEntity[]> {
    return this.tenants.find({}).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 创建API Key并返回明文Key
   * @keyword-en create api key
   */
  async createApiKey(
    input: SassApiKeyCreateInput,
  ): Promise<{ apiKey: SassApiKeyEntity; secret: string }> {
    await this.dropLegacyIdIndex('sass_api_keys');
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('INVALID_API_KEY_PAYLOAD');
    }
    const tenantObjectId = this.toObjectId(input.tenantId, 'INVALID_TENANT_ID');
    const tenant = await this.tenants.findOne({ _id: tenantObjectId });
    if (!tenant) throw new BadRequestException('TENANT_NOT_FOUND');

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new BadRequestException('API_KEY_NAME_REQUIRED');

    const expireDays = input.expireDays ?? 365;
    const expireMs = Math.max(1, Math.floor(expireDays * 24 * 60 * 60 * 1000));
    const apiKeySecret = `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const keyId = hashApiKey(apiKeySecret);
    const expiresAt = new Date(Date.now() + expireMs);

    const now = new Date();
    const doc: SassApiKeyEntity = {
      _id: new ObjectId(),
      tenantId: input.tenantId,
      name,
      keyId,
      tokenPreview: `${apiKeySecret.slice(0, 6)}...${apiKeySecret.slice(-4)}`,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    await this.apiKeys.insertOne(doc);

    return { apiKey: doc, secret: apiKeySecret };
  }

  /**
   * @description 获取API Key列表
   * @keyword-en list api key
   */
  async listApiKey(tenantId?: string): Promise<SassApiKeyEntity[]> {
    const filter: Record<string, unknown> = { revokedAt: { $exists: false } };
    if (typeof tenantId === 'string' && tenantId) {
      if (!ObjectId.isValid(tenantId)) {
        throw new BadRequestException('INVALID_TENANT_ID');
      }
      filter.tenantId = tenantId;
    }
    return this.apiKeys.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 撤销API Key
   * @keyword-en revoke api key
   */
  async revokeApiKey(id: string): Promise<boolean> {
    const keyObjectId = this.toObjectId(id, 'INVALID_API_KEY_ID');
    const res = await this.apiKeys.updateOne(
      { _id: keyObjectId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), updatedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  }

  /**
   * @description 将字符串转换为ObjectId
   * @keyword-en convert string to object id
   */
  private toObjectId(id: string, errorCode: string): ObjectId {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException(errorCode);
    }
    return new ObjectId(id);
  }

  /**
   * @description 判断是否为schema表名唯一冲突
   * @keyword-en detect schema table duplicate error
   */
  private isDuplicateTableError(error: unknown): boolean {
    if (!isObjectRecord(error) || error.code !== 11000) {
      return false;
    }
    const keyPattern = error.keyPattern;
    if (!isObjectRecord(keyPattern)) {
      return false;
    }
    return keyPattern.table === 1;
  }

  /**
   * @description 计算租户前缀
   * @keyword-en build tenant prefix
   */
  private buildTenantPrefix(tenantId: string): string {
    const raw = String(tenantId)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    const safe = raw.length > 0 ? raw : 'tn';
    return (safe + '0000').slice(0, 4);
  }

  /**
   * @description 计算租户隔离表名
   * @keyword-en resolve tenant collection
   */
  private async resolveTenantCollectionName(
    schemaId: string,
    tenantId: string,
  ): Promise<string> {
    const schemaObjectId = this.toObjectId(schemaId, 'INVALID_SCHEMA_ID');
    const schema = await this.schemas.findOne({ _id: schemaObjectId });
    if (!schema) throw new BadRequestException('SCHEMA_NOT_FOUND');
    const table = schema.table.trim();
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new BadRequestException('INVALID_TABLE_NAME');
    }
    const tenantPrefix = this.buildTenantPrefix(tenantId);
    return `${tenantPrefix}_${table}`;
  }

  /**
   * @description 获取租户隔离集合
   * @keyword-en get tenant collection
   */
  private async getTenantCollection(
    schemaId: string,
    tenantId: string,
  ): Promise<Collection<SassTenantDataRow>> {
    const collectionName = await this.resolveTenantCollectionName(
      schemaId,
      tenantId,
    );
    return this.db.collection<SassTenantDataRow>(collectionName);
  }

  /**
   * @description 获取schema与租户集合信息
   * @keyword-en resolve schema and tenant collection
   */
  private async resolveTenantTarget(
    schemaId: string,
    tenantId: string,
  ): Promise<{
    schema: SassSchemaEntity;
    collectionName: string;
    col: Collection<SassTenantDataRow>;
  }> {
    const schemaObjectId = this.toObjectId(schemaId, 'INVALID_SCHEMA_ID');
    const schema = await this.schemas.findOne({ _id: schemaObjectId });
    if (!schema) throw new BadRequestException('SCHEMA_NOT_FOUND');
    const collectionName = await this.resolveTenantCollectionName(
      schemaId,
      tenantId,
    );
    const col = this.db.collection<SassTenantDataRow>(collectionName);
    return { schema, collectionName, col };
  }

  /**
   * @description 判定值是否为非空
   * @keyword-en check non empty value
   */
  private isNonEmptyValue(value: unknown): boolean {
    if (value === null || typeof value === 'undefined') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (isObjectRecord(value)) return Object.keys(value).length > 0;
    return true;
  }

  /**
   * @description 校验单条数据与schema一致
   * @keyword-en validate row by schema
   */
  private validateRowBySchema(
    row: Record<string, unknown>,
    schema: SassSchemaEntity,
  ): void {
    const schemaFields = Object.keys(schema.tableField ?? {});
    const rowKeys = Object.keys(row ?? {});
    for (const field of schemaFields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) {
        throw new BadRequestException(`FIELD_KEY_REQUIRED:${field}`);
      }
    }
    for (const field of rowKeys) {
      if (!schemaFields.includes(field)) {
        throw new BadRequestException(`FIELD_NOT_IN_SCHEMA:${field}`);
      }
    }
    const dedupeField = isObjectRecord(schema) ? schema.dedupeField : undefined;
    if (typeof dedupeField === 'string' && dedupeField) {
      const value = row[dedupeField];
      if (!this.isNonEmptyValue(value)) {
        throw new BadRequestException(`DEDUPE_FIELD_EMPTY:${dedupeField}`);
      }
    }
  }

  /**
   * @description 构建去重键
   * @keyword-en build dedupe key
   */
  private buildDedupeKey(value: unknown): string {
    return JSON.stringify(value);
  }

  /**
   * @description 解析过滤条件节点
   * @keyword-en parse filter node
   */
  private parseFilterNode(node: SassFilterNode): Filter<SassTenantDataRow> {
    const asCondition = node as SassFilterCondition;
    if (typeof asCondition.field === 'string') {
      const field = asCondition.field.trim();
      if (!/^[a-zA-Z0-9_]+$/.test(field)) {
        throw new BadRequestException('INVALID_FILTER_FIELD');
      }
      const op = asCondition.op ?? 'eq';
      if (op === 'eq') return { [field]: asCondition.value };
      if (op === 'ne') return { [field]: { $ne: asCondition.value } };
      if (op === 'gt') return { [field]: { $gt: asCondition.value } };
      if (op === 'gte') return { [field]: { $gte: asCondition.value } };
      if (op === 'lt') return { [field]: { $lt: asCondition.value } };
      if (op === 'lte') return { [field]: { $lte: asCondition.value } };
      if (op === 'in') {
        const values = Array.isArray(asCondition.values)
          ? asCondition.values
          : [];
        return { [field]: { $in: values } };
      }
      if (op === 'nin') {
        const values = Array.isArray(asCondition.values)
          ? asCondition.values
          : [];
        return { [field]: { $nin: values } };
      }
      if (op === 'between') {
        return { [field]: { $gte: asCondition.min, $lte: asCondition.max } };
      }
      if (op === 'exists') {
        return { [field]: { $exists: Boolean(asCondition.value) } };
      }
      if (op === 'regex') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_REGEX_VALUE');
        }
        return {
          [field]: {
            $regex: asCondition.value,
            $options:
              typeof asCondition.options === 'string'
                ? asCondition.options
                : 'i',
          },
        };
      }
      if (op === 'contains') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_CONTAINS_VALUE');
        }
        return {
          [field]: {
            $regex: asCondition.value,
            $options: 'i',
          },
        };
      }
      if (op === 'starts_with') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_STARTS_WITH_VALUE');
        }
        return {
          [field]: {
            $regex: `^${asCondition.value}`,
            $options: 'i',
          },
        };
      }
      if (op === 'ends_with') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_ENDS_WITH_VALUE');
        }
        return {
          [field]: {
            $regex: `${asCondition.value}$`,
            $options: 'i',
          },
        };
      }
      throw new BadRequestException('INVALID_FILTER_OPERATOR');
    }
    const asGroup = node as SassFilterGroup;
    if (Array.isArray(asGroup.and) && asGroup.and.length > 0) {
      return { $and: asGroup.and.map((item) => this.parseFilterNode(item)) };
    }
    if (Array.isArray(asGroup.or) && asGroup.or.length > 0) {
      return { $or: asGroup.or.map((item) => this.parseFilterNode(item)) };
    }
    if (asGroup.not) {
      return { $nor: [this.parseFilterNode(asGroup.not)] };
    }
    throw new BadRequestException('INVALID_FILTER_GROUP');
  }

  /**
   * @description 构建最终Mongo过滤条件
   * @keyword-en build final mongo filter
   */
  private buildFinalFilter(
    filter?: Record<string, unknown>,
    where?: SassFilterNode,
  ): Filter<SassTenantDataRow> {
    const list: Filter<SassTenantDataRow>[] = [];
    if (filter && Object.keys(filter).length > 0) {
      list.push(filter);
    }
    if (where) {
      list.push(this.parseFilterNode(where));
    }
    if (list.length === 0) return {};
    if (list.length === 1) return list[0];
    return { $and: list };
  }

  /**
   * @description 写入数据操作日志
   * @keyword-en write data operation log
   */
  private async writeDataLog(input: {
    schemaId: string;
    tenantId: string;
    keyId?: string;
    operation:
      | 'insert'
      | 'patch'
      | 'list'
      | 'find_one'
      | 'update_one'
      | 'delete_one';
    collectionName: string;
    request: Record<string, unknown>;
    result: Record<string, unknown>;
    dataIds?: string[];
  }): Promise<void> {
    const doc: SassDatabaseLogEntity = {
      _id: new ObjectId(),
      schemaId: input.schemaId,
      tenantId: input.tenantId,
      keyId: input.keyId,
      operation: input.operation,
      collectionName: input.collectionName,
      dataIds: input.dataIds,
      request: input.request,
      result: input.result,
      createdAt: new Date(),
    };
    await this.logs.insertOne(doc);
  }

  /**
   * @description 插入租户数据
   * @keyword-en insert tenant data
   */
  async insertData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    input: SassInsertInput,
  ): Promise<{
    totalCount: number;
    insertedCount: number;
    skippedDuplicateCount: number;
    insertedIds: string[];
    skippedDuplicateValues: unknown[];
  }> {
    const { schema, collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const dataList = Array.isArray(input.data) ? input.data : [input.data];
    if (dataList.length === 0) {
      throw new BadRequestException('EMPTY_INSERT_DATA');
    }
    for (const row of dataList) {
      this.validateRowBySchema(row, schema);
    }
    const dedupeField = isObjectRecord(schema) ? schema.dedupeField : undefined;
    const skippedDuplicateValues: unknown[] = [];
    let insertRows = dataList.map((row) => ({ ...row }));
    if (typeof dedupeField === 'string' && dedupeField) {
      const dedupeValues = insertRows.map((row) => row[dedupeField]);
      const uniqueValueMap = new Map<string, unknown>();
      for (const value of dedupeValues) {
        const dedupeKey = this.buildDedupeKey(value);
        if (!uniqueValueMap.has(dedupeKey)) {
          uniqueValueMap.set(dedupeKey, value);
        }
      }
      const uniqueValues = Array.from(uniqueValueMap.values());
      const existsRows = await col
        .find(
          { [dedupeField]: { $in: uniqueValues } },
          { projection: { [dedupeField]: 1 } },
        )
        .toArray();
      const existsSet = new Set(
        existsRows.map((row) => this.buildDedupeKey(row[dedupeField])),
      );
      const selected: Record<string, unknown>[] = [];
      const selectedSet = new Set<string>(existsSet);
      for (const row of insertRows) {
        const dedupeValue = row[dedupeField];
        const dedupeKey = this.buildDedupeKey(dedupeValue);
        if (selectedSet.has(dedupeKey)) {
          skippedDuplicateValues.push(dedupeValue);
          continue;
        }
        selectedSet.add(dedupeKey);
        selected.push(row);
      }
      insertRows = selected;
    }
    const now = new Date();
    const withMeta = insertRows.map((row) => ({
      ...row,
      sassDataId: randomUUID().replace(/-/g, ''),
      createdAt: now,
      updatedAt: now,
    }));
    const insertedIds: string[] = [];
    if (withMeta.length > 0) {
      const res = await col.insertMany(withMeta);
      const keys = Object.keys(res.insertedIds)
        .map((key) => Number(key))
        .sort((a, b) => a - b);
      for (const key of keys) {
        insertedIds.push(String(res.insertedIds[key]));
      }
    }
    const dataIds = withMeta
      .map((row) => row.sassDataId)
      .filter((item): item is string => typeof item === 'string');
    const result = {
      totalCount: dataList.length,
      insertedCount: withMeta.length,
      skippedDuplicateCount: skippedDuplicateValues.length,
      insertedIds,
      skippedDuplicateValues,
    };
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'insert',
      collectionName,
      request: {
        totalCount: dataList.length,
        hasDedupeField: Boolean(dedupeField),
      },
      result,
      dataIds,
    });
    return result;
  }

  /**
   * @description 按去重字段批量补丁数据，存在则更新，不存在则新增
   * @keyword-en patch tenant data by dedupe field
   */
  async patchData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    input: SassInsertInput,
  ): Promise<{
    totalCount: number;
    effectiveCount: number;
    insertedCount: number;
    updatedCount: number;
    upsertedIds: string[];
    updatedValues: unknown[];
  }> {
    const { schema, collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const dedupeField = isObjectRecord(schema) ? schema.dedupeField : undefined;
    if (!dedupeField || typeof dedupeField !== 'string') {
      throw new BadRequestException('DEDUPE_FIELD_REQUIRED');
    }
    const dataList = Array.isArray(input.data) ? input.data : [input.data];
    if (dataList.length === 0) {
      throw new BadRequestException('EMPTY_INSERT_DATA');
    }
    for (const row of dataList) {
      this.validateRowBySchema(row, schema);
    }
    const dedupeMap = new Map<string, Record<string, unknown>>();
    for (const row of dataList) {
      const dedupeKey = this.buildDedupeKey(row[dedupeField]);
      dedupeMap.set(dedupeKey, { ...row });
    }
    const rows = Array.from(dedupeMap.values());
    const upsertedIds: string[] = [];
    const updatedValues: unknown[] = [];
    let insertedCount = 0;
    let updatedCount = 0;
    for (const row of rows) {
      const now = new Date();
      const dedupeValue = row[dedupeField];
      const res = await col.updateOne(
        { [dedupeField]: dedupeValue },
        {
          $set: { ...row, updatedAt: now },
          $setOnInsert: {
            sassDataId: randomUUID().replace(/-/g, ''),
            createdAt: now,
          },
        },
        { upsert: true },
      );
      if (res.upsertedId) {
        insertedCount += 1;
        upsertedIds.push(String(res.upsertedId));
      } else if (res.matchedCount > 0) {
        updatedCount += 1;
        updatedValues.push(dedupeValue);
      }
    }
    const result = {
      totalCount: dataList.length,
      effectiveCount: rows.length,
      insertedCount,
      updatedCount,
      upsertedIds,
      updatedValues,
    };
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'patch',
      collectionName,
      request: {
        totalCount: dataList.length,
        effectiveCount: rows.length,
        dedupeField,
      },
      result,
    });
    return result;
  }

  /**
   * @description 查询租户数据列表
   * @keyword-en list tenant data
   */
  async listData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    params?: SassDataQueryInput,
  ): Promise<SassTenantDataRow[]> {
    const { collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const limit = Math.min(Math.max(params?.limit ?? 20, 1), 500);
    const skip = Math.max(params?.skip ?? 0, 0);
    const filter = this.buildFinalFilter(params?.filter, params?.where);
    const rows = await col
      .find(filter, { projection: params?.projection ?? {} })
      .sort((params?.sort ?? { _id: -1 }) as Sort)
      .skip(skip)
      .limit(limit)
      .toArray();
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'list',
      collectionName,
      request: {
        limit,
        skip,
        hasFilter: Boolean(
          params?.filter && Object.keys(params.filter).length > 0,
        ),
        hasWhere: Boolean(params?.where),
      },
      result: { count: rows.length },
      dataIds: rows
        .map((item) => item.sassDataId)
        .filter((value): value is string => typeof value === 'string'),
    });
    return rows;
  }

  /**
   * @description 查询租户单条数据
   * @keyword-en find one tenant data
   */
  async findOneData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    params?: Omit<SassDataQueryInput, 'limit' | 'skip'>,
  ): Promise<SassTenantDataRow | null> {
    const { collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const filter = this.buildFinalFilter(params?.filter, params?.where);
    const row =
      (await col.findOne(filter, {
        projection: params?.projection ?? {},
        sort: (params?.sort ?? { _id: -1 }) as Sort,
      })) ?? null;
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'find_one',
      collectionName,
      request: {
        hasFilter: Boolean(
          params?.filter && Object.keys(params.filter).length > 0,
        ),
        hasWhere: Boolean(params?.where),
      },
      result: {
        found: Boolean(row),
        sassDataId:
          row && typeof row.sassDataId === 'string'
            ? row.sassDataId
            : undefined,
      },
      dataIds:
        row && typeof row.sassDataId === 'string'
          ? [row.sassDataId]
          : undefined,
    });
    return row;
  }

  /**
   * @description 更新租户单条数据
   * @keyword-en update one tenant data
   */
  async updateOneData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    params: {
      filter: Record<string, unknown>;
      where?: SassFilterNode;
      update: Record<string, unknown>;
      upsert?: boolean;
    },
  ): Promise<{
    matchedCount: number;
    modifiedCount: number;
    upsertedId?: string;
  }> {
    if (!params.filter || Object.keys(params.filter).length === 0) {
      throw new BadRequestException('FILTER_REQUIRED');
    }
    if (!params.update || Object.keys(params.update).length === 0) {
      throw new BadRequestException('UPDATE_REQUIRED');
    }
    const { collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const filter = this.buildFinalFilter(params.filter, params.where);
    const res = await col.updateOne(
      filter,
      { $set: { ...params.update, updatedAt: new Date() } },
      { upsert: params.upsert ?? false },
    );
    const result = {
      matchedCount: res.matchedCount,
      modifiedCount: res.modifiedCount,
      upsertedId: res.upsertedId ? String(res.upsertedId) : undefined,
    };
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'update_one',
      collectionName,
      request: {
        hasFilter: Object.keys(params.filter).length > 0,
        hasWhere: Boolean(params.where),
        updateKeys: Object.keys(params.update),
        upsert: params.upsert ?? false,
      },
      result,
    });
    return result;
  }

  /**
   * @description 删除租户单条数据
   * @keyword-en delete one tenant data
   */
  async deleteOneData(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    input: {
      filter: Record<string, unknown>;
      where?: SassFilterNode;
    },
  ): Promise<{ deletedCount: number }> {
    if (!input.filter || Object.keys(input.filter).length === 0) {
      throw new BadRequestException('FILTER_REQUIRED');
    }
    const { collectionName, col } = await this.resolveTenantTarget(
      schemaId,
      tenantId,
    );
    const filter = this.buildFinalFilter(input.filter, input.where);
    const res = await col.deleteOne(filter);
    const result = { deletedCount: res.deletedCount };
    await this.writeDataLog({
      schemaId,
      tenantId,
      keyId,
      operation: 'delete_one',
      collectionName,
      request: {
        hasFilter: Object.keys(input.filter).length > 0,
        hasWhere: Boolean(input.where),
      },
      result,
    });
    return result;
  }

  /**
   * @description 同步订单数据到指定schema
   * @keyword-en sync orders to schema
   */
  async syncOrdersToSchema(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    rows: SassOrderSyncRowInput[],
  ): Promise<{
    totalCount: number;
    insertedCount: number;
    skippedDuplicateCount: number;
    insertedIds: string[];
    skippedDuplicateValues: unknown[];
  }> {
    if (rows.length === 0) {
      throw new BadRequestException('EMPTY_SYNC_ORDERS');
    }
    const data = rows.map((item) => ({
      orderNo: item.orderNo,
      orderTime: item.orderTime,
      channelName: item.channelName,
      productName: item.productName,
      productQuantity: item.productQuantity,
      phone: item.phone,
    }));
    return this.insertData(schemaId, tenantId, keyId, { data });
  }

  /**
   * @description 同步订单使用数据到指定schema
   * @keyword-en sync usages to schema
   */
  async syncUsagesToSchema(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    rows: SassUsageSyncRowInput[],
  ): Promise<{
    totalCount: number;
    insertedCount: number;
    skippedDuplicateCount: number;
    insertedIds: string[];
    skippedDuplicateValues: unknown[];
  }> {
    if (rows.length === 0) {
      throw new BadRequestException('EMPTY_SYNC_USAGES');
    }
    const data = rows.map((item) => ({
      orderNo: item.orderNo,
      usageTime: item.usageTime,
      usageQuantity: item.usageQuantity,
    }));
    return this.insertData(schemaId, tenantId, keyId, { data });
  }

  /**
   * @description 同步订单退单数据到指定schema
   * @keyword-en sync refunds to schema
   */
  async syncRefundsToSchema(
    schemaId: string,
    tenantId: string,
    keyId: string | undefined,
    rows: SassRefundSyncRowInput[],
  ): Promise<{
    totalCount: number;
    insertedCount: number;
    skippedDuplicateCount: number;
    insertedIds: string[];
    skippedDuplicateValues: unknown[];
  }> {
    if (rows.length === 0) {
      throw new BadRequestException('EMPTY_SYNC_REFUNDS');
    }
    const data = rows.map((item) => ({
      orderNo: item.orderNo,
      refundTime: item.refundTime,
      refundQuantity: item.refundQuantity,
    }));
    return this.insertData(schemaId, tenantId, keyId, { data });
  }

  /**
   * @description 获取租户平台信息（AI补充说明）
   * @param {string | undefined} tenantId - 租户ID（为空时回退全局平台作用域）
   * @returns {Promise<PlatformInfoEntity | null>} 平台信息
   * @keyword-en get platform info
   */
  async getPlatformInfo(tenantId?: string): Promise<PlatformInfoEntity | null> {
    const normalized = (tenantId ?? '').trim();
    if (!normalized) {
      return this.platformInfos.findOne({
        tenantId: this.PLATFORM_INFO_SCOPE_TENANT_ID,
      }) as Promise<PlatformInfoEntity | null>;
    }

    const tenantInfo = (await this.platformInfos.findOne({
      tenantId: normalized,
    })) as PlatformInfoEntity | null;
    if (tenantInfo) return tenantInfo;

    if (normalized === this.PLATFORM_INFO_SCOPE_TENANT_ID) return null;
    return this.platformInfos.findOne({
      tenantId: this.PLATFORM_INFO_SCOPE_TENANT_ID,
    }) as Promise<PlatformInfoEntity | null>;
  }

  /**
   * @description 更新租户平台信息（AI补充说明）
   * @param {string} tenantId - 租户ID
   * @param {string} aiPromptSupplement - AI补充说明（markdown）
   * @param {boolean | undefined} enableAiCover - 是否开启 AI 封面生成
   * @returns {Promise<PlatformInfoEntity>} 更新后的平台信息
   * @keyword-en upsert platform info
   */
  async upsertPlatformInfo(
    tenantId: string,
    aiPromptSupplement: string,
    enableAiCover?: boolean,
  ): Promise<PlatformInfoEntity> {
    const normalized = (tenantId ?? '').trim();
    if (!normalized) throw new BadRequestException('TENANT_ID_REQUIRED');
    const now = new Date();
    const setDoc: Record<string, unknown> = {
      aiPromptSupplement: String(aiPromptSupplement ?? ''),
      updatedAt: now,
    };
    const setOnInsertDoc: Record<string, unknown> = {
      _id: new ObjectId(),
      tenantId: normalized,
      createdAt: now,
    };
    if (typeof enableAiCover === 'boolean') {
      setDoc.enableAiCover = enableAiCover;
    } else {
      setOnInsertDoc.enableAiCover = false;
    }
    const res = await this.platformInfos.findOneAndUpdate(
      { tenantId: normalized },
      {
        $set: setDoc,
        $setOnInsert: setOnInsertDoc,
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) {
      throw new BadRequestException('UPSERT_PLATFORM_INFO_FAILED');
    }
    return res.value as PlatformInfoEntity;
  }
}
