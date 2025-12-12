import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  DoRetry,
  DontRetry,
  LocalTransport,
  Matador,
  MatadorEvent,
  type MatadorSchema,
  TopologyBuilder,
  createSubscriber,
} from '../../src/index.js';

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

  constructor(
    public data: {
      orderId: string;
      amount: number;
      userId: string;
    },
  ) {
    super();
  }
}

class PaymentProcessedEvent extends MatadorEvent {
  static readonly key = 'payment.processed';
  static readonly description = 'Fired when a payment is processed';

  constructor(
    public data: {
      paymentId: string;
      orderId: string;
      status: 'success' | 'failed';
    },
  ) {
    super();
  }
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

      const topology = TopologyBuilder.create()
        .withNamespace('int-test')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'process-user',
        description: 'Processes user events',
        callback: async ({ data }) => {
          processedUsers.push(data.userId);
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      const event = new UserCreatedEvent({
        userId: 'user-123',
        email: 'test@example.com',
      });

      const result = await matador.send(event);

      // Wait for processing
      await matador.waitForIdle(5000);

      expect(result.subscribersSent).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(processedUsers).toContain('user-123');
    });

    it('should fan out to multiple subscribers', async () => {
      const notifications: string[] = [];
      const analytics: string[] = [];
      const emails: string[] = [];

      const topology = TopologyBuilder.create()
        .withNamespace('int-fanout')
        .addQueue('events')
        .build();

      const notifySub = createSubscriber({
        name: 'send-notification',
        description: 'Sends notifications',
        callback: async ({ data }) => {
          notifications.push(data.userId);
        },
      });

      const analyticsSub = createSubscriber({
        name: 'track-analytics',
        description: 'Tracks analytics',
        callback: async ({ data }) => {
          analytics.push(data.userId);
        },
      });

      const emailSub = createSubscriber({
        name: 'send-welcome-email',
        description: 'Sends welcome email',
        callback: async ({ data }) => {
          emails.push(data.email);
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [
          UserCreatedEvent,
          [notifySub, analyticsSub, emailSub],
        ],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      const event = new UserCreatedEvent({
        userId: 'user-456',
        email: 'fan@out.com',
      });

      const result = await matador.send(event);
      await matador.waitForIdle(5000);

      expect(result.subscribersSent).toBe(3);
      expect(notifications).toContain('user-456');
      expect(analytics).toContain('user-456');
      expect(emails).toContain('fan@out.com');
    });

    it('should handle multiple event types', async () => {
      const users: string[] = [];
      const orders: string[] = [];

      const topology = TopologyBuilder.create()
        .withNamespace('int-multi-event')
        .addQueue('events')
        .build();

      const userSub = createSubscriber({
        name: 'process-user',
        description: 'Processes user events',
        callback: async ({ data }) => {
          users.push(data.userId);
        },
      });

      const orderSub = createSubscriber({
        name: 'process-order',
        description: 'Processes order events',
        callback: async ({ data }) => {
          orders.push(data.orderId);
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [userSub]],
        [OrderPlacedEvent.key]: [OrderPlacedEvent, [orderSub]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      await matador.send(
        new UserCreatedEvent({ userId: 'u1', email: 'u1@test.com' }),
      );
      await matador.send(
        new OrderPlacedEvent({ orderId: 'o1', amount: 100, userId: 'u1' }),
      );
      await matador.send(
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

      const topology = TopologyBuilder.create()
        .withNamespace('int-retry')
        .addQueue('events')
        .withRetry({ enabled: true, defaultDelayMs: 10, maxDelayMs: 100 })
        .build();

      const subscriber = createSubscriber({
        name: 'flaky-subscriber',
        description: 'Flaky subscriber for retry testing',
        callback: async () => {
          attempts++;
          if (attempts < maxAttempts) {
            throw new DoRetry('Temporary failure');
          }
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      await matador.send(
        new UserCreatedEvent({ userId: 'retry-user', email: 'retry@test.com' }),
      );

      // Wait for retries
      await waitFor(() => attempts >= maxAttempts, 5000);

      expect(attempts).toBe(maxAttempts);
    });

    it('should not retry when DontRetry is thrown', async () => {
      let attempts = 0;

      const topology = TopologyBuilder.create()
        .withNamespace('int-dont-retry')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'permanent-fail-subscriber',
        description: 'Permanent failure subscriber',
        callback: async () => {
          attempts++;
          throw new DontRetry('Permanent failure');
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      await matador.send(
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

      const topology = TopologyBuilder.create()
        .withNamespace('int-correlation')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'track-correlation',
        description: 'Tracks correlation IDs',
        callback: async ({ docket }) => {
          if (docket.correlationId) {
            correlationIds.push(docket.correlationId);
          }
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      await matador.send(
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

      const topology = TopologyBuilder.create()
        .withNamespace('int-metadata')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'capture-metadata',
        description: 'Captures metadata',
        callback: async ({ docket }) => {
          if (docket.metadata) {
            receivedMetadata.push(docket.metadata);
          }
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      await matador.send(
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

      const topology = TopologyBuilder.create()
        .withNamespace('int-shutdown')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'slow-subscriber',
        description: 'Slow subscriber for shutdown testing',
        callback: async ({ data }) => {
          processingStarted = true;
          // Simulate slow processing
          await new Promise((resolve) => setTimeout(resolve, 500));
          processed.push(data.userId);
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
        shutdownConfig: {
          gracefulTimeoutMs: 5000,
          pollIntervalMs: 50,
        },
      });

      await matador.start();

      // Dispatch event
      await matador.send(
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
      const topology = TopologyBuilder.create()
        .withNamespace('int-shutdown-reject')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'test-subscriber',
        description: 'Test subscriber',
        callback: async () => {},
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      // Start shutdown
      const shutdownPromise = matador.shutdown();

      // Try to dispatch after shutdown started
      await shutdownPromise;

      await expect(
        matador.send(
          new UserCreatedEvent({ userId: 'late', email: 'late@test.com' }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('subscriber filtering', () => {
    it('should filter subscribers based on enabled hook', async () => {
      const processed: string[] = [];

      const topology = TopologyBuilder.create()
        .withNamespace('int-filter')
        .addQueue('events')
        .build();

      const enabledSub = createSubscriber({
        name: 'enabled-subscriber',
        description: 'Enabled subscriber',
        callback: async ({ data }) => {
          processed.push(`enabled:${data.userId}`);
        },
        enabled: () => true,
      });

      const disabledSub = createSubscriber({
        name: 'disabled-subscriber',
        description: 'Disabled subscriber',
        callback: async ({ data }) => {
          processed.push(`disabled:${data.userId}`);
        },
        enabled: () => false,
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [enabledSub, disabledSub]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      const result = await matador.send(
        new UserCreatedEvent({
          userId: 'filter-user',
          email: 'filter@test.com',
        }),
      );

      await matador.waitForIdle(2000);

      // Only enabled subscriber should be dispatched
      expect(result.subscribersSent).toBe(1);
      expect(processed).toContain('enabled:filter-user');
      expect(processed).not.toContain('disabled:filter-user');
    });
  });

  describe('handlers state', () => {
    it('should track handlers state during processing', async () => {
      let wasNotIdle = false;

      const topology = TopologyBuilder.create()
        .withNamespace('int-state')
        .addQueue('events')
        .build();

      const subscriber = createSubscriber({
        name: 'state-subscriber',
        description: 'State tracking subscriber',
        callback: async () => {
          // Check state while processing
          const state = matador.getHandlersState();
          if (state.eventsBeingProcessed > 0) {
            wasNotIdle = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      });

      const schema: MatadorSchema = {
        [UserCreatedEvent.key]: [UserCreatedEvent, [subscriber]],
      };

      matador = new Matador({
        transport,
        topology,
        schema,
        consumeFrom: ['events'],
      });

      await matador.start();

      expect(matador.isIdle()).toBe(true);

      await matador.send(
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
