import { Module } from '@nestjs/common';
import { FrontendFunctionCallService } from './services/frontend.service.js';
import { AiAgentModule } from '../../ai-agent/ai-agent.module.js';
import { SchemaFunctionCallModule } from '../schema/schema.module.js';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { FrontendJobsController } from './controller/jobs.controller.js';

@Module({
  imports: [AiAgentModule, DataSourceModule, SchemaFunctionCallModule],
  controllers: [FrontendJobsController],
  providers: [FrontendFunctionCallService],
  exports: [FrontendFunctionCallService],
})
export class FrontendFunctionCallModule {}
