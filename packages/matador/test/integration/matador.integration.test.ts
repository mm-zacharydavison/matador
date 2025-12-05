import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  BaseEvent,
  DoRetry,
  DontRetry,
  type Matador,
  LocalTransport,
  createMatador,
  createSubscriber,
  createTopology,
} from '../../src/index.js';

class UserCreatedEvent extends BaseEvent<{ userId: string; email: string }> {
  static readonly key = 'user.created';
  static readonly description = 'Fired when a new user is created';
}

class OrderPlacedEvent extends BaseEvent<{
  orderId: string;
  amount: number;
  userId: string;
}> {
  static readonly key = 'order.placed';
  static readonly description = 'Fired when an order is placed';
}

class PaymentProcessedEvent extends BaseEvent<{
  paymentId: string;
  orderId: string;
  status: 'success' | 'failed';
}> {
  static readonly key = 'payment.processed';
  static readonly description = 'Fired when a payment is processed';
}

describe('Matador Integration Tests', () => {
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

  describe('full message flow', () => {
    it('should dispatch event and process successfully', async () => {
      const processedUsers: string[] = [];

      const topology = createTopology()
        .withNamespace('int-test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'process-user',
        UserCreatedEvent,
        async (data) => {
          processedUsers.push(data.userId);
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      const event = new UserCreatedEvent({
        userId: 'user-123',
        email: 'test@example.com',
      });

      const result = await matador.dispatch(event);

      // Wait for processing
      await matador.waitForIdle(5000);

      expect(result.subscribersDispatched).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(processedUsers).toContain('user-123');
    });

    it('should fan out to multiple subscribers', async () => {
      const notifications: string[] = [];
      const analytics: string[] = [];
      const emails: string[] = [];

      const topology = createTopology()
        .withNamespace('int-fanout')
        .addQueue('events')
        .build();

      const notifySub = createSubscriber(
        'send-notification',
        UserCreatedEvent,
        async (data) => {
          notifications.push(data.userId);
        },
      );

      const analyticsSub = createSubscriber(
        'track-analytics',
        UserCreatedEvent,
        async (data) => {
          analytics.push(data.userId);
        },
      );

      const emailSub = createSubscriber(
        'send-welcome-email',
        UserCreatedEvent,
        async (data) => {
          emails.push(data.email);
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [notifySub, analyticsSub, emailSub]);

      await matador.start();

      const event = new UserCreatedEvent({
        userId: 'user-456',
        email: 'fan@out.com',
      });

      const result = await matador.dispatch(event);
      await matador.waitForIdle(5000);

      expect(result.subscribersDispatched).toBe(3);
      expect(notifications).toContain('user-456');
      expect(analytics).toContain('user-456');
      expect(emails).toContain('fan@out.com');
    });

    it('should handle multiple event types', async () => {
      const users: string[] = [];
      const orders: string[] = [];

      const topology = createTopology()
        .withNamespace('int-multi-event')
        .addQueue('events')
        .build();

      const userSub = createSubscriber(
        'process-user',
        UserCreatedEvent,
        async (data) => {
          users.push(data.userId);
        },
      );

      const orderSub = createSubscriber(
        'process-order',
        OrderPlacedEvent,
        async (data) => {
          orders.push(data.orderId);
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      })
        .register(UserCreatedEvent, [userSub])
        .register(OrderPlacedEvent, [orderSub]);

      await matador.start();

      await matador.dispatch(
        new UserCreatedEvent({ userId: 'u1', email: 'u1@test.com' }),
      );
      await matador.dispatch(
        new OrderPlacedEvent({ orderId: 'o1', amount: 100, userId: 'u1' }),
      );
      await matador.dispatch(
        new UserCreatedEvent({ userId: 'u2', email: 'u2@test.com' }),
      );

      await matador.waitForIdle(5000);

      expect(users).toEqual(['u1', 'u2']);
      expect(orders).toEqual(['o1']);
    });
  });

  describe('retry behavior', () => {
    it('should retry failed subscribers', async () => {
      let attempts = 0;
      const maxAttempts = 3;

      const topology = createTopology()
        .withNamespace('int-retry')
        .addQueue('events')
        .withRetry({ enabled: true, defaultDelayMs: 10, maxDelayMs: 100 })
        .build();

      const subscriber = createSubscriber(
        'flaky-subscriber',
        UserCreatedEvent,
        async () => {
          attempts++;
          if (attempts < maxAttempts) {
            throw new DoRetry('Temporary failure');
          }
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
        retry: {
          maxAttempts: 5,
          baseDelayMs: 10,
          maxDelayMs: 100,
        },
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      await matador.dispatch(
        new UserCreatedEvent({ userId: 'retry-user', email: 'retry@test.com' }),
      );

      // Wait for retries
      await waitFor(() => attempts >= maxAttempts, 5000);

      expect(attempts).toBe(maxAttempts);
    });

    it('should not retry when DontRetry is thrown', async () => {
      let attempts = 0;

      const topology = createTopology()
        .withNamespace('int-dont-retry')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'permanent-fail-subscriber',
        UserCreatedEvent,
        async () => {
          attempts++;
          throw new DontRetry('Permanent failure');
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      await matador.dispatch(
        new UserCreatedEvent({
          userId: 'no-retry-user',
          email: 'noretry@test.com',
        }),
      );

      await matador.waitForIdle(2000);

      // Should only try once
      expect(attempts).toBe(1);
    });
  });

  describe('correlation ID propagation', () => {
    it('should propagate correlation ID through event chain', async () => {
      const correlationIds: string[] = [];

      const topology = createTopology()
        .withNamespace('int-correlation')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'track-correlation',
        UserCreatedEvent,
        async (_data, docket) => {
          if (docket.correlationId) {
            correlationIds.push(docket.correlationId);
          }
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      await matador.dispatch(
        new UserCreatedEvent({ userId: 'corr-user', email: 'corr@test.com' }),
        { correlationId: 'request-abc-123' },
      );

      await matador.waitForIdle(2000);

      expect(correlationIds).toContain('request-abc-123');
    });
  });

  describe('metadata handling', () => {
    it('should include metadata in docket', async () => {
      const receivedMetadata: Record<string, unknown>[] = [];

      const topology = createTopology()
        .withNamespace('int-metadata')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'capture-metadata',
        UserCreatedEvent,
        async (_data, docket) => {
          if (docket.metadata) {
            receivedMetadata.push(docket.metadata);
          }
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      await matador.dispatch(
        new UserCreatedEvent({
          userId: 'meta-user',
          email: 'meta@test.com',
        }),
        {
          metadata: {
            source: 'api',
            requestId: 'req-123',
            userAgent: 'test-client',
          },
        },
      );

      await matador.waitForIdle(2000);

      expect(receivedMetadata.length).toBe(1);
      expect(receivedMetadata[0]).toMatchObject({
        source: 'api',
        requestId: 'req-123',
      });
    });
  });

  describe('graceful shutdown', () => {
    it('should complete in-flight processing during shutdown', async () => {
      const processed: string[] = [];
      let processingStarted = false;

      const topology = createTopology()
        .withNamespace('int-shutdown')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'slow-subscriber',
        UserCreatedEvent,
        async (data) => {
          processingStarted = true;
          // Simulate slow processing
          await new Promise((resolve) => setTimeout(resolve, 500));
          processed.push(data.userId);
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
        shutdown: {
          gracefulTimeoutMs: 5000,
          pollIntervalMs: 50,
        },
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      // Dispatch event
      await matador.dispatch(
        new UserCreatedEvent({
          userId: 'shutdown-user',
          email: 'shutdown@test.com',
        }),
      );

      // Wait for processing to start
      await waitFor(() => processingStarted, 1000);

      // Initiate shutdown while processing
      await matador.shutdown();

      // Processing should have completed
      expect(processed).toContain('shutdown-user');
    });

    it('should reject new dispatches during shutdown', async () => {
      const topology = createTopology()
        .withNamespace('int-shutdown-reject')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'test-subscriber',
        UserCreatedEvent,
        async () => {},
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      // Start shutdown
      const shutdownPromise = matador.shutdown();

      // Try to dispatch after shutdown started
      await shutdownPromise;

      await expect(
        matador.dispatch(
          new UserCreatedEvent({ userId: 'late', email: 'late@test.com' }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('subscriber filtering', () => {
    it('should filter subscribers based on enabled hook', async () => {
      const processed: string[] = [];

      const topology = createTopology()
        .withNamespace('int-filter')
        .addQueue('events')
        .build();

      const enabledSub = createSubscriber(
        'enabled-subscriber',
        UserCreatedEvent,
        async (data) => {
          processed.push(`enabled:${data.userId}`);
        },
        { enabled: () => true },
      );

      const disabledSub = createSubscriber(
        'disabled-subscriber',
        UserCreatedEvent,
        async (data) => {
          processed.push(`disabled:${data.userId}`);
        },
        { enabled: () => false },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [enabledSub, disabledSub]);

      await matador.start();

      const result = await matador.dispatch(
        new UserCreatedEvent({
          userId: 'filter-user',
          email: 'filter@test.com',
        }),
      );

      await matador.waitForIdle(2000);

      // Only enabled subscriber should be dispatched
      expect(result.subscribersDispatched).toBe(1);
      expect(processed).toContain('enabled:filter-user');
      expect(processed).not.toContain('disabled:filter-user');
    });
  });

  describe('handlers state', () => {
    it('should track handlers state during processing', async () => {
      let wasNotIdle = false;

      const topology = createTopology()
        .withNamespace('int-state')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber(
        'state-subscriber',
        UserCreatedEvent,
        async () => {
          // Check state while processing
          const state = matador.getHandlersState();
          if (state.eventsBeingProcessed > 0) {
            wasNotIdle = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      );

      matador = createMatador({
        transport,
        topology,
        consumeFrom: ['events'],
      }).register(UserCreatedEvent, [subscriber]);

      await matador.start();

      expect(matador.isIdle()).toBe(true);

      await matador.dispatch(
        new UserCreatedEvent({ userId: 'state-user', email: 'state@test.com' }),
      );

      await matador.waitForIdle(5000);

      expect(wasNotIdle).toBe(true);
      expect(matador.isIdle()).toBe(true);
    });
  });
});

/**
 * Waits for a condition to be true, with timeout.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
