import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { McpFunctionCallModule } from '../function-call/mcp/mcp.module.js';
import { BatchTaskController } from './controller/batch-task.controller.js';
import { BatchTaskService } from './services/batch-task.service.js';

@Module({
  imports: [DataSourceModule, TodoModule, McpFunctionCallModule],
  controllers: [BatchTaskController],
  providers: [BatchTaskService],
  exports: [BatchTaskService],
})
export class BatchTaskModule {}
