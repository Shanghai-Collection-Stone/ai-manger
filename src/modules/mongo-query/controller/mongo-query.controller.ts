import {
  Body,
  Controller,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { MongoQueryService } from '../services/mongo-query.service.js';
import { MongoQueryDto } from './mongo-query.dto.js';

/**
 * @description Mongo 通用查询控制器（JSON Filter）
 * @keyword-en mongo query controller
 */
@Controller('mongo')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class MongoQueryController {
  constructor(private readonly mongoQuery: MongoQueryService) {}

  /**
   * @description 通用查询入口（list / count，可选关联查询）
   * @keyword-en mongo query endpoint
   */
  @Post('query')
  async query(@Req() req: Request, @Body() body: MongoQueryDto) {
    return this.mongoQuery.execute(req, body);
  }
}
