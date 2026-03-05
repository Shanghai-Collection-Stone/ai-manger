import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SassController } from './controller/sass.controller.js';
import { SassSyncController } from './controller/sass-sync.controller.js';
import { SassTenantAuthMiddleware } from './middleware/sass-tenant-auth.middleware.js';
import { SassService } from './services/sass.service.js';

/**
 * @description Sass模块，提供Schema、租户、API Key与租户数据能力
 * @keyword-en sass module
 */
@Module({
  imports: [DataSourceModule],
  controllers: [SassController, SassSyncController],
  providers: [SassService, SassTenantAuthMiddleware],
  exports: [SassService],
})
export class SassModule implements NestModule {
  /**
   * @description 配置中间件，作用于sass schema与data路由
   * @keyword-en configure middleware for sass schema and data routes
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SassTenantAuthMiddleware)
      .forRoutes(
        { path: 'sass/schema', method: RequestMethod.ALL },
        { path: 'sass/schema/:id', method: RequestMethod.ALL },
        { path: 'sass/data/insert', method: RequestMethod.ALL },
        { path: 'sass/data/patch', method: RequestMethod.ALL },
        { path: 'sass/data/list', method: RequestMethod.ALL },
        { path: 'sass/data/find-one', method: RequestMethod.ALL },
        { path: 'sass/data/update-one', method: RequestMethod.ALL },
        { path: 'sass/data/delete-one', method: RequestMethod.ALL },
      );
  }
}
