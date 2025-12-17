import { beforeEach, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import type { DiscoveryService } from '@nestjs/core';
import {
  type AnySubscriber,
  type Envelope,
  type EventClass,
  MatadorEvent,
} from '@zdavison/matador';
import { OnMatadorEvent } from '../src/decorators/on-matador-event.decorator.js';
import { SubscriberDiscoveryService } from '../src/discovery/subscriber-discovery.service.js';

// Test events
class UserCreatedEvent extends MatadorEvent<{ userId: string }> {
  static readonly key = 'user.created';
  static readonly description = 'User created event';

  constructor(public readonly data: { userId: string }) {
    super();
  }
}

class OrderPlacedEvent extends MatadorEvent<{ orderId: string }> {
  static readonly key = 'order.placed';
  static readonly description = 'Order placed event';

  constructor(public readonly data: { orderId: string }) {
    super();
  }
}

describe('SubscriberDiscoveryService', () => {
  let discoveryService: SubscriberDiscoveryService;
  let mockNestDiscovery: { getProviders: () => Array<{ instance: unknown }> };

  beforeEach(() => {
    mockNestDiscovery = {
      getProviders: () => [],
    };
  });

  it('discovers decorated methods and builds schema', () => {
    // Create a service with decorated handlers
    class TestService {
      @OnMatadorEvent(UserCreatedEvent, {
        description: 'Handles user creation',
      })
      async onUserCreated(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }
    }

    const instance = new TestService();

    mockNestDiscovery.getProviders = () => [
      {
        instance,
      },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    // Trigger discovery (simulates onModuleInit)
    discoveryService.onModuleInit();

    const schema = discoveryService.getSchema();

    expect(schema[UserCreatedEvent.key]).toBeDefined();
    const [eventClass, subscribers] = schema[UserCreatedEvent.key] as [
      unknown,
      unknown[],
    ];
    expect(eventClass).toBe(UserCreatedEvent);
    expect(subscribers).toHaveLength(1);
    expect(subscribers[0]).toHaveProperty('name', 'TestService.onUserCreated');
    expect(subscribers[0]).toHaveProperty(
      'description',
      'Handles user creation',
    );
  });

  it('uses custom name when provided', () => {
    class TestService {
      @OnMatadorEvent(UserCreatedEvent, {
        name: 'custom-handler-name',
        description: 'Handles user creation',
      })
      async onUserCreated(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }
    }

    const instance = new TestService();

    mockNestDiscovery.getProviders = () => [
      {
        instance,
      },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    discoveryService.onModuleInit();

    const schema = discoveryService.getSchema();
    const [, subscribers] = schema[UserCreatedEvent.key] as [
      unknown,
      unknown[],
    ];
    expect(subscribers[0]).toHaveProperty('name', 'custom-handler-name');
  });

  it('discovers multiple handlers for the same event', () => {
    class ServiceA {
      @OnMatadorEvent(UserCreatedEvent, {
        description: 'Handler A',
      })
      async handle(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }
    }

    class ServiceB {
      @OnMatadorEvent(UserCreatedEvent, {
        description: 'Handler B',
      })
      async handle(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }
    }

    const instanceA = new ServiceA();
    const instanceB = new ServiceB();

    mockNestDiscovery.getProviders = () => [
      { instance: instanceA },
      { instance: instanceB },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    discoveryService.onModuleInit();

    const schema = discoveryService.getSchema();
    const [, subscribers] = schema[UserCreatedEvent.key] as [
      unknown,
      unknown[],
    ];
    expect(subscribers).toHaveLength(2);
  });

  it('discovers handlers for different events', () => {
    class TestService {
      @OnMatadorEvent(UserCreatedEvent, {
        description: 'User handler',
      })
      async onUserCreated(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }

      @OnMatadorEvent(OrderPlacedEvent, {
        description: 'Order handler',
      })
      async onOrderPlaced(_envelope: Envelope<OrderPlacedEvent['data']>) {
        // handler
      }
    }

    const instance = new TestService();

    mockNestDiscovery.getProviders = () => [
      {
        instance,
      },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    discoveryService.onModuleInit();

    const schema = discoveryService.getSchema();

    expect(schema[UserCreatedEvent.key]).toBeDefined();
    expect(schema[OrderPlacedEvent.key]).toBeDefined();
  });

  it('skips providers without decorated methods', () => {
    class PlainService {
      someMethod() {
        return 'plain';
      }
    }

    const instance = new PlainService();

    mockNestDiscovery.getProviders = () => [
      {
        instance,
      },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    discoveryService.onModuleInit();

    const schema = discoveryService.getSchema();
    expect(Object.keys(schema)).toHaveLength(0);
  });

  it('merges additional events from options', () => {
    class TestService {
      @OnMatadorEvent(UserCreatedEvent, {
        description: 'Discovered handler',
      })
      async handle(_envelope: Envelope<UserCreatedEvent['data']>) {
        // handler
      }
    }

    const instance = new TestService();

    mockNestDiscovery.getProviders = () => [
      {
        instance,
      },
    ];

    discoveryService = new SubscriberDiscoveryService(
      mockNestDiscovery as unknown as DiscoveryService,
    );

    discoveryService.onModuleInit();

    // Additional event with subscriber
    const additionalSubscriber = {
      name: 'additional-subscriber',
      description: 'Additional handler',
      callback: async () => {},
      importance: 'should-investigate' as const,
      idempotent: 'unknown' as const,
    };

    const additionalEvents = new Map<EventClass<unknown>, AnySubscriber[]>();
    additionalEvents.set(OrderPlacedEvent as EventClass<unknown>, [
      additionalSubscriber,
    ]);

    const mergedSchema = discoveryService.getMergedSchema({
      transport: {} as never,
      topology: {} as never,
      additionalEvents,
    });

    expect(mergedSchema[UserCreatedEvent.key]).toBeDefined();
    expect(mergedSchema[OrderPlacedEvent.key]).toBeDefined();

    const [, orderSubscribers] = mergedSchema[OrderPlacedEvent.key] as [
      unknown,
      unknown[],
    ];
    expect(orderSubscribers).toHaveLength(1);
    expect(orderSubscribers[0]).toHaveProperty('name', 'additional-subscriber');
  });
});
