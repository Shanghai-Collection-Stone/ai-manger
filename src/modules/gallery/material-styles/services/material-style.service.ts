import { Injectable } from '@nestjs/common';
import {
  MATERIAL_STYLE_GROUPS,
  MATERIAL_STYLE_PRESETS,
  type MaterialStyleGroupId,
  type MaterialStylePreset,
} from '../material-style.presets.js';

/**
 * @description 素材面板风格选择卡片需要的对外字段，刻意不下发 `descriptor`——
 * 提示词是服务端实现细节，前端只负责展示与回传 `id`。
 * @keyword-cn 风格选项, 风格列表项
 * @keyword-en material-style-option
 */
export type MaterialStyleOption = Pick<
  MaterialStylePreset,
  'id' | 'label' | 'group' | 'summary'
>;

/**
 * @description 随机风格的保留标识。前端选「随机风格」时回传该值，由服务端每次
 * 现挑一条，保证同一句描述连点几次也能出不同气质的素材。
 * @keyword-cn 随机风格
 * @keyword-en random-style
 */
export const RANDOM_MATERIAL_STYLE = 'random';

/**
 * @description AI 素材风格预设的查询与提示词拼装服务。
 * @keyword-cn 素材风格服务, 风格预设
 * @keyword-en material-style-service, material-style-preset
 */
@Injectable()
export class MaterialStyleService {
  /**
   * @description 列出全部风格预设与分组，供素材面板渲染风格选择区。
   * @returns {{ groups: Array<{ id: MaterialStyleGroupId; label: string }>; styles: MaterialStyleOption[] }} 分组与风格列表。
   * @keyword-cn 风格列表, 风格分组
   * @keyword-en list-material-styles, material-style-group
   */
  listStyles(): {
    groups: Array<{ id: MaterialStyleGroupId; label: string }>;
    styles: MaterialStyleOption[];
  } {
    return {
      groups: MATERIAL_STYLE_GROUPS.map((group) => ({ ...group })),
      styles: MATERIAL_STYLE_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        group: preset.group,
        summary: preset.summary,
      })),
    };
  }

  /**
   * @description 按 id 解析风格预设；传 `random` 时随机挑一条，传空或未知 id 时返回 null
   * 表示本次不套风格，让老的「纯描述词生成」行为原样保留。
   * @param {string} [id] - 风格预设 id 或 `random`。
   * @returns {MaterialStylePreset | null} 命中的预设，未命中为 null。
   * @keyword-cn 解析风格, 随机风格
   * @keyword-en resolve-material-style, random-style
   */
  resolveStyle(id?: string): MaterialStylePreset | null {
    const key = String(id ?? '').trim();
    if (!key) return null;
    if (key === RANDOM_MATERIAL_STYLE) {
      const index = Math.floor(Math.random() * MATERIAL_STYLE_PRESETS.length);
      return MATERIAL_STYLE_PRESETS[index] ?? null;
    }
    return MATERIAL_STYLE_PRESETS.find((preset) => preset.id === key) ?? null;
  }

  /**
   * @description 把风格预设拼成生图提示词里的独立段落。刻意再声明一次「只借视觉处理、
   * 不要文字」——预设描述里出现「手写笔刷」「大字块」这类词会诱导模型直接画字，
   * 而 `ai-material` 的产物必须是可去底的无字贴纸。
   * @param {MaterialStylePreset | null} preset - 已解析的风格预设。
   * @returns {string} 提示词段落，未选风格时为空串。
   * @keyword-cn 风格提示词, 风格段落
   * @keyword-en build-style-prompt, style-paragraph
   */
  buildStylePrompt(preset: MaterialStylePreset | null): string {
    if (!preset) return '';
    return [
      `【风格预设 - ${preset.label}】${preset.descriptor}`,
      '风格预设只决定配色、笔触质感、描边方式和装饰元素语言；它不改变主体是什么，也不允许因此画出任何文字、字母或数字。',
    ].join('\n');
  }
}
