import { Global, Module } from '@nestjs/common';
import { AntiDetectionService } from './services/anti-detection.service.js';
import { AntiDetectionController } from './controller/anti-detection.controller.js';
import { AdminModule } from '../admin/admin.module.js';

/**
 * @title 抗AI识别模块 Image Anti-AI-Detection Module
 * @description 对 AI 生图 / 拼图 / 烧字封面等落盘前进行去AI特征处理（元数据清理/噪点/重采样等）。
 * 同时对外暴露前端工具页可调用的单张 / 批量 HTTP 接口。
 * @keywords-cn 抗AI识别模块, 图片去AI特征, 噪点, EXIF清理, 重采样, 模块声明
 * @keywords-en image anti detection module, remove ai fingerprint, noise, exif strip, resample
 */
@Global()
@Module({
  imports: [AdminModule],
  controllers: [AntiDetectionController],
  providers: [AntiDetectionService],
  exports: [AntiDetectionService],
})
export class ImageAntiDetectionModule {}
