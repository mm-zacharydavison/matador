import { beforeEach, describe, expect, it } from 'bun:test';
import { BaseEvent, createSubscriber } from '../types/index.js';
import { SchemaError, SchemaRegistry } from './registry.js';

class TestEvent extends BaseEvent<{ id: string }> {
  static readonly key = 'test.event';
  static readonly description = 'A test event';
}

class AliasedEvent extends BaseEvent<{ name: string }> {
  static readonly key = 'user.created.v2';
  static readonly description = 'User created event with aliases';
  static readonly aliases = ['user.created', 'user.created.v1'];
}

describe('SchemaRegistry', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  describe('register', () => {
    it('should register an event with subscribers', () => {
      const subscriber = createSubscriber(
        'test-subscriber',
        TestEvent,
        async () => {},
      );

      registry.register(TestEvent, [subscriber]);

      expect(registry.hasEvent('test.event')).toBe(true);
      expect(registry.getSubscribers('test.event')).toHaveLength(1);
    });

    it('should throw when registering duplicate event without override', () => {
      const subscriber = createSubscriber(
        'test-subscriber',
        TestEvent,
        async () => {},
      );

      registry.register(TestEvent, [subscriber]);

      expect(() => registry.register(TestEvent, [subscriber])).toThrow(
        SchemaError,
      );
    });

    it('should allow override when option is set', () => {
      const subscriber1 = createSubscriber('sub-1', TestEvent, async () => {});
      const subscriber2 = createSubscriber('sub-2', TestEvent, async () => {});

      registry.register(TestEvent, [subscriber1]);
      registry.register(TestEvent, [subscriber2], { override: true });

      const subscribers = registry.getSubscribers('test.event');
      expect(subscribers).toHaveLength(1);
      expect(subscribers[0]?.name).toBe('sub-2');
    });

    it('should register aliases', () => {
      const subscriber = createSubscriber(
        'test-subscriber',
        AliasedEvent,
        async () => {},
      );

      registry.register(AliasedEvent, [subscriber]);

      expect(registry.hasEvent('user.created.v2')).toBe(true);
      expect(registry.hasEvent('user.created')).toBe(true);
      expect(registry.hasEvent('user.created.v1')).toBe(true);
    });

    it('should throw on duplicate aliases without override', () => {
      class EventWithSameAlias extends BaseEvent<{ x: number }> {
        static readonly key = 'another.event';
        static readonly description = 'Another event';
        static readonly aliases = ['user.created']; // conflicts with AliasedEvent
      }

      const sub1 = createSubscriber('sub-1', AliasedEvent, async () => {});
      const sub2 = createSubscriber(
        'sub-2',
        EventWithSameAlias,
        async () => {},
      );

      registry.register(AliasedEvent, [sub1]);

      expect(() => registry.register(EventWithSameAlias, [sub2])).toThrow(
        'Alias "user.created" is already registered',
      );
    });
  });

  describe('getEventClass', () => {
    it('should return event class by key', () => {
      const subscriber = createSubscriber(
        'test-subscriber',
        TestEvent,
        async () => {},
      );
      registry.register(TestEvent, [subscriber]);

      const eventClass = registry.getEventClass('test.event');
      expect(eventClass).toBeDefined();
      expect(eventClass?.key).toBe('test.event');
    });

    it('should return event class by alias', () => {
      const subscriber = createSubscriber(
        'test-subscriber',
        AliasedEvent,
        async () => {},
      );
      registry.register(AliasedEvent, [subscriber]);

      const eventClass = registry.getEventClass('user.created');
      expect(eventClass).toBeDefined();
      expect(eventClass?.key).toBe('user.created.v2');
    });

    it('should return undefined for unknown key', () => {
      expect(registry.getEventClass('unknown.event')).toBeUndefined();
    });
  });

  describe('getSubscribers', () => {
    it('should return all subscribers for an event', () => {
      const sub1 = createSubscriber('sub-1', TestEvent, async () => {});
      const sub2 = createSubscriber('sub-2', TestEvent, async () => {});

      registry.register(TestEvent, [sub1, sub2]);

      const subscribers = registry.getSubscribers('test.event');
      expect(subscribers).toHaveLength(2);
      expect(subscribers[0]?.name).toBe('sub-1');
      expect(subscribers[1]?.name).toBe('sub-2');
    });

    it('should return empty array for unknown event', () => {
      expect(registry.getSubscribers('unknown.event')).toEqual([]);
    });
  });

  describe('getSubscriber', () => {
    it('should return specific subscriber by name', () => {
      const sub1 = createSubscriber('sub-1', TestEvent, async () => {});
      const sub2 = createSubscriber('sub-2', TestEvent, async () => {});

      registry.register(TestEvent, [sub1, sub2]);

      const subscriber = registry.getSubscriber('test.event', 'sub-2');
      expect(subscriber?.name).toBe('sub-2');
    });

    it('should return undefined for unknown subscriber', () => {
      const sub = createSubscriber('sub-1', TestEvent, async () => {});
      registry.register(TestEvent, [sub]);

      expect(registry.getSubscriber('test.event', 'unknown')).toBeUndefined();
    });
  });

  describe('getSubscriberDefinition', () => {
    it('should return subscriber definition for pipeline', () => {
      const sub = createSubscriber('sub-1', TestEvent, async () => {}, {
        idempotent: 'yes',
        importance: 'must-investigate',
        targetQueue: 'custom-queue',
      });

      registry.register(TestEvent, [sub]);

      const definition = registry.getSubscriberDefinition(
        'test.event',
        'sub-1',
      );
      expect(definition).toEqual({
        name: 'sub-1',
        idempotent: 'yes',
        importance: 'must-investigate',
        targetQueue: 'custom-queue',
      });
    });

    it('should return undefined for unknown subscriber', () => {
      expect(
        registry.getSubscriberDefinition('unknown', 'unknown'),
      ).toBeUndefined();
    });
  });

  describe('getExecutableSubscriber', () => {
    it('should return subscriber with callback', () => {
      const callback = async () => {};
      const sub = createSubscriber('sub-1', TestEvent, callback);

      registry.register(TestEvent, [sub]);

      const executable = registry.getExecutableSubscriber(
        'test.event',
        'sub-1',
      );
      expect(executable).toBeDefined();
      expect(executable?.callback).toBe(callback);
    });
  });

  describe('getEventKeys', () => {
    it('should return all registered event keys', () => {
      const sub1 = createSubscriber('sub-1', TestEvent, async () => {});
      const sub2 = createSubscriber('sub-2', AliasedEvent, async () => {});

      registry.register(TestEvent, [sub1]);
      registry.register(AliasedEvent, [sub2]);

      const keys = registry.getEventKeys();
      expect(keys).toContain('test.event');
      expect(keys).toContain('user.created.v2');
      expect(keys).not.toContain('user.created'); // aliases not included
    });
  });

  describe('validate', () => {
    it('should pass validation for valid schema', () => {
      const sub = createSubscriber('sub-1', TestEvent, async () => {});
      registry.register(TestEvent, [sub]);

      const result = registry.validate();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect duplicate subscriber names', () => {
      const sub1 = createSubscriber(
        'duplicate-name',
        TestEvent,
        async () => {},
      );
      const sub2 = createSubscriber(
        'duplicate-name',
        TestEvent,
        async () => {},
      );

      registry.register(TestEvent, [sub1, sub2]);

      const result = registry.validate();
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.severity).toBe('error');
      expect(result.issues[0]?.message).toContain('Duplicate subscriber name');
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const sub = createSubscriber('sub-1', TestEvent, async () => {});
      registry.register(TestEvent, [sub]);

      registry.clear();

      expect(registry.hasEvent('test.event')).toBe(false);
      expect(registry.getEventKeys()).toHaveLength(0);
    });
  });
});
