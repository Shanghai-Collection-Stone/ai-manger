import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { GalleryToolsService } from './gallery-tools.service.js';
import { XhsToolsService } from './xhs-tools.service.js';

/**
 * @title Media Agent Service
 * @description 媒体 Agent 服务，聚合图库和小红书工具的 Agent 能力
 * @keywords-cn media-agent, gallery, xhs, langchain, deepagent
 * @keywords-en media-agent, gallery, xhs, langchain, deepagent
 */
@Injectable()
export class MediaAgentService {
  constructor(
    private readonly agentService: AgentService,
    private readonly galleryTools: GalleryToolsService,
    private readonly xhsTools: XhsToolsService,
  ) {}

  /**
   * @description 获取图库工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} 图库相关工具列表
   * @keyword-en get gallery tools handle
   * @since 2026-03-23
   */
  getGalleryToolsHandle(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }): CreateAgentParams['tools'] {
    return this.galleryTools.getHandle(scope);
  }

  /**
   * @description 获取小红书工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} XHS/Canvas 相关工具列表
   * @keyword-en get XHS tools handle
   * @since 2026-03-23
   */
  getXhsToolsHandle(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }): CreateAgentParams['tools'] {
    return this.xhsTools.getHandle(scope);
  }
}
