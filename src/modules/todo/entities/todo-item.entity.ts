import { ObjectId } from 'mongodb';

export type TodoItemStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface TodoItemEntity {
  _id: ObjectId;
  id: number;
  todoId: number;
  tenantId?: string;
  userId: string;
  title: string;
  description?: string;
  plannedAt?: Date;
  status: TodoItemStatus;
  stage?: string;
  doneNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TodoItemCreateInput {
  todoId: number;
  tenantId?: string;
  title: string;
  description?: string;
  plannedAt?: Date;
  status?: TodoItemStatus;
  stage?: string;
  doneNote?: string;
}

export interface TodoItemUpdateInput {
  id: number;
  tenantId?: string;
  title?: string;
  description?: string;
  plannedAt?: Date;
  status?: TodoItemStatus;
  stage?: string;
  doneNote?: string;
}
