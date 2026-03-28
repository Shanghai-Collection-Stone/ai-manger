# Media Agent Module

## 模块描述
该模块提供基于 LangChain/DeepAgent 的媒体 Agent 能力，包括图库对话 Agent 和小红书专项 Agent。
文件路径: `src/modules/media-agent`

## 功能描述及关键词

### media-agent.service.ts
核心 Agent 服务，提供图库和小红书相关的 Agent 能力。
- **关键词**: media-agent, gallery-agent, xhs-agent, langchain, deepagent
- **函数**:
  - `getGalleryToolsHandle` - 获取图库工具句柄
  - `getXhsToolsHandle` - 获取 XHS 工具句柄

### gallery-tools.service.ts
图库工具服务，提供图库搜索和管理相关的 LangChain 工具。
- **关键词**: gallery, tools, langchain, image-search, groups
- **函数**:
  - `getHandle` - 获取图库工具列表（含 gallery_groups 工具）
  - `createSearchImagesTool` - 图片搜索工具（支持 tag/group_id 过滤）
  - `createListImagesTool` - 图片列表工具
  - `createListTagsTool` - 标签列表工具
  - `createRandomImagesTool` - 随机图片工具
  - `createListGroupsTool` - 列出图库分组工具
  - `createSearchGroupsTool` - 向量搜索图库分组工具

### xhs-tools.service.ts
小红书工具服务，提供 Canvas 和批量发布相关的 LangChain 工具。
- **关键词**: xhs, canvas, tools, langchain
- **函数**:
  - `getHandle` - 获取 XHS 工具列表

### media-agent.module.ts
模块定义。
- **关键词**: module, media-agent, nestjs
