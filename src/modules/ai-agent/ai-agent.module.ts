import { Module } from '@nestjs/common';
import { AgentService } from './services/agent.service';
import { enableProxyFromEnv } from '../../shared/network/proxy';
import { ContextModule } from '../context/context.module';

const AI_AGENT_PROXY_INIT = 'AI_AGENT_PROXY_INIT';

@Module({
  imports: [ContextModule],
  providers: [
    {
      provide: AI_AGENT_PROXY_INIT,
      useFactory: (): boolean => {
        enableProxyFromEnv();
        return true;
      },
    },
    AgentService,
  ],
  exports: [AgentService],
})
export class AiAgentModule {}
