import type { XhsTopicCandidate } from '../entities/xhs-topic.entity.js';
import {
  normalizeRequirementRecommendation,
  recordTopicCandidates,
} from './xhs-topic.service.js';

describe('recordTopicCandidates', () => {
  it('一次交付全部候选时逐条写入并带上文章风格', () => {
    const candidates: XhsTopicCandidate[] = [];
    const result = recordTopicCandidates(
      candidates,
      [
        { title: '  周末  城市漫步路线 ', topic_type: '城市观察' },
        { title: '一个人吃火锅的勇气', topic_type: '情绪共鸣' },
      ],
      2,
      '第一人称口语',
    );
    expect(result).toEqual({ recorded: 2, problems: [] });
    expect(candidates).toEqual([
      {
        title: '周末 城市漫步路线',
        topicType: '城市观察',
        articleStyle: '第一人称口语',
      },
      {
        title: '一个人吃火锅的勇气',
        topicType: '情绪共鸣',
        articleStyle: '第一人称口语',
      },
    ]);
  });

  it('单条不合格只跳过该条并说明原因，不连累整批', () => {
    const candidates: XhsTopicCandidate[] = [
      { title: '已有题目', topicType: '生活指南' },
    ];
    const result = recordTopicCandidates(
      candidates,
      [
        { title: '已有题目', topic_type: '生活指南' },
        { title: '新题目', topic_type: '' },
        { title: '另一个新题目', topicType: '趋势讨论' },
      ],
      5,
    );
    expect(result.recorded).toBe(1);
    expect(result.problems).toEqual([
      '《已有题目》与已有题目重复',
      '《新题目》题目或题目类型少于 2 个字',
    ]);
    expect(candidates.map((item) => item.title)).toEqual([
      '已有题目',
      '另一个新题目',
    ]);
  });

  it('超出目标数量的忽略，JSON 字符串也能解析', () => {
    const candidates: XhsTopicCandidate[] = [];
    const result = recordTopicCandidates(
      candidates,
      JSON.stringify([
        { title: '题目一', topic_type: '生活指南' },
        { title: '题目二', topic_type: '生活指南' },
      ]),
      1,
    );
    expect(result.recorded).toBe(1);
    expect(result.problems).toEqual(['《题目二》超出目标数量，已忽略']);
  });

  it('参数不是数组时整批不记录并给出原因', () => {
    const candidates: XhsTopicCandidate[] = [];
    expect(recordTopicCandidates(candidates, '不是 JSON', 3)).toEqual({
      recorded: 0,
      problems: ['candidates 不是合法的 JSON 数组'],
    });
    expect(recordTopicCandidates(candidates, { title: 'x' }, 3)).toEqual({
      recorded: 0,
      problems: ['candidates 必须是数组'],
    });
    expect(candidates).toEqual([]);
  });
});

describe('normalizeRequirementRecommendation', () => {
  const options = {
    purposes: ['攻略教程', '种草推荐'],
    personas: ['打工人', '宝妈'],
    styles: ['第一人称', '真实体验', '干货清单'],
    lengths: ['不限', '300字左右'],
  };

  it('合格交付原样收下', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      {
        purpose: '攻略教程',
        persona: '打工人',
        styleTags: ['第一人称', '干货清单'],
        keywords: ['上海', '周末'],
        length: '300字左右',
        idea: '用一天的时间线讲清楚怎么玩',
      },
      options,
    );
    expect(problems).toEqual([]);
    expect(result).toEqual({
      purpose: '攻略教程',
      persona: '打工人',
      styleTags: ['第一人称', '干货清单'],
      keywords: ['上海', '周末'],
      length: '300字左右',
      idea: '用一天的时间线讲清楚怎么玩',
    });
  });

  it('近似值、分隔符串与井号都能归一，长度缺省回落不限', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      {
        purpose: ' 攻略 ',
        persona: '打工人。',
        styleTags: '#真实体验，干货清单、不存在的风格',
        keywords: '#上海 周末,  ,一个人',
        length: '800字',
        idea: '  从房间收纳切入  ',
      },
      options,
    );
    expect(problems).toEqual([]);
    expect(result.purpose).toBe('攻略教程');
    expect(result.persona).toBe('打工人');
    expect(result.styleTags).toEqual(['真实体验', '干货清单']);
    expect(result.keywords).toEqual(['上海 周末', '一个人']);
    expect(result.length).toBe('不限');
    expect(result.idea).toBe('从房间收纳切入');
  });

  it('越界的值丢弃并说明原因，供重试提示词使用', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      { purpose: '随便写写', persona: '', styleTags: ['不存在'] },
      options,
    );
    expect(result.purpose).toBe('');
    expect(result.styleTags).toEqual([]);
    expect(problems).toEqual([
      'purpose 必须逐字取自：攻略教程、种草推荐',
      'persona 必须逐字取自：打工人、宝妈',
      'styleTags 至少从 styles 候选里逐字选 1 项',
      'keywords 至少给 2 个具体关键词',
      'idea 不能为空，用一句话写清切入角度',
    ]);
  });
});
