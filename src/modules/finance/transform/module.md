# Finance-Transform Module

## 模块描述
财务 Transform 引擎模块。把 `finance/source` 拉到的飞书原始行(多维表/审批)按 DSL 转换为统一范式数据,产出对齐外部财务系统的 `financial_event` 字段。
- 引擎纯函数,无 IO
- DSL 支持:filter(行过滤)+ map(字段映射 + 类型转换)+ compute(concat/sum/if/coalesce/**const**/**lookup**)
- 单行失败不中断整体,错误归集到结果的 errors 字段
- storeId/companyId 不在 source 级别绑定 — 同一银行账户/审批流程往往跨多门店,只能由 DSL 用 `compute: lookup` 从源数据字段(如"门店"、"商户号"、"备注")映射

文件路径: `src/modules/finance/transform`

## 功能描述及关键词

### types/transform-dsl.types.ts
DSL 与运行结果类型。
- **关键词**: transform dsl types, filter, map, compute(const/lookup), value type, result, error
- **类型**:
  - `TransformDsl`: DSL 顶层(version + filter + fields)
  - `TransformFieldRule`: 字段规则(map | compute)
  - `TransformMapRule`: 直接映射 + 类型转换
  - `TransformComputeRule`: 计算规则(支持 const 的 `value`、lookup 的 `from + map`)
  - `TransformFilterCondition` / `TransformFilterOp`
  - `TransformComputeOp`: `'concat' | 'sum' | 'if' | 'coalesce' | 'const' | 'lookup'`
  - `TransformValueType`、`TransformResult`、`TransformError`

### services/transform-engine.service.ts
DSL 执行引擎。
- **关键词**: transform engine, dsl runner, normalize, error tolerant, feishu cell flatten, const compute, lookup compute
- **函数**:
  - `run`: 执行 DSL,返回 rows + errors + 计数 /run dsl on rows
  - `passesFilter`: and 语义过滤判断 /and-conjunction filter
  - `matchCondition`: 单条件匹配 /match condition
  - `toComparable`: 飞书各种 cell 拍平为 primitive(string/number/boolean);数组遍历调用 `cellToPrimitive`,多值 join /flatten feishu cell to primitive
  - `cellToPrimitive`: 单 cell 识别顺序 `text`(富文本/链接) → `name`(人员/单选/多选/附件) → `value`(枚举);未知复合 object 返回 null(避免下游拿到 raw object)/cell to primitive
  - `applyRule`: 应用单条字段规则 /apply rule
  - `runMap`: 直接映射(源字段空 OR 类型转换失败都走 default 兜底)/run map with default fallback after cast
  - `runCompute`: 计算(concat/sum/if/coalesce/**const**/**lookup**;cast 失败也走 default 兜底)/run compute with default fallback after cast
  - `castValue`: 类型转换 /cast value
  - `toDate`: 日期归一 /to date string

### services/transform-validator.service.ts
DSL 结构校验(落库前 / Agent 输出后调用)。
- 入参为 string 时自动 JSON.parse 兜底
- 错误信息形如 `<CODE>:<细节>`
- **关键词**: transform validator, dsl schema check, const lookup validation
- **函数**:
  - `validate`: 顶层校验(string 兜底)/validate dsl structure with string fallback
  - `validateField`: 字段规则校验(含 const/lookup 必填项校验)/validate field rule
  - `validateCondition`: 过滤条件校验 /validate filter condition
  - `validateType`: 类型字段校验 /validate value type

### finance-transform.module.ts
模块定义。
- **关键词**: finance transform module, providers, exports
