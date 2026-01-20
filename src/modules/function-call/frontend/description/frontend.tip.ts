import { createHash } from 'crypto';

export const moduleTip = {
  keywordsCn: ['前端', '异步', '人机协作', 'HTML', '静态资源', '布局'],
  keywordsEn: ['frontend', 'async', 'HITL', 'HTML', 'static', 'layout'],
  files: {
    '服务/Service':
      'src/modules/function-call/frontend/services/frontend.service.ts',
    '模块/Module': 'src/modules/function-call/frontend/frontend.module.ts',
  },
  functionMap: {
    '规划/plan': {
      name: 'frontend_plan',
      hash: sha(
        'src/modules/function-call/frontend/services/frontend.service.ts#frontend_plan',
      ),
    },
    '确认/finalize': {
      name: 'frontend_finalize',
      hash: sha(
        'src/modules/function-call/frontend/services/frontend.service.ts#frontend_finalize',
      ),
    },
  },
  description:
    '前端异步生成工具：提供人机协作规划与最终静态HTML产出，生成随机哈希外链并记录执行状态。',
  apiDocs: {
    mongoSearch: {
      title: '通用Mongo搜索接口',
      endpoint: '/fc/mongo/search',
      method: 'POST',
      request: {
        collection: 'string(required)',
        schema: 'Record<field, type>?',
        filter: 'Record<string, unknown>?',
        projection: 'Record<string, 0|1>?',
        sort: 'Record<string, 1|-1>?',
        limit: 'number?',
        skip: 'number?',
        includeTotal: 'boolean?',
        type: '"find"|"count"|"aggregate"|"distinct"|"min"|"max"|"sum"|"avg"?',
        key: 'string?(for distinct|min|max|sum|avg)',
        pipeline: 'object[]?(for aggregate)',
      },
      response:
        'depends on type: find->[docs] | count->[{count}] | distinct->[values] | aggregate->[docs] | min/max/sum/avg->[{op:value}]',
      notes:
        '支持多种查询方式(find/count/aggregate/distinct/min/max/sum/avg)，可用分页(skip/limit)与includeTotal；建议最小化查询规模以减少上下文负载。',
      example: {
        request: {
          collection: 'orders',
          filter: { status: 'paid', date: { $gte: '2025-11-01' } },
          projection: { _id: 0, date: 1, total: 1 },
          limit: 20,
          sort: { date: 1 },
        },
        response: [{ date: '2025-11-01', total: 123.45 }],
      },
    },
  },
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
