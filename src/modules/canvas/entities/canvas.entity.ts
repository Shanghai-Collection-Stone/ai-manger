import { ObjectId } from 'mongodb';

export type CanvasStatus =
  | 'generating'
  | 'completed'
  | 'requires_human'
  | 'failed';

export interface CanvasArticleEntity {
  id: number;
  title: string;
  tags: string[];
  contentJson: Record<string, unknown>;
  imageUrls?: string[];
  imageIds?: number[];
  status: 'pending' | 'done' | 'requires_human' | 'failed';
  doneNote?: string;
}

export interface CanvasEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  topic?: string;
  outline?: Record<string, unknown>;
  style?: Record<string, unknown>;
  status: CanvasStatus;
  articles: CanvasArticleEntity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CanvasCreateInput {
  userId: string;
  topic?: string;
  outline?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

export interface CanvasAddArticlesInput {
  articles: Array<{
    title: string;
    tags?: string[];
    contentJson: Record<string, unknown>;
  }>;
}

export interface CanvasUpdateStatusInput {
  status: CanvasStatus;
}

export interface CanvasUpdateArticleInput {
  title?: string;
  tags?: string[];
  contentJson?: Record<string, unknown>;
  imageUrls?: string[];
  status?: CanvasArticleEntity['status'];
  doneNote?: string;
}
