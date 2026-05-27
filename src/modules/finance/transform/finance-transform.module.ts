import { Module } from '@nestjs/common';
import { TransformEngineService } from './services/transform-engine.service.js';
import { TransformValidatorService } from './services/transform-validator.service.js';

/**
 * @description 财务 Transform 引擎模块(纯函数 + 校验,无外部依赖)
 * @keyword-en finance-transform-module, dsl-engine, validator
 */
@Module({
  providers: [TransformEngineService, TransformValidatorService],
  exports: [TransformEngineService, TransformValidatorService],
})
export class FinanceTransformModule {}
