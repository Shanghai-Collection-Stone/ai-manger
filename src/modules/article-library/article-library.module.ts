import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { ArticleLibraryController } from './controller/article-library.controller.js';
import { ArticleLibraryTaskController } from './controller/article-library-task.controller.js';
import { ArticleLibraryService } from './services/article-library.service.js';
import { ArticleService } from './services/article.service.js';

/**
 * @description 文章库模块：库 CRUD / 文章入库 / 状态更新 / 队列顺序领取 + task-api 入口
 * @keyword-en article library module crud queue lease task api
 */
@Module({
  imports: [DataSourceModule, AdminModule, TodoModule],
  controllers: [ArticleLibraryController, ArticleLibraryTaskController],
  providers: [ArticleLibraryService, ArticleService],
  exports: [ArticleLibraryService, ArticleService],
})
export class ArticleLibraryModule {}
