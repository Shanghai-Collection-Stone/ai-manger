# Frontend Function-Call Module

## 模块描述
前端异步生成工具：提供人机协作规划与最终静态HTML产出，生成随机哈希外链并记录执行状态。
文件路径: `src/modules/function-call/frontend`

## 功能描述及关键词

### frontend.service.ts
前端生成服务。
- **关键词**: frontend, async, HITL, HTML, static, layout, service
- **函数**:
  - `frontend_plan`: 规划/plan
  - `frontend_finalize`: 确认/finalize

### frontend.module.ts
前端生成模块定义。
- **关键词**: module

## API Docs

### mongoSearch
通用Mongo搜索接口。
- **Endpoint**: `/fc/mongo/search`
- **Method**: `POST`
- **Notes**: 支持多种查询方式(find/count/aggregate/distinct/min/max/sum/avg)，可用分页(skip/limit)与includeTotal；建议最小化查询规模以减少上下文负载。
