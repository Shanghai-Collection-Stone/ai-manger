import {
  classifyShuyanModel,
  fetchShuyanModels,
  isShuyanProvider,
  listShuyanModelsByCategory,
  SHUYAN_DEFAULT_BASE_URL,
} from './shuyan-model-catalog';

describe('isShuyanProvider', () => {
  it('认 shuyan / shuyanai 两个代码，大小写与空格无关', () => {
    expect(isShuyanProvider('shuyan')).toBe(true);
    expect(isShuyanProvider(' ShuyanAI ')).toBe(true);
    expect(isShuyanProvider('pixmax')).toBe(false);
    expect(isShuyanProvider('')).toBe(false);
  });
});

describe('classifyShuyanModel 结构化端点类型优先', () => {
  it('有 supported_endpoint_types 时不看模型名', () => {
    // 名字像文本模型，但端点类型是生图，按端点类型判
    expect(
      classifyShuyanModel({
        id: 'deepseek-flash',
        supportedEndpointTypes: ['image-generation'],
      }),
    ).toBe('image');
    expect(
      classifyShuyanModel({
        id: 'whatever',
        supportedEndpointTypes: ['video-generations'],
      }),
    ).toBe('video');
    expect(
      classifyShuyanModel({ id: 'x', supportedEndpointTypes: ['embeddings'] }),
    ).toBe('em');
    expect(
      classifyShuyanModel({ id: 'x', supportedEndpointTypes: ['midjourney'] }),
    ).toBe('image');
    expect(
      classifyShuyanModel({ id: 'x', supportedEndpointTypes: ['openai'] }),
    ).toBe('llm');
  });
});

describe('classifyShuyanModel 按模型名兜底', () => {
  // 取平台公告里真实上架过的模型名
  it.each([
    ['deepseek-flash', 'llm'],
    ['deepseek-v4-pro-0813', 'llm'],
    ['kimi-k3', 'llm'],
    ['kimi-k2.7-code', 'llm'],
    ['glm-5.3-flash', 'llm'],
    ['qwen3.8-max', 'llm'],
    ['minimax-m3', 'llm'],
    ['wan3.0-video', 'video'],
    ['minimax-h3', 'video'],
    ['hailuo-2.3', 'video'],
    ['seedance-2.0', 'video'],
    ['happyhorse-1.1', 'video'],
    ['jimeng-video-3.0', 'video'],
    ['doubao-seedream-5.0-lite', 'image'],
    ['gpt-image-1', 'image'],
    ['qwen-image', 'image'],
    ['flux-schnell', 'image'],
    ['text-embedding-3-small', 'em'],
    ['bge-m3', 'em'],
    ['jina-reranker-v2', 'em'],
    ['suno-v4', 'other'],
    ['whisper-1', 'other'],
  ])('%s → %s', (id, expected) => {
    expect(classifyShuyanModel({ id })).toBe(expected);
  });

  it('同族里生图与生视频靠 -image / -video 区分，不被族名带偏', () => {
    expect(classifyShuyanModel({ id: 'jimeng-image-4.0' })).toBe('image');
    expect(classifyShuyanModel({ id: 'jimeng-video-3.0' })).toBe('video');
  });

  it('认不出来的当文本模型，空名字归 other', () => {
    expect(classifyShuyanModel({ id: 'some-brand-new-chat-model' })).toBe(
      'llm',
    );
    expect(classifyShuyanModel({ id: '' })).toBe('other');
  });
});

describe('fetchShuyanModels', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('缺 Key 时直接报错，不发请求', async () => {
    const spy = jest.fn();
    global.fetch = spy;
    await expect(fetchShuyanModels({ apiKey: ' ' })).rejects.toThrow(
      'SHUYAN_MODEL_LIST_FAILED:API_KEY_NOT_CONFIGURED',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('baseUrl 留空走主节点，带 Bearer 请求 /models', async () => {
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ id: 'kimi-k3' }] }),
    });
    global.fetch = spy;
    const rows = await fetchShuyanModels({ apiKey: 'sk-test' });
    expect(spy).toHaveBeenCalledWith(
      `${SHUYAN_DEFAULT_BASE_URL}/models`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-test' },
      }),
    );
    expect(rows).toEqual([
      { id: 'kimi-k3', ownedBy: undefined, supportedEndpointTypes: undefined },
    ]);
  });

  it('HTTP 失败时把对端 error.message 带进异常', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: '无效的令牌' } }),
    });
    await expect(fetchShuyanModels({ apiKey: 'sk-bad' })).rejects.toThrow(
      'SHUYAN_MODEL_LIST_FAILED:无效的令牌',
    );
  });

  it('丢掉空 id 的脏数据', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: '' }, { id: '  ' }, { id: 'glm-5.2' }],
        }),
    });
    const rows = await fetchShuyanModels({ apiKey: 'sk-test' });
    expect(rows.map((x) => x.id)).toEqual(['glm-5.2']);
  });
});

describe('listShuyanModelsByCategory', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('同一份目录按节点类型切出三份互不重叠的列表，并按模型名排序', async () => {
    const catalog = {
      data: [
        { id: 'kimi-k3' },
        { id: 'deepseek-flash' },
        { id: 'wan3.0-video' },
        { id: 'minimax-h3' },
        { id: 'doubao-seedream-5.0-lite' },
        { id: 'text-embedding-3-small' },
        { id: 'suno-v4' },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(catalog),
    });

    const llm = await listShuyanModelsByCategory({
      apiKey: 'sk-test',
      category: 'llm',
    });
    const image = await listShuyanModelsByCategory({
      apiKey: 'sk-test',
      category: 'image',
    });
    const video = await listShuyanModelsByCategory({
      apiKey: 'sk-test',
      category: 'video',
    });

    expect(llm.map((x) => x.code)).toEqual(['deepseek-flash', 'kimi-k3']);
    expect(image.map((x) => x.code)).toEqual(['doubao-seedream-5.0-lite']);
    expect(video.map((x) => x.code)).toEqual(['minimax-h3', 'wan3.0-video']);
    // 向量与音频模型不属于任何节点类型，三份列表都不该出现
    const all = [...llm, ...image, ...video].map((x) => x.code);
    expect(all).not.toContain('text-embedding-3-small');
    expect(all).not.toContain('suno-v4');
  });
});
