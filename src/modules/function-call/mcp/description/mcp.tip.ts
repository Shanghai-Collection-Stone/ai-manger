/**
 * @description MCP 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword mcp, module, tip
 * @since 2026-01-24
 */
export const moduleTip = {
  moduleName: 'MCP-Function-Call',
  purpose: '为 AI Agent 提供 MCP 资源检索/读取与专用文件录入能力',
  description:
    '该模块实现一组与 MCP 兼容的工具：列出资源、读取资源以及将文本/二进制文件录入到专用目录中。AI Agent 可直接调用这些工具以访问或管理上下文资源。',
  keywords: ['mcp', 'resources', 'ingest', 'tool', 'function-call'],
  dependencies: ['@nestjs/common', 'langchain', 'zod', 'node:fs', 'node:path'],
  lastUpdated: '2026-01-24',
  files: {
    '服务/Service': 'src/modules/function-call/mcp/services/mcp.service.ts',
    '存储/Storage':
      'src/modules/function-call/mcp/services/mcp-storage.service.ts',
    '进程/Process':
      'src/modules/function-call/mcp/services/mcp-process.service.ts',
    '模块/Module': 'src/modules/function-call/mcp/mcp.module.ts',
  },
};
