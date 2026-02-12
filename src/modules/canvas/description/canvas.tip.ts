/**
 * @description Canvas 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword canvas, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Canvas',
  purpose: '多文章画布存储与内容/配图状态管理',
  description:
    '该模块基于MongoDB存储画布与文章列表，支持创建画布、批量追加文章、更新画布状态，以及为指定文章写入图片ID/URL与完成说明，用于批量生产与发布流程衔接。',
  keywords: [
    'canvas',
    'articles',
    'multi-article',
    'outline',
    'style',
    'content-json',
    'image-ids',
    'status',
    'mongo',
  ],
  dependencies: ['@nestjs/common', 'mongodb', 'data-source module'],
  lastUpdated: '2026-02-04',
  files: {
    '控制器/Controller': 'src/modules/canvas/controller/canvas.controller.ts',
    '服务/Service': 'src/modules/canvas/services/canvas.service.ts',
    '实体/Entity': 'src/modules/canvas/entities/canvas.entity.ts',
    '模块/Module': 'src/modules/canvas/canvas.module.ts',
  },
};
