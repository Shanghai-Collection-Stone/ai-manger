/**
 * @description 模型还没有实测耗时时，一个任务按 3 分钟估算。
 * @keyword-cn 默认任务耗时, 排队估时兜底
 * @keyword-en default-task-seconds, wait-estimate-fallback
 */
export const DOUYIN_VIDEO_DEFAULT_TASK_SECONDS = 180;

/**
 * @description 正在跑的任务超出常规耗时后，至少再按这么久估算，排队时间不会显示成马上轮到。
 * @keyword-cn 最短剩余耗时, 超时任务估时
 * @keyword-en min-remaining-seconds, overdue-task-estimate
 */
export const DOUYIN_VIDEO_MIN_REMAINING_SECONDS = 30;

/**
 * @description 至少有这么多条完成记录才采用实测耗时，样本太少时结果不稳定。
 * @keyword-cn 实测样本下限, 耗时样本
 * @keyword-en task-sample-minimum, duration-samples
 */
export const DOUYIN_VIDEO_TASK_SAMPLE_MIN = 3;

/**
 * @description 取最近完成任务的耗时中位数（开跑到完成），丢掉不足 20 秒或超过 30 分钟的异常值；样本不足时返回 null。
 * @keyword-cn 实测任务耗时, 耗时中位数
 * @keyword-en measured-task-seconds, median-duration
 * @param samples 完成记录的开跑与完成时间。
 * @returns {number|null} 秒数或 null。
 */
export function medianTaskSeconds(
  samples: Array<{ startedAt?: Date; updatedAt: Date }>,
): number | null {
  const seconds = samples
    .map(
      (item) =>
        (new Date(item.updatedAt).getTime() -
          new Date(item.startedAt ?? 0).getTime()) /
        1000,
    )
    .filter((value) => value >= 20 && value <= 1800)
    .sort((a, b) => a - b);
  if (seconds.length < DOUYIN_VIDEO_TASK_SAMPLE_MIN) return null;
  return Math.round(seconds[Math.floor(seconds.length / 2)]);
}

/**
 * @description 模拟排队估算还要等多久才轮到：各通道按正在跑任务的剩余时间起步，前面的任务依次排到最早空出来的通道。
 * @keyword-cn 估算排队等待, 通道模拟
 * @keyword-en estimate-video-wait, channel-simulation
 * @param input 前面的任务数、通道数、正在跑任务已用秒数与单任务耗时。
 * @returns {number} 等待秒数。
 */
export function estimateVideoWaitSeconds(input: {
  ahead: number;
  channels: number;
  runningElapsed: number[];
  taskSeconds: number;
}): number {
  const lanes = Math.max(1, Math.floor(input.channels) || 1);
  // 正在跑的比通道多时（调低过上限），要等多出来的先跑完，只留最晚结束的几路
  const busy = input.runningElapsed
    .map((elapsed) =>
      Math.max(DOUYIN_VIDEO_MIN_REMAINING_SECONDS, input.taskSeconds - elapsed),
    )
    .sort((a, b) => a - b)
    .slice(-lanes);
  const free = [...Array<number>(lanes - busy.length).fill(0), ...busy];
  for (let index = 0; index < Math.max(0, input.ahead); index += 1) {
    free.sort((a, b) => a - b);
    free[0] += input.taskSeconds;
  }
  return Math.round(Math.min(...free));
}

/**
 * @description 把前面的任务归并成人数：同一个人的多段只算一人，自己的任务单独计数；查不到归属的任务各算一人。
 * @keyword-cn 统计前方人数, 任务归并到人
 * @keyword-en count-people-ahead, group-tasks-by-user
 * @param owners 前面各任务的用户 ID。
 * @param me 当前用户 ID。
 * @returns {{people: number, mine: number}} 其他人数与自己的任务数。
 */
export function countPeopleAhead(
  owners: Array<string | undefined>,
  me: string,
): { people: number; mine: number } {
  const others = new Set<string>();
  let unknown = 0;
  let mine = 0;
  for (const owner of owners) {
    if (!owner) unknown += 1;
    else if (owner === me) mine += 1;
    else others.add(owner);
  }
  return { people: others.size + unknown, mine };
}
