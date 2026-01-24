import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

/**
 * @title 向量嵌入服务 Embedding Service
 * @description 使用 Google Generative AI 生成文本向量嵌入，支持单文本和批量处理。
 * @keywords-cn 向量, 嵌入, Google AI, 文本向量化
 * @keywords-en embedding, vector, Google AI, text vectorization
 */
@Injectable()
export class EmbeddingService {
  private readonly embeddings: GoogleGenerativeAIEmbeddings;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey,
      model: 'text-embedding-004',
    });
  }

  /**
   * @title 单文本向量化 Embed Single Text
   * @description 将单个文本转换为向量（768维）。
   * @keywords-cn 单文本, 向量化
   * @keywords-en single text, vectorize
   * @param text 待向量化的文本
   * @returns 768维浮点数数组
   */
  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array<number>(768).fill(0);
    }
    try {
      const vector = await this.embeddings.embedQuery(text);
      return vector;
    } catch (error) {
      console.error('Embedding failed:', error);
      return new Array<number>(768).fill(0);
    }
  }

  /**
   * @title 批量文本向量化 Embed Batch Texts
   * @description 批量将多个文本转换为向量。
   * @keywords-cn 批量, 向量化
   * @keywords-en batch, vectorize
   * @param texts 待向量化的文本数组
   * @returns 二维数组，每个元素是对应文本的768维向量
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }
    try {
      const vectors = await this.embeddings.embedDocuments(texts);
      return vectors;
    } catch (error) {
      console.error('Batch embedding failed:', error);
      return texts.map(() => new Array<number>(768).fill(0));
    }
  }

  /**
   * @title 计算余弦相似度 Calculate Cosine Similarity
   * @description 计算两个向量之间的余弦相似度。
   * @keywords-cn 余弦相似度, 向量比较
   * @keywords-en cosine similarity, vector comparison
   * @param vecA 向量A
   * @param vecB 向量B
   * @returns 相似度值（-1 到 1 之间）
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
      return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
  }
}
