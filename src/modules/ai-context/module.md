# Ai-Context Module

## 模块描述
AI上下文检索模块：提供关键词提取、命中检索与滑动窗口上下文构造能力。
文件路径: `src/modules/ai-context`

## 功能描述及关键词

### retrieval.service.ts
检索服务，提供基于关键词的上下文检索与滑动窗口构造。
- **关键词**: retrieval, sliding window, service, search, reindex
- **函数**:
  - `reindexSession`: 重建索引/reindex
  - `search`: 关键词检索/search
  - `getSlidingContext`: 滑动上下文/sliding

### keyword.service.ts
关键词提取服务。
- **关键词**: keywords, extract
- **函数**:
  - `extractKeywords`: 关键词提取/extractKeywords

### retrieval.controller.ts
检索控制器。
- **关键词**: controller

### retrieval.types.ts
检索类型定义。
- **关键词**: types
