# Finance-Transform Module

## 模块名称 (Module Name)

Finance-Transform

## 概述 (Overview)

财务 Transform DSL 引擎,把 `finance/source` 拉到的飞书原始行转换为外部财务系统统一 `financial_event` 字段。支持行过滤、字段映射、类型转换、计算字段、前序 computed 字段引用、嵌套 compute、同名输出合并、`or/and` 分组与 `between` 区间过滤。

## 文件清单 (File List)

- `finance-transform.module.ts` — Nest 模块定义,导出 transform engine 与 validator。
- `types/transform-dsl.types.ts` — DSL、过滤、计算、合并模式与执行结果类型。
- `services/transform-engine.service.ts` — DSL 执行引擎,负责行过滤、字段求值、类型转换与错误容忍。
- `services/transform-validator.service.ts` — DSL 结构校验器,负责落库前与 Agent dry-run 前的 schema 检查。

## 函数清单 (Function List)

- `TransformEngineService()` — 财务 Transform DSL 执行引擎类 | keywords: transform-engine, dsl-runner, finance-normalize
- `run(rows,dsl)` — 执行 DSL 并返回转换行、错误与计数 | keywords: run-dsl, transform-result
- `passesFilter(fields,conditions?)` — 以 and 语义判断顶层过滤条件 | keywords: filter-pass, and-conjunction
- `matchCondition(row,cond)` — 匹配单个过滤条件,支持 or/and/between/regex/notRegex | keywords: condition-match, filter-op
- `toRegex(value)` — 把 filter value 编译成 RegExp(支持字符串或 `{pattern,flags}`) | keywords: regex-compile, condition-regex
- `toBetweenBounds(value)` — 解析 between 的数组或对象边界 | keywords: between-bounds, filter-range
- `isBetween(value,min,max)` — 判断值是否处于闭区间 | keywords: between-compare, filter-range
- `toOrderNumber(value)` — 将数字或日期转为可排序数值 | keywords: order-number, range-compare
- `toComparable(value)` — 将飞书 cell 拍平为 primitive | keywords: cell-flatten, primitive-value
- `cellToPrimitive(value)` — 单个 cell 提取 text/name/value | keywords: cell-primitive, object-null
- `applyRule(src,rule)` — 执行单条字段规则并返回值 | keywords: field-rule-apply, dsl-field
- `assignOutput(dst,context,rule,value)` — 写入输出字段并同步 computed 上下文 | keywords: output-merge, computed-context
- `mergeOutputValue(current,incoming,mode?)` — 合并同名输出字段 | keywords: duplicate-field-merge, output-merge
- `isPlainObject(value)` — 判断普通对象以支持 object merge | keywords: plain-object, object-merge
- `runMap(src,rule)` — 执行直接字段映射 | keywords: map-rule-run, default-fallback
- `readFieldValue(src,field,fallback?,type?,format?)` — 从源字段或 computed 上下文读取字段 | keywords: context-field-read, computed-field
- `runCompute(src,rule)` — 执行 concat/sum/if/coalesce/const/lookup/regex | keywords: compute-rule-run, nested-compute, regex-extract
- `resolveExpressionValue(src,value,allowBareFieldRef?)` — 求值 then/else 中的字段引用或嵌套 compute | keywords: expression-resolve, nested-compute
- `resolveMappedValue(src,value)` — 求值 lookup map 命中后的显式表达式 | keywords: lookup-value-resolve, nested-compute
- `isComputeExpression(value)` — 判断嵌套 compute 表达式 | keywords: nested-compute-detect, expression-detect
- `isFieldRefExpression(value)` — 判断 `{ from }` 字段引用表达式 | keywords: field-reference-detect, expression-detect
- `castValue(value,type?,format?)` — 执行 string/number/boolean/date/array 类型转换 | keywords: value-cast, type-convert
- `toDate(value,format?)` — 日期归一化(ms/秒数字、纯数字字符串、ISO 字符串、Date 都支持)为 ISO、YYYY-MM-DD 或 YYYY-MM | keywords: date-string, value-cast, timestamp-normalize
- `TransformValidatorService()` — Transform DSL 结构校验器类 | keywords: transform-validator, dsl-schema-check
- `validate(dsl)` — 校验顶层 DSL 并兼容 string JSON | keywords: dsl-validate, string-fallback
- `validateField(input,idx)` — 校验字段规则与 compute 必填项 | keywords: field-rule-validate, dsl-field
- `validateCondition(input,label)` — 校验过滤条件、分组条件与 regex 形态 | keywords: filter-condition-validate, filter-op, regex-shape
- `readRegexValue(value)` — 从 filter value 读出 `{pattern, flags}` | keywords: regex-value-read, regex-shape
- `assertRegexCompiles(pattern,flags,label)` — 落库期试编译 regex,失败即拒收 | keywords: regex-compile-check, dsl-validate
- `validateType(value,label)` — 校验字段类型 | keywords: value-type-validate, value-cast
- `validateMerge(value,label)` — 校验同名字段合并策略 | keywords: merge-mode-validate, duplicate-field

## 关键词索引 (Keyword Index)

| 中文          | English                        |
| ------------- | ------------------------------ |
| DSL 执行      | dsl-runner                     |
| 行过滤        | filter-op                      |
| 区间过滤      | filter-range                   |
| 嵌套计算      | nested-compute                 |
| 字段引用      | computed-field                 |
| 同名字段合并  | duplicate-field                |
| 类型转换      | value-cast                     |
| 飞书字段拍平  | cell-flatten                   |
| 结构校验      | dsl-schema-check               |
| 正则抽取/匹配 | regex-extract, condition-regex |

## 类型导出 (Type Exports)

- `TransformDsl` — DSL 顶层结构 | keywords: transform-dsl-root, dsl-schema
- `TransformFieldRule` — 字段规则联合类型 | keywords: transform-field-rule, dsl-field
- `TransformMapRule` — 直接映射规则 | keywords: transform-map-rule, field-map
- `TransformComputeRule` — 计算规则 | keywords: transform-compute-rule, compute-rule
- `TransformFilterCondition` — 过滤条件或分组条件 | keywords: transform-filter-condition, filter-condition
- `TransformFilterOp` — 过滤操作符,含 `between`/`or`/`and` | keywords: transform-filter-operator, filter-op
- `TransformComputeOp` — 计算操作符 | keywords: transform-compute-operator, compute-op
- `TransformValueType` — 值类型 | keywords: transform-value-type, value-cast
- `TransformMergeMode` — 同名字段合并模式 | keywords: transform-merge-mode, duplicate-field
- `TransformResult` — 执行结果 | keywords: transform-engine-result, run-result
- `TransformError` — 单行错误 | keywords: transform-row-error, row-error

## 模块功能描述 (Module Feature Description)

执行流程按行处理:先用顶层 `filter` 过滤,再按 `fields` 顺序逐条执行。每条规则会读取源字段和前序已输出字段组成的上下文,因此 `lookup.from`、`if.when`、后续 map 都可以引用 computed 字段。同名 `to` 默认智能合并,也可用 `merge` 显式指定。单行异常记录到 `errors`,不影响其他行。
