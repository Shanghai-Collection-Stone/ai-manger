/**
 * @title 文本格式化模块 Text Format Module
 * @description 提供文本清理与规范化服务，例如去除代码块围栏。
 * @keywords-cn 文本格式化, 代码块, 清理
 * @keywords-en text format, code fence, cleanup
 */
import { Module } from '@nestjs/common';
import { TextFormatService } from './services/format.service';

@Module({
  providers: [TextFormatService],
  exports: [TextFormatService],
})
export class FormatModule {}
