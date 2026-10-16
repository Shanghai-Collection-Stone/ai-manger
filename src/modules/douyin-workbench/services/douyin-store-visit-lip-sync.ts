import type { DouyinStoreVisitLipSyncView } from '../entities/douyin-workbench.entity.js';

/** @description 可灵对口型单个音频片段的最短时长（毫秒），短于它的片段不提交。 @keyword-cn 对口型最短片段, 音频裁剪下限 @keyword-en lip-sync-min-clip, audio-clip-floor */
export const STORE_VISIT_LIP_SYNC_MIN_MS = 2000;

/** @description 出现时长不到视频这个比例的脸视为路人，只有一张脸达标时直接当主播。 @keyword-cn 人脸出现占比, 路人过滤 @keyword-en face-coverage-threshold, passerby-filter */
export const STORE_VISIT_FACE_COVERAGE_MIN = 0.5;

/** @description 交给视觉模型比对的候选脸上限，按出现时长取前几张。 @keyword-cn 候选人脸上限, 视觉比对数量 @keyword-en face-candidate-limit, vision-match-count */
export const STORE_VISIT_FACE_MATCH_LIMIT = 6;

/** @description 对口型主动跳过时的报错前缀，后面跟给用户看的中文原因。 @keyword-cn 对口型跳过标记, 跳过原因 @keyword-en lip-sync-skip-prefix, skip-reason */
export const STORE_VISIT_LIP_SYNC_SKIP_PREFIX = 'STORE_VISIT_LIP_SYNC_SKIP:';

/**
 * @description 把对口型没做成的原始信息翻成一句中文：主动跳过的用自带原因，数眼 404 说明没开放接口，可灵业务错误带对端原话。
 * @keyword-cn 对口型跳过说明, 报错翻译
 * @keyword-en lip-sync-skip-message, error-translation
 * @param {string} raw 原始报错。
 * @returns {string} 「没对上口型：…，已保留原画面」。
 */
export function describeStoreVisitLipSyncSkip(raw: string): string {
  const text = String(raw ?? '');
  const kling = /SHUYAN_KLING_ERROR:(-?\d+):?(.*)/s.exec(text);
  const http = /SHUYAN_VIDEO_HTTP_(\d+)/.exec(text);
  const cause = text.startsWith(STORE_VISIT_LIP_SYNC_SKIP_PREFIX)
    ? text.slice(STORE_VISIT_LIP_SYNC_SKIP_PREFIX.length)
    : kling
      ? `可灵返回错误（${kling[1]}）${kling[2]?.trim() ? `：${kling[2].trim().slice(0, 120)}` : ''}`
      : http?.[1] === '404'
        ? '数眼没有开放可灵人脸识别或对口型接口'
        : http
          ? `对口型接口返回 HTTP ${http[1]}`
          : /NETWORK_ERROR/.test(text)
            ? '连不上对口型接口'
            : '对口型请求失败';
  return `没对上口型：${cause}，已保留原画面`;
}

/** @description 可灵人脸识别返回的一张脸：编号、截图与在视频里出现的起止毫秒。 @keyword-cn 识别到的人脸, 人脸时间段 @keyword-en detected-face, face-time-range */
export interface StoreVisitDetectedFace {
  faceId: string;
  imageUrl: string;
  startMs: number;
  endMs: number;
}

/** @description 提交给可灵对口型的一张脸与它对应的配音片段（毫秒）。 @keyword-cn 对口型人脸片段, 配音时间窗 @keyword-en lip-sync-face-clip, audio-window */
export interface StoreVisitLipSyncFace {
  face_id: string;
  sound_file: string;
  sound_start_time: number;
  sound_end_time: number;
  sound_insert_time: number;
}

/**
 * @description 拼可灵人脸识别或对口型地址：`{网关}/kling/v1/videos/identify-face`、`{网关}/kling/v1/videos/advanced-lip-sync[/{id}]`。
 * @keyword-cn 对口型接口地址, 人脸识别地址
 * @keyword-en lip-sync-task-url, identify-face-url
 * @param {string} gateway 数眼网关。
 * @param {'identify-face'|'advanced-lip-sync'} kind 接口。
 * @param {string} [taskId] 对口型任务 ID，查询时传。
 * @returns {string} 接口地址。
 */
export function buildStoreVisitLipSyncUrl(
  gateway: string,
  kind: 'identify-face' | 'advanced-lip-sync',
  taskId?: string,
): string {
  const base = `${gateway}/kling/v1/videos/${kind}`;
  return taskId ? `${base}/${encodeURIComponent(taskId)}` : base;
}

/**
 * @description 取可灵返回的文本或数字字段（会话 ID、人脸编号、截图），其他类型当空。
 * @keyword-cn 读取识别字段, 文本字段
 * @keyword-en read-face-field, text-field
 * @param {unknown} value 字段值。
 * @returns {string} 去首尾空白的文本。
 */
function readFaceText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

/**
 * @description 读出人脸识别结果：会话 ID 与每张脸的编号、截图和起止毫秒；缺起止时间的按整段视频算。
 * @keyword-cn 解析人脸识别, 人脸会话
 * @keyword-en parse-identify-face, face-session
 * @param {Record<string, unknown>} data 可灵响应的 `data`。
 * @param {number} videoMs 视频时长（毫秒）。
 * @returns {{sessionId: string, faces: StoreVisitDetectedFace[]}} 会话与人脸。
 */
export function readStoreVisitFaces(
  data: Record<string, unknown>,
  videoMs: number,
): { sessionId: string; faces: StoreVisitDetectedFace[] } {
  const list = Array.isArray(data.face_data)
    ? (data.face_data as Array<Record<string, unknown>>)
    : [];
  const faces = list
    .map((item) => {
      const startMs = Math.max(0, Number(item.start_time) || 0);
      const endMs =
        Number(item.end_time) > startMs ? Number(item.end_time) : videoMs;
      const image = readFaceText(item.face_image);
      // 截图可能是地址，也可能是不带前缀的 Base64
      const imageUrl =
        !image || /^(https?:|data:)/i.test(image)
          ? image
          : `data:image/jpeg;base64,${image}`;
      return {
        faceId: readFaceText(item.face_id),
        imageUrl,
        startMs,
        endMs,
      };
    })
    .filter((face) => face.faceId);
  return { sessionId: readFaceText(data.session_id), faces };
}

/**
 * @description 按出现时长挑脸：只有一张脸出现超过半段时直接用它；否则按出现时长排序取前几张交给视觉模型比对，备选为出现超过半段的最长那张。
 * @keyword-cn 挑选主播人脸, 出现时长筛选
 * @keyword-en pick-presenter-face, coverage-filter
 * @param {StoreVisitDetectedFace[]} faces 识别到的人脸。
 * @param {number} videoMs 视频时长（毫秒）。
 * @returns {{direct: StoreVisitDetectedFace|null, candidates: StoreVisitDetectedFace[], fallback: StoreVisitDetectedFace|null}} 直接采用、待比对与比对失败时的备选。
 */
export function planStoreVisitFaceMatch(
  faces: StoreVisitDetectedFace[],
  videoMs: number,
): {
  direct: StoreVisitDetectedFace | null;
  candidates: StoreVisitDetectedFace[];
  fallback: StoreVisitDetectedFace | null;
} {
  const span = (face: StoreVisitDetectedFace) => face.endMs - face.startMs;
  const sorted = [...faces].sort((a, b) => span(b) - span(a));
  const qualified = sorted.filter(
    (face) => span(face) >= videoMs * STORE_VISIT_FACE_COVERAGE_MIN,
  );
  if (qualified.length === 1)
    return { direct: qualified[0], candidates: [], fallback: qualified[0] };
  return {
    direct: null,
    candidates: sorted.slice(0, STORE_VISIT_FACE_MATCH_LIMIT),
    fallback: qualified[0] ?? null,
  };
}

/**
 * @description 写人脸比对任务：第一张是出镜人物参考照，后面依次是候选脸，返回与参考照同一个人的编号（同一人被拆成多段时都要列出）。
 * @keyword-cn 人脸比对提示, 主播身份确认
 * @keyword-en face-match-brief, presenter-identity-check
 * @param {number} count 候选脸数量。
 * @returns {string} 提示词。
 */
export function buildStoreVisitFaceMatchBrief(count: number): string {
  return [
    `图片1是探店视频出镜人物的参考照。图片2到图片${count + 1}依次是视频里识别到的候选人脸 1 到 ${count}。`,
    '逐张比对脸型、五官、发型和肤色，找出与参考照是同一个人的候选脸。同一个人可能因为转身被拆成多张，都要列出；路人、店员和其他顾客不要列。',
    '只返回 JSON：{"matches":[候选编号...]}，都不是同一个人时返回 {"matches":[]}。',
  ].join('\n');
}

/**
 * @description 解析人脸比对结果：只收 1..count 内的去重编号，JSON 不合法时抛错交给调用方退回备选。
 * @keyword-cn 解析人脸比对, 候选编号校验
 * @keyword-en parse-face-matches, candidate-index-check
 * @param {string} text 视觉模型输出。
 * @param {number} count 候选脸数量。
 * @returns {number[]} 匹配的候选编号（从 1 开始）。
 */
export function parseStoreVisitFaceMatches(
  text: string,
  count: number,
): number[] {
  const value = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  ) as { matches?: unknown };
  if (!Array.isArray(value.matches))
    throw new Error('人脸比对结果缺少 matches');
  return [
    ...new Set(
      value.matches
        .map(Number)
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= count),
    ),
  ];
}

/**
 * @description 把选中的脸按出现时间排开，各自对上同一时间段的配音（配音从视频第 0 秒铺，音频时间与视频时间一致），重叠部分归先出现的脸，短于 2 秒的片段不提交。
 * @keyword-cn 对口型片段编排, 配音时间切分
 * @keyword-en build-lip-sync-clips, audio-time-split
 * @param {StoreVisitDetectedFace[]} faces 选中的脸。
 * @param {{audioMs: number, videoMs: number, soundFile: string}} input 配音时长、视频时长（毫秒）与配音地址。
 * @returns {StoreVisitLipSyncFace[]} 可灵 `face_choose`。
 */
export function buildStoreVisitLipSyncFaces(
  faces: StoreVisitDetectedFace[],
  input: { audioMs: number; videoMs: number; soundFile: string },
): StoreVisitLipSyncFace[] {
  const limit = Math.min(input.audioMs, input.videoMs);
  let cursor = 0;
  const clips: StoreVisitLipSyncFace[] = [];
  for (const face of [...faces].sort((a, b) => a.startMs - b.startMs)) {
    const start = Math.max(face.startMs, cursor);
    const end = Math.min(face.endMs, limit);
    if (end - start < STORE_VISIT_LIP_SYNC_MIN_MS) continue;
    clips.push({
      face_id: face.faceId,
      sound_file: input.soundFile,
      sound_start_time: Math.round(start),
      sound_end_time: Math.round(end),
      sound_insert_time: Math.round(start),
    });
    cursor = end;
  }
  return clips;
}

/**
 * @description 对外只给对口型阶段与跳过原因，会话、任务 ID 与原视频地址留在服务端。
 * @keyword-cn 对口型状态视图, 隐藏内部字段
 * @keyword-en lip-sync-view, hide-internal-fields
 * @param {DouyinStoreVisitLipSyncView} [state] 调用记录上的对口型状态。
 * @returns {DouyinStoreVisitLipSyncView|undefined} 前端视图。
 */
export function toStoreVisitLipSyncView(
  state?: DouyinStoreVisitLipSyncView,
): DouyinStoreVisitLipSyncView | undefined {
  return state
    ? { stage: state.stage, ...(state.reason ? { reason: state.reason } : {}) }
    : undefined;
}
