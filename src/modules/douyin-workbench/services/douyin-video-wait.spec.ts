import {
  countPeopleAhead,
  estimateVideoWaitSeconds,
  medianTaskSeconds,
} from './douyin-video-wait';

/**
 * @description 构造一条耗时为指定秒数的完成记录。
 * @keyword-cn 构造耗时样本, 测试数据
 * @keyword-en build-duration-sample, fixture
 * @param seconds 耗时秒数。
 * @returns {{startedAt: Date, updatedAt: Date}} 样本。
 */
function sample(seconds: number) {
  const startedAt = new Date('2026-11-23T00:00:00Z');
  return {
    startedAt,
    updatedAt: new Date(startedAt.getTime() + seconds * 1000),
  };
}

describe('video queue wait estimate', () => {
  it('uses the median and ignores outliers', () => {
    expect(
      medianTaskSeconds([sample(100), sample(120), sample(140), sample(5000)]),
    ).toBe(120);
    expect(medianTaskSeconds([sample(100), sample(120)])).toBeNull();
    expect(medianTaskSeconds([sample(5), sample(100), sample(120)])).toBeNull();
  });

  it('shrinks as the running task progresses', () => {
    const early = estimateVideoWaitSeconds({
      ahead: 2,
      channels: 1,
      runningElapsed: [30],
      taskSeconds: 120,
    });
    const later = estimateVideoWaitSeconds({
      ahead: 2,
      channels: 1,
      runningElapsed: [80],
      taskSeconds: 120,
    });
    expect(early).toBe(330);
    expect(later).toBe(280);
  });

  it('spreads the queue across channels', () => {
    expect(
      estimateVideoWaitSeconds({
        ahead: 3,
        channels: 2,
        runningElapsed: [0, 60],
        taskSeconds: 120,
      }),
    ).toBe(240);
    expect(
      estimateVideoWaitSeconds({
        ahead: 0,
        channels: 2,
        runningElapsed: [60],
        taskSeconds: 120,
      }),
    ).toBe(0);
  });

  it('keeps a floor for overdue tasks and handles extra running tasks', () => {
    expect(
      estimateVideoWaitSeconds({
        ahead: 0,
        channels: 1,
        runningElapsed: [900],
        taskSeconds: 120,
      }),
    ).toBe(30);
    expect(
      estimateVideoWaitSeconds({
        ahead: 0,
        channels: 2,
        runningElapsed: [110, 60, 0],
        taskSeconds: 120,
      }),
    ).toBe(60);
  });

  it('counts people instead of tasks', () => {
    expect(
      countPeopleAhead(['a', 'a', 'b', 'me', undefined, 'me'], 'me'),
    ).toEqual({ people: 3, mine: 2 });
    expect(countPeopleAhead([], 'me')).toEqual({ people: 0, mine: 0 });
  });
});
