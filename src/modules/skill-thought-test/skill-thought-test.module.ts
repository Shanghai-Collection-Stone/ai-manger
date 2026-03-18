import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { SkillThoughtModule } from '../skill-thought/skill-thought.module.js';
import { SkillThoughtTestController } from './skill-thought-test.controller.js';

@Module({
  imports: [AdminModule, SkillThoughtModule],
  controllers: [SkillThoughtTestController],
})
export class SkillThoughtTestModule {}
