import { describe, expect, it } from 'bun:test';
import {
  MatadorEvent,
  createSubscriber,
  createSubscriberStub,
} from '../types/index.js';
import { bind, installPlugins, isSchemaEntryTuple } from './types.js';
import type { MatadorSchema } from './types.js';

class UserCreatedEvent extends MatadorEvent {
  static readonly key = 'user.created';
  static readonly description = 'User created event';

  constructor(public data: { userId: string }) {
    super();
  }
}

class OrderPlacedEvent extends MatadorEvent {
  static readonly key = 'order.placed';
  static readonly description = 'Order placed event';

  constructor(public data: { orderId: string }) {
    super();
  }
}

class ChatMessageSentEvent extends MatadorEvent {
  static readonly key = 'chat.message.sent';
  static readonly description = 'Chat message sent event';

  constructor(public data: { messageId: string }) {
    super();
  }
}

describe('bind', () => {
  it('should create a schema entry tuple', () => {
    const subscriber = createSubscriber<UserCreatedEvent>({
      name: 'test-sub',
      description: 'Test subscriber',
      callback: async () => {},
    });
    const entry = bind(UserCreatedEvent, [subscriber]);

    expect(isSchemaEntryTuple(entry)).toBe(true);
    expect(entry[0]).toBe(UserCreatedEvent);
    expect(entry[1]).toHaveLength(1);
    expect(entry[1][0]).toBe(subscriber);
  });
});

describe('isSchemaEntryTuple', () => {
  it('should return true for tuple format', () => {
    const entry = [UserCreatedEvent, []] as const;
    expect(isSchemaEntryTuple(entry)).toBe(true);
  });

  it('should return false for object format', () => {
    const entry = { eventClass: UserCreatedEvent, subscribers: [] };
    expect(isSchemaEntryTuple(entry)).toBe(false);
  });
});

describe('installPlugins', () => {
  it('should add plugin subscriber to all events', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const sub2 = createSubscriber<OrderPlacedEvent>({
      name: 'order-handler',
      description: 'Handles order events',
      callback: async () => {},
    });
    const globalSub = createSubscriber<MatadorEvent>({
      name: 'analytics',
      description: 'Analytics subscriber',
      callback: async () => {},
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: [UserCreatedEvent, [sub1]],
      [OrderPlacedEvent.key]: [OrderPlacedEvent, [sub2]],
    };

    const schema = installPlugins(baseSchema, [{ subscriber: globalSub }]);

    // Check user.created has both subscribers
    const userEntry = schema[UserCreatedEvent.key];
    expect(isSchemaEntryTuple(userEntry!)).toBe(true);
    const [, userSubs] = userEntry as [unknown, readonly unknown[]];
    expect(userSubs).toHaveLength(2);
    expect(userSubs[0]).toBe(sub1);
    expect(userSubs[1]).toBe(globalSub);

    // Check order.placed has both subscribers
    const orderEntry = schema[OrderPlacedEvent.key];
    const [, orderSubs] = orderEntry as [unknown, readonly unknown[]];
    expect(orderSubs).toHaveLength(2);
    expect(orderSubs[0]).toBe(sub2);
    expect(orderSubs[1]).toBe(globalSub);
  });

  it('should respect exclusions', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const sub2 = createSubscriber<OrderPlacedEvent>({
      name: 'order-handler',
      description: 'Handles order events',
      callback: async () => {},
    });
    const sub3 = createSubscriber<ChatMessageSentEvent>({
      name: 'chat-handler',
      description: 'Handles chat events',
      callback: async () => {},
    });
    const globalSub = createSubscriber<MatadorEvent>({
      name: 'analytics',
      description: 'Analytics subscriber',
      callback: async () => {},
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: [UserCreatedEvent, [sub1]],
      [OrderPlacedEvent.key]: [OrderPlacedEvent, [sub2]],
      [ChatMessageSentEvent.key]: [ChatMessageSentEvent, [sub3]],
    };

    const schema = installPlugins(baseSchema, [
      {
        subscriber: globalSub,
        exclusions: [ChatMessageSentEvent.key],
      },
    ]);

    // user.created should have analytics
    const userEntry = schema[UserCreatedEvent.key];
    const [, userSubs] = userEntry as [unknown, readonly unknown[]];
    expect(userSubs).toHaveLength(2);

    // order.placed should have analytics
    const orderEntry = schema[OrderPlacedEvent.key];
    const [, orderSubs] = orderEntry as [unknown, readonly unknown[]];
    expect(orderSubs).toHaveLength(2);

    // chat.message.sent should NOT have analytics (excluded)
    const chatEntry = schema[ChatMessageSentEvent.key];
    const [, chatSubs] = chatEntry as [unknown, readonly unknown[]];
    expect(chatSubs).toHaveLength(1);
    expect(chatSubs[0]).toBe(sub3);
  });

  it('should handle multiple plugins', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const analyticsSub = createSubscriber<MatadorEvent>({
      name: 'analytics',
      description: 'Analytics subscriber',
      callback: async () => {},
    });
    const loggingSub = createSubscriber<MatadorEvent>({
      name: 'logging',
      description: 'Logging subscriber',
      callback: async () => {},
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: [UserCreatedEvent, [sub1]],
    };

    const schema = installPlugins(baseSchema, [
      { subscriber: analyticsSub },
      { subscriber: loggingSub },
    ]);

    const entry = schema[UserCreatedEvent.key];
    const [, subs] = entry as [unknown, readonly unknown[]];
    expect(subs).toHaveLength(3);
    expect(subs[0]).toBe(sub1);
    expect(subs[1]).toBe(analyticsSub);
    expect(subs[2]).toBe(loggingSub);
  });

  it('should handle object format schema entries', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const globalSub = createSubscriber<MatadorEvent>({
      name: 'analytics',
      description: 'Analytics subscriber',
      callback: async () => {},
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: {
        eventClass: UserCreatedEvent,
        subscribers: [sub1],
      },
    };

    const schema = installPlugins(baseSchema, [{ subscriber: globalSub }]);

    const entry = schema[UserCreatedEvent.key];
    expect(isSchemaEntryTuple(entry!)).toBe(true);
    const [eventClass, subs] = entry as [unknown, readonly unknown[]];
    expect(eventClass).toBe(UserCreatedEvent);
    expect(subs).toHaveLength(2);
  });

  it('should work with subscriber stubs', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const stubSub = createSubscriberStub({
      name: 'remote-analytics',
      description: 'Remote analytics stub',
      targetQueue: 'analytics-worker',
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: [UserCreatedEvent, [sub1]],
    };

    const schema = installPlugins(baseSchema, [{ subscriber: stubSub }]);

    const entry = schema[UserCreatedEvent.key];
    const [, subs] = entry as [unknown, readonly unknown[]];
    expect(subs).toHaveLength(2);
    expect(subs[1]).toBe(stubSub);
  });

  it('should return empty schema for empty input', () => {
    const schema = installPlugins({}, [
      {
        subscriber: createSubscriber<MatadorEvent>({
          name: 'analytics',
          description: 'Analytics subscriber',
          callback: async () => {},
        }),
      },
    ]);

    expect(Object.keys(schema)).toHaveLength(0);
  });

  it('should not modify original schema', () => {
    const sub1 = createSubscriber<UserCreatedEvent>({
      name: 'user-handler',
      description: 'Handles user events',
      callback: async () => {},
    });
    const globalSub = createSubscriber<MatadorEvent>({
      name: 'analytics',
      description: 'Analytics subscriber',
      callback: async () => {},
    });

    const baseSchema: MatadorSchema = {
      [UserCreatedEvent.key]: [UserCreatedEvent, [sub1]],
    };

    installPlugins(baseSchema, [{ subscriber: globalSub }]);

    // Original schema should be unchanged
    const entry = baseSchema[UserCreatedEvent.key];
    const [, subs] = entry as [unknown, readonly unknown[]];
    expect(subs).toHaveLength(1);
  });
});
