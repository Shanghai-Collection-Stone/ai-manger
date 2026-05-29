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
  'between',
  'regex',
  'notRegex',
  'or',
  'and',
]);

const VALID_COMPUTE_OPS = new Set([
  'concat',
  'sum',
  'if',
  'coalesce',
  'const',
  'lookup',
  'regex',
]);

const VALID_TYPES = new Set(['string', 'number', 'boolean', 'date', 'array']);

const VALID_MERGE_MODES = new Set([
  'auto',
  'replace',
  'append',
  'array',
  'concat',
  'sum',
  'object',
]);

/**
 * @description Transform DSL 校验器（落库前/Agent 输出后调用）
 * @keyword-en transform-validator, dsl-schema-check
 */
@Injectable()
export class TransformValidatorService {
  /**
   * @description 校验 DSL 结构合法性，抛 BadRequestException；string 入参自动 JSON.parse 兜底（LLM 常 stringify）
   * @keyword-en dsl-validate, string-fallback
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
          parsed === null
            ? 'null'
            : Array.isArray(parsed)
              ? 'array'
              : typeof parsed
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
    const fields = fieldsRaw.map((rule, idx) => this.validateField(rule, idx));
    const filterRaw = obj.filter;
    let filter: TransformFilterCondition[] | undefined;
    if (typeof filterRaw !== 'undefined' && filterRaw !== null) {
      if (!Array.isArray(filterRaw)) {
        throw new BadRequestException(
          'TRANSFORM_DSL_FILTER_INVALID:filter 必须是数组（或省略）',
        );
      }
      filter = filterRaw.map((c, idx) =>
        this.validateCondition(c, `filter[${idx}]`),
      );
    }
    return { version, filter, fields };
  }

  /**
   * @description 校验单条字段规则
   * @keyword-en field-rule-validate, dsl-field
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
    if (obj.compute != null) {
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
          obj.when != null
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
        pattern: typeof obj.pattern === 'string' ? obj.pattern : undefined,
        flags: typeof obj.flags === 'string' ? obj.flags : undefined,
        index:
          typeof obj.index === 'number' && Number.isFinite(obj.index)
            ? obj.index
            : undefined,
        type: this.validateType(obj.type, `field[${idx}]`),
        format: typeof obj.format === 'string' ? obj.format : undefined,
        default: obj.default,
        merge: this.validateMerge(obj.merge, `field[${idx}]`),
      };
      if (op === 'if' && !rule.when) {
        throw new BadRequestException(`TRANSFORM_FIELD_IF_NEEDS_WHEN:${idx}`);
      }
      if (
        (op === 'concat' || op === 'sum' || op === 'coalesce') &&
        (!rule.fields || rule.fields.length === 0)
      ) {
        throw new BadRequestException(`TRANSFORM_FIELD_FIELDS_REQUIRED:${idx}`);
      }
      if (op === 'const' && typeof rule.value === 'undefined') {
        throw new BadRequestException(
          `TRANSFORM_FIELD_CONST_NEEDS_VALUE:${idx}`,
        );
      }
      if (op === 'lookup') {
        if (!rule.from) {
          throw new BadRequestException(
            `TRANSFORM_FIELD_LOOKUP_NEEDS_FROM:${idx}`,
          );
        }
        if (!rule.map) {
          throw new BadRequestException(
            `TRANSFORM_FIELD_LOOKUP_NEEDS_MAP:${idx}`,
          );
        }
      }
      if (op === 'regex') {
        if (!rule.from) {
          throw new BadRequestException(
            `TRANSFORM_FIELD_REGEX_NEEDS_FROM:${idx}`,
          );
        }
        if (!rule.pattern) {
          throw new BadRequestException(
            `TRANSFORM_FIELD_REGEX_NEEDS_PATTERN:${idx}`,
          );
        }
        this.assertRegexCompiles(rule.pattern, rule.flags, `field[${idx}]`);
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
      merge: this.validateMerge(obj.merge, `field[${idx}]`),
    };
    return rule;
  }

  /**
   * @description 校验过滤条件
   * @keyword-en filter-condition-validate, filter-op
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
    if (!VALID_FILTER_OPS.has(op)) {
      throw new BadRequestException(`TRANSFORM_CONDITION_OP_INVALID:${label}`);
    }
    if (op === 'or' || op === 'and') {
      if (!Array.isArray(obj.conditions) || obj.conditions.length === 0) {
        throw new BadRequestException(
          `TRANSFORM_CONDITION_GROUP_REQUIRED:${label}`,
        );
      }
      return {
        op: op as TransformFilterCondition['op'],
        conditions: obj.conditions.map((item, idx) =>
          this.validateCondition(item, `${label}.conditions[${idx}]`),
        ),
      };
    }
    if (!field) {
      throw new BadRequestException(
        `TRANSFORM_CONDITION_FIELD_REQUIRED:${label}`,
      );
    }
    if (op === 'regex' || op === 'notRegex') {
      const { pattern, flags } = this.readRegexValue(obj.value);
      if (!pattern) {
        throw new BadRequestException(
          `TRANSFORM_CONDITION_REGEX_NEEDS_PATTERN:${label}`,
        );
      }
      this.assertRegexCompiles(pattern, flags, label);
    }
    return {
      field,
      op: op as TransformFilterCondition['op'],
      value: obj.value,
    };
  }

  /**
   * @description 从 filter condition 的 value 读出 regex { pattern, flags };支持纯字符串 pattern 或 \`{pattern, flags}\` 对象
   * @keyword-en regex-value-read, regex-shape
   */
  readRegexValue(value: unknown): { pattern?: string; flags?: string } {
    if (typeof value === 'string') return { pattern: value };
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      return {
        pattern: typeof obj.pattern === 'string' ? obj.pattern : undefined,
        flags: typeof obj.flags === 'string' ? obj.flags : undefined,
      };
    }
    return {};
  }

  /**
   * @description 落库期编译一次 regex 失败即拒收,避免无效 pattern 进库后行级反复抛错
   * @keyword-en regex-compile-check, dsl-validate
   */
  assertRegexCompiles(pattern: string, flags: string | undefined, label: string): void {
    try {
      new RegExp(pattern, flags);
    } catch (err) {
      throw new BadRequestException(
        `TRANSFORM_REGEX_INVALID:${label}:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * @description 校验类型字段
   * @keyword-en value-type-validate, value-cast
   */
  private validateType(
    value: unknown,
    label: string,
  ): TransformMapRule['type'] {
    if (value == null) return undefined;
    const str = String(value);
    if (!VALID_TYPES.has(str)) {
      throw new BadRequestException(`TRANSFORM_TYPE_INVALID:${label}`);
    }
    return str as TransformMapRule['type'];
  }

  /**
   * @description 校验同名输出字段合并策略
   * @keyword-en merge-mode-validate, duplicate-field
   */
  private validateMerge(
    value: unknown,
    label: string,
  ): TransformMapRule['merge'] {
    if (value == null) return undefined;
    const str = String(value);
    if (!VALID_MERGE_MODES.has(str)) {
      throw new BadRequestException(`TRANSFORM_MERGE_INVALID:${label}`);
    }
    return str as TransformMapRule['merge'];
  }
}
