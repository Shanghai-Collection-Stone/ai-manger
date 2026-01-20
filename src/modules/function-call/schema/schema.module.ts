import { Module } from '@nestjs/common';
import { SchemaFunctionCallService } from './services/schema.service.js';
import { SchemaModule } from '../../schema/schema.module.js';

@Module({
  imports: [SchemaModule],
  providers: [SchemaFunctionCallService],
  exports: [SchemaFunctionCallService],
})
export class SchemaFunctionCallModule {}
