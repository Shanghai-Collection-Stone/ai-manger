import {
  buildOpensourceFullPrompt,
  buildOpensourceShotPrompt,
  buildOpensourceVideoAudioLine,
} from './douyin-opensource-video.service.js';
import type { DouyinStoryboardShot } from '../entities/douyin-workbench.entity.js';

const voiceover = { mode: 'voiceover', language: 'zh-CN' } as const;

function shotOf(
  visual: string,
  narration: string,
  duration: number,
): DouyinStoryboardShot {
  return {
    id: visual,
    visual,
    narration,
    duration,
    shotType: '中景',
  } as DouyinStoryboardShot;
}

describe('自建 MiniMax-H3 分镜 / 整片提示词', () => {
  it('Audio 行：配音时口播放在引号里并要求从第一秒开始、前后不说别的', () => {
    const line = buildOpensourceVideoAudioLine({
      audio: voiceover,
      quotes: ['第一句', ' ', '第二句'],
      personaVoice:
        '旁白音色固定为青年男声，语速适中；全片只有这一个人的声音，不要换音色。',
    });
    expect(line).toContain(
      'Audio: one narrator (young male voice) says in Mandarin Chinese, clearly and only once, in this order: "第一句" "第二句"',
    );
    expect(line).toContain(
      'The speech starts right at the beginning and nothing else is said',
    );
    expect(/[㐀-鿿]/.test(line.replace(/"[^"]*"/g, ''))).toBe(false);
  });

  it('Audio 行：静音无声，仅音乐或没有口播时不要人声', () => {
    expect(
      buildOpensourceVideoAudioLine({
        audio: { mode: 'mute', language: 'zh-CN' },
        quotes: ['x'],
      }),
    ).toBe('Audio: complete silence, no voice, no music and no sound effects.');
    expect(
      buildOpensourceVideoAudioLine({ audio: voiceover, quotes: [''] }),
    ).toContain('no voice, narration, dialogue or lyrics');
    expect(
      buildOpensourceVideoAudioLine({
        audio: { mode: 'voiceover', language: 'yue' },
        quotes: ['食咗饭未'],
      }),
    ).toContain('says in Cantonese');
  });

  it('单镜：没有中文指令段，首帧写 <Picture 1>，时间轴按实际秒数', () => {
    const prompt = buildOpensourceShotPrompt({
      shot: shotOf('男生咬一口汉堡', '这口汉堡真的绝了', 5),
      index: 1,
      hasImage: true,
      seconds: 5,
      audio: voiceover,
    });
    expect(prompt).not.toMatch(/【/);
    expect(prompt).toContain('shot 2, 中景');
    expect(prompt).toContain('The video starts exactly on <Picture 1>');
    expect(prompt).toContain('[0s-5s] 男生咬一口汉堡');
    expect(prompt).toContain('"这口汉堡真的绝了"');
  });

  it('整片：逐镜时间轴按实际时长等比缩放，口播按镜头顺序，首尾帧写 <Picture 1> / <Picture 2>', () => {
    const prompt = buildOpensourceFullPrompt({
      script: '整段正文',
      shots: [shotOf('开场', '第一句', 4), shotOf('结尾', '第二句', 4)],
      seconds: 6,
      referModel: 'firstAndLastFrame',
      audio: voiceover,
    });
    expect(prompt).toContain(
      'opens exactly on <Picture 1> and ends exactly on <Picture 2>',
    );
    expect(prompt).toContain('[0s-3s] Shot 1 (中景): 开场');
    expect(prompt).toContain('[3s-6s] Shot 2 (中景): 结尾');
    expect(prompt).toContain('"第一句" "第二句"');
    expect(prompt).not.toContain('整段正文');
    expect(prompt).toContain('may be shortened to fit the duration');
  });

  it('整片：各镜都没有旁白时用脚本正文作口播', () => {
    const prompt = buildOpensourceFullPrompt({
      script: '整段正文',
      shots: [shotOf('开场', '', 5)],
      seconds: 5,
      audio: voiceover,
    });
    expect(prompt).toContain('"整段正文"');
    expect(prompt).not.toContain('<Picture 1>');
  });
});
