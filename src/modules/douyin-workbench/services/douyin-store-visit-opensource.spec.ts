import {
  SCRIPT_FIRST_SCENE_RULES,
  STORE_VISIT_REAL_SCENE_RULES,
  supportsStoreVisitReferenceAudio,
  supportsStoreVisitReferences,
} from './douyin-store-visit-continuity.js';
import {
  buildStoreVisitH3Prompt,
  buildStoreVisitNativePrompt,
  buildStoreVisitVideoTarget,
  DouyinStoreVisitService,
  storeVisitProviderOf,
} from './douyin-store-visit.service.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function runtimeOf(providerCode: string, model: string): WorkflowNodeRuntime {
  return {
    providerId: 'p1',
    providerCode,
    providerName: providerCode,
    model,
    baseUrl: 'https://gpu.example.com',
    apiKey: 'k',
  };
}

describe('探店分段走自建 MiniMax-H3', () => {
  it('按提供商代码分流：自建服务的模型名虽然像 MiniMax-H3，也不能走数眼路由', () => {
    const own = runtimeOf('opensource-video', 'minimax-h3-turbo');
    expect(buildStoreVisitVideoTarget('broll', own)).toEqual({
      shot: 'broll',
      engine: 'opensource-video',
      runtime: own,
    });
    const shuyan = runtimeOf('shuyan', 'MiniMax-H3');
    expect(buildStoreVisitVideoTarget('presenter', shuyan)).toMatchObject({
      engine: 'shuyan-video',
      route: 'hailuo-v2',
    });
    expect(storeVisitProviderOf(own)).toBe('opensource-video');
    expect(storeVisitProviderOf(shuyan)).toBe('shuyan');
  });

  it('自建服务的三个档位都按支持多图参考与参考音频处理', () => {
    for (const model of [
      'minimax-h3-turbo',
      'minimax-h3-fast',
      'minimax-h3-quality',
    ]) {
      expect(supportsStoreVisitReferences(model)).toBe(true);
      expect(supportsStoreVisitReferenceAudio(model)).toBe(true);
    }
  });

  const service = Object.create(DouyinStoreVisitService.prototype) as {
    buildOpensourceSegmentInput(
      input: unknown,
    ): Promise<Record<string, unknown>>;
  };

  it('只有一张首帧时走首帧图生视频，画幅跟随首帧', async () => {
    const input = await service.buildOpensourceSegmentInput({
      prompt: '图1 是上一段实际尾帧，继续拍摄。',
      content: [
        { type: 'text', text: '...' },
        { type: 'image_url', image_url: { url: PNG }, role: 'first_frame' },
      ],
      seconds: 6,
      megapixels: 0.8,
      runtime: runtimeOf('opensource-video', 'minimax-h3-turbo'),
    });
    expect(input).toEqual({
      prompt: '图1 是上一段实际尾帧，继续拍摄。',
      duration: 6,
      aspect_ratio: 'auto',
      megapixels: 0.8,
      mode: 'turbo',
      first_frame: PNG,
    });
  });

  it('有参考图或参考声音时走参考生视频，固定竖屏，提示词原样提交', async () => {
    const input = await service.buildOpensourceSegmentInput({
      prompt: 'The person from <Picture 2> speaks with the voice of <Audio 1>.',
      content: [
        { type: 'text', text: '...' },
        { type: 'image_url', image_url: { url: PNG }, role: 'reference_image' },
        { type: 'image_url', image_url: { url: PNG }, role: 'reference_image' },
        { type: 'audio_url', audio_url: { url: 'x' }, role: 'reference_audio' },
      ],
      seconds: 8,
      megapixels: 0.8,
      runtime: runtimeOf('opensource-video', 'minimax-h3-quality'),
      referenceAudio: { url: '/static/a.wav', buffer: Buffer.from('RIFF') },
    });
    expect(input).toMatchObject({
      aspect_ratio: '9:16',
      mode: 'quality',
      reference_images: [PNG, PNG],
      reference_audios: [
        `data:audio/wav;base64,${Buffer.from('RIFF').toString('base64')}`,
      ],
    });
    expect(input.first_frame).toBeUndefined();
    expect(input.prompt).toBe(
      'The person from <Picture 2> speaks with the voice of <Audio 1>.',
    );
  });

  const promptBase = {
    title: '集合石探店',
    lines: '生日派对、朋友聚会、公司团建，一个包间全包了。',
    seconds: 8,
    sceneDescription: '蓝色霓虹招牌与收银台',
    voiceDescription: '男声，东北话',
    multiReference: false,
  };

  /** 去掉引号里的台词后剩下的文本里不能有中文 */
  const chineseOutsideLines = (prompt: string) =>
    /[㐀-鿿]/.test(prompt.replace(/"[^"]*"/g, ''));

  it('H3 原生提示词：除引号里的台词外没有中文（标题、场景说明、音色描述都会被念出来）', () => {
    const prompt = buildStoreVisitH3Prompt({
      ...promptBase,
      shot: 'broll',
      referenceAudio: true,
    });
    expect(chineseOutsideLines(prompt)).toBe(false);
    expect(prompt).toContain('Location: exactly the place in <Picture 1>.');
    expect(prompt).toContain(
      '[0s-8s] One continuous shot: the camera slowly pushes in',
    );
    expect(prompt).toContain(
      'Audio: An off-screen narrator with exactly the voice, accent and tone of <Audio 1> (male voice, Northeastern Chinese accent) says in Mandarin Chinese, in a relaxed, natural conversational tone, clearly, completely and only once: "生日派对、朋友聚会、公司团建，一个包间全包了。"',
    );
    expect(prompt).toContain('<Audio 1> is only a voice sample');
  });

  it('从脚本开始：H3 与数眼提示词不称门店、不加门店实拍的硬约束，改成宽松的画面约束', () => {
    const h3 = buildStoreVisitH3Prompt({
      ...promptBase,
      shot: 'broll',
      referenceAudio: false,
      scriptFirst: true,
    });
    expect(chineseOutsideLines(h3)).toBe(false);
    expect(h3).toContain('Short-form vertical video');
    expect(h3).toContain('Scene: starts from <Picture 1>');
    expect(h3).not.toContain('store');
    const native = buildStoreVisitNativePrompt({
      ...promptBase,
      shot: 'broll',
      referenceAudio: false,
      scriptFirst: true,
    });
    expect(native).toContain(SCRIPT_FIRST_SCENE_RULES);
    expect(native).not.toContain(STORE_VISIT_REAL_SCENE_RULES);
    expect(native).not.toContain('门店');
    expect(
      buildStoreVisitNativePrompt({
        ...promptBase,
        shot: 'broll',
        referenceAudio: false,
      }),
    ).toContain(STORE_VISIT_REAL_SCENE_RULES);
  });

  it('H3 原生提示词：锚点段只要干净人声，其余段保留轻微环境声', () => {
    const anchor = buildStoreVisitH3Prompt({
      ...promptBase,
      shot: 'presenter',
      referenceAudio: false,
      cleanVoice: true,
    });
    expect(anchor).toContain(
      'Only the clean, dry voice: no ambient sound, no echo, no background music, no other voices.',
    );
    expect(anchor).not.toContain('Light ambient sound');
    const normal = buildStoreVisitH3Prompt({
      ...promptBase,
      shot: 'broll',
      referenceAudio: true,
    });
    expect(normal).toContain('Light ambient sound of the store underneath');
  });

  it('H3 原生提示词：人物照编号排在同点位其余照片之后，接尾帧时声明从 <Picture 1> 接续，人物名、衔接方案与中文动作不写', () => {
    const prompt = buildStoreVisitH3Prompt({
      ...promptBase,
      shot: 'presenter',
      referenceAudio: false,
      multiReference: true,
      personName: '老王',
      personAppearance: '短发',
      extraSceneDescriptions: ['侧面', '细节'],
      continued: true,
      continuation: '人物向右走两步',
      action: '端起饮料喝一口',
    });
    expect(chineseOutsideLines(prompt)).toBe(false);
    expect(prompt).toContain('<Picture 2>-<Picture 3> show the same spot');
    expect(prompt).toContain('The on-camera person is <Picture 4>:');
    expect(prompt).toContain(
      'The person from <Picture 4> speaks on camera (male voice, Northeastern Chinese accent)',
    );
    expect(prompt).toContain('greets the viewers naturally');
    expect(prompt).toContain(
      'continues seamlessly from <Picture 1>, the actual last frame of the previous shot',
    );
    expect(prompt).not.toContain('<Audio 1>');
  });

  it('节点模型不是自建服务的档位时拒绝提交', async () => {
    await expect(
      service.buildOpensourceSegmentInput({
        prompt: 'x',
        content: [],
        seconds: 5,
        megapixels: 0.8,
        runtime: runtimeOf('opensource-video', 'MiniMax-H3'),
      }),
    ).rejects.toThrow('不认识这个模型');
  });
});
