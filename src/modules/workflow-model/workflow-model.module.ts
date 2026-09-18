import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { WorkflowModelAdminController } from './controller/workflow-model-admin.controller.js';
import { WorkflowModelService } from './services/workflow-model.service.js';

/**
 * @description 装配预设工作流节点模型设置，导出 `WorkflowModelService` 供业务模块按节点取模型。
 * @keyword-cn 工作流节点模型模块, 按节点取模型
 * @keyword-en workflow-model-module, per-node-model
 */
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [WorkflowModelAdminController],
  providers: [WorkflowModelService],
  exports: [WorkflowModelService],
})
export class WorkflowModelModule {}
