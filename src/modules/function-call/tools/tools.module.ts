import { Module } from '@nestjs/common';
import { ToolsService } from './services/tools.service.js';
import { FrontendFunctionCallModule } from '../frontend/frontend.module.js';
import { AnalysisFunctionCallModule } from '../analysis/analysis.module.js';
import { TitleFunctionCallModule } from '../title/title.module.js';
import { SkillThoughtModule } from '../../skill-thought/skill-thought.module.js';
import { McpFunctionCallModule } from '../mcp/mcp.module.js';
import { TodoFunctionCallModule } from '../todo/todo.module.js';
import { GraphModule } from '../../graph/graph.module.js';
import { GraphWorkflowFunctionCallService } from './services/graph-workflow.service.js';
import { CanvasModule } from '../../canvas/canvas.module.js';
import { GalleryModule } from '../../gallery/gallery.module.js';

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
    TodoFunctionCallModule,
    GraphModule,
    CanvasModule,
    GalleryModule,
  ],
  providers: [ToolsService, GraphWorkflowFunctionCallService],
  exports: [ToolsService],
})
export class FunctionCallToolsModule {}
