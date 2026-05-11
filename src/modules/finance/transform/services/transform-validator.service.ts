import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  TransformComputeRule,
  TransformDsl,
  TransformFieldRule,
  TransformFilterCondition,
  TransformMapRule,
} from '../types/transform-dsl.types.js';

const VALID_FILTER_OPS = new Set([
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'isEmpty',
  'isNotEmpty',
]);

const VALID_COMPUTE_OPS = new Set([
  'concat',
  'sum',
  'if',
  'coalesce',
  'const',
  'lookup',
]);

const VALID_TYPES = new Set(['string', 'number', 'boolean', 'date', 'array']);

/**
 * @description Transform DSL 校验器（落库前/Agent 输出后调用）
 * @keyword-en transform validator, dsl schema check
 */
@Injectable()
export class TransformValidatorService {
  /**
   * @description 校验 DSL 结构合法性，抛 BadRequestException；string 入参自动 JSON.parse 兜底（LLM 常 stringify）
   * @keyword-en validate dsl structure with string fallback
   */
  validate(dsl: unknown): TransformDsl {
    let parsed: unknown = dsl;
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (!trimmed) {
        throw new BadRequestException('TRANSFORM_DSL_INVALID:empty string');
      }
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        throw new BadRequestException(
          `TRANSFORM_DSL_INVALID:dsl 是字符串但不是合法 JSON · ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(
        `TRANSFORM_DSL_INVALID:期望 object，收到 ${
          parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed
        }`,
      );
    }
    const obj = parsed as Record<string, unknown>;
    const version = Number(obj.version ?? 1);
    if (!Number.isFinite(version) || version < 1) {
      throw new BadRequestException(
        `TRANSFORM_DSL_VERSION_INVALID:version 必须是 ≥1 的整数，收到 ${String(obj.version)}`,
      );
    }
    const fieldsRaw = obj.fields;
    if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
      throw new BadRequestException(
        'TRANSFORM_DSL_FIELDS_REQUIRED:fields 必须是非空数组',
      );
    }
    const fields = fieldsRaw.map((rule, idx) =>
      this.validateField(rule, idx),
    );
    const filterRaw = obj.filter;
    let filter: TransformFilterCondition[] | undefined;
    if (typeof filterRaw !== 'undefined' && filterRaw !== null) {
      if (!Array.isArray(filterRaw)) {
        throw new BadRequestException(
          'TRANSFORM_DSL_FILTER_INVALID:filter 必须是数组（或省略）',
        );
      }
      filter = filterRaw.map((c, idx) => this.validateCondition(c, `filter[${idx}]`));
    }
    return { version, filter, fields };
  }

  /**
   * @description 校验单条字段规则
   * @keyword-en validate field rule
   */
  private validateField(input: unknown, idx: number): TransformFieldRule {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException(`TRANSFORM_FIELD_INVALID:${idx}`);
    }
    const obj = input as Record<string, unknown>;
    const to = String(obj.to ?? '').trim();
    if (!to) {
      throw new BadRequestException(`TRANSFORM_FIELD_TO_REQUIRED:${idx}`);
    }
    if (typeof obj.compute !== 'undefined') {
      const op = String(obj.compute);
      if (!VALID_COMPUTE_OPS.has(op)) {
        throw new BadRequestException(`TRANSFORM_FIELD_COMPUTE_INVALID:${idx}`);
      }
      const rule: TransformComputeRule = {
        to,
        compute: op as TransformComputeRule['compute'],
        fields: Array.isArray(obj.fields)
          ? obj.fields.map((f) => String(f))
          : undefined,
        sep: typeof obj.sep === 'string' ? obj.sep : undefined,
        when:
          typeof obj.when !== 'undefined'
            ? this.validateCondition(obj.when, `field[${idx}].when`)
            : undefined,
        then: obj.then,
        else: obj.else,
        value: obj.value,
        from:
          typeof obj.from === 'string' && obj.from.trim()
            ? obj.from.trim()
            : undefined,
        map:
          obj.map && typeof obj.map === 'object' && !Array.isArray(obj.map)
            ? (obj.map as Record<string, unknown>)
            : undefined,
        type: this.validateType(obj.type, `field[${idx}]`),
        default: obj.default,
      };
      if (op === 'if' && !rule.when) {
        throw new BadRequestException(`TRANSFORM_FIELD_IF_NEEDS_WHEN:${idx}`);
      }
      if ((op === 'concat' || op === 'sum' || op === 'coalesce') && (!rule.fields || rule.fields.length === 0)) {
        throw new BadRequestException(`TRANSFORM_FIELD_FIELDS_REQUIRED:${idx}`);
      }
      if (op === 'const' && typeof rule.value === 'undefined') {
        throw new BadRequestException(`TRANSFORM_FIELD_CONST_NEEDS_VALUE:${idx}`);
      }
      if (op === 'lookup') {
        if (!rule.from) {
          throw new BadRequestException(`TRANSFORM_FIELD_LOOKUP_NEEDS_FROM:${idx}`);
        }
        if (!rule.map) {
          throw new BadRequestException(`TRANSFORM_FIELD_LOOKUP_NEEDS_MAP:${idx}`);
        }
      }
      return rule;
    }
    const from = String(obj.from ?? '').trim();
    if (!from) {
      throw new BadRequestException(`TRANSFORM_FIELD_FROM_REQUIRED:${idx}`);
    }
    const rule: TransformMapRule = {
      to,
      from,
      type: this.validateType(obj.type, `field[${idx}]`),
      format: typeof obj.format === 'string' ? obj.format : undefined,
      default: obj.default,
    };
    return rule;
  }

  /**
   * @description 校验过滤条件
   * @keyword-en validate filter condition
   */
  private validateCondition(
    input: unknown,
    label: string,
  ): TransformFilterCondition {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException(`TRANSFORM_CONDITION_INVALID:${label}`);
    }
    const obj = input as Record<string, unknown>;
    const field = String(obj.field ?? '').trim();
    const op = String(obj.op ?? '');
    if (!field) {
      throw new BadRequestException(`TRANSFORM_CONDITION_FIELD_REQUIRED:${label}`);
    }
    if (!VALID_FILTER_OPS.has(op)) {
      throw new BadRequestException(`TRANSFORM_CONDITION_OP_INVALID:${label}`);
    }
    return {
      field,
      op: op as TransformFilterCondition['op'],
      value: obj.value,
    };
  }

  /**
   * @description 校验类型字段
   * @keyword-en validate value type
   */
  private validateType(
    value: unknown,
    label: string,
  ): TransformMapRule['type'] {
    if (typeof value === 'undefined') return undefined;
    const str = String(value);
    if (!VALID_TYPES.has(str)) {
      throw new BadRequestException(`TRANSFORM_TYPE_INVALID:${label}`);
    }
    return str as TransformMapRule['type'];
  }
}
