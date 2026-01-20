import { Module } from '@nestjs/common';
import { ToolsService } from './services/tools.service.js';
import { FrontendFunctionCallModule } from '../frontend/frontend.module.js';
import { AnalysisFunctionCallModule } from '../analysis/analysis.module.js';
import { MongoFunctionCallModule } from '../mongo/mongo.module.js';
import { SchemaFunctionCallModule } from '../schema/schema.module.js';
import { TitleFunctionCallModule } from '../title/title.module.js';

@Module({
  imports: [
    FrontendFunctionCallModule,
    AnalysisFunctionCallModule,
    MongoFunctionCallModule,
    SchemaFunctionCallModule,
    TitleFunctionCallModule,
  ],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class FunctionCallToolsModule {}
