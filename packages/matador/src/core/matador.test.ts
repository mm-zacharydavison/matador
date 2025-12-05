import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createTopology } from '../topology/builder.js';
import { LocalTransport } from '../transport/local/local-transport.js';
import { BaseEvent, createSubscriber } from '../types/index.js';
import { Matador, createMatador } from './matador.js';

class UserCreatedEvent extends BaseEvent<{ userId: string; email: string }> {
  static readonly key = 'user.created';
  static readonly description = 'Fired when a new user is created';
}

class OrderPlacedEvent extends BaseEvent<{ orderId: string; amount: number }> {
  static readonly key = 'order.placed';
  static readonly description = 'Fired when an order is placed';
}

describe('Matador', () => {
  let transport: LocalTransport;
  let matador: Matador;

  beforeEach(() => {
    transport = new LocalTransport();
  });

  afterEach(async () => {
    if (matador) {
      await matador.shutdown();
    }
  });

  describe('configuration', () => {
    it('should create with minimal config', () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      matador = createMatador({ transport, topology });

      expect(matador).toBeInstanceOf(Matador);
      expect(matador.isConnected()).toBe(false);
    });
  });

  describe('registration', () => {
    it('should register events with subscribers', () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'send-welcome-email',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      expect(matador).toBeInstanceOf(Matador);
    });

    it('should support chained registration', () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const userSub = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );
      const orderSub = createSubscriber(
        'handle-order',
        OrderPlacedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology })
        .register(UserCreatedEvent, [userSub])
        .register(OrderPlacedEvent, [orderSub]);

      expect(matador).toBeInstanceOf(Matador);
    });
  });

  describe('start', () => {
    it('should connect transport and be ready', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      expect(matador.isConnected()).toBe(true);
    });

    it('should throw if started twice', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      // start() is idempotent - calling it again should not throw
      await expect(matador.start()).resolves.toBeUndefined();
    });

    it('should throw on invalid schema', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      // Register duplicate subscriber names
      const sub1 = createSubscriber(
        'same-name',
        UserCreatedEvent,
        async () => {},
      );
      const sub2 = createSubscriber(
        'same-name',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [sub1, sub2],
      );

      expect(matador.start()).rejects.toThrow('Schema validation failed');
    });
  });

  describe('dispatch', () => {
    it('should throw if not started', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      const event = new UserCreatedEvent({
        userId: '123',
        email: 'test@example.com',
      });

      await expect(matador.dispatch(event)).rejects.toThrow(
        'Matador has not been started',
      );
    });

    it('should dispatch events to transport', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      const event = new UserCreatedEvent({
        userId: '123',
        email: 'test@example.com',
      });

      const result = await matador.dispatch(event);

      expect(result.subscribersDispatched).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should create one envelope per subscriber', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const sub1 = createSubscriber('sub-1', UserCreatedEvent, async () => {});
      const sub2 = createSubscriber('sub-2', UserCreatedEvent, async () => {});
      const sub3 = createSubscriber('sub-3', UserCreatedEvent, async () => {});

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [sub1, sub2, sub3],
      );

      await matador.start();

      const event = new UserCreatedEvent({
        userId: '123',
        email: 'test@example.com',
      });

      const result = await matador.dispatch(event);

      expect(result.subscribersDispatched).toBe(3);
    });

    it('should include correlation ID in dispatch', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      const event = new UserCreatedEvent({
        userId: '123',
        email: 'test@example.com',
      });

      const result = await matador.dispatch(event, {
        correlationId: 'request-456',
      });

      expect(result.subscribersDispatched).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should gracefully shutdown', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();
      await matador.shutdown();

      expect(matador.isConnected()).toBe(false);
    });

    it('should be idempotent', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();
      await matador.shutdown();
      await matador.shutdown(); // Should not throw

      expect(matador.isConnected()).toBe(false);
    });

    it('should reject dispatch after shutdown initiated', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      // Initiate shutdown but don't await
      const shutdownPromise = matador.shutdown();

      const event = new UserCreatedEvent({
        userId: '123',
        email: 'test@example.com',
      });

      // Dispatch should fail during/after shutdown
      await shutdownPromise;

      expect(matador.dispatch(event)).rejects.toThrow();
    });
  });

  describe('idle state', () => {
    it('should report idle when no processing', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      expect(matador.isIdle()).toBe(true);
    });

    it('should return handlers state', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      const state = matador.getHandlersState();

      expect(state.isIdle).toBe(true);
      expect(state.eventsBeingProcessed).toBe(0);
      expect(state.eventsBeingEnqueued).toBe(0);
    });

    it('should wait for idle', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({ transport, topology }).register(
        UserCreatedEvent,
        [subscriber],
      );

      await matador.start();

      const isIdle = await matador.waitForIdle(1000);
      expect(isIdle).toBe(true);
    });
  });

  describe('consuming from queues', () => {
    it('should subscribe to specified queues', async () => {
      const topology = createTopology()
        .withNamespace('test')
        .addQueue('events')
        .addQueue('notifications')
        .build();

      const subscriber = createSubscriber(
        'handle-user',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      expect(matador.isConnected()).toBe(true);
    });
  });
});
