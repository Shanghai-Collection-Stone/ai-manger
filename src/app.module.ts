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
import { BatchTaskModule } from './modules/batch-task/batch-task.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { GraphModule } from './modules/graph/graph.module';

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
    BatchTaskModule,
    GalleryModule,
    CanvasModule,
    GraphModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
