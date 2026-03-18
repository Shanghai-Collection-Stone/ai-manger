import { Module, forwardRef } from '@nestjs/common';
import { AgentService } from './services/agent.service';
import { enableProxyFromEnv } from '../../shared/network/proxy';
import { ContextModule } from '../context/context.module';
import { AdminModule } from '../admin/admin.module.js';

const AI_AGENT_PROXY_INIT = 'AI_AGENT_PROXY_INIT';

@Module({
  imports: [forwardRef(() => ContextModule), forwardRef(() => AdminModule)],
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
