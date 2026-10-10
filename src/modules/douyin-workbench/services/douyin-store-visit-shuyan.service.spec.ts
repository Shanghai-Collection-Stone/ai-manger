import { parseStoreVisitSceneSegments } from './douyin-child-topic-generation.service.js';
import {
  buildStoreVisitAvatarUrl,
  buildStoreVisitKeyframePrompt,
  describeStoreVisitSegmentFailure,
  inferKlingVoiceLanguage,
  mapStoreVisitAvatarStatus,
  resolveStoreVisitAvatarEngine,
  textOf,
} from './douyin-store-visit-shuyan.service.js';
import {
  mergeStoreVisitSegments,
  normalizeStoreVisitSegments,
} from './douyin-workbench-repository.service.js';

describe('探店数眼分段通道', () => {
  it('按节点模型名选数字人引擎与可灵模式，认不出时为空', () => {
    expect(resolveStoreVisitAvatarEngine('kling-avatar-std')).toEqual({
      engine: 'kling-avatar',
      mode: 'std',
    });
    expect(resolveStoreVisitAvatarEngine('Kling-Avatar-Pro')).toEqual({
      engine: 'kling-avatar',
      mode: 'pro',
    });
    expect(resolveStoreVisitAvatarEngine('wan2.2-s2v')).toEqual({
      engine: 'wan-s2v',
    });
    expect(resolveStoreVisitAvatarEngine('doubao-seedance-2-0')).toBeNull();
  });

  it('拼可灵与万相数字人的创建、查询地址', () => {
    const gateway = 'https://platform.shuyanai.com';
    expect(buildStoreVisitAvatarUrl(gateway, 'kling-avatar')).toBe(
      'https://platform.shuyanai.com/kling/v1/videos/avatar/image2video',
    );
    expect(buildStoreVisitAvatarUrl(gateway, 'kling-avatar', 'k 1')).toBe(
      'https://platform.shuyanai.com/kling/v1/videos/avatar/image2video/k%201',
    );
    expect(buildStoreVisitAvatarUrl(gateway, 'wan-s2v')).toBe(
      'https://platform.shuyanai.com/ali/api/v1/services/aigc/image2video/video-synthesis',
    );
    expect(buildStoreVisitAvatarUrl(gateway, 'wan-s2v', 't-1')).toBe(
      'https://platform.shuyanai.com/ali/api/v1/tasks/t-1',
    );
  });

  it('响应字段只把字符串与数字读成文本', () => {
    expect(textOf('  a1 ')).toBe('a1');
    expect(textOf(12)).toBe('12');
    expect(textOf({ id: 1 })).toBe('');
    expect(textOf(undefined)).toBe('');
  });

  it('可灵与万相任务状态收成统一状态', () => {
    expect(mapStoreVisitAvatarStatus('submitted')).toBe('queued');
    expect(mapStoreVisitAvatarStatus('PENDING')).toBe('queued');
    expect(mapStoreVisitAvatarStatus('processing')).toBe('running');
    expect(mapStoreVisitAvatarStatus('RUNNING')).toBe('running');
    expect(mapStoreVisitAvatarStatus('succeed')).toBe('completed');
    expect(mapStoreVisitAvatarStatus('SUCCEEDED')).toBe('completed');
    expect(mapStoreVisitAvatarStatus('failed')).toBe('failed');
    expect(mapStoreVisitAvatarStatus('UNKNOWN')).toBe('failed');
  });

  it('按音色 ID 与名称推断语种', () => {
    expect(inferKlingVoiceLanguage('oversea_male1', 'Oversea Male')).toBe('en');
    expect(inferKlingVoiceLanguage('x1', 'Sunny Girl')).toBe('en');
    expect(inferKlingVoiceLanguage('zhinen_xuesheng', '阳光少年')).toBe('zh');
  });

  it('可灵与语音合成报错带上对端原话，其余走数眼通用对照', () => {
    expect(
      describeStoreVisitSegmentFailure('SHUYAN_KLING_ERROR:1201:image invalid'),
    ).toBe('可灵返回错误（1201）：image invalid');
    expect(
      describeStoreVisitSegmentFailure('SHUYAN_KLING_TTS_FAILED:failed'),
    ).toContain('可灵语音合成没有出音频');
    expect(
      describeStoreVisitSegmentFailure('SHUYAN_VIDEO_HTTP_401:{}'),
    ).toContain('API Key');
  });

  it('关键帧提示词带场景图时要求保持人物与场景，没有场景图时只保持人物', () => {
    const withScene = buildStoreVisitKeyframePrompt({
      title: '街角咖啡',
      lines: '今天带大家来这家店',
      hasSceneImage: true,
      sceneName: '门头',
    });
    expect(withScene).toContain('第二张图是门店场景');
    expect(withScene).toContain('场景：门头');
    const faceOnly = buildStoreVisitKeyframePrompt({
      title: '街角咖啡',
      lines: '今天带大家来这家店',
      action: '举起咖啡',
      hasSceneImage: false,
    });
    expect(faceOnly).not.toContain('第二张图');
    expect(faceOnly).toContain('举起咖啡');
  });

  it('规整分段：去空段、换掉非法或重复 ID、清掉不在场景里的场景图', () => {
    const segments = normalizeStoreVisitSegments(
      [
        { id: 'a1', lines: ' 第一段 ', sceneImageId: 5, action: ' 微笑 ' },
        { id: 'a1', lines: '第二段', sceneImageId: 9 },
        { id: 'bad id', lines: '   ' },
        { id: '../x', lines: '第三段' },
      ],
      [5, 6],
    );
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      id: 'a1',
      lines: '第一段',
      sceneImageId: 5,
      action: '微笑',
    });
    expect(segments[1].id).not.toBe('a1');
    expect(segments[1].sceneImageId).toBeUndefined();
    expect(segments[2].id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('合并分段：场景没变保留关键帧，台词也没变才保留成片', () => {
    const keyframe = {
      type: 'image' as const,
      id: 30,
      name: 'k',
      url: 'https://cdn/k.png',
    };
    const current = [
      { id: 'a', lines: '旧台词', sceneImageId: 5, keyframe, videoId: 40 },
      { id: 'b', lines: '不变', sceneImageId: 6, keyframe, videoId: 41 },
      { id: 'c', lines: '换场景', sceneImageId: 5, keyframe, videoId: 42 },
    ];
    const merged = mergeStoreVisitSegments(
      [
        { id: 'a', lines: '新台词', sceneImageId: 5 },
        { id: 'b', lines: '不变', sceneImageId: 6 },
        { id: 'c', lines: '换场景', sceneImageId: 6 },
      ],
      current,
    );
    expect(merged[0]).toMatchObject({ keyframe });
    expect(merged[0].videoId).toBeUndefined();
    expect(merged[1]).toMatchObject({ keyframe, videoId: 41 });
    expect(merged[2].keyframe).toBeUndefined();
    expect(merged[2].videoId).toBeUndefined();
  });

  it('解析按场景分段的台词，标记缺失或越界时返回空', () => {
    expect(
      parseStoreVisitSceneSegments(
        '【场景1】\n今天来到街角咖啡\n【场景2】\n招牌拿铁真的香',
        [11, 12],
      ),
    ).toEqual([
      { sceneImageId: 11, lines: '今天来到街角咖啡' },
      { sceneImageId: 12, lines: '招牌拿铁真的香' },
    ]);
    expect(parseStoreVisitSceneSegments('没有标记的台词', [11])).toEqual([]);
    expect(parseStoreVisitSceneSegments('【场景3】\n越界', [11, 12])).toEqual(
      [],
    );
  });
});
