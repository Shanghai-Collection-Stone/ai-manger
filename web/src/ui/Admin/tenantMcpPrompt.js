/**
 * @description 生成可交给 Muse 等 Agent 的 MCP 接入提示词，包含协议、授权工具说明和失败排查。
 * @keyword-cn MCP接入提示词, 工具说明
 * @keyword-en mcp-connection-prompt, tool-description
 */
export function buildTenantMcpPrompt({
  url,
  secret,
  permissions = [],
  tools = [],
}) {
  const authorization = `Bearer ${secret || '<YOUR_MCP_KEY>'}`;
  const allowedTools = permissions.map((name) => {
    const tool = tools.find((item) => item.name === name);
    return `- ${name}${tool?.title ? `（${tool.title}）` : ''}：${tool?.description || '具体用途和参数以 tools/list 返回的 description、inputSchema 为准。'}`;
  });
  return [
    '请将下面的租户业务 MCP 接入当前 Agent，并先完成工具发现，再按我的业务需求调用工具。',
    '',
    '连接信息：',
    `- MCP 地址：${url}`,
    '- 传输协议：Streamable HTTP。',
    '- 鉴权方式：每次请求携带 Authorization: Bearer <完整MCP密钥>。',
    secret
      ? '- 下方配置已包含此连接的完整 MCP 密钥，只用于本连接的鉴权。'
      : '- 下方 <YOUR_MCP_KEY> 是占位符，请让我在客户端凭证设置中填入已保存的完整 MCP 密钥；不要把占位符当作有效密钥，也不要用密钥前缀代替。',
    '- 连接地址必须能从 Agent 的执行环境访问；云端 Agent 无法访问我电脑上的 localhost/127.0.0.1，遇到此情况应报告地址不可达并请求部署地址。',
    '',
    '客户端连接配置（字段位置按当前客户端的配置格式填写）：',
    '```json',
    JSON.stringify(
      {
        mcpServers: {
          'tenant-articles': { url, headers: { Authorization: authorization } },
        },
      },
      null,
      2,
    ),
    '```',
    '',
    '协议与工具发现步骤：',
    '1. 优先使用客户端的标准 MCP SDK 建立连接。初始化请求 initialize 可使用协议版本 2025-11-25，初始化后发送 notifications/initialized，并在后续请求的 MCP-Protocol-Version 中使用实际协商版本。',
    '2. 所有 JSON-RPC 消息均通过 HTTP POST 发到上面的 MCP 地址本身，不要拼接 /tools/list、/tool/list 或 /sse 路径。',
    '3. 请求头包括 Authorization、Content-Type: application/json、Accept: application/json, text/event-stream。服务端可能返回 application/json，应正常解析。',
    '4. 工具发现的方法名必须是 tools/list（tools 是复数），不是 tool/list。它是协议方法，不是需要在业务工具列表中寻找的工具。请求体示例：',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    '5. 从 result.tools 读取工具的 name、title、description 和 inputSchema；description 说明工具作用，inputSchema 说明参数。按实际返回的 schema 构造参数，再使用 tools/call 调用：',
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: '<从tools/list中选择的工具名>', arguments: {} },
    }),
    '6. 只有工具发现和鉴权确实成功后才能报告接入完成；如果客户端无法发起此类连接，请明确说明原因，不要虚构工具列表或执行结果。',
    '',
    '此密钥已配置的工具权限及用途（以实时 tools/list 返回为准）：',
    ...(allowedTools.length
      ? allowedTools
      : [
          '- 当前未分配任何工具权限，认证成功也会返回 result.tools=[]；需要管理员为此密钥勾选工具权限后重新发现工具。',
        ]),
    '',
    '业务使用说明：',
    '- 工具只能访问该密钥所属租户的数据。只调用 tools/list 实际返回的工具，不能通过修改 tenantId/userId 扩大权限。',
    '- “发布文章”表示存入文章库等待扫码发布，不表示已经发布到小红书。',
    '- 发布二维码工具返回二维码内容或小程序链接，不直接返回 PNG 图片；仅当 qrContentType=xhs-miniapp-url 且 xhsQrcodeUrl 非空时，才拿到了小程序二维码链接。',
    '- 抓取目标必须是有有效小红书 NoteId 的已发布文章。同步抓取返回本次数据；异步抓取返回 taskId、completed=false，可使用已授权的 article_recent_data 携带 articleId/taskId 查询后续状态和数据。若缺少轮询工具权限，应提示补充授权。',
    '',
    '连接失败时请保留 HTTP 状态和 JSON-RPC 错误原文，并隐去密钥：',
    '- result.tools=[]：当前密钥没有工具权限，不能据此判断服务不符合 MCP 标准。',
    '- JSON-RPC -32601：方法不存在，检查是否把 tools/list 拼成了 tool/list。',
    '- JSON-RPC -32602：工具名或参数无效；工具也可能未被当前密钥授权，以实时工具目录为准。',
    '- HTTP 401：检查完整密钥、Bearer 格式、链接与密钥是否匹配，以及密钥/链接是否停用或过期。',
    '- HTTP 403：检查 Origin 来源校验。HTTP 404：检查连接地址和部署版本。HTTP 406：检查 Accept 是否同时包含 application/json 和 text/event-stream。',
    '- GET/DELETE 返回 405 是本服务无状态 Streamable HTTP 的预期行为，不表示 POST tools/list 不可用；不要配置成旧式 SSE 连接。',
    '- 修改权限后刷新或重新连接，以更新客户端缓存的工具目录。',
  ].join('\n');
}
