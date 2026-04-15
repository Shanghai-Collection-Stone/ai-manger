import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AutoTaskRobotModule } from '../auto-task-robot/auto-task-robot.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TodoService } from './services/todo.service.js';
import { XhsPostStatService } from './services/xhs-post-stat.service.js';
import { TodoController } from './controller/todo.controller.js';
import { TodoTaskController } from './controller/todo-task.controller.js';
import { TodoResourceController } from './controller/todo-resource.controller.js';

/**
 * @description 待办模块，提供待办CRUD与控制器
 * @keyword todo, module, crud
 * @since 2026-01-27
 */
@Module({
  imports: [DataSourceModule, AdminModule, AutoTaskRobotModule],
  controllers: [TodoController, TodoTaskController, TodoResourceController],
  providers: [TodoService, XhsPostStatService],
  exports: [TodoService, XhsPostStatService],
})
export class TodoModule {}
