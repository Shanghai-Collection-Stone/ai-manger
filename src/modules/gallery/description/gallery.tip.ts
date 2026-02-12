/**
 * @description Gallery 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword gallery, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Gallery',
  purpose: '图片/图库组管理、向量存储与相似度检索',
  description:
    '该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。',
  keywords: [
    'gallery',
    'image',
    'group',
    'groups',
    'upload',
    'pagination',
    'cursor',
    'embedding',
    'vector-search',
    'similarity',
    'groupId',
    'atlas',
    'cosine',
    'mongo',
  ],
  dependencies: [
    '@nestjs/common',
    'mongodb',
    'multer',
    'data-source module',
    'embedding module',
  ],
  lastUpdated: '2026-02-04',
  files: {
    '控制器/Controller': 'src/modules/gallery/controller/gallery.controller.ts',
    '图片服务/ImageService': 'src/modules/gallery/services/gallery.service.ts',
    '图库组服务/GroupService':
      'src/modules/gallery/services/gallery-group.service.ts',
    '图片实体/ImageEntity':
      'src/modules/gallery/entities/gallery-image.entity.ts',
    '图库组实体/GroupEntity':
      'src/modules/gallery/entities/gallery-group.entity.ts',
    '模块/Module': 'src/modules/gallery/gallery.module.ts',
  },
};
