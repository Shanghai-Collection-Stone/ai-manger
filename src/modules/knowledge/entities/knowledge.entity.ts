import type { ObjectId } from 'mongodb';

/**
 * @description 知识名称最大长度。
 * @keyword-cn 知识名称上限
 * @keyword-en knowledge-name-limit
 */
export const KNOWLEDGE_NAME_MAX_LENGTH = 50;

/**
 * @description 单条知识内容最大长度。
 * @keyword-cn 知识内容上限
 * @keyword-en knowledge-content-limit
 */
export const KNOWLEDGE_CONTENT_MAX_LENGTH = 5000;

/**
 * @description 一个母选题最多引用的知识条数，DTO 与仓储归一化共用。
 * @keyword-cn 引用知识条数上限
 * @keyword-en knowledge-reference-limit
 */
export const KNOWLEDGE_REFERENCE_LIMIT = 10;

/**
 * @description 注入生成提示词的引用知识总字数上限，超出的条目截断，避免挤占模型上下文。
 * @keyword-cn 引用知识提示词预算
 * @keyword-en knowledge-prompt-budget
 */
export const KNOWLEDGE_PROMPT_MAX_LENGTH = 8000;

/**
 * @description 引用知识的数据作用域：同一租户内共享，母平台只看无租户的平台级知识。
 * @keyword-cn 引用知识作用域, 租户共享
 * @keyword-en knowledge-scope, tenant-shared
 */
export interface KnowledgeScope {
  tenantId?: string | null;
  userId: string;
}

/**
 * @description 引用知识条目，集合 `knowledge_items`：母选题生成子题、文章与脚本时作为事实依据注入提示词。
 * @keyword-cn 引用知识实体
 * @keyword-en knowledge-entity
 */
export interface KnowledgeEntity {
  _id: ObjectId;
  tenantId: string | null;
  name: string;
  content: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 引用知识接口视图。
 * @keyword-cn 引用知识视图
 * @keyword-en knowledge-view
 */
export interface KnowledgeView {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
