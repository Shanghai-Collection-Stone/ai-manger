import { Module } from '@nestjs/common';
import { AnalysisFunctionCallService } from './services/analysis.service.js';
import { AiAgentModule } from '../../ai-agent/ai-agent.module.js';
import { SchemaFunctionCallModule } from '../schema/schema.module.js';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { SuperPartySourceModule } from '../../data-source/sources/super-party/super-party-source.module.js';
import { FeishuBitableSourceModule } from '../../data-source/sources/feishu-bitable/feishu-bitable-source.module.js';
import { SkillThoughtModule } from '../../skill-thought/skill-thought.module.js';

/**
 * @title 数据分析函数调用模块 Analysis Function Call Module
 * @description 集中管理所有数据源的分析工具，方便思维链接入。
 * @keywords-cn 数据分析, 函数调用, 数据源
 * @keywords-en data analysis, function call, data source
 */
@Module({
  imports: [
    AiAgentModule,
    SchemaFunctionCallModule,
    DataSourceModule,
    SuperPartySourceModule,
    FeishuBitableSourceModule,
    SkillThoughtModule,
  ],
  providers: [AnalysisFunctionCallService],
  exports: [AnalysisFunctionCallService],
})
export class AnalysisFunctionCallModule {}
