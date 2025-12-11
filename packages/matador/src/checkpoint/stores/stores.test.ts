import { beforeEach, describe, expect, it } from 'bun:test';
import type { Checkpoint } from '../types.js';
import { MemoryCheckpointStore } from './memory.js';
import { NoOpCheckpointStore } from './noop.js';

describe('MemoryCheckpointStore', () => {
  let store: MemoryCheckpointStore;

  beforeEach(() => {
    store = new MemoryCheckpointStore();
  });

  describe('get()', () => {
    it('should return undefined for non-existent checkpoint', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return stored checkpoint', async () => {
      const checkpoint: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: { 'step-1': 'result-1' },
      };

      await store.set('test-id', checkpoint);
      const result = await store.get('test-id');

      expect(result).toEqual(checkpoint);
    });
  });

  describe('set()', () => {
    it('should store checkpoint', async () => {
      const checkpoint: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: {},
      };

      await store.set('test-id', checkpoint);
      expect(store.size).toBe(1);
    });

    it('should overwrite existing checkpoint', async () => {
      const checkpoint1: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: { 'step-1': 'old' },
      };

      const checkpoint2: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: { 'step-1': 'new', 'step-2': 'added' },
      };

      await store.set('test-id', checkpoint1);
      await store.set('test-id', checkpoint2);

      const result = await store.get('test-id');
      expect(result).toEqual(checkpoint2);
      expect(store.size).toBe(1);
    });
  });

  describe('delete()', () => {
    it('should delete checkpoint', async () => {
      const checkpoint: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: {},
      };

      await store.set('test-id', checkpoint);
      expect(store.size).toBe(1);

      await store.delete('test-id');
      expect(store.size).toBe(0);
    });

    it('should not throw when deleting non-existent checkpoint', async () => {
      await expect(store.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('utility methods', () => {
    it('size should return number of checkpoints', async () => {
      expect(store.size).toBe(0);

      await store.set('id-1', {
        envelopeId: 'id-1',
        subscriberName: 'sub',
        completedSteps: {},
      });
      expect(store.size).toBe(1);

      await store.set('id-2', {
        envelopeId: 'id-2',
        subscriberName: 'sub',
        completedSteps: {},
      });
      expect(store.size).toBe(2);
    });

    it('clear() should remove all checkpoints', async () => {
      await store.set('id-1', {
        envelopeId: 'id-1',
        subscriberName: 'sub',
        completedSteps: {},
      });
      await store.set('id-2', {
        envelopeId: 'id-2',
        subscriberName: 'sub',
        completedSteps: {},
      });

      expect(store.size).toBe(2);
      store.clear();
      expect(store.size).toBe(0);
    });

    it('keys() should return all checkpoint IDs', async () => {
      await store.set('id-1', {
        envelopeId: 'id-1',
        subscriberName: 'sub',
        completedSteps: {},
      });
      await store.set('id-2', {
        envelopeId: 'id-2',
        subscriberName: 'sub',
        completedSteps: {},
      });

      const keys = store.keys();
      expect(keys).toContain('id-1');
      expect(keys).toContain('id-2');
      expect(keys).toHaveLength(2);
    });
  });
});

describe('NoOpCheckpointStore', () => {
  let store: NoOpCheckpointStore;

  beforeEach(() => {
    store = new NoOpCheckpointStore();
  });

  describe('get()', () => {
    it('should always return undefined', async () => {
      const result = await store.get('any-id');
      expect(result).toBeUndefined();
    });
  });

  describe('set()', () => {
    it('should not store anything (no-op)', async () => {
      const checkpoint: Checkpoint = {
        envelopeId: 'test-id',
        subscriberName: 'test-subscriber',
        completedSteps: { 'step-1': 'result-1' },
      };

      await store.set('test-id', checkpoint);
      const result = await store.get('test-id');

      expect(result).toBeUndefined();
    });
  });

  describe('delete()', () => {
    it('should not throw', async () => {
      await expect(store.delete('any-id')).resolves.toBeUndefined();
    });
  });
});
