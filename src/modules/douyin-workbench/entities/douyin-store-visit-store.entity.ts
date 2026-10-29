import { ObjectId } from 'mongodb';

/**
 * @description 探店门店与点位的上限：每租户门店不限，每店最多 40 个点位，每个点位最多 40 张图片、6 段实拍视频；点位名 30 字、点位说明 500 字、单张图片描述 300 字。
 * @keyword-cn 探店点位上限, 点位图片上限
 * @keyword-en store-visit-spot-limits, spot-image-limit
 */
export const DOUYIN_STORE_VISIT_SPOT_LIMITS = {
  spots: 40,
  images: 40,
  videos: 6,
  name: 30,
  description: 500,
  imageDescription: 300,
} as const;

/**
 * @description AI 给图片打的精细度分数达到这一档（满分 10）就自动收藏，下次写台词、挑参考图时优先选用。
 * @keyword-cn 自动收藏分数线, 精细度打分
 * @keyword-en auto-favorite-score, fineness-score
 */
export const DOUYIN_STORE_VISIT_SPOT_FAVORITE_SCORE = 8;

/**
 * @description 点位里的一张图片：场景图库里的图库图片引用，带 AI 写的图片描述与精细度打分（1～10，越清晰、构图越完整、越能代表这个点位越高）。
 * @keyword-cn 点位图片, 图片描述打分
 * @keyword-en spot-image, image-description-score
 */
export interface DouyinStoreVisitSpotImage {
  imageId: number;
  url: string;
  thumbUrl?: string;
  /** @description 这张图拍到了什么（AI 看图写，用户可改），同步写进图库备注 */
  description: string;
  /** @description 精细度打分 1～10，达到 `DOUYIN_STORE_VISIT_SPOT_FAVORITE_SCORE` 时图库里自动收藏 */
  score: number;
}

/**
 * @description 点位的补充实拍视频：视频库视频引用与说明，写台词时作为事实依据，生成时可作参考视频。
 * @keyword-cn 点位实拍视频, 补充素材
 * @keyword-en spot-video, supplemental-footage
 */
export interface DouyinStoreVisitSpotVideo {
  videoId: number;
  url: string;
  coverUrl?: string;
  name: string;
  description: string;
  durationSeconds?: number;
}

/**
 * @description 门店的一个点位（场景）：一个游乐设备、一个打卡点、一道招牌菜或门头，由多张图片（可加实拍视频）组成；
 *   名称由使用者确认，说明写清它是什么、团购价与份量或可玩项目（AI 写台词只复述这里与图片描述里的事实）。
 * @keyword-cn 探店点位, 场景归类
 * @keyword-en store-visit-spot, scene-cluster
 */
export interface DouyinStoreVisitSpot {
  id: string;
  name: string;
  description: string;
  /** @description 门头、招牌、店外这类适合开场报店名的点位 */
  opening?: boolean;
  images: DouyinStoreVisitSpotImage[];
  videos: DouyinStoreVisitSpotVideo[];
  updatedAt: Date;
}

/**
 * @description 探店门店：租户内共享，名称与整体说明（位置、人均、营业时间）加上它的点位；探店选题选了门店后只看这家店的点位。
 * @keyword-cn 探店门店, 门店点位
 * @keyword-en store-visit-store, store-spots
 */
export interface DouyinStoreVisitStoreEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string;
  /** @description 创建人，门店在租户内共享 */
  userId: string;
  name: string;
  description: string;
  spots: DouyinStoreVisitSpot[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 对外返回的门店：去掉 Mongo 主键。
 * @keyword-cn 门店视图, 隐藏数据库ID
 * @keyword-en store-visit-store-view, hide-database-id
 */
export type DouyinStoreVisitStoreView = Omit<
  DouyinStoreVisitStoreEntity,
  '_id'
>;

/**
 * @description AI 归类时逐条推给前端的事件（NDJSON 每行一条）：模型每调用一次归类工具就推 `assign`，归入新点位时先推 `spot`（服务端生成 `new-` 草稿键，名称要使用者确认后才保存），
 *   一批结束推 `done`（归上的与没归上的图片），出错推 `error`。
 * @keyword-cn 归类推送事件, 实时归类
 * @keyword-en classify-stream-event, realtime-classification
 */
export type DouyinStoreVisitClassifyEvent =
  | {
      type: 'spot';
      key: string;
      name: string;
      description: string;
      opening: boolean;
    }
  | {
      type: 'assign';
      imageId: number;
      spotKey: string;
      description: string;
      score: number;
    }
  | { type: 'done'; assigned: number[]; missed: number[] }
  | { type: 'error'; message: string };
