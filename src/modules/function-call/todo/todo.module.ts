import { Module } from '@nestjs/common';
import { TodoModule } from '../../todo/todo.module.js';
import { TodoFunctionCallService } from './services/todo.service.js';

/**
 * @description 待办函数调用模块，提供AI可用的待办CRUD工具
 * @keyword todo, function-call, module
 * @since 2026-01-27
 */
@Module({
  imports: [TodoModule],
  providers: [TodoFunctionCallService],
  exports: [TodoFunctionCallService],
})
export class TodoFunctionCallModule {}
