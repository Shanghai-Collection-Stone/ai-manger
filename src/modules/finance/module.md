# Finance Module

## 模块描述
财务领域总目录。包含飞书源读取、Transform DSL 引擎、配置(用户自定义 name 命名的 binding + transform 持久化)、Agent 工具集、推送链路、外部资源透传。
独立于 `data-source` 模块,凭证统一从 `tenant-credential` 取。
**外部接入合约**:根目录 `api.md`(对方接收侧定义,统一 `financial_event` 模型),整批拒收语义,推送统一打到 `/api/v1/events/upsert`。

文件路径: `src/modules/finance`

## 子模块总览

- 飞书源读取:`source/`(多维表 + 审批读取,独立 lark client)
- Transform 引擎:`transform/`(DSL 引擎 + 校验器 + source 默认归属注入器,纯函数 + 无 IO)
- 配置:`config/`(用户自定义 name 的 binding + DSL 持久化,作用域内 name 唯一)
- Agent:`agent/`(围绕单个 binding name 设定/解读 DSL 的对话工具集,system prompt 内含 financial_event schema)
- 推送:`push/`(每作用域一份推送配置 + 按 binding name 推送 + 外部 stores/companies 透传查询)

## 依赖关系

- `source/` → `tenant-credential/`
- `config/` → `transform/`、`source/`(暴露多维表列表给前端弹窗)、`admin/`
- `agent/` → `config/`、`source/`、`transform/`、`ai-agent/`
- `push/` → `config/`、`source/`、`transform/`、`admin/`
- `finance.module.ts` 聚合上述子模块,由 `app.module.ts` 顶层导入
