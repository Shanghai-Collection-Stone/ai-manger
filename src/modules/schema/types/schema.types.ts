/**
 * @title Schema 覆盖类型 Schema Overrides Types
 * @description AI优化返回结构的类型与安全解析器。
 * @keywords-cn Schema, 覆盖, 解析
 * @keywords-en schema, overrides, parse
 */
import { z } from 'zod';

export const ZFieldOverride = z.object({
  nameCn: z.string().optional(),
  description: z.string().optional(),
});

export const ZTableOverride = z.object({
  nameCn: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fields: z.record(ZFieldOverride).optional(),
});

export const ZOverrides = z.record(ZTableOverride);

export type FieldOverride = z.infer<typeof ZFieldOverride>;
export type TableOverride = z.infer<typeof ZTableOverride>;
export type Overrides = z.infer<typeof ZOverrides>;

export const ZFieldArrayItem = z.object({
  name: z.string(),
  nameCn: z.string().optional(),
  description: z.string().optional(),
});

export const ZOverridesAlt = z.object({
  table: z.object({
    name: z.string(),
    nameCn: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    fields: z.array(ZFieldArrayItem),
  }),
});

export type FieldArrayItem = z.infer<typeof ZFieldArrayItem>;

export const ZTableOverrideAlt = z.object({
  nameCn: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fields: z.array(ZFieldArrayItem).optional(),
});

export const ZOverridesKeyedAlt = z.record(ZTableOverrideAlt);
