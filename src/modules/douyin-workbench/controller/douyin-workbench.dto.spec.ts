import { ValidationPipe } from '@nestjs/common';
import { UpdateDouyinTopicDto } from './douyin-workbench.dto';
import { normalizePublishCopy } from '../services/douyin-workbench-repository.service';

/**
 * 控制器上挂的是 `forbidNonWhitelisted`，所以服务端自己写进分镜的字段
 * （例如卡通换头记下的 `originalMedia`）只要没进 DTO 白名单，
 * 前端把分镜原样回传保存时就会被打成 400。用同一套管道跑一遍守住这件事。
 */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const metadata = {
  type: 'body' as const,
  metatype: UpdateDouyinTopicDto,
};

const image = (id: number) => ({
  type: 'image',
  id,
  name: `图片 #${id}`,
  url: `/static/gallery/${id}.jpg`,
  coverUrl: `/static/gallery/${id}.jpg`,
});

describe('抖音工作台 DTO', () => {
  it('分镜保存要收下服务端写进去的每一个字段', async () => {
    const shot = {
      id: 'shot-1',
      duration: 4,
      shotType: '特写',
      visual: '门店招牌特写',
      narration: '这家店藏在巷子里',
      transition: '硬切',
      media: image(1),
      originalMedia: image(2),
      imagePrompt: '门店招牌',
      videoId: 3,
    };
    await expect(
      pipe.transform({ storyboard: [shot] }, metadata),
    ).resolves.toMatchObject({ storyboard: [shot] });
  });

  it('没处理过的分镜不带 originalMedia 也能存', async () => {
    await expect(
      pipe.transform(
        {
          storyboard: [
            {
              id: 'shot-1',
              duration: 4,
              shotType: '特写',
              visual: '门店招牌特写',
              narration: '',
              transition: '',
              media: image(1),
            },
          ],
        },
        metadata,
      ),
    ).resolves.toBeDefined();
  });

  it('整片清晰度与时长按白名单收', async () => {
    await expect(
      pipe.transform(
        { fullVideoResolution: '1080P', fullVideoDuration: 15 },
        metadata,
      ),
    ).resolves.toMatchObject({
      fullVideoResolution: '1080P',
      fullVideoDuration: 15,
    });
  });

  it('发布文案按白名单收，话题超过 5 个打回', async () => {
    const publishCopy = {
      title: '巷子里的宝藏小店',
      description: '藏在老街的一家店，去过的都说值。你最想打卡哪一家？',
      tags: ['#探店', '宝藏小店'],
    };
    await expect(
      pipe.transform({ publishCopy }, metadata),
    ).resolves.toMatchObject({ publishCopy });
    await expect(
      pipe.transform(
        {
          publishCopy: { ...publishCopy, tags: ['1', '2', '3', '4', '5', '6'] },
        },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it('发布文案去井号去重、全空时清掉', () => {
    expect(
      normalizePublishCopy({
        title: '  标题\n换行 ',
        description: '正文',
        tags: ['#探店', '探店', '##美食', ' '],
      }),
    ).toEqual({
      title: '标题 换行',
      description: '正文',
      tags: ['探店', '美食'],
    });
    expect(
      normalizePublishCopy({ title: ' ', description: '', tags: [] }),
    ).toBeNull();
  });

  it('真的不认识的字段仍然要打回，白名单不能形同虚设', async () => {
    await expect(
      pipe.transform({ 不存在的字段: 1 }, metadata),
    ).rejects.toThrow();
  });
});
