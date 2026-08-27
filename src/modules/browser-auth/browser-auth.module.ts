import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { BrowserAuthInteractionController } from './controller/browser-auth-interaction.controller.js';
import { BrowserAuthCryptoService } from './services/browser-auth-crypto.service.js';
import { BrowserAuthInteractionService } from './services/browser-auth-interaction.service.js';
import { BrowserSessionService } from './services/browser-session.service.js';

/**
 * @description 浏览器登录态持久化与任务人机交互模块。
 * @keyword-cn 浏览器认证模块, 任务人机交互
 * @keyword-en browser-auth-module, human-in-the-loop
 */
@Module({
  imports: [DataSourceModule, AdminModule, TodoModule],
  controllers: [BrowserAuthInteractionController],
  providers: [
    BrowserAuthCryptoService,
    BrowserSessionService,
    BrowserAuthInteractionService,
  ],
  exports: [BrowserSessionService, BrowserAuthInteractionService],
})
export class BrowserAuthModule {}
