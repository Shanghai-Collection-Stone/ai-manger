import { ObjectId } from 'mongodb';

export interface GalleryGroupEntity {
  _id: ObjectId;
  id: number;
  userId: string;
  name: string;
  description?: string;
  tags: string[];
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryGroupCreateInput {
  userId: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface GalleryGroupUpdateInput {
  id: number;
  name?: string;
  description?: string;
  tags?: string[];
}

export interface GalleryGroupSearchResult {
  group: GalleryGroupEntity;
  score: number;
}
