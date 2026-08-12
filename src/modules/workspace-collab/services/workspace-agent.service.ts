import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { WorkspaceAgentEntity } from '../entities/workspace-collab.entity.js';
import {
  DEFAULT_WORKSPACE_AGENTS,
  WORKSPACE_AGENT_DEFAULT_MODEL,
  WORKSPACE_AGENT_DEFAULT_PROVIDER,
} from '../constants/workspace-agent.constants.js';
import { WORKSPACE_COLLAB_AUDIT_ACTIONS } from '../constants/workspace-collab-audit.constants.js';
import { WorkspaceCollabContextService } from './workspace-collab-context.service.js';

/**
 * @description 创建 Agent 入参
 * @keyword-en create workspace agent input
 * @keyword-cn 创建Agent入参
 */
export interface CreateWorkspaceAgentInput {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  accent?: string;
  aiEnabled?: boolean;
  aiProvider?: string;
  aiModel?: string;
}

/**
 * @description 更新 Agent 入参
 * @keyword-en update workspace agent input
 * @keyword-cn 更新Agent入参
 */
export interface UpdateWorkspaceAgentInput {
  name?: string;
  description?: string;
  icon?: string;
  accent?: string;
  enabled?: boolean;
  aiEnabled?: boolean;
  aiProvider?: string;
  aiModel?: string;
  sortOrder?: number;
}

/**
 * @description 工作区 Agent 服务，维护租户级 Agent 通讯录；租户首次读取时写入默认目录，
 *   之后完全以库中数据为准，可增删改
 * @keyword-en workspace agent service
 * @keyword-cn 工作区Agent服务
 */
@Injectable()
export class WorkspaceAgentService {
  private readonly agents: Collection<WorkspaceAgentEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly context: WorkspaceCollabContextService,
  ) {
    this.agents = db.collection<WorkspaceAgentEntity>('workspace_agents');
    void this.ensureIndexes();
  }

  /**
   * @description 初始化 Agent 索引
   * @keyword-en ensure workspace agent indexes
   * @keyword-cn 初始化Agent索引
   */
  async ensureIndexes(): Promise<void> {
    await this.agents.createIndex({ tenantId: 1, key: 1 }, { unique: true });
    await this.agents.createIndex({ tenantId: 1, sortOrder: 1 });
  }

  /**
   * @description Agent 通讯录(按工作区校验访问边界，数据为租户级)
   * @keyword-en list workspace agents
   * @keyword-cn Agent通讯录
   */
  async list(
    currentUser: AdminUserEntity,
    workspaceId: string,
  ): Promise<WorkspaceAgentEntity[]> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    await this.ensureSeed(workspace.tenantId);
    return this.agents
      .find({ tenantId: workspace.tenantId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .toArray();
  }

  /**
   * @description 按键读取租户内 Agent(内部使用，不做工作区校验)
   * @keyword-en get workspace agent by key
   * @keyword-cn 按键读取Agent
   */
  async getByKey(
    tenantId: string,
    key: string,
  ): Promise<WorkspaceAgentEntity | null> {
    await this.ensureSeed(tenantId);
    return this.agents.findOne({ tenantId, key });
  }

  /**
   * @description 新增 Agent
   * @keyword-en create workspace agent
   * @keyword-cn 新增Agent
   */
  async create(
    currentUser: AdminUserEntity,
    workspaceId: string,
    input: CreateWorkspaceAgentInput,
  ): Promise<WorkspaceAgentEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    await this.ensureSeed(workspace.tenantId);
    const last = await this.agents
      .find({ tenantId: workspace.tenantId })
      .sort({ sortOrder: -1 })
      .limit(1)
      .toArray();
    const now = new Date();
    const doc: WorkspaceAgentEntity = {
      _id: new ObjectId(),
      tenantId: workspace.tenantId,
      key: input.key.trim(),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      icon: input.icon?.trim() || 'bot',
      accent: input.accent?.trim() || 'chat',
      enabled: true,
      aiEnabled: input.aiEnabled ?? false,
      aiProvider: input.aiProvider?.trim() || WORKSPACE_AGENT_DEFAULT_PROVIDER,
      aiModel: input.aiModel?.trim() || WORKSPACE_AGENT_DEFAULT_MODEL,
      sortOrder: (last[0]?.sortOrder ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.agents.insertOne(doc);
    } catch {
      throw new BadRequestException('AGENT_KEY_ALREADY_EXISTS');
    }
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.agentCreate,
      'workspace_agent',
      String(doc._id),
      { workspaceId, key: doc.key, name: doc.name },
    );
    return doc;
  }

  /**
   * @description 更新 Agent(可用状态、AI 接入开关与运行时参数)
   * @keyword-en update workspace agent
   * @keyword-cn 更新Agent
   */
  async update(
    currentUser: AdminUserEntity,
    workspaceId: string,
    agentId: string,
    input: UpdateWorkspaceAgentInput,
  ): Promise<WorkspaceAgentEntity> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string') updates.name = input.name.trim();
    if (typeof input.description === 'string') {
      updates.description = input.description.trim();
    }
    if (typeof input.icon === 'string') updates.icon = input.icon.trim();
    if (typeof input.accent === 'string') updates.accent = input.accent.trim();
    if (typeof input.enabled === 'boolean') updates.enabled = input.enabled;
    if (typeof input.aiEnabled === 'boolean')
      updates.aiEnabled = input.aiEnabled;
    if (typeof input.aiProvider === 'string') {
      updates.aiProvider = input.aiProvider.trim();
    }
    if (typeof input.aiModel === 'string')
      updates.aiModel = input.aiModel.trim();
    if (typeof input.sortOrder === 'number')
      updates.sortOrder = input.sortOrder;

    const res = await this.agents.findOneAndUpdate(
      {
        _id: this.context.toId(agentId, 'INVALID_AGENT_ID'),
        tenantId: workspace.tenantId,
      },
      { $set: updates },
      { returnDocument: 'after' },
    );
    if (!res) throw new NotFoundException('AGENT_NOT_FOUND');
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.agentUpdate,
      'workspace_agent',
      agentId,
      { workspaceId, ...updates },
    );
    return res;
  }

  /**
   * @description 删除 Agent(历史会话保留冗余的 Agent 名，不做级联删除)
   * @keyword-en delete workspace agent
   * @keyword-cn 删除Agent
   */
  async remove(
    currentUser: AdminUserEntity,
    workspaceId: string,
    agentId: string,
  ): Promise<boolean> {
    const workspace = await this.context.requireWorkspace(
      currentUser,
      workspaceId,
    );
    const res = await this.agents.findOneAndDelete({
      _id: this.context.toId(agentId, 'INVALID_AGENT_ID'),
      tenantId: workspace.tenantId,
    });
    if (!res) return false;
    await this.context.audit(
      currentUser,
      WORKSPACE_COLLAB_AUDIT_ACTIONS.agentDelete,
      'workspace_agent',
      agentId,
      { workspaceId, key: res.key },
    );
    return true;
  }

  /**
   * @description 租户首次使用时写入默认 Agent 目录(已有数据则跳过)
   * @keyword-en ensure workspace agent seed
   * @keyword-cn 初始化Agent目录
   */
  private async ensureSeed(tenantId: string): Promise<void> {
    const existing = await this.agents.countDocuments(
      { tenantId },
      { limit: 1 },
    );
    if (existing > 0) return;
    const now = new Date();
    const docs: WorkspaceAgentEntity[] = DEFAULT_WORKSPACE_AGENTS.map(
      (seed) => ({
        _id: new ObjectId(),
        tenantId,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        accent: seed.accent,
        enabled: true,
        aiEnabled: seed.aiEnabled,
        aiProvider: WORKSPACE_AGENT_DEFAULT_PROVIDER,
        aiModel: WORKSPACE_AGENT_DEFAULT_MODEL,
        sortOrder: seed.sortOrder,
        createdAt: now,
        updatedAt: now,
      }),
    );
    try {
      await this.agents.insertMany(docs, { ordered: false });
    } catch {
      // 并发首次访问时唯一索引会拒绝重复种子，此处忽略即可
    }
  }
}
