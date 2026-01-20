import { Module } from '@nestjs/common';
import { ChatMainService } from './services/chat.service';
import { ChatMainController } from './controller/chat.controller';
import { ContextModule } from '../context/context.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { SchemaModule } from '../schema/schema.module';
import { FunctionCallToolsModule } from '../function-call/tools/tools.module';
import { TitleFunctionCallModule } from '../function-call/title/title.module';
import { AiContextModule } from '../ai-context/ai-context.module';

/**
 * @title 主对话模块 Chat-Main Module
 * @description 提供主对话流式与非流式接口，并管理上下文CRUD。
 * @keywords-cn 主对话, 流式, 非流式, 上下文
 * @keywords-en chat main, streaming, non-streaming, context
 */
@Module({
  imports: [
    ContextModule,
    AiAgentModule,
    SchemaModule,
    FunctionCallToolsModule,
    TitleFunctionCallModule,
    AiContextModule,
  ],
  controllers: [ChatMainController],
  providers: [ChatMainService],
  exports: [ChatMainService],
})
export class ChatMainModule {}
