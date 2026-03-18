# Skill-Thought Module

## 模块描述
该模块基于MongoDB存储思维链（thought），支持向量Embedding相似度检索与阈值合并，并向函数调用层导出工具以便Agent在完成任务后沉淀可复用知识。
文件路径: `src/modules/skill-thought`

## 功能描述及关键词

### services/skill-thought.service.ts
思维链服务。
- **关键词**: skill-thought, skill_thoughts, thought, memory, embedding, similarity, merge, retrieval, mongo, tools, tenant-scope, service
- **函数**:
  - `create`: 创建思维链/create thought
  - `searchSimilar`: 相似检索/search similar
  - `findStronglyRelated`: 强相关检索/find strongly related
  - `update`: 更新思维链/update thought
  - `delete`: 删除思维链/delete thought
  - `list`: 列表查询/list thoughts
  - `getById`: 详情查询/get thought by id
  - `ensureIndexes`: 索引对齐/ensure indexes
  - `buildReadScopeFilter`: 读场景范围兼容/build read scope filter
  - `resolveDefaultAiConfig`: 默认模型解析/resolve default ai config
  - `resolveDefaultEmbeddingConfig`: 默认向量配置解析/resolve default embedding config

### tools/skill-thought.tools.ts
思维链工具。
- **关键词**: tools, thought-route, generate-thought, search-thought

### controller/skill-thought.controller.ts
思维链管理控制器。
- **关键词**: controller, crud, thought-management
- **函数**:
  - `list`: 列表/list
  - `get`: 详情/get
  - `create`: 创建/create
  - `update`: 更新/update
  - `remove`: 删除/remove

### entities/skill-thought.entity.ts
思维链实体。
- **关键词**: entity, tenant-scope

### skill-thought.module.ts
思维链模块定义。
- **关键词**: module, controller
