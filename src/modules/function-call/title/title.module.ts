import { Module } from '@nestjs/common';
import { TitleFunctionCallService } from './services/title.service.js';
import { AiAgentModule } from '../../ai-agent/ai-agent.module.js';
import { ContextModule } from '../../context/context.module.js';

/**
 * @title 会话标题函数模块 Title Function Call Module
 * @description 提供首轮问答生成并持久化标题的工具。
 * @keywords-cn 会话标题, 函数模块
 * @keywords-en session title, function module
 */
@Module({
  imports: [AiAgentModule, ContextModule],
  providers: [TitleFunctionCallService],
  exports: [TitleFunctionCallService],
})
export class TitleFunctionCallModule {}
