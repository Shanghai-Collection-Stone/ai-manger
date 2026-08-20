import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ChatMainModule } from '../chat-main/chat-main.module.js';
import { WorkspaceCollabController } from './controller/workspace-collab.controller.js';
import { WorkspaceCollabContextService } from './services/workspace-collab-context.service.js';
import { WorkspaceAgentService } from './services/workspace-agent.service.js';
import { WorkspaceConversationService } from './services/workspace-conversation.service.js';
import { WorkspaceTaskService } from './services/workspace-task.service.js';

/**
 * @description 工作区协作模块(v2)，工作区内页的 Agent 通讯录、会话消息与任务跟进；
 *   依赖工作区模块做租户/工作区边界校验，依赖 chat-main 为已接入 AI 的 Agent 生成真实回复
 * @keyword-en workspace collab module
 * @keyword-cn 工作区协作模块
 */
@Module({
  imports: [
    DataSourceModule,
    AdminModule,
    AuditLogModule,
    WorkspaceModule,
    ChatMainModule,
  ],
  controllers: [WorkspaceCollabController],
  providers: [
    WorkspaceCollabContextService,
    WorkspaceAgentService,
    WorkspaceConversationService,
    WorkspaceTaskService,
  ],
  exports: [WorkspaceAgentService, WorkspaceTaskService],
})
export class WorkspaceCollabModule {}
