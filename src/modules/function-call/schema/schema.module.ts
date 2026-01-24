import { Module } from '@nestjs/common';
import { SchemaFunctionCallService } from './services/schema.service.js';
import { DataSourceModule } from '../../data-source/data-source.module.js';

@Module({
  imports: [DataSourceModule],
  providers: [SchemaFunctionCallService],
  exports: [SchemaFunctionCallService],
})
export class SchemaFunctionCallModule {}
