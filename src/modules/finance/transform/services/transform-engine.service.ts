import { Injectable } from '@nestjs/common';
import type { FinanceRawRow } from '../../source/types/finance-source.types.js';
import type {
  TransformComputeRule,
  TransformDsl,
  TransformError,
  TransformFieldRule,
  TransformFilterCondition,
  TransformMapRule,
  TransformMergeMode,
  TransformResult,
  TransformValueType,
} from '../types/transform-dsl.types.js';

type Row = Record<string, unknown>;
type ComputeExpression = Omit<TransformComputeRule, 'to'> & { to?: string };

/**
 * @description Transform 引擎：把原始飞书行按 DSL 转换为范式数据
 * @keyword-en transform-engine, dsl-runner, finance-normalize
 */
@Injectable()
export class TransformEngineService {
  /**
   * @description 执行 DSL；单行失败计入 errors 不中断整体
   * @keyword-en run-dsl, transform-result
   */
  run(rows: FinanceRawRow[], dsl: TransformDsl): TransformResult {
    const out: Row[] = [];
    const errors: TransformError[] = [];
    let filteredCount = 0;

    rows.forEach((raw, index) => {
      const fields = raw.fields ?? {};
      try {
        if (!this.passesFilter(fields, dsl.filter)) {
          filteredCount += 1;
          return;
        }
        const result: Row = {};
        const context: Row = { ...fields };
        for (const rule of dsl.fields) {
          const value = this.applyRule(context, rule);
          this.assignOutput(result, context, rule, value);
        }
        out.push(result);
      } catch (err) {
        errors.push({
          rowIndex: index,
          rowId: raw.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return {
      rows: out,
      errors,
      sourceCount: rows.length,
      filteredCount,
    };
  }

  /**
   * @description 行级过滤（and 语义）
   * @keyword-en filter-pass, and-conjunction
   */
  private passesFilter(
    fields: Row,
    conditions?: TransformFilterCondition[],
  ): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((cond) => this.matchCondition(fields, cond));
  }

  /**
   * @description 单条件匹配
   * @keyword-en condition-match, filter-op
   */
  private matchCondition(row: Row, cond: TransformFilterCondition): boolean {
    if (cond.op === 'or') {
      return (cond.conditions ?? []).some((item) =>
        this.matchCondition(row, item),
      );
    }
    if (cond.op === 'and') {
      return (cond.conditions ?? []).every((item) =>
        this.matchCondition(row, item),
      );
    }
    if (!cond.field) return false;
    const left = this.toComparable(row[cond.field]);
    const right = this.toComparable(cond.value);
    switch (cond.op) {
      case 'eq':
        return left === right;
      case 'neq':
        return left !== right;
      case 'in':
        return (
          Array.isArray(cond.value) &&
          cond.value.map((v) => this.toComparable(v)).includes(left)
        );
      case 'notIn':
        return (
          Array.isArray(cond.value) &&
          !cond.value.map((v) => this.toComparable(v)).includes(left)
        );
      case 'gt':
        return Number(left as never) > Number(right as never);
      case 'gte':
        return Number(left as never) >= Number(right as never);
      case 'lt':
        return Number(left as never) < Number(right as never);
      case 'lte':
        return Number(left as never) <= Number(right as never);
      case 'contains':
        return String(left ?? '').includes(String(right ?? ''));
      case 'isEmpty':
        return (
          left == null ||
          left === '' ||
          (Array.isArray(left) && left.length === 0)
        );
      case 'isNotEmpty':
        return !(
          left == null ||
          left === '' ||
          (Array.isArray(left) && left.length === 0)
        );
      case 'between': {
        const bounds = this.toBetweenBounds(cond.value);
        return bounds ? this.isBetween(left, bounds[0], bounds[1]) : false;
      }
      case 'regex': {
        const re = this.toRegex(cond.value);
        if (!re) return false;
        return left == null ? false : re.test(String(left));
      }
      case 'notRegex': {
        const re = this.toRegex(cond.value);
        if (!re) return true;
        return left == null ? true : !re.test(String(left));
      }
      default:
        return false;
    }
  }

  /**
   * @description 把 filter value 编译成 RegExp;支持 \`"pattern"\` 或 \`{pattern, flags}\`,编译失败返回 null 由调用方决定语义
   * @keyword-en regex-compile, condition-regex
   */
  private toRegex(value: unknown): RegExp | null {
    let pattern: string | undefined;
    let flags: string | undefined;
    if (typeof value === 'string') {
      pattern = value;
    } else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.pattern === 'string') pattern = obj.pattern;
      if (typeof obj.flags === 'string') flags = obj.flags;
    }
    if (!pattern) return null;
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  /**
   * @description 解析 between 条件边界
   * @keyword-en between-bounds, filter-range
   */
  private toBetweenBounds(value: unknown): [unknown, unknown] | null {
    if (Array.isArray(value) && value.length >= 2) {
      return [value[0], value[1]];
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const min = obj.min ?? obj.from ?? obj.start;
      const max = obj.max ?? obj.to ?? obj.end;
      if (typeof min !== 'undefined' && typeof max !== 'undefined') {
        return [min, max];
      }
    }
    return null;
  }

  /**
   * @description 判断值是否落在闭区间内,优先按数字/日期比较,兜底按字符串比较
   * @keyword-en between-compare, filter-range
   */
  private isBetween(value: unknown, min: unknown, max: unknown): boolean {
    const left = this.toOrderNumber(value);
    const low = this.toOrderNumber(min);
    const high = this.toOrderNumber(max);
    if (left != null && low != null && high != null) {
      return left >= low && left <= high;
    }
    const text = String(value ?? '');
    return text >= String(min ?? '') && text <= String(max ?? '');
  }

  /**
   * @description 转成可排序数字,支持 number、数字字符串与日期字符串
   * @keyword-en order-number, range-compare
   */
  private toOrderNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
      const date = Date.parse(value);
      if (!Number.isNaN(date)) return date;
    }
    if (value instanceof Date) return value.getTime();
    return null;
  }

  /**
   * @description 把飞书各种 cell 拍平为 primitive(string/number/boolean);未知 object 返回 null,避免被下游当字符串使用
   * @keyword-en cell-flatten, primitive-value
   */
  private toComparable(value: unknown): unknown {
    if (Array.isArray(value)) {
      const flat = value
        .map((item) => this.cellToPrimitive(item))
        .filter((v) => v != null && v !== '');
      if (flat.length === 0) return null;
      if (flat.length === 1) return flat[0];
      return flat.join(',');
    }
    return this.cellToPrimitive(value);
  }

  /**
   * @description 单个飞书 cell → primitive。识别顺序:text(富文本/链接) → name(人员/单选/多选/附件) → value(枚举类) → 复合对象返回 null
   * @keyword-en cell-primitive, object-null
   */
  private cellToPrimitive(value: unknown): unknown {
    if (value == null) return null;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const text = obj.text;
    if (typeof text === 'string' || typeof text === 'number') return text;
    const name = obj.name;
    if (typeof name === 'string' || typeof name === 'number') return name;
    const v = obj.value;
    if (
      v == null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      return v;
    }
    // 未知复合 object(如多层嵌套):返回 null,让 coalesce/concat 等跳过,避免脏数据被推送
    return null;
  }

  /**
   * @description 应用单条字段规则
   * @keyword-en field-rule-apply, dsl-field
   */
  private applyRule(src: Row, rule: TransformFieldRule): unknown {
    if ('compute' in rule) {
      return this.runCompute(src, rule);
    }
    return this.runMap(src, rule);
  }

  /**
   * @description 写入输出字段;同名字段按 merge 策略叠加,并同步到后续规则上下文
   * @keyword-en output-merge, computed-context
   */
  private assignOutput(
    dst: Row,
    context: Row,
    rule: TransformFieldRule,
    value: unknown,
  ): void {
    const hasExisting = Object.prototype.hasOwnProperty.call(dst, rule.to);
    dst[rule.to] = hasExisting
      ? this.mergeOutputValue(dst[rule.to], value, rule.merge)
      : value;
    context[rule.to] = dst[rule.to];
  }

  /**
   * @description 合并同名输出字段,支持 append/array/concat/sum/object/replace/auto
   * @keyword-en duplicate-field-merge, output-merge
   */
  private mergeOutputValue(
    current: unknown,
    incoming: unknown,
    mode: TransformMergeMode = 'auto',
  ): unknown {
    if (mode === 'replace') return incoming;
    if (mode === 'sum') {
      const a = Number(current);
      const b = Number(incoming);
      return (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
    }
    if (mode === 'object') {
      return {
        ...(this.isPlainObject(current) ? current : {}),
        ...(this.isPlainObject(incoming) ? incoming : {}),
      };
    }
    if (mode === 'concat') return `${current ?? ''}${incoming ?? ''}`;
    if (mode === 'append' || mode === 'array') {
      return [
        ...(Array.isArray(current) ? current : [current]),
        ...(Array.isArray(incoming) ? incoming : [incoming]),
      ].filter((item) => item != null && item !== '');
    }

    if (incoming == null || incoming === '') return current ?? incoming;
    if (current == null || current === '') return incoming;
    if (typeof current === 'number' && typeof incoming === 'number') {
      return current + incoming;
    }
    if (Array.isArray(current) || Array.isArray(incoming)) {
      return [
        ...(Array.isArray(current) ? current : [current]),
        ...(Array.isArray(incoming) ? incoming : [incoming]),
      ].filter((item) => item != null && item !== '');
    }
    if (this.isPlainObject(current) && this.isPlainObject(incoming)) {
      return { ...current, ...incoming };
    }
    if (typeof current === 'string' && typeof incoming === 'string') {
      return `${current}${incoming}`;
    }
    return [current, incoming];
  }

  /**
   * @description 判断值是否为普通对象
   * @keyword-en plain-object, object-merge
   */
  private isPlainObject(value: unknown): value is Row {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * @description 执行直接映射 + 类型转换;源字段为空 OR 类型转换失败时,都用 default 兜底
   * @keyword-en map-rule-run, default-fallback
   */
  private runMap(src: Row, rule: TransformMapRule): unknown {
    return this.readFieldValue(
      src,
      rule.from,
      rule.default,
      rule.type,
      rule.format,
    );
  }

  /**
   * @description 从当前上下文读取字段并做类型转换;上下文包含源字段和前序 computed 字段
   * @keyword-en context-field-read, computed-field
   */
  private readFieldValue(
    src: Row,
    field: string,
    fallback?: unknown,
    type?: TransformValueType,
    format?: string,
  ): unknown {
    const raw = this.toComparable(src[field]);
    if (raw == null || raw === '') {
      return fallback ?? null;
    }
    const cast = this.castValue(raw, type, format);
    if (cast == null && typeof fallback !== 'undefined' && fallback !== null) {
      return fallback;
    }
    return cast;
  }

  /**
   * @description 执行计算规则
   * @keyword-en compute-rule-run, nested-compute
   */
  private runCompute(
    src: Row,
    rule: TransformComputeRule | ComputeExpression,
  ): unknown {
    let result: unknown;
    switch (rule.compute) {
      case 'concat': {
        const parts = (rule.fields ?? [])
          .map((f) => this.toComparable(src[f]))
          .filter((v) => v != null && v !== '')
          .map((v) => String(v));
        result = parts.length > 0 ? parts.join(rule.sep ?? '') : null;
        break;
      }
      case 'sum': {
        const nums = (rule.fields ?? [])
          .map((f) => Number(this.toComparable(src[f])))
          .filter((n) => Number.isFinite(n));
        result = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
        break;
      }
      case 'coalesce': {
        const found = (rule.fields ?? [])
          .map((f) => this.toComparable(src[f]))
          .find((v) => v != null && v !== '');
        result = found ?? null;
        break;
      }
      case 'if': {
        if (!rule.when) {
          result = this.resolveExpressionValue(src, rule.else ?? null, true);
          break;
        }
        result = this.matchCondition(src, rule.when)
          ? this.resolveExpressionValue(src, rule.then, true)
          : this.resolveExpressionValue(src, rule.else ?? null, true);
        break;
      }
      case 'const': {
        result = typeof rule.value !== 'undefined' ? rule.value : null;
        break;
      }
      case 'lookup': {
        if (!rule.from || !rule.map || typeof rule.map !== 'object') {
          result = null;
          break;
        }
        const key = this.toComparable(src[rule.from]);
        const keyStr = key == null ? '' : String(key);
        if (
          keyStr !== '' &&
          Object.prototype.hasOwnProperty.call(rule.map, keyStr)
        ) {
          result = this.resolveMappedValue(src, rule.map[keyStr]);
        } else {
          result = null;
        }
        break;
      }
      case 'regex': {
        if (!rule.from || !rule.pattern) {
          result = null;
          break;
        }
        const raw = this.toComparable(src[rule.from]);
        if (raw == null || raw === '') {
          result = null;
          break;
        }
        let re: RegExp;
        try {
          re = new RegExp(rule.pattern, rule.flags);
        } catch {
          result = null;
          break;
        }
        const m = String(raw).match(re);
        if (!m) {
          result = null;
          break;
        }
        const idx = typeof rule.index === 'number' ? rule.index : 0;
        result = m[idx] ?? null;
        break;
      }
      default:
        result = null;
    }
    if (result == null && typeof rule.default !== 'undefined') {
      result = rule.default;
    }
    if (rule.type) {
      const cast = this.castValue(result, rule.type, rule.format);
      // cast 失败(返回 null)仍然走 default 兜底,避免 default 被类型转换悄无声息地吞掉
      if (
        cast == null &&
        typeof rule.default !== 'undefined' &&
        rule.default !== null
      ) {
        return rule.default;
      }
      return cast;
    }
    return result;
  }

  /**
   * @description 求值 then/else 等表达式;支持嵌套 compute、{from} 引用与裸字段名引用
   * @keyword-en expression-resolve, nested-compute
   */
  private resolveExpressionValue(
    src: Row,
    value: unknown,
    allowBareFieldRef = false,
  ): unknown {
    if (this.isComputeExpression(value)) {
      return this.runCompute(src, value);
    }
    if (this.isFieldRefExpression(value)) {
      return this.readFieldValue(
        src,
        value.from,
        value.default,
        value.type,
        value.format,
      );
    }
    if (
      allowBareFieldRef &&
      typeof value === 'string' &&
      Object.prototype.hasOwnProperty.call(src, value)
    ) {
      return this.toComparable(src[value]);
    }
    return value;
  }

  /**
   * @description 求值 lookup map 命中的值;仅解析显式表达式,避免把 literal id 误当字段名
   * @keyword-en lookup-value-resolve, nested-compute
   */
  private resolveMappedValue(src: Row, value: unknown): unknown {
    return this.resolveExpressionValue(src, value, false);
  }

  /**
   * @description 判断对象是否为嵌套 compute 表达式
   * @keyword-en nested-compute-detect, expression-detect
   */
  private isComputeExpression(value: unknown): value is ComputeExpression {
    return (
      !!value &&
      typeof value === 'object' &&
      typeof (value as { compute?: unknown }).compute === 'string'
    );
  }

  /**
   * @description 判断对象是否为显式字段引用表达式
   * @keyword-en field-reference-detect, expression-detect
   */
  private isFieldRefExpression(value: unknown): value is {
    from: string;
    default?: unknown;
    type?: TransformValueType;
    format?: string;
  } {
    return (
      !!value &&
      typeof value === 'object' &&
      typeof (value as { from?: unknown }).from === 'string' &&
      typeof (value as { compute?: unknown }).compute === 'undefined'
    );
  }

  /**
   * @description 类型转换
   * @keyword-en value-cast, type-convert
   */
  private castValue(
    value: unknown,
    type?: TransformValueType,
    format?: string,
  ): unknown {
    if (value == null) return null;
    switch (type) {
      case 'string':
        return String(value);
      case 'number': {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        return ['true', '1', 'yes', '是', 'y'].includes(
          String(value).toLowerCase(),
        );
      case 'date':
        return this.toDate(value, format);
      case 'array':
        return Array.isArray(value) ? value : [value];
      default:
        return value;
    }
  }

  /**
   * @description 日期归一(支持 ms/秒数字、纯数字字符串、ISO/常见日期字符串、Date 对象;format=YYYY-MM-DD 只取日期,format=YYYY-MM 只取年月,默认输出 ISO)
   * @keyword-en date-string, value-cast, timestamp-normalize
   */
  private toDate(value: unknown, format?: string): string | null {
    let ms: number | null = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      ms = value < 10_000_000_000 ? value * 1000 : value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      // 纯数字字符串走时间戳分支(Date.parse 对 "1735660800000" 之类一律 NaN)
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (Number.isFinite(num)) {
          ms = num < 10_000_000_000 ? num * 1000 : num;
        }
      } else {
        const parsed = Date.parse(trimmed);
        ms = Number.isNaN(parsed) ? null : parsed;
      }
    } else if (value instanceof Date) {
      ms = value.getTime();
    }
    if (ms == null || !Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    if (format === 'YYYY-MM-DD') {
      return d.toISOString().slice(0, 10);
    }
    if (format === 'YYYY-MM') {
      return d.toISOString().slice(0, 7);
    }
    return d.toISOString();
  }
}
