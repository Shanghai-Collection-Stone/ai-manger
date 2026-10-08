import { KNOWLEDGE_REFERENCE_LIMIT } from '../entities/knowledge.entity.js';

/**
 * @description 归一化母选题上保存的引用知识 ID：只留 24 位十六进制 ObjectId、转小写、去重、按上限截断。
 *   是否存在、是否属于本租户在生成时按租户过滤，保存时不查库，删掉的知识会被自动跳过。
 * @keyword-cn 归一化引用知识ID
 * @keyword-en normalize-knowledge-ids
 * @param ids 原始 ID 列表。
 * @returns {string[]} 归一化后的 ID。
 */
export function normalizeKnowledgeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(
      ids
        .map((id) =>
          String(id ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter((id) => /^[0-9a-f]{24}$/.test(id)),
    ),
  ].slice(0, KNOWLEDGE_REFERENCE_LIMIT);
}
