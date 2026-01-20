import { Body, Controller, Post } from '@nestjs/common';
import { SchemaService } from '../services/schema.service.js';

/**
 * @title Mongo 控制器 Mongo Controller
 * @description 暴露函数调用查询与Schema缓存生成接口。
 * @keywords-cn Mongo, 控制器, 缓存
 * @keywords-en mongo, controller, cache
 */
@Controller('schema')
export class SchemaController {
  constructor(private readonly schema: SchemaService) {}

  /**
   * @title 生成缓存JS Generate Cache JS
   * @description 生成并写入 `data/cache/mongo-schema.js` 用于后续读取。
   * @keywords-cn 缓存JS, 生成
   * @keywords-en cache js, generate
   */
  @Post('cache')
  async generateCache(
    @Body()
    overrides?: {
      [table: string]: {
        nameCn?: string;
        keywords?: string[];
        fields?: { [field: string]: { nameCn?: string; description?: string } };
      };
    },
  ): Promise<{ path: string; size: number }> {
    return this.schema.buildCache(overrides);
  }

  /**
   * @title AI优化缓存 Optimize Cache via AI
   * @description 使用Gemini模型优化字段描述与关键词，并更新缓存文件。
   * @keywords-cn AI优化, 缓存
   * @keywords-en ai optimize, cache
   */
  @Post('cache/optimize')
  async optimizeCache(
    @Body()
    params?: {
      model?: string;
      temperature?: number;
    },
  ): Promise<{ path: string; size: number }> {
    return this.schema.optimizeCacheWithAI(params);
  }
}
