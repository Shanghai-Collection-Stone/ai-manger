import { createHash } from 'crypto';

/**
 * @title 模块描述 Function-Call Mongo Tip
 * @description Mongo函数调用与Schema缓存模块关键词映射。
 * @keywords-cn 函数调用, Mongo, Schema, 缓存
 * @keywords-en function-call, mongo, schema, cache
 */
export const moduleTip = {
  keywordsCn: [
    '函数调用',
    'Mongo',
    '查询',
    '服务',
    '类型',
    '聚合',
    '去重',
    '计数',
    '分页',
    '最小值',
    '最大值',
    '求和',
    '平均值',
  ],
  keywordsEn: [
    'function-call',
    'mongo',
    'query',
    'service',
    'types',
    'aggregate',
    'distinct',
    'count',
    'pagination',
    'min',
    'max',
    'sum',
    'avg',
  ],
  files: {
    '服务/FunctionCallService':
      'src/modules/function-call/mongo/services/mongo.service.ts',
    '类型/Types': 'src/modules/function-call/mongo/types/mongo.types.ts',
    '控制器/MongoSearchController':
      'src/modules/function-call/mongo/controller/search.controller.ts',
    '缓存/SchemaCache': 'src/modules/function-call/mongo/cache/mongo.cache.ts',
  },
  functionMap: {
    '获取句柄/get handle': {
      name: 'getHandle',
      hash: sha(
        'src/modules/function-call/mongo/services/mongo.service.ts#getHandle',
      ),
    },
    '归一化过滤器/normalize filter': {
      name: 'normalizeFilter',
      hash: sha(
        'src/modules/function-call/mongo/services/mongo.service.ts#normalizeFilter',
      ),
    },
    '控制器查询/search': {
      name: 'search',
      hash: sha(
        'src/modules/function-call/mongo/controller/search.controller.ts#search',
      ),
    },
  },
  description:
    'Function-Call Mongo模块：提供查询句柄与类型定义；提示优先结合 find+count、distinct 与 aggregate 获取数据与统计，用分页控制返回大小。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
