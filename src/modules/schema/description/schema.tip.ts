import { createHash } from 'crypto';

/**
 * @title 模块描述 Schema Tip
 * @description Schema更新触发模块，仅提供更新接口。
 * @keywords-cn 控制器, Schema, 更新
 * @keywords-en controller, schema, update
 */
export const moduleTip = {
  keywordsCn: ['控制器', 'Schema', '更新'],
  keywordsEn: ['controller', 'schema', 'update'],
  files: {
    '控制器/Controller': 'src/modules/schema/controller/schema.controller.ts',
    '服务/Service': 'src/modules/schema/services/schema.service.ts',
  },
  functionMap: {
    '生成缓存/generate cache': {
      name: 'buildCache',
      hash: sha('src/modules/schema/services/schema.service.ts#buildCache'),
    },
    '获取Schema/get schema': {
      name: 'getDatabaseSchema',
      hash: sha(
        'src/modules/schema/services/schema.service.ts#getDatabaseSchema',
      ),
    },
    'AI优化缓存/ai optimize cache': {
      name: 'optimizeCacheWithAI',
      hash: sha(
        'src/modules/schema/services/schema.service.ts#optimizeCacheWithAI',
      ),
    },
  },
  description: 'Schema模块：仅用于对外触发缓存更新，读取通过内部代码完成。',
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
