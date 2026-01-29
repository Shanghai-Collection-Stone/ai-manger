import { ContextService } from './context.service';
import { ContextRole } from '../enums/context.enums';
import type { Db } from 'mongodb';
import type { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

describe('ContextService.getMessages', () => {
  it('maps stored assistant parts by assistant order, not checkpoint timestamp', async () => {
    const checkpointTs = 200_000;
    const tuple = {
      checkpoint: {
        ts: checkpointTs,
        channel_values: {
          messages: [
            { type: 'human', content: 'hi' },
            { type: 'ai', content: 'first' },
            { type: 'human', content: 'yo' },
            { type: 'ai', content: 'second' },
          ],
        },
      },
    };

    const storedAssistants = [
      {
        sessionId: 'sid',
        role: ContextRole.Assistant,
        content: 'first',
        parts: [{ type: 'text', content: 'first' }],
        timestamp: new Date(1_000),
      },
      {
        sessionId: 'sid',
        role: ContextRole.Assistant,
        content: 'second',
        parts: [{ type: 'text', content: 'second' }],
        timestamp: new Date(checkpointTs),
      },
    ];

    const mockConversations = {
      createIndex: jest.fn().mockResolvedValue(undefined),
    };
    const mockMessages = {
      createIndex: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(storedAssistants),
        }),
      }),
    };
    const mockDeleted = {
      createIndex: jest.fn().mockResolvedValue(undefined),
    };
    const mockDb = {
      collection: jest.fn((name: string) => {
        if (name === 'conversations') return mockConversations;
        if (name === 'messages') return mockMessages;
        if (name === 'deleted_messages') return mockDeleted;
        return {};
      }),
    };
    const mockSaver = {
      getTuple: jest.fn().mockResolvedValue(tuple),
    };

    const svc = new ContextService(
      mockDb as unknown as Db,
      mockSaver as unknown as MongoDBSaver,
    );
    const out = await svc.getMessages('sid');
    const assistants = out.filter((m) => m.role === ContextRole.Assistant);

    expect(assistants).toHaveLength(2);
    expect(assistants[0].content).toBe('first');
    expect(assistants[0].parts).toEqual([{ type: 'text', content: 'first' }]);
    expect(assistants[1].content).toBe('second');
    expect(assistants[1].parts).toEqual([{ type: 'text', content: 'second' }]);
  });
});
