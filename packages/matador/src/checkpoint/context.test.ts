import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Envelope, SubscriberDefinition } from '../types/index.js';
import { ResumableContext } from './context.js';
import { DuplicateIoKeyError } from '../errors/index.js';
import { MemoryCheckpointStore } from './stores/memory.js';

function createTestEnvelope(id = 'test-envelope-id', attempts = 1): Envelope {
  return {
    id,
    data: { userId: '123' },
    docket: {
      eventKey: 'test.event',
      targetSubscriber: 'test-subscriber',
      importance: 'should-investigate',
      attempts,
      createdAt: new Date().toISOString(),
    },
  };
}

function createTestSubscriber(name = 'test-subscriber'): SubscriberDefinition {
  return {
    name,
    description: 'Test subscriber',
    idempotent: 'resumable',
    importance: 'should-investigate',
  };
}

describe('ResumableContext', () => {
  let store: MemoryCheckpointStore;
  let envelope: Envelope;
  let subscriber: SubscriberDefinition;

  beforeEach(() => {
    store = new MemoryCheckpointStore();
    envelope = createTestEnvelope();
    subscriber = createTestSubscriber();
  });

  describe('io()', () => {
    it('should execute function and cache result on first call', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      let executeCount = 0;
      const result = await context.io('step-1', () => {
        executeCount++;
        return 'result-1';
      });

      expect(result).toBe('result-1');
      expect(executeCount).toBe(1);
      expect(store.size).toBe(1);
    });

    it('should return cached result on retry without re-executing', async () => {
      // First execution - cache the result
      const firstContext = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      let executeCount = 0;
      await firstContext.io('step-1', () => {
        executeCount++;
        return 'result-1';
      });

      expect(executeCount).toBe(1);

      // Simulate retry - load existing checkpoint
      const checkpoint = await store.get(envelope.id);
      const retryContext = new ResumableContext({
        store,
        envelope: createTestEnvelope(envelope.id, 2),
        subscriber,
        existingCheckpoint: checkpoint,
      });

      const result = await retryContext.io<string>('step-1', () => {
        executeCount++;
        return 'should-not-be-used';
      });

      expect(result).toBe('result-1');
      expect(executeCount).toBe(1); // Still 1, not re-executed
    });

    it('should throw DuplicateIoKeyError on duplicate key within same execution', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      await context.io('same-key', () => 'first');

      await expect(context.io('same-key', () => 'second')).rejects.toThrow(
        DuplicateIoKeyError,
      );
    });

    it('should handle async functions', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      const result = await context.io('async-step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { value: 42 };
      });

      expect(result).toEqual({ value: 42 });
    });

    it('should not cache failed operations', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      // First attempt - fails
      await expect(
        context.io('failing-step', () => {
          throw new Error('Operation failed');
        }),
      ).rejects.toThrow('Operation failed');

      // Checkpoint should not contain the failed step
      const checkpoint = await store.get(envelope.id);
      expect(checkpoint?.completedSteps['failing-step']).toBeUndefined();
    });

    it('should persist checkpoint after each io() call', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      await context.io('step-1', () => 'result-1');
      let checkpoint = await store.get(envelope.id);
      expect(Object.keys(checkpoint!.completedSteps)).toHaveLength(1);

      await context.io('step-2', () => 'result-2');
      checkpoint = await store.get(envelope.id);
      expect(Object.keys(checkpoint!.completedSteps)).toHaveLength(2);
    });

    it('should support various JSON-serializable return types', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      expect(await context.io('string', () => 'hello')).toBe('hello');
      expect(await context.io('number', () => 42)).toBe(42);
      expect(await context.io('boolean', () => true)).toBe(true);
      expect(await context.io('null', () => null)).toBe(null);
      expect(await context.io('array', () => [1, 2, 3])).toEqual([1, 2, 3]);
      expect(await context.io('object', () => ({ foo: 'bar' }))).toEqual({
        foo: 'bar',
      });
    });
  });

  describe('all()', () => {
    it('should execute multiple operations in parallel', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      const executionOrder: string[] = [];
      const [a, b, c] = await context.all([
        [
          'fetch-a',
          () => {
            executionOrder.push('a');
            return 'result-a';
          },
        ],
        [
          'fetch-b',
          () => {
            executionOrder.push('b');
            return 'result-b';
          },
        ],
        [
          'fetch-c',
          () => {
            executionOrder.push('c');
            return 'result-c';
          },
        ],
      ]);

      expect(a).toBe('result-a');
      expect(b).toBe('result-b');
      expect(c).toBe('result-c');
      expect(executionOrder).toHaveLength(3);
    });

    it('should cache all results on retry', async () => {
      // First execution
      const firstContext = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      let executeCount = 0;
      await firstContext.all([
        [
          'fetch-a',
          () => {
            executeCount++;
            return 'result-a';
          },
        ],
        [
          'fetch-b',
          () => {
            executeCount++;
            return 'result-b';
          },
        ],
      ]);

      expect(executeCount).toBe(2);

      // Retry with cached checkpoint
      const checkpoint = await store.get(envelope.id);
      const retryContext = new ResumableContext({
        store,
        envelope: createTestEnvelope(envelope.id, 2),
        subscriber,
        existingCheckpoint: checkpoint,
      });

      const [a, b] = await retryContext.all([
        [
          'fetch-a',
          () => {
            executeCount++;
            return 'new-a';
          },
        ],
        [
          'fetch-b',
          () => {
            executeCount++;
            return 'new-b';
          },
        ],
      ]);

      expect(a).toBe('result-a'); // Cached
      expect(b).toBe('result-b'); // Cached
      expect(executeCount).toBe(2); // Still 2, not re-executed
    });

    it('should throw on duplicate key in all()', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      await expect(
        context.all([
          ['same-key', () => 'first'],
          ['same-key', () => 'second'],
        ]),
      ).rejects.toThrow(DuplicateIoKeyError);
    });

    it('should throw if all() key conflicts with previous io() key', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      await context.io('used-key', () => 'first');

      await expect(
        context.all([
          ['used-key', () => 'second'],
          ['new-key', () => 'third'],
        ]),
      ).rejects.toThrow(DuplicateIoKeyError);
    });
  });

  describe('attempt and isRetry', () => {
    it('should report attempt number from envelope', async () => {
      const context = new ResumableContext({
        store,
        envelope: createTestEnvelope('test', 3),
        subscriber,
      });

      expect(context.attempt).toBe(3);
    });

    it('should report isRetry as false for first attempt', async () => {
      const context = new ResumableContext({
        store,
        envelope: createTestEnvelope('test', 1),
        subscriber,
      });

      expect(context.isRetry).toBe(false);
    });

    it('should report isRetry as true for subsequent attempts', async () => {
      const context = new ResumableContext({
        store,
        envelope: createTestEnvelope('test', 2),
        subscriber,
      });

      expect(context.isRetry).toBe(true);
    });
  });

  describe('clear()', () => {
    it('should delete checkpoint from store', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      await context.io('step-1', () => 'result');
      expect(store.size).toBe(1);

      await context.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('hooks', () => {
    it('should call onCheckpointHit when using cached value', async () => {
      const onCheckpointHit = vi.fn();

      // First execution - populate cache
      const firstContext = new ResumableContext({
        store,
        envelope,
        subscriber,
      });
      await firstContext.io('cached-step', () => 'cached-result');

      // Retry with hooks
      const checkpoint = await store.get(envelope.id);
      const retryContext = new ResumableContext({
        store,
        envelope: createTestEnvelope(envelope.id, 2),
        subscriber,
        existingCheckpoint: checkpoint,
        hooks: { onCheckpointHit },
      });

      await retryContext.io('cached-step', () => 'new-result');

      expect(onCheckpointHit).toHaveBeenCalledWith({
        envelope: expect.anything(),
        subscriber,
        stepKey: 'cached-step',
      });
    });

    it('should call onCheckpointMiss when executing fresh', async () => {
      const onCheckpointMiss = vi.fn();

      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
        hooks: { onCheckpointMiss },
      });

      await context.io('fresh-step', () => 'result');

      expect(onCheckpointMiss).toHaveBeenCalledWith({
        envelope,
        subscriber,
        stepKey: 'fresh-step',
      });
    });
  });

  describe('real-world scenarios', () => {
    it('should replay cached steps and execute new ones on retry', async () => {
      const executionLog: string[] = [];
      let shouldFail = true;

      // First attempt - fails after step-1
      const firstContext = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      try {
        await firstContext.io('step-0', () => {
          executionLog.push('step-0');
          return 'result-0';
        });

        await firstContext.io('step-1', () => {
          executionLog.push('step-1');
          return 'result-1';
        });

        if (shouldFail) {
          shouldFail = false;
          throw new Error('Simulated failure');
        }

        await firstContext.io('step-2', () => {
          executionLog.push('step-2');
          return 'result-2';
        });
      } catch {
        // Expected failure
      }

      expect(executionLog).toEqual(['step-0', 'step-1']);

      // Retry - step-0 and step-1 use cache, step-2 executes
      executionLog.length = 0;
      const checkpoint = await store.get(envelope.id);
      const retryContext = new ResumableContext({
        store,
        envelope: createTestEnvelope(envelope.id, 2),
        subscriber,
        existingCheckpoint: checkpoint,
      });

      await retryContext.io('step-0', () => {
        executionLog.push('step-0');
        return 'should-not-use';
      });

      await retryContext.io('step-1', () => {
        executionLog.push('step-1');
        return 'should-not-use';
      });

      await retryContext.io('step-2', () => {
        executionLog.push('step-2');
        return 'result-2';
      });

      expect(executionLog).toEqual(['step-2']); // Only step-2 executed!
    });

    it('should handle conditional io() calls correctly', async () => {
      const context = new ResumableContext({
        store,
        envelope: { ...envelope, data: { sendEmail: true } },
        subscriber,
      });

      const result = await context.io('send-email', () => ({
        messageId: 'msg-123',
      }));

      expect(result).toEqual({ messageId: 'msg-123' });
    });

    it('should handle dynamic loop with unique keys', async () => {
      const context = new ResumableContext({
        store,
        envelope,
        subscriber,
      });

      const items = [
        { id: 'item-1', value: 10 },
        { id: 'item-2', value: 20 },
        { id: 'item-3', value: 30 },
      ];

      const results: number[] = [];
      for (const item of items) {
        const processed = await context.io(`process-${item.id}`, () => {
          return item.value * 2;
        });
        results.push(processed);
      }

      expect(results).toEqual([20, 40, 60]);
    });
  });
});
