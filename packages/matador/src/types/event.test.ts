import { describe, expect, it } from 'bun:test';
import { createEnvelope } from './envelope.js';
import { MatadorEvent } from './event.js';

class UserCreatedEvent extends MatadorEvent {
  static readonly key = 'user.created';
  static readonly description = 'Fired when a new user is created';

  constructor(public data: { userId: string; email: string }) {
    super();
  }
}

class OrderPlacedEvent extends MatadorEvent {
  static readonly key = 'order.placed';
  static readonly description = 'Fired when an order is placed';
  static readonly aliases = ['order.created'];

  constructor(public data: { orderId: string; amount: number }) {
    super();
  }
}

class MinimalEvent extends MatadorEvent {
  static readonly key = 'minimal.event';

  constructor(public data: { id: string }) {
    super();
  }
}

describe('Event', () => {
  describe('static fields', () => {
    it('should have static key field on class', () => {
      expect(UserCreatedEvent.key).toBe('user.created');
      expect(OrderPlacedEvent.key).toBe('order.placed');
      expect(MinimalEvent.key).toBe('minimal.event');
    });

    it('should have static description field on class when defined', () => {
      expect(UserCreatedEvent.description).toBe(
        'Fired when a new user is created',
      );
      expect(OrderPlacedEvent.description).toBe(
        'Fired when an order is placed',
      );
      expect(MinimalEvent.description).toBeUndefined();
    });

    it('should have static aliases field on class when defined', () => {
      expect(UserCreatedEvent.aliases).toBeUndefined();
      expect(OrderPlacedEvent.aliases).toEqual(['order.created']);
      expect(MinimalEvent.aliases).toBeUndefined();
    });
  });

  describe('instance data', () => {
    it('should have instance data field', () => {
      const event = new UserCreatedEvent({
        userId: 'usr_001',
        email: 'test@example.com',
      });

      expect(event.data).toEqual({
        userId: 'usr_001',
        email: 'test@example.com',
      });
    });
  });
});

describe('Envelope with eventDescription', () => {
  it('should include eventDescription in docket when provided', () => {
    const event = new UserCreatedEvent({
      userId: 'usr_123',
      email: 'test@example.com',
    });

    const envelope = createEnvelope({
      eventKey: UserCreatedEvent.key,
      eventDescription: UserCreatedEvent.description,
      targetSubscriber: 'test-subscriber',
      data: event.data,
      importance: 'should-investigate',
    });

    expect(envelope.docket.eventKey).toBe('user.created');
    expect(envelope.docket.eventDescription).toBe(
      'Fired when a new user is created',
    );
  });

  it('should not include eventDescription in docket when undefined', () => {
    const event = new MinimalEvent({ id: 'min_123' });

    const envelope = createEnvelope({
      eventKey: MinimalEvent.key,
      eventDescription: MinimalEvent.description,
      targetSubscriber: 'test-subscriber',
      data: event.data,
      importance: 'should-investigate',
    });

    expect(envelope.docket.eventKey).toBe('minimal.event');
    expect(envelope.docket.eventDescription).toBeUndefined();
  });

  it('should serialize envelope with eventDescription for logging', () => {
    const event = new OrderPlacedEvent({
      orderId: 'ord_456',
      amount: 99.99,
    });

    const envelope = createEnvelope({
      eventKey: OrderPlacedEvent.key,
      eventDescription: OrderPlacedEvent.description,
      targetSubscriber: 'order-processor',
      data: event.data,
      importance: 'must-investigate',
    });

    const serialized = JSON.stringify(envelope);
    const parsed = JSON.parse(serialized);

    expect(parsed.docket.eventKey).toBe('order.placed');
    expect(parsed.docket.eventDescription).toBe(
      'Fired when an order is placed',
    );
    expect(parsed.data.orderId).toBe('ord_456');
  });

  it('should include eventDescription in hook logging context', () => {
    const event = new UserCreatedEvent({
      userId: 'usr_error',
      email: 'error@example.com',
    });

    const envelope = createEnvelope({
      eventKey: UserCreatedEvent.key,
      eventDescription: UserCreatedEvent.description,
      targetSubscriber: 'user-handler',
      data: event.data,
      importance: 'should-investigate',
    });

    // Simulating what would be logged in onEnqueueError hook
    const errorLog = {
      message: 'Failed to enqueue event',
      eventKey: envelope.docket.eventKey,
      eventDescription: envelope.docket.eventDescription,
      data: envelope.data,
    };

    expect(errorLog.eventKey).toBe('user.created');
    expect(errorLog.eventDescription).toBe('Fired when a new user is created');
  });
});
