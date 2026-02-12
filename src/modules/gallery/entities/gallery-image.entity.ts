import { ObjectId } from 'mongodb';

export interface GalleryImageEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  groupId?: number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  tags: string[];
  description?: string;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryImageCreateInput {
  userId: string;
  groupId?: number;
  originalName: string;
  fileName: string;
  url: string;
  thumbFileName?: string;
  thumbUrl?: string;
  absPath?: string;
  mimeType?: string;
  size?: number;
  tags?: string[];
  description?: string;
}

export interface GallerySearchResult {
  image: GalleryImageEntity;
  score: number;
}
