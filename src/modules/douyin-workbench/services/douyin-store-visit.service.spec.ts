import {
  buildDigitalHumanUrl,
  DIGITAL_HUMAN_PATHS,
  mapDigitalHumanStatus,
  readDirectField,
} from './douyin-store-visit.service.js';

describe('douyin store visit helpers', () => {
  it('normalizes direct service statuses', () => {
    expect(mapDigitalHumanStatus('PENDING')).toBe('queued');
    expect(mapDigitalHumanStatus('submitted')).toBe('queued');
    expect(mapDigitalHumanStatus('processing')).toBe('running');
    expect(mapDigitalHumanStatus(undefined)).toBe('running');
    expect(mapDigitalHumanStatus('SUCCEEDED')).toBe('completed');
    expect(mapDigitalHumanStatus('done')).toBe('completed');
    expect(mapDigitalHumanStatus('cancelled')).toBe('failed');
    expect(mapDigitalHumanStatus('error')).toBe('failed');
  });

  it('prefers the first candidate key across layers over a later key at the top level', () => {
    const response = { id: 'request-1', data: { voiceId: 'voice-9' } };
    expect(readDirectField(response, ['voiceId', 'voice_id', 'id'])).toBe(
      'voice-9',
    );
    expect(readDirectField({ voice_id: 'v-2' }, ['voiceId', 'voice_id'])).toBe(
      'v-2',
    );
    expect(
      readDirectField({ output: { video_url: 'https://cdn/x.mp4' } }, [
        'videoUrl',
        'video_url',
      ]),
    ).toBe('https://cdn/x.mp4');
  });

  it('accepts numeric values and skips blanks', () => {
    expect(readDirectField({ videoId: 12 }, ['videoId'])).toBe('12');
    expect(
      readDirectField(
        { videoUrl: '  ', result: { videoUrl: 'https://a/b.mp4' } },
        ['videoUrl'],
      ),
    ).toBe('https://a/b.mp4');
    expect(readDirectField({}, ['videoUrl'])).toBe('');
  });

  it('joins contract paths onto the provider base url', () => {
    expect(
      buildDigitalHumanUrl(
        'https://avatar.example.com/api/',
        DIGITAL_HUMAN_PATHS.voiceClone,
      ),
    ).toBe('https://avatar.example.com/api/voice-clone');
    expect(
      buildDigitalHumanUrl(
        'https://avatar.example.com',
        DIGITAL_HUMAN_PATHS.queryTask,
        'task/1',
      ),
    ).toBe('https://avatar.example.com/digital-human/tasks/task%2F1');
  });
});
