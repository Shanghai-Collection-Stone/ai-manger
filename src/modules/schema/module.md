# Schema Module

## 模块描述
Schema模块：仅用于对外触发缓存更新，读取通过内部代码完成。
文件路径: `src/modules/schema`

## 功能描述及关键词

### schema.controller.ts
Schema控制器。
- **关键词**: controller, schema, update

### schema.service.ts
Schema服务。
- **关键词**: service
- **函数**:
  - `buildCache`: 生成缓存/generate cache
  - `getDatabaseSchema`: 获取Schema/get schema
  - `optimizeCacheWithAI`: AI优化缓存/ai optimize cache
