jest.mock('../../admin/services/admin.service', () => ({
  AdminService: class {},
}));
jest.mock('../../ai-billing/services/ai-billing.service', () => ({
  AiBillingService: class {},
}));

import type {
  DouyinStoryboardShot,
  DouyinVideoAudioSetting,
} from '../entities/douyin-workbench.entity';
import {
  buildFullVideoPrompt,
  buildShotVideoPrompt,
  buildVideoAudioSection,
  presentDouyinVideoError,
  readDouyinVideoPlan,
} from './douyin-pixmax-video.service';

const MANDARIN: DouyinVideoAudioSetting = {
  mode: 'voiceover',
  language: 'zh-CN',
};

/**
 * @description 构造测试分镜。
 * @keyword-cn 测试分镜, 镜头数据
 * @keyword-en test-shot, shot-fixture
 */
function shot(visual: string, duration: number): DouyinStoryboardShot {
  return {
    id: visual,
    duration,
    shotType: '近景',
    visual,
    narration: `${visual}的口播`,
    transition: '直接切换',
  };
}

describe('douyin pixmax video prompts', () => {
  it('整片提示词分区：时间轴、完整口播稿、声音、参考图、限制', () => {
    const prompt = buildFullVideoPrompt({
      title: '咖啡探店',
      script: '今天带你打卡一家宝藏咖啡馆。拉花超美，味道也在线。',
      shots: [shot('门头', 3), shot('拉花', 4), shot('品尝', 3)],
      images: [
        {
          imageId: 9,
          url: '/static/uploads/a.jpg',
          name: 'a.jpg',
          shotIndexes: [1],
        },
      ],
      seconds: 10,
      referModel: 'referToVideo',
      audio: MANDARIN,
    });
    expect(prompt).toContain('【视频】竖屏 9:16 抖音短视频《咖啡探店》');
    expect(prompt).toContain('【分镜时间轴】');
    expect(prompt).toContain('镜头1（0-3 秒，近景）：门头');
    expect(prompt).toContain(
      '镜头2（3-7 秒，近景）：拉花；画面参考图1；口播：拉花的口播',
    );
    expect(prompt).toContain(
      '【口播稿】按时间轴节奏朗读：\n今天带你打卡一家宝藏咖啡馆。',
    );
    expect(prompt).toContain('【声音】旁白配音：使用标准普通话（中文）朗读');
    expect(prompt).toContain('【参考图】参考图按编号对应');
    expect(prompt).toContain('【限制】');
    expect(prompt).not.toContain('【时长】');
  });

  it('没有脚本正文时用分镜口播拼成口播稿；时长不足时压缩并允许精简', () => {
    const prompt = buildFullVideoPrompt({
      title: '长视频',
      shots: [shot('一', 20), shot('二', 20)],
      images: [],
      seconds: 15,
      audio: MANDARIN,
      extra: '节奏快一点',
    });
    expect(prompt).toContain(
      '【口播稿】按时间轴节奏朗读：\n一的口播\n二的口播',
    );
    expect(prompt).toContain('【时长】分镜原计划 40 秒，本次最长 15 秒');
    expect(prompt).toContain('镜头2（7.5-15 秒');
    expect(prompt).toContain('可以精简口播稿，但必须保持标准普通话（中文）');
    expect(prompt).toContain('【补充要求】节奏快一点');
  });

  it('设定时长比分镜总时长长时按比例放缓每镜，不提示压缩', () => {
    const prompt = buildFullVideoPrompt({
      title: '慢节奏',
      shots: [shot('一', 3), shot('二', 7)],
      images: [],
      seconds: 20,
      audio: MANDARIN,
    });
    expect(prompt).toContain('总时长约 20 秒');
    expect(prompt).toContain('镜头1（0-6 秒');
    expect(prompt).toContain('镜头2（6-20 秒');
    expect(prompt).not.toContain('【时长】');
  });

  it('首尾帧模式说明参考图1是首帧、参考图2是尾帧', () => {
    const prompt = buildFullVideoPrompt({
      title: '咖啡探店',
      shots: [shot('门头', 3), shot('品尝', 3)],
      images: [
        { imageId: 1, url: '/a.jpg', name: 'a.jpg', shotIndexes: [0] },
        { imageId: 2, url: '/b.jpg', name: 'b.jpg', shotIndexes: [1] },
      ],
      seconds: 6,
      referModel: 'firstAndLastFrame',
      audio: MANDARIN,
    });
    expect(prompt).toContain('参考图1是开场首帧、参考图2是结尾尾帧');
  });

  it('声音结构：配音限定语言，仅音乐禁止人声，静音要求无声', () => {
    expect(
      buildVideoAudioSection({ mode: 'voiceover', language: 'yue' }),
    ).toContain('使用粤语（中文）朗读');
    expect(
      buildVideoAudioSection({ mode: 'music', language: 'zh-CN' }),
    ).toContain('不要任何人声');
    expect(
      buildVideoAudioSection({ mode: 'mute', language: 'zh-CN' }),
    ).toContain('无声视频');
    const muted = buildFullVideoPrompt({
      title: 't',
      script: '正文',
      shots: [shot('一', 3)],
      images: [],
      seconds: 3,
      audio: { mode: 'mute', language: 'zh-CN' },
    });
    expect(muted).toContain('【口播稿】仅用于理解内容，不要朗读');
  });

  it('单镜提示词分区，带本镜口播稿与首帧说明', () => {
    const prompt = buildShotVideoPrompt({
      title: '咖啡探店',
      shot: shot('拉花', 4),
      index: 1,
      hasImage: true,
      audio: MANDARIN,
    });
    expect(prompt).toContain('第 2 个镜头，景别近景，时长约 4 秒');
    expect(prompt).toContain('【口播稿】拉花的口播');
    expect(prompt).toContain('【参考图】参考图是这一镜的首帧');
    expect(prompt).toContain('标准普通话（中文）');
  });

  it('读取生成方案：生成方式、参考图、时长、声音与口播稿', () => {
    expect(
      readDouyinVideoPlan({
        referModel: 'firstAndLastFrame',
        imageIds: [1, 9],
        duration: 15,
        plannedSeconds: 43,
        durationClamped: true,
        audio: MANDARIN,
        scriptIncluded: true,
      }),
    ).toEqual({
      referModel: 'firstAndLastFrame',
      imageCount: 2,
      duration: 15,
      plannedSeconds: 43,
      durationClamped: true,
      audioMode: 'voiceover',
      audioLanguage: 'zh-CN',
      scriptIncluded: true,
    });
  });
  it('旧记录里的原始报错展示时翻译成中文，原文放进详情', () => {
    const raw =
      'PIXMAX_ASSET_COMPLIANCE_FAILED:{"errorCode":"InputImageSensitiveContentDetected.PolicyViolation"}';
    expect(presentDouyinVideoError({ provider: 'pixmax', error: raw })).toEqual(
      {
        error:
          '参考图可能涉及版权内容（如知名 IP、动漫或影视形象、品牌标识等），没有通过平台审核。请换成原创或没有版权风险的图片后重试。',
        errorDetail: raw,
      },
    );
    expect(
      presentDouyinVideoError({
        provider: 'pixmax',
        error: 'PixMax 积分不足，请充值后重新生成。',
      }),
    ).toEqual({ error: 'PixMax 积分不足，请充值后重新生成。' });
    expect(
      presentDouyinVideoError({ provider: 'direct', error: 'HTTP 500' }),
    ).toEqual({
      error: 'HTTP 500',
      errorDetail: undefined,
    });
  });
});
