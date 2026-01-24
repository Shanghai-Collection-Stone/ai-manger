import { ObjectId } from 'mongodb';

/**
 * @title 思维链实体 Skill Thought Entity
 * @description 表示一条思维链记录，用于总结和检索历史解决方案。
 * @keywords-cn 思维链, 实体, 向量搜索, 经验总结
 * @keywords-en skill thought, entity, vector search, experience summary
 */
export interface SkillThoughtEntity {
  _id: ObjectId;
  /**
   * 技能文字（长文）- 完整的思维链内容
   */
  content: string;
  /**
   * 摘要（用于快速检索）
   */
  summary: string;
  /**
   * 关键词列表
   */
  keywords: string[];
  /**
   * 向量字段（768维，Google Embeddings text-embedding-004）
   */
  embedding: number[];
  /**
   * 关联的会话ID（可选）
   */
  sessionId?: string;
  /**
   * 使用的工具列表
   */
  toolsUsed?: string[];
  /**
   * 思维链类型/分类
   */
  category?: string;
  /**
   * 使用次数（用于排序和优化）
   */
  usageCount: number;
  /**
   * 创建时间
   */
  createdAt: Date;
  /**
   * 更新时间
   */
  updatedAt: Date;
}

/**
 * @title 思维链创建输入 Skill Thought Create Input
 * @description 创建思维链时的输入参数。
 */
export interface SkillThoughtCreateInput {
  content: string;
  summary: string;
  keywords: string[];
  sessionId?: string;
  toolsUsed?: string[];
  category?: string;
}

/**
 * @title 思维链搜索结果 Skill Thought Search Result
 * @description 向量相似度搜索的结果。
 */
export interface SkillThoughtSearchResult {
  thought: SkillThoughtEntity;
  score: number;
}

/**
 * @title 思维链更新输入 Skill Thought Update Input
 * @description 更新思维链时的输入参数。
 */
export interface SkillThoughtUpdateInput {
  content?: string;
  summary?: string;
  keywords?: string[];
  toolsUsed?: string[];
  category?: string;
}
