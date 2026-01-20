import { Module } from '@nestjs/common';
import { AnalysisFunctionCallService } from './services/analysis.service.js';
import { AiAgentModule } from '../../ai-agent/ai-agent.module.js';
import { SchemaFunctionCallModule } from '../schema/schema.module.js';
import { MongoFunctionCallModule } from '../mongo/mongo.module.js';

@Module({
  imports: [AiAgentModule, SchemaFunctionCallModule, MongoFunctionCallModule],
  providers: [AnalysisFunctionCallService],
  exports: [AnalysisFunctionCallService],
})
export class AnalysisFunctionCallModule {}
