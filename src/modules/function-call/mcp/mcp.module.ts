import { Module } from '@nestjs/common';
import { McpFunctionCallService } from './services/mcp.service.js';
import { McpStorageService } from './services/mcp-storage.service.js';
import { McpProcessService } from './services/mcp-process.service.js';
import { McpAdaptersService } from './services/mcp-adapter.service.js';

/**
 * @description MCP 功能模块，提供基于专用文件目录的资源检索、读取与录入工具。
 * @keyword mcp, tools, resources
 * @since 2026-01-24
 */
@Module({
  imports: [],
  providers: [
    McpFunctionCallService,
    McpStorageService,
    McpProcessService,
    McpAdaptersService,
  ],
  exports: [McpFunctionCallService, McpAdaptersService],
})
export class McpFunctionCallModule {}
