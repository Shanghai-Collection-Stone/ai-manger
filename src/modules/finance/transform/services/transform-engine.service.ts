import { Injectable } from '@nestjs/common';
import type { FinanceRawRow } from '../../source/types/finance-source.types.js';
import type {
  TransformComputeRule,
  TransformDsl,
  TransformError,
  TransformFieldRule,
  TransformFilterCondition,
  TransformMapRule,
  TransformResult,
  TransformValueType,
} from '../types/transform-dsl.types.js';

type Row = Record<string, unknown>;

/**
 * @description Transform 引擎：把原始飞书行按 DSL 转换为范式数据
 * @keyword-en transform engine, dsl runner, normalize finance data
 */
@Injectable()
export class TransformEngineService {
  /**
   * @description 执行 DSL；单行失败计入 errors 不中断整体
   * @keyword-en run dsl on rows
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
        for (const rule of dsl.fields) {
          this.applyRule(fields, result, rule);
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
   * @keyword-en passes filter and-conjunction
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
   * @keyword-en match single condition
   */
  private matchCondition(row: Row, cond: TransformFilterCondition): boolean {
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
        return left == null || left === '' || (Array.isArray(left) && left.length === 0);
      case 'isNotEmpty':
        return !(left == null || left === '' || (Array.isArray(left) && left.length === 0));
      default:
        return false;
    }
  }

  /**
   * @description 把飞书各种 cell 拍平为 primitive(string/number/boolean);未知 object 返回 null,避免被下游当字符串使用
   * @keyword-en flatten feishu cell to primitive value, never return raw object
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
   * @keyword-en cell to primitive, unrecognized object becomes null
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
   * @keyword-en apply transform field rule
   */
  private applyRule(src: Row, dst: Row, rule: TransformFieldRule): void {
    if ('compute' in rule) {
      dst[rule.to] = this.runCompute(src, rule);
    } else {
      dst[rule.to] = this.runMap(src, rule);
    }
  }

  /**
   * @description 执行直接映射 + 类型转换;源字段为空 OR 类型转换失败时,都用 default 兜底
   * @keyword-en run map rule with default fallback also after cast
   */
  private runMap(src: Row, rule: TransformMapRule): unknown {
    const raw = this.toComparable(src[rule.from]);
    if (raw == null || raw === '') {
      return rule.default ?? null;
    }
    const cast = this.castValue(raw, rule.type, rule.format);
    if (cast == null && typeof rule.default !== 'undefined' && rule.default !== null) {
      return rule.default;
    }
    return cast;
  }

  /**
   * @description 执行计算规则
   * @keyword-en run compute rule
   */
  private runCompute(src: Row, rule: TransformComputeRule): unknown {
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
          result = rule.else ?? null;
          break;
        }
        result = this.matchCondition(src, rule.when)
          ? rule.then
          : (rule.else ?? null);
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
        if (keyStr !== '' && Object.prototype.hasOwnProperty.call(rule.map, keyStr)) {
          result = (rule.map as Record<string, unknown>)[keyStr];
        } else {
          result = null;
        }
        break;
      }
      default:
        result = null;
    }
    if (result == null && typeof rule.default !== 'undefined') {
      result = rule.default;
    }
    if (rule.type) {
      const cast = this.castValue(result, rule.type, undefined);
      // cast 失败(返回 null)仍然走 default 兜底,避免 default 被类型转换悄无声息地吞掉
      if (cast == null && typeof rule.default !== 'undefined' && rule.default !== null) {
        return rule.default;
      }
      return cast;
    }
    return result;
  }

  /**
   * @description 类型转换
   * @keyword-en cast value to type
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
   * @description 日期归一（输出 ISO；format=YYYY-MM-DD 时只取日期）
   * @keyword-en to date string
   */
  private toDate(value: unknown, format?: string): string | null {
    let ms: number | null = null;
    if (typeof value === 'number') {
      ms = value < 10_000_000_000 ? value * 1000 : value;
    } else if (typeof value === 'string') {
      const parsed = Date.parse(value);
      ms = Number.isNaN(parsed) ? null : parsed;
    } else if (value instanceof Date) {
      ms = value.getTime();
    }
    if (ms == null) return null;
    const d = new Date(ms);
    if (format === 'YYYY-MM-DD') {
      return d.toISOString().slice(0, 10);
    }
    return d.toISOString();
  }
}
