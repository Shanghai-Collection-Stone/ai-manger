import { Module } from '@nestjs/common';
import { ToolsService } from './services/tools.service.js';
import { FrontendFunctionCallModule } from '../frontend/frontend.module.js';
import { AnalysisFunctionCallModule } from '../analysis/analysis.module.js';
import { TitleFunctionCallModule } from '../title/title.module.js';
import { SkillThoughtModule } from '../../skill-thought/skill-thought.module.js';
import { McpFunctionCallModule } from '../mcp/mcp.module.js';

/**
 * @title 工具模块 Tools Module
 * @description 所有数据源工具已集中到 AnalysisFunctionCallModule。
 */
@Module({
  imports: [
    FrontendFunctionCallModule,
    AnalysisFunctionCallModule,
    TitleFunctionCallModule,
    SkillThoughtModule,
    McpFunctionCallModule,
  ],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class FunctionCallToolsModule {}
