import { Module } from '@nestjs/common';
import { RobotRegistryService } from './services/robot-registry.service.js';

@Module({
  providers: [RobotRegistryService],
  exports: [RobotRegistryService],
})
export class AutoTaskRobotModule {}
