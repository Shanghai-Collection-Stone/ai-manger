import {
  normalizeCleanupSettings,
  resolveDefaultCleanupSettings,
  selectCapacityOverflow,
  xhsCleanupScopeKey,
} from './xhs-topic-retention.constants.js';

describe('resolveDefaultCleanupSettings', () => {
  it('沿用环境变量天数，文章库默认关闭且数量不限', () => {
    const defaults = resolveDefaultCleanupSettings({
      XHS_TOPIC_IDLE_DAYS: '15',
      XHS_DRAFT_RETENTION_DAYS: 'bad',
    });
    expect(defaults.motherTopic).toEqual({
      enabled: true,
      retentionDays: 15,
      maxCount: 0,
    });
    expect(defaults.draftArticle).toEqual({
      enabled: true,
      retentionDays: 7,
      maxCount: 0,
    });
    expect(defaults.libraryArticle).toEqual({
      enabled: false,
      retentionDays: 90,
      maxCount: 0,
    });
  });
});

describe('normalizeCleanupSettings', () => {
  const fallback = resolveDefaultCleanupSettings({});

  it('缺失或越界字段回落默认值，合法字段保留', () => {
    const settings = normalizeCleanupSettings(
      {
        motherTopic: { enabled: false, retentionDays: 0, maxCount: 50 },
        draftArticle: { enabled: 'yes', retentionDays: 3, maxCount: -1 },
      },
      fallback,
    );
    expect(settings.motherTopic).toEqual({
      enabled: false,
      retentionDays: 30,
      maxCount: 50,
    });
    expect(settings.draftArticle).toEqual({
      enabled: true,
      retentionDays: 3,
      maxCount: 0,
    });
    expect(settings.libraryArticle).toEqual(fallback.libraryArticle);
  });

  it('非对象输入返回完整回退值', () => {
    expect(normalizeCleanupSettings(null, fallback)).toEqual(fallback);
  });
});

describe('xhsCleanupScopeKey', () => {
  it('无租户归到平台作用域', () => {
    expect(xhsCleanupScopeKey(undefined)).toBe('__platform__');
    expect(xhsCleanupScopeKey(' ')).toBe('__platform__');
    expect(xhsCleanupScopeKey('t1')).toBe('t1');
  });
});

describe('selectCapacityOverflow', () => {
  const items = [
    { id: 1, at: 40, keep: false },
    { id: 2, at: 10, keep: true },
    { id: 3, at: 20, keep: false },
    { id: 4, at: 30, keep: false },
  ];
  type Item = (typeof items)[number];
  const none = new Set<Item>();
  const base = {
    candidates: items,
    total: items.length,
    isEvictable: (item: Item) => !item.keep,
    timeOf: (item: Item) => item.at,
  };

  it('上限为 0 表示不限', () => {
    expect(
      selectCapacityOverflow({ ...base, maxCount: 0, excluded: none }),
    ).toEqual([]);
  });

  it('跳过受保护条目，按时间最早优先挑出超出部分', () => {
    const picked = selectCapacityOverflow({
      ...base,
      maxCount: 2,
      excluded: none,
    });
    expect(picked.map((item) => item.id)).toEqual([3, 4]);
  });

  it('已按天数选中的条目算作已腾出', () => {
    const picked = selectCapacityOverflow({
      ...base,
      maxCount: 2,
      excluded: new Set([items[2]]),
    });
    expect(picked.map((item) => item.id)).toEqual([4]);
  });

  it('总数可大于候选数（文章库未发布文章只计数不清理）', () => {
    const picked = selectCapacityOverflow({
      ...base,
      total: 10,
      maxCount: 8,
      excluded: none,
    });
    expect(picked.map((item) => item.id)).toEqual([3, 4]);
  });
});
