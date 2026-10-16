import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { GalleryModule } from '../gallery/gallery.module.js';
import { ArticleLibraryModule } from '../article-library/article-library.module.js';
import { XhsTopicModule } from '../xhs-topic/xhs-topic.module.js';
import { XhsTopicDataModule } from '../xhs-topic-data/xhs-topic-data.module.js';
import { TenantMcpAdminController } from './controller/tenant-mcp-admin.controller.js';
import { TenantMcpController } from './controller/tenant-mcp.controller.js';
import { TenantMcpAuthGuard } from './controller/tenant-mcp-auth.guard.js';
import { TenantMcpService } from './services/tenant-mcp.service.js';
import { TenantMcpToolsService } from './services/tenant-mcp-tools.service.js';
import { TenantMcpProtocolService } from './services/tenant-mcp-protocol.service.js';

/** @keyword-en tenant-mcp-module, mcp-server */
@Module({
  imports: [
    AdminModule,
    DataSourceModule,
    GalleryModule,
    ArticleLibraryModule,
    XhsTopicModule,
    XhsTopicDataModule,
  ],
  controllers: [TenantMcpAdminController, TenantMcpController],
  providers: [
    TenantMcpService,
    TenantMcpToolsService,
    TenantMcpProtocolService,
    TenantMcpAuthGuard,
  ],
})
export class TenantMcpModule {}
