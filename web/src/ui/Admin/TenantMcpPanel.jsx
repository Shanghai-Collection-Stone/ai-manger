import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';
import { buildTenantMcpPrompt } from './tenantMcpPrompt';

/** @keyword-en mcp-permission-picker, tool-permission */
function PermissionPicker({ tools, selected, onChange, disabled }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {tools.map((tool) => (
        <label
          key={tool.name}
          className="flex items-start gap-2 rounded border border-slate-200 p-2 text-xs"
          title={tool.description}
        >
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.includes(tool.name)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, tool.name]
                  : selected.filter((name) => name !== tool.name),
              )
            }
          />
          <span>
            {tool.title}
            <span className="block text-slate-400">{tool.name}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** @keyword-en mcp-key-editor, key-management */
function KeyEditor({
  item,
  tools,
  busy,
  onSave,
  onDelete,
  onCopyPrompt,
  onCopySecret,
  onRotate,
}) {
  const [permissions, setPermissions] = useState(item.permissions);
  const [name, setName] = useState(item.name);
  const [expiry, setExpiry] = useState(
    item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16) : '',
  );
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-sm">
        {item.name} · {item.prefix}… · {item.enabled ? '启用' : '停用'} ·{' '}
        {item.permissions.length} 项权限
        {item.expiresAt
          ? ` · 到期 ${new Date(item.expiresAt).toLocaleString()}`
          : ''}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <code className="break-all select-all">
          {item.secret ||
            '此密钥暂时无法显示，可成功调用一次后刷新，或重新生成。'}
        </code>
        <button
          disabled={busy || !item.secret}
          onClick={onCopySecret}
          className="text-blue-600"
        >
          复制密钥
        </button>
        <button
          disabled={busy || !item.secret}
          onClick={onCopyPrompt}
          className="text-blue-600"
        >
          复制接入提示词（含密钥）
        </button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-slate-500">
          编辑权限和有效期
        </summary>
        <div className="mt-3 space-y-3">
          <input
            aria-label="密钥名称"
            className="rounded border p-2 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
          <label className="ml-3 text-xs">
            过期时间（UTC，留空永久）{' '}
            <input
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              className="rounded border p-2"
            />
          </label>
          <PermissionPicker
            tools={tools}
            selected={permissions}
            onChange={setPermissions}
            disabled={busy}
          />
          <div className="flex gap-3 text-xs">
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `重新生成「${item.name}」的密钥后，旧密钥立即失效，需要更新已连接的客户端。继续？`,
                  )
                )
                  onRotate();
              }}
            >
              重新生成密钥
            </button>
            <button
              disabled={busy || !name.trim()}
              onClick={() =>
                onSave(item.id, {
                  name: name.trim(),
                  permissions,
                  expiresAt: expiry ? `${expiry}:00.000Z` : null,
                })
              }
              className="rounded bg-slate-900 px-3 py-2 text-white"
            >
              保存名称与权限
            </button>
            <button
              disabled={busy}
              onClick={() => onSave(item.id, { enabled: !item.enabled })}
            >
              {item.enabled ? '停用密钥' : '启用密钥'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `撤销密钥「${item.name}」？此操作将立即禁止后续调用。`,
                  )
                )
                  onDelete(item.id);
              }}
              className="text-red-600"
            >
              撤销密钥
            </button>
          </div>
          <p className="text-xs text-slate-400">
            最近调用：
            {item.lastUsedAt
              ? new Date(item.lastUsedAt).toLocaleString()
              : '尚无调用'}
          </p>
        </div>
      </details>
    </div>
  );
}

/** @keyword-en mcp-endpoint-editor, key-management */
function EndpointEditor({
  endpoint,
  tools,
  busy,
  mutate,
  onSecret,
  onCopyPrompt,
}) {
  const [name, setName] = useState(endpoint.name);
  const [keyName, setKeyName] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [expiresAt, setExpiresAt] = useState('');
  const path = `/endpoints/${endpoint.id}`;
  const url = endpoint.url.startsWith('http')
    ? endpoint.url
    : `${window.location.origin}${endpoint.path}`;

  /** @keyword-en mcp-create-key, recoverable-secret */
  async function createKey(event) {
    event.preventDefault();
    const result = await mutate(`${path}/keys`, 'POST', {
      name: keyName.trim(),
      permissions,
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    });
    if (result) {
      onSecret({
        secret: result.secret,
        url,
        permissions: result.key.permissions,
      });
      setKeyName('');
      setPermissions([]);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="链接名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          className="rounded border p-2 text-sm"
        />
        <button
          disabled={busy || !name.trim()}
          onClick={() => mutate(path, 'PATCH', { name: name.trim() })}
          className="text-xs"
        >
          保存名称
        </button>
        <span
          className={`text-xs ${endpoint.enabled ? 'text-green-700' : 'text-slate-400'}`}
        >
          {endpoint.enabled ? '链接已开放' : '链接已停用'}
        </span>
        <button
          disabled={busy}
          onClick={() => mutate(path, 'PATCH', { enabled: !endpoint.enabled })}
          className="text-xs"
        >
          {endpoint.enabled ? '停用链接' : '启用链接'}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (window.confirm(`删除链接「${endpoint.name}」及其所有密钥？`))
              mutate(path, 'DELETE');
          }}
          className="text-xs text-red-600"
        >
          删除链接
        </button>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <code className="break-all">{url}</code>
        <button
          onClick={() => navigator.clipboard.writeText(url)}
          className="text-blue-600"
        >
          复制链接
        </button>
      </div>
      <div className="space-y-2">
        {endpoint.keys.map((item) => (
          <KeyEditor
            key={`${item.id}-${item.name}-${JSON.stringify(item.permissions)}-${item.expiresAt}`}
            item={item}
            tools={tools}
            busy={busy}
            onSave={(id, data) => mutate(`${path}/keys/${id}`, 'PATCH', data)}
            onDelete={(id) => mutate(`${path}/keys/${id}`, 'DELETE')}
            onCopyPrompt={() =>
              onCopyPrompt({
                url,
                secret: item.secret,
                permissions: item.permissions,
              })
            }
            onCopySecret={() =>
              onCopyPrompt({ secretOnly: true, secret: item.secret })
            }
            onRotate={() => mutate(`${path}/keys/${item.id}/rotate`, 'POST')}
          />
        ))}
      </div>
      <form
        onSubmit={createKey}
        className="space-y-3 rounded border border-slate-200 bg-white p-3"
      >
        <p className="text-sm font-medium">新增密钥</p>
        <div className="flex flex-wrap gap-3">
          <input
            required
            placeholder="密钥名称，例如内容助手"
            aria-label="新密钥名称"
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            maxLength={100}
            className="rounded border p-2 text-sm"
          />
          <label className="text-xs">
            到期时间（本地，留空永久）{' '}
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="rounded border p-2"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          勾选允许此密钥使用的工具。新密钥默认没有权限。
        </p>
        <PermissionPicker
          tools={tools}
          selected={permissions}
          onChange={setPermissions}
          disabled={busy}
        />
        <button
          disabled={busy || !keyName.trim()}
          className="rounded bg-slate-900 px-3 py-2 text-xs text-white"
        >
          创建密钥
        </button>
      </form>
    </section>
  );
}

/** @keyword-en tenant-mcp-panel, key-management */
export default function TenantMcpPanel({
  currentRole,
  tenants = [],
  onNotice,
  onError,
}) {
  const [tenantId, setTenantId] = useState('');
  const [data, setData] = useState({ endpoints: [], tools: [] });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState(null);
  const platform = currentRole === 'super_admin';
  const ready = !platform || Boolean(tenantId);

  /** @keyword-en mcp-reload, key-management */
  async function reload() {
    setData(await adminApi.tenantMcp('', {}, tenantId));
  }

  useEffect(() => {
    let active = true;
    setSecret(null);
    setData({ endpoints: [], tools: [] });
    if (!ready) return undefined;
    setLoading(true);
    adminApi
      .tenantMcp('', {}, tenantId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active) onError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, ready]);

  /** @keyword-en mcp-mutation, key-management */
  async function mutate(path, method, body) {
    setBusy(true);
    onError('');
    try {
      const result = await adminApi.tenantMcp(
        path,
        { method, ...(body ? { body: JSON.stringify(body) } : {}) },
        tenantId,
      );
      // 先展示创建或重新生成的密钥，刷新失败时仍可复制。
      if (result?.secret)
        setSecret({
          secret: result.secret,
          url: data.endpoints.find((item) => path.includes(item.id))?.url || '',
          permissions: result.key.permissions,
        });
      try {
        await reload();
      } catch (error) {
        onError(`操作已成功，刷新失败：${error.message}`);
      }
      onNotice('MCP 配置已保存');
      return result;
    } catch (error) {
      onError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** @keyword-en mcp-create-endpoint, key-management */
  async function createEndpoint(event) {
    event.preventDefault();
    if (await mutate('/endpoints', 'POST', { name: name.trim() })) setName('');
  }

  /** @keyword-cn 复制接入提示词, 工具说明
   * @keyword-en copy-mcp-prompt, tool-description */
  async function copyPrompt(connection) {
    try {
      await navigator.clipboard.writeText(
        connection.secretOnly
          ? connection.secret
          : buildTenantMcpPrompt({ ...connection, tools: data.tools }),
      );
      onNotice(
        connection.secretOnly
          ? 'MCP 密钥已复制'
          : 'MCP 接入提示词已复制，包含完整密钥、连接步骤、已授权工具说明和排障信息',
      );
    } catch {
      onError('复制失败，请检查浏览器剪贴板权限后重试');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        每个租户可开放多个 MCP
        链接，每个链接可创建多把密钥并单独分配工具权限。连接方式为 Streamable
        HTTP，使用 Authorization: Bearer 密钥。
      </p>
      {platform ? (
        <label className="block text-sm">
          租户{' '}
          <select
            disabled={busy}
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="ml-2 rounded border p-2"
          >
            <option value="">请选择租户</option>
            {tenants.map((tenant) => (
              <option
                key={tenant.id || tenant._id}
                value={tenant.id || tenant._id}
              >
                {tenant.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {secret ? (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">
            密钥已保存，可随时在下方查看并复制接入提示词。
          </p>
          <code className="block break-all select-all">{secret.secret}</code>
          <button
            onClick={() => navigator.clipboard.writeText(secret.secret)}
            className="mr-4 text-blue-600"
          >
            复制密钥
          </button>
          <button
            onClick={() => copyPrompt(secret)}
            className="mr-4 text-blue-600"
          >
            复制接入提示词（含密钥）
          </button>
          <button
            onClick={() =>
              navigator.clipboard.writeText(
                JSON.stringify(
                  {
                    mcpServers: {
                      'tenant-articles': {
                        url: secret.url,
                        headers: { Authorization: `Bearer ${secret.secret}` },
                      },
                    },
                  },
                  null,
                  2,
                ),
              )
            }
            className="mr-4 text-blue-600"
          >
            复制客户端配置
          </button>
          <button onClick={() => setSecret(null)}>关闭提示</button>
        </div>
      ) : null}
      {ready ? (
        <>
          <form onSubmit={createEndpoint} className="flex gap-3">
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="新链接名称"
              aria-label="新链接名称"
              className="rounded border p-2 text-sm"
            />
            <button
              disabled={busy || loading || !name.trim()}
              className="rounded bg-slate-900 px-3 text-sm text-white"
            >
              新增 MCP 链接
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => reload().catch((error) => onError(error.message))}
              className="text-sm"
            >
              刷新
            </button>
          </form>
          {loading ? (
            <p className="text-sm text-slate-400">加载中…</p>
          ) : data.endpoints.length ? (
            data.endpoints.map((endpoint) => (
              <EndpointEditor
                key={`${tenantId}-${endpoint.id}`}
                endpoint={endpoint}
                tools={data.tools}
                busy={busy}
                mutate={mutate}
                onSecret={setSecret}
                onCopyPrompt={copyPrompt}
              />
            ))
          ) : (
            <p className="text-sm text-slate-400">还没有 MCP 链接。</p>
          )}
        </>
      ) : null}
    </div>
  );
}
