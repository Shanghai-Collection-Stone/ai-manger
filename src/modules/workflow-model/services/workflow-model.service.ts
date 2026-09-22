import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  AdminAiProviderEntity,
  AdminUserEntity,
} from '../../admin/entities/admin.entity.js';
import { AdminService } from '../../admin/services/admin.service.js';
import {
  WORKFLOW_MODEL_CATALOG,
  WORKFLOW_RUNTIME_SUPPORT,
  type WorkflowNodeCategory,
  type WorkflowNodeDefinition,
  type WorkflowNodeModelEntity,
  type WorkflowNodeRuntime,
  type WorkflowNodeView,
  type WorkflowProviderOption,
  type WorkflowView,
} from '../entities/workflow-model.entity.js';
import {
  isShuyanProvider,
  listShuyanModelsByCategory,
} from './shuyan-model-catalog.js';

/**
 * @description PixMax 模型类型与节点类型的对照。
 * @keyword-cn PixMax节点类型, 类型映射
 * @keyword-en pixmax-node-type, category-mapping
 */
const PIXMAX_NODE_TYPES: Record<WorkflowNodeCategory, string> = {
  llm: 'GENERATE_TEXT',
  image: 'GENERATE_IMAGE',
  video: 'GENERATE_VIDEO',
};

/**
 * @description 判断某提供商在该模型类型下当前运行时能否真正调用。
 * @keyword-cn 运行时支持判断, 提供商兼容
 * @keyword-en is-runtime-supported, provider-compatibility
 * @param category 节点模型类型。
 * @param providerCode 提供商代码。
 * @returns {boolean} 是否支持。
 */
export function isWorkflowRuntimeSupported(
  category: WorkflowNodeCategory,
  providerCode: string,
): boolean {
  const code = String(providerCode ?? '')
    .trim()
    .toLowerCase();
  const support = WORKFLOW_RUNTIME_SUPPORT[category];
  if (support.excluded.includes(code)) return false;
  return support.allowed === null || support.allowed.includes(code);
}

/**
 * @description 把节点运行配置转成 `AgentService.runWithMessages` 的 config 覆盖字段；节点没设置时返回空对象，沿用默认提供商。
 * @keyword-cn 节点LLM覆盖参数, 默认回退
 * @keyword-en node-llm-config-override, default-fallback
 * @param runtime 节点运行配置或 null。
 * @returns 可直接展开进 config 的对象。
 */
export function toWorkflowLlmConfig(runtime: WorkflowNodeRuntime | null): {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
} {
  if (!runtime) return {};
  return {
    provider: runtime.providerCode,
    model: runtime.model,
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
  };
}

/**
 * @description 预设工作流节点模型设置：后台为每个节点选择提供商与模型，业务调用时按节点取运行配置，未设置则回退该类型默认提供商。
 * @keyword-cn 工作流节点模型, 节点指定模型
 * @keyword-en workflow-node-model, per-node-model
 */
@Injectable()
export class WorkflowModelService {
  private readonly logger = new Logger(WorkflowModelService.name);
  private readonly bindings: Collection<WorkflowNodeModelEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly adminService: AdminService,
  ) {
    this.bindings = db.collection<WorkflowNodeModelEntity>(
      'workflow_node_models',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 建立「工作流 + 节点」唯一索引。
   * @keyword-cn 节点设置索引, 唯一约束
   * @keyword-en node-binding-index, unique-constraint
   */
  async ensureIndexes(): Promise<void> {
    await this.bindings.createIndex(
      { workflowKey: 1, nodeKey: 1 },
      { unique: true },
    );
  }

  /**
   * @description 列出全部预设工作流、各节点当前设置与回退的默认提供商，以及可选的已启用提供商（不含密钥）。
   * @keyword-cn 工作流设置列表, 提供商选项
   * @keyword-en list-workflow-settings, provider-options
   * @param currentUser 当前后台用户。
   * @returns 工作流视图与提供商选项。
   */
  async list(currentUser: AdminUserEntity): Promise<{
    workflows: WorkflowView[];
    providers: WorkflowProviderOption[];
  }> {
    const [rows, providerRows] = await Promise.all([
      this.bindings.find({}).toArray(),
      this.adminService.listAiProviders(currentUser),
    ]);
    const providers = providerRows
      .filter((row) => row.enabled && this.isNodeCategory(row.modelCategory))
      .map((row) => this.toProviderOption(row));
    const providerById = new Map(providers.map((item) => [item.id, item]));
    const bindingByNode = new Map(
      rows.map((row) => [`${row.workflowKey}/${row.nodeKey}`, row]),
    );
    const fallbacks = new Map<
      WorkflowNodeCategory,
      WorkflowNodeView['fallback']
    >();
    for (const category of ['llm', 'image', 'video'] as const) {
      fallbacks.set(category, await this.readFallback(category));
    }

    const workflows = WORKFLOW_MODEL_CATALOG.map((workflow) => ({
      key: workflow.key,
      label: workflow.label,
      description: workflow.description,
      nodes: workflow.nodes.map((node) => {
        const row = bindingByNode.get(`${workflow.key}/${node.key}`);
        const provider = row ? providerById.get(row.providerId) : undefined;
        return {
          ...node,
          binding: row
            ? {
                providerId: row.providerId,
                providerName: provider?.name ?? '（提供商已删除或停用）',
                providerCode: provider?.providerCode ?? '',
                model: row.model,
                providerAvailable: Boolean(
                  provider && provider.category === node.category,
                ),
                runtimeSupported: provider
                  ? isWorkflowRuntimeSupported(
                      node.category,
                      provider.providerCode,
                    )
                  : false,
                updatedAt: row.updatedAt,
              }
            : null,
          fallback: fallbacks.get(node.category) ?? null,
        };
      }),
    }));
    return { workflows, providers };
  }

  /**
   * @description 为一个节点保存提供商与模型；提供商必须已启用且类型与节点一致，模型留空时用提供商自身的默认模型。
   * @keyword-cn 保存节点模型, 类型校验
   * @keyword-en save-node-model, category-check
   * @param currentUser 当前后台用户。
   * @param workflowKey 工作流 key。
   * @param nodeKey 节点 key。
   * @param input 提供商 ID 与模型编码。
   * @returns 刷新后的设置列表。
   * @throws {NotFoundException} WORKFLOW_NODE_NOT_FOUND。
   * @throws {BadRequestException} WORKFLOW_PROVIDER_UNAVAILABLE / WORKFLOW_PROVIDER_CATEGORY_MISMATCH / WORKFLOW_MODEL_REQUIRED。
   */
  async saveNode(
    currentUser: AdminUserEntity,
    workflowKey: string,
    nodeKey: string,
    input: { providerId: string; model?: string },
  ) {
    const node = this.requireNode(workflowKey, nodeKey);
    const provider = await this.adminService.getAiProviderRuntimeById(
      input.providerId,
    );
    if (!provider) {
      throw new BadRequestException('WORKFLOW_PROVIDER_UNAVAILABLE');
    }
    if (provider.modelCategory !== node.category) {
      throw new BadRequestException('WORKFLOW_PROVIDER_CATEGORY_MISMATCH');
    }
    const model = String(input.model ?? '').trim() || provider.model || '';
    if (!model) throw new BadRequestException('WORKFLOW_MODEL_REQUIRED');
    const now = new Date();
    await this.bindings.updateOne(
      { workflowKey, nodeKey },
      {
        $set: {
          providerId: provider.providerId,
          model: model.slice(0, 200),
          updatedBy: String(currentUser._id),
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true },
    );
    return this.list(currentUser);
  }

  /**
   * @description 清除节点设置，节点回到该类型默认提供商。
   * @keyword-cn 重置节点模型, 回退默认
   * @keyword-en reset-node-model, fallback-default
   * @param currentUser 当前后台用户。
   * @param workflowKey 工作流 key。
   * @param nodeKey 节点 key。
   * @returns 刷新后的设置列表。
   */
  async resetNode(
    currentUser: AdminUserEntity,
    workflowKey: string,
    nodeKey: string,
  ) {
    this.requireNode(workflowKey, nodeKey);
    await this.bindings.deleteOne({ workflowKey, nodeKey });
    return this.list(currentUser);
  }

  /**
   * @description 列出某提供商在指定类型下可选的模型：PixMax 实时读取「可用模型」接口并按节点类型过滤（只能选）；
   *   数眼智能实时读取 OpenAI 兼容 `GET /v1/models` 并按分类过滤（可选可填）；
   *   其他提供商只返回它自己配置的模型，页面允许手填。
   * @keyword-cn 提供商可选模型, PixMax模型列表, 数眼可选模型
   * @keyword-en list-provider-models, pixmax-model-list, shuyan-model-list
   * @param providerId 提供商 ID。
   * @param category 节点模型类型。
   * @returns 模型选项与是否允许手填。
   * @throws {BadRequestException} WORKFLOW_PROVIDER_UNAVAILABLE / PIXMAX_MODEL_LIST_FAILED / SHUYAN_MODEL_LIST_FAILED。
   */
  async listProviderModels(
    providerId: string,
    category: WorkflowNodeCategory,
  ): Promise<{
    models: Array<{ code: string; name: string }>;
    allowCustom: boolean;
  }> {
    const provider =
      await this.adminService.getAiProviderRuntimeById(providerId);
    if (!provider) {
      throw new BadRequestException('WORKFLOW_PROVIDER_UNAVAILABLE');
    }
    const providerCode = provider.providerCode.trim().toLowerCase();
    if (isShuyanProvider(providerCode)) {
      // 数眼智能是中转站，一个 Key 下同时有文本 / 生图 / 生视频等多类模型，
      // 这里实时拉全量目录再按节点类型过滤；分类靠 New API 的端点类型 + 模型名兜底，
      // 新模型族可能漏判，所以仍然 allowCustom，页面在下拉之外保留手填框。
      const models = await listShuyanModelsByCategory({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        category,
      });
      return { models, allowCustom: true };
    }
    if (providerCode !== 'pixmax') {
      return {
        models: provider.model
          ? [{ code: provider.model, name: provider.model }]
          : [],
        allowCustom: true,
      };
    }
    const response = await fetch(
      `${String(provider.baseUrl ?? '').replace(/\/$/, '')}/openapi/model/available`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(15 * 1000),
      },
    ).catch((error: unknown) => {
      throw new BadRequestException(
        `PIXMAX_MODEL_LIST_FAILED:${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      errCode?: string;
      errMessage?: string;
      data?: Array<{
        modelCode?: string;
        modelName?: string;
        nodeType?: string;
      }>;
    };
    if (!response.ok || payload.success === false) {
      throw new BadRequestException(
        `PIXMAX_MODEL_LIST_FAILED:${payload.errCode || payload.errMessage || `HTTP_${response.status}`}`,
      );
    }
    const models = (Array.isArray(payload.data) ? payload.data : [])
      .filter((item) => item?.nodeType === PIXMAX_NODE_TYPES[category])
      .map((item) => ({
        code: String(item.modelCode ?? '').trim(),
        name: String(item.modelName ?? item.modelCode ?? '').trim(),
      }))
      .filter((item) => item.code);
    return { models, allowCustom: false };
  }

  /**
   * @description 业务调用时读取节点的运行配置：有设置且提供商可用、运行时支持时返回；
   *   没有设置时返回 null，调用方用该类型默认提供商；设置了但提供商已删除 / 停用时记日志并回退默认；
   *   提供商类型不符或运行时不支持时直接报错，避免悄悄换成别的模型。
   * @keyword-cn 解析节点运行配置, 回退默认提供商
   * @keyword-en resolve-node-runtime, fallback-default-provider
   * @param workflowKey 工作流 key。
   * @param nodeKey 节点 key。
   * @returns 节点运行配置或 null。
   * @throws {BadRequestException} WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:<category>:<providerCode>。
   */
  async resolveNodeRuntime(
    workflowKey: string,
    nodeKey: string,
  ): Promise<WorkflowNodeRuntime | null> {
    const node = this.requireNode(workflowKey, nodeKey);
    const row = await this.bindings.findOne({ workflowKey, nodeKey });
    if (!row) return null;
    const provider = await this.adminService.getAiProviderRuntimeById(
      row.providerId,
    );
    if (!provider) {
      this.logger.warn(
        `[resolveNodeRuntime] ${workflowKey}/${nodeKey} 指定的提供商 ${row.providerId} 已删除或停用，回退默认提供商`,
      );
      return null;
    }
    if (
      provider.modelCategory !== node.category ||
      !isWorkflowRuntimeSupported(node.category, provider.providerCode)
    ) {
      throw new BadRequestException(
        `WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:${node.category}:${provider.providerCode}`,
      );
    }
    return {
      providerId: provider.providerId,
      providerCode: provider.providerCode,
      providerName: provider.name,
      model: row.model,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      tokensPerCredit: provider.tokensPerCredit,
      fixedTokensPerCall: provider.fixedTokensPerCall,
    };
  }

  /**
   * @description 读取节点未设置时实际生效的默认提供商（生图没有默认时由美图兜底，返回 null；
   *   生视频未指定时业务走环境变量直连服务，不读默认提供商，返回 null）。
   * @keyword-cn 读取默认提供商, 回退说明
   * @keyword-en read-fallback-provider, fallback-label
   */
  private async readFallback(
    category: WorkflowNodeCategory,
  ): Promise<WorkflowNodeView['fallback']> {
    if (category === 'video') return null;
    const row =
      category === 'image'
        ? await this.adminService.getDefaultImageProviderRuntime()
        : await this.adminService.getDefaultAiProvider(category);
    if (!row) return null;
    return {
      providerName: 'name' in row ? row.name : row.providerCode,
      providerCode: row.providerCode,
      model: row.model,
    };
  }

  /**
   * @description 按 key 查找目录里的节点定义。
   * @keyword-cn 查找节点定义, 目录校验
   * @keyword-en require-node-definition, catalog-check
   * @throws {NotFoundException} WORKFLOW_NODE_NOT_FOUND。
   */
  private requireNode(
    workflowKey: string,
    nodeKey: string,
  ): WorkflowNodeDefinition {
    const node = WORKFLOW_MODEL_CATALOG.find(
      (workflow) => workflow.key === workflowKey,
    )?.nodes.find((item) => item.key === nodeKey);
    if (!node) throw new NotFoundException('WORKFLOW_NODE_NOT_FOUND');
    return node;
  }

  /**
   * @description 判断提供商类型是否可被节点使用（排除向量模型）。
   * @keyword-cn 节点可用类型, 排除向量
   * @keyword-en is-node-category, exclude-embedding
   */
  private isNodeCategory(
    category: AdminAiProviderEntity['modelCategory'],
  ): category is WorkflowNodeCategory {
    return category === 'llm' || category === 'image' || category === 'video';
  }

  /**
   * @description 把提供商实体转成不含密钥的选项。
   * @keyword-cn 提供商选项视图, 隐藏密钥
   * @keyword-en provider-option-view, hide-api-key
   */
  private toProviderOption(row: AdminAiProviderEntity): WorkflowProviderOption {
    const category = row.modelCategory as WorkflowNodeCategory;
    return {
      id: String(row._id),
      name: row.name,
      providerCode: row.providerCode,
      category,
      model: row.model,
      isDefault: Boolean(row.isDefault),
      runtimeSupported: isWorkflowRuntimeSupported(category, row.providerCode),
    };
  }
}
