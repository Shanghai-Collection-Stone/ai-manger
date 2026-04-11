import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { BatchTaskModule } from '../batch-task/batch-task.module.js';
import { CanvasModule } from '../canvas/canvas.module.js';
import { FormatModule } from '../format/format.module';
import { AnalysisFunctionCallModule } from '../function-call/analysis/analysis.module.js';
import { McpFunctionCallModule } from '../function-call/mcp/mcp.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { SassModule } from '../sass/sass.module.js';
import { GraphController } from './controller/graph.controller.js';
import { ArticleGraphService } from './services/article-graph.service.js';
import { BatchTaskGraphService } from './services/batch-task-graph.service.js';

@Module({
  imports: [
    AiAgentModule,
    FormatModule,
    CanvasModule,
    GalleryModule,
    SassModule,
    BatchTaskModule,
    AnalysisFunctionCallModule,
    McpFunctionCallModule,
  ],
  controllers: [GraphController],
  providers: [
    ArticleGraphService,
    BatchTaskGraphService,
    { provide: 'ARTICLE_GRAPH_SERVICE', useExisting: ArticleGraphService },
  ],
  exports: [
    ArticleGraphService,
    BatchTaskGraphService,
    'ARTICLE_GRAPH_SERVICE',
  ],
})
export class GraphModule {}
