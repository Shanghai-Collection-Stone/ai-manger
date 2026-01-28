import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TodoService } from './services/todo.service.js';
import { TodoController } from './controller/todo.controller.js';

/**
 * @description 待办模块，提供待办CRUD与控制器
 * @keyword todo, module, crud
 * @since 2026-01-27
 */
@Module({
  imports: [DataSourceModule],
  controllers: [TodoController],
  providers: [TodoService],
  exports: [TodoService],
})
export class TodoModule {}
