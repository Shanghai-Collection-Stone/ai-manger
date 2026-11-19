/**
 * @description 判断向量是否可用：至少有一个有限的非零分量。向量服务没配置或调用失败时 EmbeddingService 返回全 0 向量，
 *   这种向量和谁算余弦相似度都是 0，不能参与检索。
 * @keyword-cn 有效向量判断, 全零向量
 * @keyword-en usable-embedding-check, zero-vector
 */
export function hasUsableEmbedding(vec: unknown): vec is number[] {
  return (
    Array.isArray(vec) &&
    vec.some((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0)
  );
}

/**
 * @description 写库前规整向量：可用就原样保留，全 0、空或非法时存空数组，不再写 768 个 0 占用文档体积。
 * @keyword-cn 规整入库向量, 不存零向量
 * @keyword-en normalize-stored-embedding, skip-zero-vector
 */
export function toStoredEmbedding(vec: unknown): number[] {
  return hasUsableEmbedding(vec) ? vec : [];
}
