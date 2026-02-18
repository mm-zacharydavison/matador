import { describe, expect, it } from 'bun:test';
import { createEnvelope } from '../types/envelope.js';
import {
  DoRetry,
  DontRetry,
  EventAssertionError,
  assertEvent,
  isAssertionError,
  isDoRetry,
  isDontRetry,
} from './retry-errors.js';

function createTestEnvelope(data: unknown = { foo: 'bar' }) {
  return createEnvelope({
    data,
    eventKey: 'test.event',
    targetSubscriber: 'test-subscriber',
    importance: 'can-ignore',
  });
}

describe('retry-errors', () => {
  describe('DoRetry', () => {
    it('should have correct name', () => {
      const error = new DoRetry('test message');
      expect(error.name).toBe('DoRetry');
    });

    it('should have description', () => {
      const error = new DoRetry('test message');
      expect(error.description).toBeDefined();
    });

    it('should serialize to JSON', () => {
      const error = new DoRetry('test message');
      const json = error.toJSON();
      expect(json.name).toBe('DoRetry');
      expect(json.message).toBe('test message');
      expect(json.description).toBeDefined();
    });
  });

  describe('DontRetry', () => {
    it('should have correct name', () => {
      const error = new DontRetry('test message');
      expect(error.name).toBe('DontRetry');
    });

    it('should have description', () => {
      const error = new DontRetry('test message');
      expect(error.description).toBeDefined();
    });

    it('should serialize to JSON', () => {
      const error = new DontRetry('test message');
      const json = error.toJSON();
      expect(json.name).toBe('DontRetry');
      expect(json.message).toBe('test message');
      expect(json.description).toBeDefined();
    });
  });

  describe('EventAssertionError', () => {
    it('should have correct name', () => {
      const envelope = createTestEnvelope();
      const error = new EventAssertionError(envelope, 'assertion failed');
      expect(error.name).toBe('EventAssertionError');
    });

    it('should store the envelope', () => {
      const envelope = createTestEnvelope();
      const error = new EventAssertionError(envelope, 'assertion failed');
      expect(error.envelope).toBe(envelope);
    });

    it('should have description', () => {
      const envelope = createTestEnvelope();
      const error = new EventAssertionError(envelope, 'assertion failed');
      expect(error.description).toBeDefined();
      expect(error.description).toContain('NOT to retry');
    });

    it('should serialize to JSON with envelope', () => {
      const envelope = createTestEnvelope();
      const error = new EventAssertionError(envelope, 'assertion failed');
      const json = error.toJSON();
      expect(json.name).toBe('EventAssertionError');
      expect(json.message).toBe('assertion failed');
      expect(json.envelope).toBe(envelope);
      expect(json.description).toBeDefined();
    });
  });

  describe('assertEvent', () => {
    it('should not throw when value is truthy', () => {
      const envelope = createTestEnvelope();
      expect(() => assertEvent(envelope, true, 'should be true')).not.toThrow();
      expect(() =>
        assertEvent(envelope, 'string', 'should be string'),
      ).not.toThrow();
      expect(() => assertEvent(envelope, 1, 'should be number')).not.toThrow();
      expect(() => assertEvent(envelope, {}, 'should be object')).not.toThrow();
      expect(() => assertEvent(envelope, [], 'should be array')).not.toThrow();
    });

    it('should throw EventAssertionError when value is falsy', () => {
      const envelope = createTestEnvelope();

      expect(() => assertEvent(envelope, false, 'value was false')).toThrow(
        EventAssertionError,
      );
      expect(() => assertEvent(envelope, null, 'value was null')).toThrow(
        EventAssertionError,
      );
      expect(() =>
        assertEvent(envelope, undefined, 'value was undefined'),
      ).toThrow(EventAssertionError);
      expect(() => assertEvent(envelope, 0, 'value was zero')).toThrow(
        EventAssertionError,
      );
      expect(() => assertEvent(envelope, '', 'value was empty string')).toThrow(
        EventAssertionError,
      );
    });

    it('should include envelope in thrown error', () => {
      const envelope = createTestEnvelope();
      try {
        assertEvent(envelope, false, 'assertion failed');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(EventAssertionError);
        expect((error as EventAssertionError).envelope).toBe(envelope);
        expect((error as EventAssertionError).message).toBe('assertion failed');
      }
    });

    it('should include message in thrown error', () => {
      const envelope = createTestEnvelope();
      try {
        assertEvent(envelope, null, 'userId is required');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(EventAssertionError);
        expect((error as EventAssertionError).message).toBe(
          'userId is required',
        );
      }
    });
  });

  describe('type guards', () => {
    it('isDoRetry should identify DoRetry errors', () => {
      expect(isDoRetry(new DoRetry('test'))).toBe(true);
      expect(isDoRetry(new DontRetry('test'))).toBe(false);
      expect(isDoRetry(new Error('test'))).toBe(false);
      expect(isDoRetry(null)).toBe(false);
    });

    it('isDontRetry should identify DontRetry errors', () => {
      expect(isDontRetry(new DontRetry('test'))).toBe(true);
      expect(isDontRetry(new DoRetry('test'))).toBe(false);
      expect(isDontRetry(new Error('test'))).toBe(false);
      expect(isDontRetry(null)).toBe(false);
    });

    it('isAssertionError should identify EventAssertionError', () => {
      const envelope = createTestEnvelope();
      expect(isAssertionError(new EventAssertionError(envelope, 'test'))).toBe(
        true,
      );
      expect(isAssertionError(new DoRetry('test'))).toBe(false);
      expect(isAssertionError(new Error('test'))).toBe(false);
      expect(isAssertionError(null)).toBe(false);
    });
  });
});
