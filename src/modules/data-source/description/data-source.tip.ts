/**
 * @description Data-Source 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword data-source, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Data-Source',
  purpose: '提供Mongo数据连接、数据源注册、Schema缓存与查询工具',
  description:
    '该模块管理主业务Mongo连接（DS_MONGO_DB），提供数据源注册、Schema缓存更新与通用数据查询/聚合能力，并向函数调用层导出可复用的查询工具服务。',
  keywords: [
    'data-source',
    'mongo',
    'schema',
    'query',
    'aggregate',
    'tools',
    'feishu',
    'bitable',
    'super-party',
    'embedding',
  ],
  dependencies: [
    '@nestjs/common',
    '@nestjs/config',
    'mongodb',
    'embedding module',
    'ai-agent module',
    'format module',
  ],
  lastUpdated: '2026-02-04',
  files: {
    '控制器/Controller':
      'src/modules/data-source/controller/data-source.controller.ts',
    '服务/Service': 'src/modules/data-source/services/data-source.service.ts',
    'Schema服务/SchemaService':
      'src/modules/data-source/services/data-source-schema.service.ts',
    '工具/Tools': 'src/modules/data-source/tools/data-source-search.tools.ts',
    '模块/Module': 'src/modules/data-source/data-source.module.ts',
  },
};
