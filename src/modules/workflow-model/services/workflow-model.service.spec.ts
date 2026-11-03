jest.mock('../../admin/services/admin.service', () => ({
  AdminService: class {},
}));

import type { Db } from 'mongodb';
import type { AdminService } from '../../admin/services/admin.service';
import type { AdminUserEntity } from '../../admin/entities/admin.entity';
import {
  isWorkflowRuntimeSupported,
  toWorkflowLlmConfig,
  WorkflowModelService,
} from './workflow-model.service';
import {
  WORKFLOW_MODEL_CATALOG,
  WORKFLOW_NODES,
} from '../entities/workflow-model.entity';

type Row = Record<string, unknown>;

/**
 * @description 构造只支持本服务用到的几个方法的内存集合。
 * @keyword-cn 内存集合, 测试替身
 * @keyword-en in-memory-collection, test-double
 */
function memoryCollection(rows: Row[]) {
  const match = (row: Row, filter: Row) =>
    Object.entries(filter).every(([key, value]) => row[key] === value);
  return {
    createIndex: jest.fn().mockResolvedValue('ok'),
    find: () => ({ toArray: async () => rows }),
    findOne: async (filter: Row) =>
      rows.find((row) => match(row, filter)) ?? null,
    updateOne: async (
      filter: Row,
      update: { $set?: Row; $setOnInsert?: Row },
    ) => {
      const existing = rows.find((row) => match(row, filter));
      if (existing) Object.assign(existing, update.$set);
      else rows.push({ ...filter, ...update.$setOnInsert, ...update.$set });
      return { upsertedCount: existing ? 0 : 1 };
    },
    deleteOne: async (filter: Row) => {
      const index = rows.findIndex((row) => match(row, filter));
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

const providers: Record<string, Row> = {
  aaaaaaaaaaaaaaaaaaaaaaaa: {
    providerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    providerCode: 'doubao',
    name: '豆包生图',
    modelCategory: 'image',
    model: 'seedream-4',
    apiKey: 'k1',
    baseUrl: 'https://ark',
  },
  bbbbbbbbbbbbbbbbbbbbbbbb: {
    providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    providerCode: 'pixmax',
    name: 'PixMax 生图',
    modelCategory: 'image',
    model: '',
    apiKey: 'k2',
    baseUrl: 'https://app.pixmax.cn',
  },
  cccccccccccccccccccccccc: {
    providerId: 'cccccccccccccccccccccccc',
    providerCode: 'deepseek',
    name: 'DeepSeek',
    modelCategory: 'llm',
    model: 'deepseek-chat',
    apiKey: 'k3',
  },
};

/**
 * @description 构造带内存集合与假 AdminService 的服务实例。
 * @keyword-cn 构造测试服务, 假提供商
 * @keyword-en build-test-service, fake-provider
 */
function buildService(rows: Row[] = []) {
  const admin = {
    getAiProviderRuntimeById: jest.fn(
      async (id: string) => providers[id] ?? null,
    ),
    listAiProviders: jest.fn(async () => []),
    getDefaultAiProvider: jest.fn(async () => null),
    getDefaultImageProviderRuntime: jest.fn(async () => null),
  };
  const db = { collection: () => memoryCollection(rows) } as unknown as Db;
  const service = new WorkflowModelService(
    db,
    admin as unknown as AdminService,
  );
  return { service, rows };
}

const user = { _id: 'u1' } as unknown as AdminUserEntity;

describe('workflow model service', () => {
  it('没设置时返回 null，业务回退默认提供商', async () => {
    const { service } = buildService();
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'image'),
    ).resolves.toBeNull();
    expect(toWorkflowLlmConfig(null)).toEqual({});
  });

  it('保存后按节点返回指定提供商与模型，模型留空用提供商默认模型', async () => {
    const { service } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'image', {
      providerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const runtime = await service.resolveNodeRuntime(
      'douyin-workbench',
      'image',
    );
    expect(runtime).toMatchObject({
      providerCode: 'doubao',
      model: 'seedream-4',
      apiKey: 'k1',
    });
  });

  it('提供商类型与节点不一致时拒绝保存', async () => {
    const { service } = buildService();
    await expect(
      service.saveNode(user, 'douyin-workbench', 'image', {
        providerId: 'cccccccccccccccccccccccc',
      }),
    ).rejects.toThrow('WORKFLOW_PROVIDER_CATEGORY_MISMATCH');
  });

  it('没有默认模型且未填写模型时拒绝保存', async () => {
    const { service } = buildService();
    await expect(
      service.saveNode(user, 'douyin-workbench', 'image', {
        providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).rejects.toThrow('WORKFLOW_MODEL_REQUIRED');
  });

  it('运行时暂不支持的组合可以保存，但调用时报错而不是静默降级', async () => {
    const { service } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'image', {
      providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      model: 'DOUBAO_SEEDREAM_5_PRO',
    });
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'image'),
    ).rejects.toThrow('WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:image:pixmax');
  });

  it('指定的提供商被删除或停用时回退默认', async () => {
    const { service } = buildService([
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'think',
        providerId: 'dddddddddddddddddddddddd',
        model: 'x',
      },
    ]);
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'think'),
    ).resolves.toBeNull();
  });

  it('恢复默认后节点不再有设置；未知节点报错', async () => {
    const { service, rows } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'think', {
      providerId: 'cccccccccccccccccccccccc',
    });
    expect(rows).toHaveLength(1);
    await service.resetNode(user, 'douyin-workbench', 'think');
    expect(rows).toHaveLength(0);
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'unknown'),
    ).rejects.toThrow('WORKFLOW_NODE_NOT_FOUND');
  });

  it('运行时支持矩阵：文本排除 PixMax，生图与生视频放行数眼智能', () => {
    expect(isWorkflowRuntimeSupported('llm', 'deepseek')).toBe(true);
    expect(isWorkflowRuntimeSupported('llm', 'PixMax')).toBe(false);
    expect(isWorkflowRuntimeSupported('image', 'openai')).toBe(true);
    expect(isWorkflowRuntimeSupported('image', 'shuyan')).toBe(true);
    expect(isWorkflowRuntimeSupported('image', 'ShuyanAI')).toBe(true);
    expect(isWorkflowRuntimeSupported('image', 'pixmax')).toBe(false);
    expect(isWorkflowRuntimeSupported('video', 'pixmax')).toBe(true);
    expect(isWorkflowRuntimeSupported('video', 'shuyan')).toBe(true);
    expect(isWorkflowRuntimeSupported('video', 'openai')).toBe(false);
  });

  it('节点登记了可用提供商时按节点收窄：生视频收 PixMax / 数眼 / 自建 MiniMax-H3，音色克隆只收百炼', () => {
    const nodes = WORKFLOW_MODEL_CATALOG.find(
      (workflow) => workflow.key === WORKFLOW_NODES.douyinWorkbench.key,
    )!.nodes;
    const providersOf = (key: string) =>
      nodes.find((node) => node.key === key)?.runtimeProviders;
    expect(
      isWorkflowRuntimeSupported(
        'video',
        'shuyan',
        providersOf(WORKFLOW_NODES.douyinWorkbench.storeVisitVideo),
      ),
    ).toBe(true);
    expect(
      isWorkflowRuntimeSupported(
        'video',
        'pixmax',
        providersOf(WORKFLOW_NODES.douyinWorkbench.video),
      ),
    ).toBe(true);
    expect(
      isWorkflowRuntimeSupported(
        'video',
        'opensource-video',
        providersOf(WORKFLOW_NODES.douyinWorkbench.video),
      ),
    ).toBe(true);
    expect(
      isWorkflowRuntimeSupported(
        'video',
        'digital-human',
        providersOf(WORKFLOW_NODES.douyinWorkbench.storeVisitVideo),
      ),
    ).toBe(false);
    expect(
      isWorkflowRuntimeSupported(
        'audio',
        'DashScope',
        providersOf(WORKFLOW_NODES.douyinWorkbench.voiceClone),
      ),
    ).toBe(true);
    expect(
      isWorkflowRuntimeSupported(
        'audio',
        'digital-human',
        providersOf(WORKFLOW_NODES.douyinWorkbench.voiceClone),
      ),
    ).toBe(false);
    expect(isWorkflowRuntimeSupported('audio', 'openai')).toBe(false);
    expect(isWorkflowRuntimeSupported('llm', 'dashscope')).toBe(true);
  });

  it('节点只按能力分四类，常量（含旧步骤别名）去重后与工作流目录一一对应', () => {
    const fromConstants = [
      ...new Set(
        Object.values(WORKFLOW_NODES).flatMap(({ key, ...nodes }) =>
          Object.values(nodes).map((node) => `${key}/${node}`),
        ),
      ),
    ].sort();
    const fromCatalog = WORKFLOW_MODEL_CATALOG.flatMap((workflow) =>
      workflow.nodes.map((node) => `${workflow.key}/${node.key}`),
    ).sort();
    expect(fromConstants).toEqual(fromCatalog);
  });
  it('旧节点设置并入新节点：按顺序取第一个有设置的旧节点，新节点已有设置不动，可重复执行', async () => {
    const rows: Row[] = [
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'script',
        providerId: 'cccccccccccccccccccccccc',
        model: 'deepseek-chat',
      },
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'store-visit-continuity',
        providerId: 'cccccccccccccccccccccccc',
        model: 'deepseek-vl',
      },
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'shot-image',
        providerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        model: 'seedream-4',
      },
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'image',
        providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        model: 'already-set',
      },
      {
        workflowKey: 'xhs-article',
        nodeKey: 'image-decision',
        providerId: 'cccccccccccccccccccccccc',
        model: 'xhs-fast',
      },
    ];
    const { service } = buildService(rows);
    await service.ensureIndexes();
    await service.mergeLegacyBindings();
    const pick = (workflowKey: string, nodeKey: string) =>
      rows.filter(
        (row) => row.workflowKey === workflowKey && row.nodeKey === nodeKey,
      );
    expect(pick('douyin-workbench', 'think').map((row) => row.model)).toEqual([
      'deepseek-vl',
    ]);
    expect(pick('douyin-workbench', 'image').map((row) => row.model)).toEqual([
      'already-set',
    ]);
    expect(pick('douyin-workbench', 'video')).toHaveLength(0);
    expect(pick('xhs-article', 'think').map((row) => row.model)).toEqual([
      'xhs-fast',
    ]);
    expect(pick('douyin-workbench', 'script')).toHaveLength(1);
  });
});
