import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiContextModule } from './modules/ai-context/ai-context.module';
import { ContextModule } from './modules/context/context.module';
import { SchemaModule } from './modules/schema/schema.module';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module';
import { FormatModule } from './modules/format/format.module';
import { ChatMainModule } from './modules/chat-main/chat-main.module';
import { EmbeddingModule } from './modules/shared/embedding/embedding.module';
import { DataSourceModule } from './modules/data-source/data-source.module';
import { SkillThoughtModule } from './modules/skill-thought/skill-thought.module';
import { SkillThoughtTestModule } from './modules/skill-thought-test/skill-thought-test.module';
import { BatchTaskModule } from './modules/batch-task/batch-task.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { GraphModule } from './modules/graph/graph.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SassModule } from './modules/sass/sass.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { DecisionCardModule } from './modules/decision-card/decision-card.module.js';
import { MongoQueryModule } from './modules/mongo-query/mongo-query.module.js';
import { DashboardConfigModule } from './modules/dashboard-config/dashboard-config.module.js';
import { ImageAntiDetectionModule } from './modules/image-anti-detection/image-anti-detection.module.js';
import { ArticleLibraryModule } from './modules/article-library/article-library.module.js';
import { TenantCredentialModule } from './modules/tenant-credential/tenant-credential.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.development', '.env.local'],
    }),
    EmbeddingModule,
    ContextModule,
    AiContextModule,
    SchemaModule,
    AiAgentModule,
    FormatModule,
    ChatMainModule,
    DataSourceModule,
    SkillThoughtModule,
    SkillThoughtTestModule,
    BatchTaskModule,
    GalleryModule,
    CanvasModule,
    GraphModule,
    DashboardModule,
    SassModule,
    AdminModule,
    DecisionCardModule,
    MongoQueryModule,
    DashboardConfigModule,
    ImageAntiDetectionModule,
    ArticleLibraryModule,
    TenantCredentialModule,
    FinanceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
