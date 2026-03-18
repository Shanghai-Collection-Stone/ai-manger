import { Module } from '@nestjs/common';
import { DecisionCardController } from './controller/decision-card.controller.js';
import { DecisionCardService } from './services/decision-card.service.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { AutoTaskRobotModule } from '../auto-task-robot/auto-task-robot.module.js';

/**
 * @description 决策卡模块
 * @keyword-en decision card module
 */
@Module({
  imports: [
    DataSourceModule,
    AiAgentModule,
    AdminModule,
    TodoModule,
    AutoTaskRobotModule,
  ],
  controllers: [DecisionCardController],
  providers: [DecisionCardService],
  exports: [DecisionCardService],
})
export class DecisionCardModule {}
