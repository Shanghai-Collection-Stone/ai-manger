import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 节点模型类型的中文名，与后端 `WorkflowNodeCategory` 一一对应
 * @keyword-cn 节点类型文案
 * @keyword-en node-category-labels
 */
const CATEGORY_LABELS = { llm: '文本', image: '生图', video: '生视频' };

/**
 * @description 记住上次选中工作流子菜单的本地存储 key
 * @keyword-cn 工作流菜单记忆
 * @keyword-en active-workflow-storage-key
 */
const ACTIVE_WORKFLOW_STORAGE_KEY = 'admin_workflow_models_active';

/**
 * @description 节点未设置时的回退说明文案
 * @keyword-cn 默认回退文案, 未设置说明
 * @keyword-en fallback-label, unset-hint
 * @param {object} node 节点视图。
 * @returns {string} 回退说明。
 */
function describeFallback(node) {
  if (node.fallback) {
    return `${node.fallback.providerName}${node.fallback.model ? ` · ${node.fallback.model}` : ''}`;
  }
  if (node.category === 'image') return '未配置默认生图提供商，走美图兜底';
  if (node.category === 'video') return '未指定时走环境变量配置的视频生成直连服务';
  return '未配置默认文本提供商';
}

/**
 * @description 单个节点的编辑行：选提供商 → 选（或填写）模型 → 保存 / 恢复默认
 * @keyword-cn 节点模型编辑行, 选择模型
 * @keyword-en node-model-row, pick-model
 * @param {{ workflowKey: string, node: object, providers: object[], busy: boolean, onSave: Function, onReset: Function, onError: Function }} props
 */
function NodeModelRow({ workflowKey, node, providers, busy, onSave, onReset, onError }) {
  const candidates = providers.filter((item) => item.category === node.category);
  const [providerId, setProviderId] = useState(node.binding?.providerId || '');
  const [model, setModel] = useState(node.binding?.model || '');
  const [models, setModels] = useState([]);
  const [allowCustom, setAllowCustom] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const provider = candidates.find((item) => item.id === providerId);
  const dirty =
    providerId !== (node.binding?.providerId || '') ||
    model.trim() !== (node.binding?.model || '');

  useEffect(() => {
    setProviderId(node.binding?.providerId || '');
    setModel(node.binding?.model || '');
  }, [node.binding?.providerId, node.binding?.model]);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setAllowCustom(true);
      return undefined;
    }
    let active = true;
    setLoadingModels(true);
    adminApi
      .listWorkflowProviderModels(providerId, node.category)
      .then((res) => {
        if (!active) return;
        setModels(res?.models || []);
        setAllowCustom(res?.allowCustom !== false);
      })
      .catch((err) => {
        if (!active) return;
        setModels([]);
        setAllowCustom(true);
        onError(`读取「${node.label}」可选模型失败：${err.message}`);
      })
      .finally(() => {
        if (active) setLoadingModels(false);
      });
    return () => {
      active = false;
    };
  }, [providerId, node.category]);

  /**
   * @description 切换提供商时预填它的默认模型
   * @keyword-cn 切换提供商, 预填模型
   * @keyword-en change-provider, prefill-model
   * @param {string} nextId 新提供商 ID。
   */
  const onChangeProvider = (nextId) => {
    setProviderId(nextId);
    const next = candidates.find((item) => item.id === nextId);
    setModel(next?.model || '');
  };

  const modelInList = models.some((item) => item.code === model);
  return (
    <div
      data-workflow-node={`${workflowKey}/${node.key}`}
      className="grid gap-3 border-t border-slate-100 py-3 lg:grid-cols-[14rem_1fr_auto] lg:items-start"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{node.label}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {CATEGORY_LABELS[node.category]}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{node.description}</p>
        <p className="mt-1 text-xs text-slate-400">
          {node.binding ? '已指定' : `未指定，使用默认：${describeFallback(node)}`}
        </p>
      </div>

      <div className="space-y-2">
        <select
          className="w-full rounded border px-3 py-2 text-sm"
          value={providerId}
          disabled={busy}
          onChange={(e) => onChangeProvider(e.target.value)}
        >
          <option value="">使用默认提供商</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}（{item.providerCode}）
              {item.isDefault ? ' · 默认' : ''}
              {item.runtimeSupported ? '' : ' · 运行时暂不支持'}
            </option>
          ))}
        </select>
        {providerId ? (
          <>
            {models.length ? (
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={modelInList ? model : ''}
                disabled={busy || loadingModels}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">{loadingModels ? '读取模型中…' : '选择模型'}</option>
                {models.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name === item.code ? item.code : `${item.name}（${item.code}）`}
                  </option>
                ))}
              </select>
            ) : null}
            {allowCustom ? (
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="模型名称，留空使用提供商默认模型"
                value={model}
                disabled={busy}
                onChange={(e) => setModel(e.target.value)}
              />
            ) : null}
            {!loadingModels && !allowCustom && !models.length ? (
              <p className="text-xs text-amber-600">该账号在 PixMax 没有可用的{CATEGORY_LABELS[node.category]}模型。</p>
            ) : null}
          </>
        ) : null}
        {provider && !provider.runtimeSupported ? (
          <p className="text-xs text-amber-600">
            {node.category === 'video'
              ? `业务侧的生视频目前只接入了 PixMax，「${provider.providerCode}」保存后调用这个节点会直接报错；请改选 PixMax。`
              : `可以先保存，但业务侧暂未接入「${provider.providerCode}」的${CATEGORY_LABELS[node.category]}调用，调用这个节点时会直接报错，不会悄悄换成其他模型。`}
          </p>
        ) : null}
        {node.binding && !node.binding.providerAvailable ? (
          <p className="text-xs text-red-600">
            之前指定的提供商已删除、停用或类型不符，当前实际回退默认提供商，请重新选择。
          </p>
        ) : null}
      </div>

      <div className="flex gap-2 lg:flex-col">
        <button
          disabled={busy || !providerId || !dirty || (!allowCustom && !model)}
          onClick={() => onSave(node, { providerId, model: model.trim() || undefined })}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-300"
        >
          保存
        </button>
        {node.binding ? (
          <button
            disabled={busy}
            onClick={() => onReset(node)}
            className="rounded border border-slate-200 px-4 py-2 text-sm text-slate-600"
          >
            恢复默认
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @description 后台「工作流节点模型」Tab：按预设工作流列出会调用模型的节点，为每个节点指定提供商与模型（仅超管）
 * @keyword-cn 工作流节点模型面板, 节点指定模型
 * @keyword-en workflow-model-panel, per-node-model
 * @param {{ onNotice: (text: string) => void, onError: (text: string) => void }} props
 */
export default function WorkflowModelPanel({ onNotice, onError }) {
  const [workflows, setWorkflows] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyNode, setBusyNode] = useState('');
  const [activeKey, setActiveKey] = useState(() => {
    try {
      return window.localStorage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  /**
   * @description 切换左侧工作流子菜单，并记住上次选择
   * @keyword-cn 切换工作流菜单, 记住选择
   * @keyword-en select-workflow-tab, remember-selection
   * @param {string} key 工作流 key。
   */
  const selectWorkflow = (key) => {
    setActiveKey(key);
    try {
      window.localStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, key);
    } catch {
      /* 存储不可用时只影响刷新后的默认选择 */
    }
  };

  /**
   * @description 用接口返回刷新工作流与提供商
   * @keyword-cn 回填节点设置
   * @keyword-en apply-workflow-models
   * @param {{ workflows?: object[], providers?: object[] }} res 接口返回。
   */
  const apply = (res) => {
    setWorkflows(res?.workflows || []);
    setProviders(res?.providers || []);
  };

  useEffect(() => {
    adminApi
      .listWorkflowModels()
      .then(apply)
      .catch((err) => onError(`读取工作流节点模型失败：${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  /**
   * @description 保存节点的提供商与模型
   * @keyword-cn 保存节点模型
   * @keyword-en save-node-model
   * @param {string} workflowKey 工作流 key。
   * @param {object} node 节点视图。
   * @param {{ providerId: string, model?: string }} payload 提交内容。
   */
  const onSave = async (workflowKey, node, payload) => {
    setBusyNode(`${workflowKey}/${node.key}`);
    try {
      apply(await adminApi.saveWorkflowNodeModel(workflowKey, node.key, payload));
      onNotice(`「${node.label}」已改用指定模型`);
    } catch (err) {
      onError(`保存「${node.label}」失败：${err.message}`);
    } finally {
      setBusyNode('');
    }
  };

  /**
   * @description 清除节点设置，回到默认提供商
   * @keyword-cn 恢复节点默认
   * @keyword-en reset-node-model
   * @param {string} workflowKey 工作流 key。
   * @param {object} node 节点视图。
   */
  const onReset = async (workflowKey, node) => {
    setBusyNode(`${workflowKey}/${node.key}`);
    try {
      apply(await adminApi.resetWorkflowNodeModel(workflowKey, node.key));
      onNotice(`「${node.label}」已恢复默认提供商`);
    } catch (err) {
      onError(`恢复「${node.label}」失败：${err.message}`);
    } finally {
      setBusyNode('');
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-slate-400">加载中…</div>;
  }
  const active = workflows.find((item) => item.key === activeKey) || workflows[0];
  return (
    <div className="grid gap-4 pb-8 md:grid-cols-[13rem_1fr]">
      <nav data-workflow-menu className="h-fit rounded-xl border border-slate-200 bg-white p-2">
        <div className="px-2 pb-2 pt-1 text-xs font-medium text-slate-400">工作流</div>
        {workflows.map((workflow) => {
          const assigned = workflow.nodes.filter((node) => node.binding).length;
          const selected = workflow.key === active?.key;
          return (
            <button
              key={workflow.key}
              type="button"
              data-workflow-tab={workflow.key}
              onClick={() => selectWorkflow(workflow.key)}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              <span className="block font-medium">{workflow.label}</span>
              <span className={`mt-0.5 block text-xs ${selected ? 'text-slate-300' : 'text-slate-400'}`}>
                {workflow.nodes.length} 个节点 · 已指定 {assigned}
              </span>
            </button>
          );
        })}
      </nav>

      {active ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">{active.label}</h2>
          <p className="mt-1 text-xs text-slate-500">{active.description}</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            不指定的节点使用「Ai提供商设置」里该类型的默认提供商。可选提供商来自已启用、类别一致的记录；PixMax 需按类别分别添加（生图、生视频各一条，providerCode 填 <code>pixmax</code>），选中后实时读取该账号可用的模型。
          </p>
          <div className="mt-3">
            {active.nodes.map((node) => (
              <NodeModelRow
                key={`${active.key}/${node.key}`}
                workflowKey={active.key}
                node={node}
                providers={providers}
                busy={busyNode === `${active.key}/${node.key}`}
                onSave={(target, payload) => onSave(active.key, target, payload)}
                onReset={(target) => onReset(active.key, target)}
                onError={onError}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">暂无预设工作流</div>
      )}
    </div>
  );
}
