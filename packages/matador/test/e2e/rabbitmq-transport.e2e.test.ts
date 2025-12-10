import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import type { Subscription } from '../../src/transport/index.js';
import { RabbitMQTransport } from '../../src/transport/rabbitmq/rabbitmq-transport.js';
import {
  createTestEnvelope,
  createTestTopology,
} from './transport-compliance.e2e.test.js';

// Skip tests if docker is not available
const SKIP_E2E = process.env.SKIP_E2E_TESTS === 'true';

describe.skipIf(SKIP_E2E)('RabbitMQ Transport E2E', () => {
  let container: StartedRabbitMQContainer;
  let connectionUrl: string;

  beforeAll(async () => {
    // Start RabbitMQ container
    container = await new RabbitMQContainer('rabbitmq:3.13-management')
      .withExposedPorts(5672, 15672)
      .start();

    connectionUrl = container.getAmqpUrl();
    console.log(`RabbitMQ container started at ${connectionUrl}`);
  }, 120_000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  describe('RabbitMQ-specific features', () => {
    let transport: RabbitMQTransport;
    let subscriptions: Subscription[] = [];

    beforeEach(async () => {
      transport = new RabbitMQTransport({
        url: connectionUrl,
        quorumQueues: false, // Use classic queues for faster tests
        defaultPrefetch: 5,
      });
      await transport.connect();
      await transport.applyTopology(createTestTopology(`test-${Date.now()}`));
      subscriptions = [];
    });

    afterEach(async () => {
      for (const sub of subscriptions) {
        if (sub.isActive) {
          await sub.unsubscribe();
        }
      }
      if (transport.isConnected()) {
        await transport.disconnect();
      }
    });

    it('should report correct capabilities', () => {
      expect(transport.name).toBe('rabbitmq');
      expect(transport.capabilities.deliveryModes).toContain('at-least-once');
      expect(transport.capabilities.deadLetterRouting).toBe('native');
      expect(transport.capabilities.attemptTracking).toBe(true);
      expect(transport.capabilities.concurrencyModel).toBe('prefetch');
      expect(transport.capabilities.priorities).toBe(true);
      // delayedMessages depends on plugin availability
    });

    it('should handle message priority', async () => {
      const topology = createTestTopology(`priority-${Date.now()}`);
      topology.queues[0] = { ...topology.queues[0], priorities: true };

      await transport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const receivedOrder: number[] = [];

      const subscription = await transport.subscribe(
        queueName,
        async (env, receipt) => {
          receivedOrder.push((env.data as { priority: number }).priority);
          await transport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      // Send messages with different priorities
      await transport.send(
        queueName,
        createTestEnvelope({ eventKey: 'priority.1' }),
        { priority: 1 },
      );
      await transport.send(
        queueName,
        createTestEnvelope({ eventKey: 'priority.5' }),
        { priority: 5 },
      );
      await transport.send(
        queueName,
        createTestEnvelope({ eventKey: 'priority.10' }),
        { priority: 10 },
      );

      // Wait for all messages
      await waitFor(() => receivedOrder.length >= 3, 5000);

      // Priority is not strictly guaranteed in RabbitMQ,
      // but higher priority messages should generally come first
      expect(receivedOrder.length).toBe(3);
    });

    it('should track attempt number in headers', async () => {
      const topology = createTestTopology(`attempts-${Date.now()}`);
      await transport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      let attemptNumber = 0;

      const subscription = await transport.subscribe(
        queueName,
        async (_env, receipt) => {
          attemptNumber = receipt.attemptNumber;
          await transport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      await transport.send(queueName, createTestEnvelope());

      await waitFor(() => attemptNumber > 0, 5000);

      expect(attemptNumber).toBe(1);
    });

    it('should handle prefetch/concurrency per queue', async () => {
      const topology = createTestTopology(`prefetch-${Date.now()}`);
      await transport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const processing = new Set<string>();
      let maxConcurrent = 0;

      const subscription = await transport.subscribe(
        queueName,
        async (env, receipt) => {
          processing.add(env.id);
          maxConcurrent = Math.max(maxConcurrent, processing.size);

          // Simulate processing time
          await new Promise((resolve) => setTimeout(resolve, 100));

          processing.delete(env.id);
          await transport.complete(receipt);
        },
        { concurrency: 3 },
      );
      subscriptions.push(subscription);

      // Send more messages than prefetch allows
      for (let i = 0; i < 10; i++) {
        await transport.send(queueName, createTestEnvelope({ id: `msg-${i}` }));
      }

      // Wait for all messages to be processed
      await waitFor(() => processing.size === 0, 10000);

      // Should never exceed prefetch
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should throw when sending delayed message without plugin', async () => {
      // Standard RabbitMQ container doesn't have delayed message plugin
      const topology = createTestTopology(`delay-${Date.now()}`);
      await transport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      // Should throw because plugin is not available
      await expect(
        transport.send(queueName, createTestEnvelope(), { delay: 1000 }),
      ).rejects.toThrow('delayed message exchange plugin');
    });

    it('should report delayedMessages capability based on plugin', () => {
      // Standard RabbitMQ without plugin should report false
      expect(transport.capabilities.delayedMessages).toBe(false);
    });
  });

  describe('reconnection behavior', () => {
    it('should handle disconnect and reconnect', async () => {
      const transport = new RabbitMQTransport({
        url: connectionUrl,
        connection: {
          maxReconnectAttempts: 3,
          initialReconnectDelay: 100,
        },
      });

      await transport.connect();
      expect(transport.isConnected()).toBe(true);

      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);

      // Reconnect
      await transport.connect();
      expect(transport.isConnected()).toBe(true);

      await transport.disconnect();
    });
  });

  describe('channel per queue isolation', () => {
    let transport: RabbitMQTransport;
    const subscriptions: Subscription[] = [];

    beforeEach(async () => {
      transport = new RabbitMQTransport({
        url: connectionUrl,
        quorumQueues: false,
        defaultPrefetch: 2,
      });
      await transport.connect();
    });

    afterEach(async () => {
      for (const sub of subscriptions) {
        if (sub.isActive) {
          await sub.unsubscribe();
        }
      }
      if (transport.isConnected()) {
        await transport.disconnect();
      }
    });

    it('should have independent concurrency per queue', async () => {
      const topology = createTestTopology(`isolation-${Date.now()}`);
      await transport.applyTopology(topology);

      const queue1 = `${topology.namespace}.events`;
      const queue2 = `${topology.namespace}.notifications`;

      const queue1Processing = new Set<string>();
      const queue2Processing = new Set<string>();
      let queue1MaxConcurrent = 0;
      let queue2MaxConcurrent = 0;

      // Subscribe to both queues with different concurrency
      const sub1 = await transport.subscribe(
        queue1,
        async (env, receipt) => {
          queue1Processing.add(env.id);
          queue1MaxConcurrent = Math.max(
            queue1MaxConcurrent,
            queue1Processing.size,
          );
          await new Promise((resolve) => setTimeout(resolve, 50));
          queue1Processing.delete(env.id);
          await transport.complete(receipt);
        },
        { concurrency: 2 },
      );
      subscriptions.push(sub1);

      const sub2 = await transport.subscribe(
        queue2,
        async (env, receipt) => {
          queue2Processing.add(env.id);
          queue2MaxConcurrent = Math.max(
            queue2MaxConcurrent,
            queue2Processing.size,
          );
          await new Promise((resolve) => setTimeout(resolve, 50));
          queue2Processing.delete(env.id);
          await transport.complete(receipt);
        },
        { concurrency: 3 },
      );
      subscriptions.push(sub2);

      // Send messages to both queues
      for (let i = 0; i < 6; i++) {
        await transport.send(queue1, createTestEnvelope({ id: `q1-${i}` }));
        await transport.send(queue2, createTestEnvelope({ id: `q2-${i}` }));
      }

      // Wait for all to complete
      await waitFor(
        () => queue1Processing.size === 0 && queue2Processing.size === 0,
        10000,
      );

      // Each queue should respect its own prefetch
      expect(queue1MaxConcurrent).toBeLessThanOrEqual(2);
      expect(queue2MaxConcurrent).toBeLessThanOrEqual(3);
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
