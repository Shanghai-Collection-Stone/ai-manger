import { ObjectId } from 'mongodb';

export type BatchTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'cancelled';

export type BatchTaskPostStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface BatchTaskPostEntity {
  id: number;
  title: string;
  plannedAt?: Date;
  todoItemId?: number;
  mcpPostId?: string;
  payload?: Record<string, unknown>;
  status: BatchTaskPostStatus;
  stage?: string;
  doneNote?: string;
  result?: unknown;
}

export interface BatchTaskEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  platform?: string;
  topic?: string;
  canvasId?: string;
  mcpTaskId?: string;
  todoId?: number;
  status: BatchTaskStatus;
  posts: BatchTaskPostEntity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchTaskCreateInput {
  userId: string;
  platform?: string;
  topic?: string;
  canvasId?: string;
  mcpTaskId?: string;
}

export interface BatchTaskAddPostsInput {
  posts: Array<{
    title: string;
    plannedAt?: string;
    payload?: Record<string, unknown>;
  }>;
  concurrency?: number;
}

export interface BatchTaskRunInput {
  callbackUrl?: string;
  payload?: Record<string, unknown>;
}

export interface BatchTaskCallbackInput {
  mcpTaskId?: string;
  taskId?: string;
  posts?: Array<{
    mcpPostId?: string;
    postId?: number;
    status?: BatchTaskPostStatus;
    stage?: string;
    doneNote?: string;
    result?: unknown;
  }>;
  status?: BatchTaskStatus;
  error?: string;
  raw?: unknown;
}
