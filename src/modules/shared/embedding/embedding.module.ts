import { Module, Global } from '@nestjs/common';
import { EmbeddingService } from './embedding.service.js';

/**
 * @title 向量嵌入模块 Embedding Module
 * @description 提供全局可用的文本向量化服务。
 * @keywords-cn 向量模块, 全局服务
 * @keywords-en embedding module, global service
 */
@Global()
@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
