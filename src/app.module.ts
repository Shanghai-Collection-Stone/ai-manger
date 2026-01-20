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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.development', '.env.local'],
    }),
    ContextModule,
    AiContextModule,
    SchemaModule,
    AiAgentModule,
    FormatModule,
    ChatMainModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
