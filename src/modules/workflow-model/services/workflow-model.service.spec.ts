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
      update: { $set: Row; $setOnInsert: Row },
    ) => {
      const existing = rows.find((row) => match(row, filter));
      if (existing) Object.assign(existing, update.$set);
      else rows.push({ ...filter, ...update.$setOnInsert, ...update.$set });
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
      service.resolveNodeRuntime('douyin-workbench', 'shot-image'),
    ).resolves.toBeNull();
    expect(toWorkflowLlmConfig(null)).toEqual({});
  });

  it('保存后按节点返回指定提供商与模型，模型留空用提供商默认模型', async () => {
    const { service } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'shot-image', {
      providerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const runtime = await service.resolveNodeRuntime(
      'douyin-workbench',
      'shot-image',
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
      service.saveNode(user, 'douyin-workbench', 'shot-image', {
        providerId: 'cccccccccccccccccccccccc',
      }),
    ).rejects.toThrow('WORKFLOW_PROVIDER_CATEGORY_MISMATCH');
  });

  it('没有默认模型且未填写模型时拒绝保存', async () => {
    const { service } = buildService();
    await expect(
      service.saveNode(user, 'douyin-workbench', 'shot-image', {
        providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).rejects.toThrow('WORKFLOW_MODEL_REQUIRED');
  });

  it('运行时暂不支持的组合可以保存，但调用时报错而不是静默降级', async () => {
    const { service } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'shot-image', {
      providerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      model: 'DOUBAO_SEEDREAM_5_PRO',
    });
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'shot-image'),
    ).rejects.toThrow('WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:image:pixmax');
  });

  it('指定的提供商被删除或停用时回退默认', async () => {
    const { service } = buildService([
      {
        workflowKey: 'douyin-workbench',
        nodeKey: 'script',
        providerId: 'dddddddddddddddddddddddd',
        model: 'x',
      },
    ]);
    await expect(
      service.resolveNodeRuntime('douyin-workbench', 'script'),
    ).resolves.toBeNull();
  });

  it('恢复默认后节点不再有设置；未知节点报错', async () => {
    const { service, rows } = buildService();
    await service.saveNode(user, 'douyin-workbench', 'script', {
      providerId: 'cccccccccccccccccccccccc',
    });
    expect(rows).toHaveLength(1);
    await service.resetNode(user, 'douyin-workbench', 'script');
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

  it('节点 key 常量与工作流目录一一对应', () => {
    const fromConstants = Object.values(WORKFLOW_NODES)
      .flatMap(({ key, ...nodes }) =>
        Object.values(nodes).map((node) => `${key}/${node}`),
      )
      .sort();
    const fromCatalog = WORKFLOW_MODEL_CATALOG.flatMap((workflow) =>
      workflow.nodes.map((node) => `${workflow.key}/${node.key}`),
    ).sort();
    expect(fromConstants).toEqual(fromCatalog);
  });
});
