import sharp from 'sharp';
import {
  activeTemplateAspect,
  buildTemplateEditPrompt,
  composeTemplateCover,
  cropFrameToAspect,
  describeVideoAspect,
  DOUYIN_TEMPLATE_CANVAS,
  locateTemplateWindow,
  normalizeTemplateCopy,
  parseTemplatePlan,
  pickTemplateAspect,
  punchTemplateWindow,
  sizeTemplateWindow,
} from './douyin-video-template.js';
import type { DouyinVideoTemplate } from '../entities/douyin-workbench.entity.js';

/**
 * @description 画一张模拟的模板海报：橙色底，指定位置一块纯绿 #00FF00 矩形。
 * @keyword-cn 测试模板海报, 绿块测试图
 * @keyword-en test-template-poster, green-block-image
 */
async function makePoster(
  box: { x: number; y: number; width: number; height: number },
  size = DOUYIN_TEMPLATE_CANVAS,
) {
  return await sharp({
    create: {
      width: size.width,
      height: size.height,
      channels: 3,
      background: { r: 250, g: 140, b: 40 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: box.width,
            height: box.height,
            channels: 3,
            background: { r: 0, g: 255, b: 0 },
          },
        })
          .png()
          .toBuffer(),
        left: box.x,
        top: box.y,
      },
    ])
    .png()
    .toBuffer();
}

describe('douyin video template helpers', () => {
  it('snaps window sizes to the nearest supported aspect', () => {
    expect(pickTemplateAspect(1000, 750)).toBe('4:3');
    expect(pickTemplateAspect(1000, 800)).toBe('4:3');
    expect(pickTemplateAspect(1600, 900)).toBe('16:9');
    expect(pickTemplateAspect(900, 1000)).toBe('1:1');
    expect(pickTemplateAspect(720, 960)).toBe('3:4');
    expect(pickTemplateAspect(0, 10)).toBe('4:3');
  });

  it('sizes the window by aspect, centres it and keeps it inside the canvas', () => {
    const centred = sizeTemplateWindow({ aspect: '4:3' });
    expect(centred.width / centred.height).toBeCloseTo(4 / 3, 1);
    // 居中后再向下取偶，最多偏 1px
    expect(
      Math.abs(centred.x - (1080 - centred.width) / 2),
    ).toBeLessThanOrEqual(1);
    expect(centred.y + centred.height / 2).toBeCloseTo(960, -1);
    for (const value of Object.values(centred)) expect(value % 2).toBe(0);
    // 竖向 3:4 满宽会超过 62% 画布高度，按高度回收
    const tall = sizeTemplateWindow({ aspect: '3:4', width: 1 });
    expect(tall.height).toBeLessThanOrEqual(Math.round(1920 * 0.62));
    expect(tall.width / tall.height).toBeCloseTo(3 / 4, 1);
    // 给的位置越界时夹回画布
    const edge = sizeTemplateWindow({
      aspect: '16:9',
      x: 0.9,
      y: 0.99,
      width: 1,
    });
    expect(edge.x + edge.width).toBeLessThanOrEqual(1080);
    expect(edge.y + edge.height).toBeLessThanOrEqual(1920);
  });

  it('parses the planner JSON and treats 9:16 or missing title as no template', () => {
    const plan = parseTemplatePlan(
      '```json\n{"useTemplate":true,"reason":"门店引流","aspectRatio":"4:3","window":{"x":0.04,"y":0.27,"width":0.92},"title":"上海儿童生日派对","subtitle":"父母省心一站式派对乐园","sellingPoints":["主题闯关","互动游戏","欢乐庆生","","多余的第五个"],"cta":"点击了解生日定制方案","style":"蓝色卡通气球"}\n```',
    );
    expect(plan).toMatchObject({
      useTemplate: true,
      aspectRatio: '4:3',
      title: '上海儿童生日派对',
      sellingPoints: ['主题闯关', '互动游戏', '欢乐庆生', '多余的第五个'],
      cta: '点击了解生日定制方案',
    });
    expect(plan.window.y).toBe(Math.floor((0.27 * 1920) / 2) * 2);
    expect(
      parseTemplatePlan('{"aspectRatio":"9:16","title":"满屏"}').useTemplate,
    ).toBe(false);
    expect(
      parseTemplatePlan('{"useTemplate":true,"aspectRatio":"1:1"}').useTemplate,
    ).toBe(false);
    expect(parseTemplatePlan('not json').useTemplate).toBe(false);
    // 比例缺失时按窗口宽高吸附
    expect(
      parseTemplatePlan('{"title":"标题","window":{"width":0.9,"height":0.3}}')
        .aspectRatio,
    ).toBe('16:9');
  });

  it('caps template copy lengths like the DTO', () => {
    const copy = normalizeTemplateCopy({
      title: '一二三四五六七八九十一二三四五六七八九十多出来',
      sellingPoints: ['一二三四五六七八九十多', 1, '  好玩  '],
    });
    expect(Array.from(copy.title)).toHaveLength(20);
    expect(copy.sellingPoints).toEqual(['一二三四五六七八九十', '好玩']);
  });

  it('writes the exact texts and the green window into the edit prompt, and forbids new content', () => {
    const prompt = buildTemplateEditPrompt({
      window: { x: 44, y: 520, width: 992, height: 744 },
      title: '上海儿童生日派对',
      subtitle: '父母省心一站式派对乐园',
      sellingPoints: ['主题闯关', '互动游戏'],
      cta: '点击了解生日定制方案',
      style: '蓝白配色，圆润粗体字',
    });
    expect(prompt).toContain('#00FF00');
    expect(prompt).toContain('「上海儿童生日派对」');
    expect(prompt).toContain('「主题闯关」「互动游戏」');
    expect(prompt).toContain('宽约 92%');
    // 只在实拍图上排版，不新造画面内容
    expect(prompt).toContain('只做编辑排版，不新造画面内容');
    expect(prompt).toContain('背景只能用这张图本身');
    expect(prompt).toContain('不要添加图里没有的任何东西');
    expect(prompt).toContain('不要据此画任何新东西');
  });

  it('locates the green block and punches it transparent', async () => {
    const poster = await makePoster({ x: 60, y: 500, width: 960, height: 720 });
    expect(await locateTemplateWindow(poster)).toEqual({
      x: 60,
      y: 500,
      width: 960,
      height: 720,
    });
    const punched = await punchTemplateWindow(poster, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(punched.detected).toBe(true);
    expect(punched.aspectRatio).toBe('4:3');
    expect(punched.window).toEqual({ x: 54, y: 494, width: 972, height: 732 });
    const { data, info } = await sharp(punched.png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([1080, 1920, 4]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(540, 860)).toBe(0);
    expect(alpha(540, 200)).toBe(255);
  });

  it('falls back to the planned window when there is no green block', async () => {
    const plain = await sharp({
      create: { width: 1024, height: 1792, channels: 3, background: '#3366cc' },
    })
      .png()
      .toBuffer();
    const punched = await punchTemplateWindow(plain, {
      x: 100,
      y: 600,
      width: 880,
      height: 660,
    });
    expect(punched.detected).toBe(false);
    expect(punched.window).toEqual({ x: 94, y: 594, width: 892, height: 672 });
  });

  it('composes the first frame into the window under the template', async () => {
    const punched = await punchTemplateWindow(
      await makePoster({ x: 60, y: 500, width: 960, height: 720 }),
      { x: 0, y: 0, width: 100, height: 100 },
    );
    const frame = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#0000ff' },
    })
      .jpeg()
      .toBuffer();
    const cover = await composeTemplateCover(
      punched.png,
      frame,
      punched.window,
    );
    const { data, info } = await sharp(cover)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1920]);
    const pixel = (x: number, y: number) =>
      Array.from(
        data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
      );
    const inside = pixel(540, 860);
    const outside = pixel(540, 200);
    expect(inside[2]).toBeGreaterThan(200);
    expect(inside[0]).toBeLessThan(60);
    expect(outside[0]).toBeGreaterThan(200);
  });

  it('centre-crops frames to the window aspect without stretching', async () => {
    const portrait = await sharp({
      create: { width: 720, height: 1280, channels: 3, background: '#888888' },
    })
      .jpeg()
      .toBuffer();
    const cropped = await cropFrameToAspect(
      `data:image/jpeg;base64,${portrait.toString('base64')}`,
      '4:3',
    );
    const meta = await sharp(
      Buffer.from(cropped.slice(cropped.indexOf(',') + 1), 'base64'),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([720, 540]);
    const same = `data:image/jpeg;base64,${portrait.toString('base64')}`;
    expect(await cropFrameToAspect(same, '9:16')).toBe(same);
    expect(await cropFrameToAspect('/static/a.jpg', '4:3')).toBe(
      '/static/a.jpg',
    );
  });

  it('only treats an enabled template with an image as active', () => {
    const base: DouyinVideoTemplate = {
      enabled: true,
      window: { x: 0, y: 0, width: 1080, height: 810 },
      aspectRatio: '4:3',
      title: '标题',
      sellingPoints: [],
      style: '',
      imageUrl: '/static/t.png',
      updatedAt: new Date(),
    };
    expect(activeTemplateAspect(base)).toBe('4:3');
    expect(activeTemplateAspect({ ...base, enabled: false })).toBeUndefined();
    expect(
      activeTemplateAspect({ ...base, imageUrl: undefined }),
    ).toBeUndefined();
    expect(activeTemplateAspect(undefined)).toBeUndefined();
    expect(describeVideoAspect('4:3')).toBe('horizontal 4:3');
    expect(describeVideoAspect()).toBe('vertical 9:16');
  });
});
