import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { ArticleLibraryModule } from '../article-library/article-library.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { FeaturedArticleController } from './controller/featured-article.controller.js';
import { FeaturedArticleService } from './services/featured-article.service.js';

/**
 * @description Featured article module for workspace drafts and article-library publishing handoff.
 * @keyword-en featured-article, module
 * @keyword-cn 精选文章, 模块
 */
@Module({
  imports: [DataSourceModule, AdminModule, ArticleLibraryModule],
  controllers: [FeaturedArticleController],
  providers: [FeaturedArticleService],
  exports: [FeaturedArticleService],
})
export class FeaturedArticleModule {}
