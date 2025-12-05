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
import type { TransportFallbackContext } from '../../src/hooks/index.js';
import { FallbackTransport } from '../../src/transport/fallback/fallback-transport.js';
import type { Subscription } from '../../src/transport/index.js';
import { LocalTransport } from '../../src/transport/local/local-transport.js';
import { RabbitMQTransport } from '../../src/transport/rabbitmq/rabbitmq-transport.js';
import {
  createTestEnvelope,
  createTestTopology,
} from './transport-compliance.e2e.test.js';

// Skip tests if docker is not available
const SKIP_E2E = process.env.SKIP_E2E_TESTS === 'true';

describe.skipIf(SKIP_E2E)('FallbackTransport E2E', () => {
  let container: StartedRabbitMQContainer;
  let connectionUrl: string;

  beforeAll(async () => {
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

  describe('fallback to local transport when RabbitMQ fails', () => {
    let rabbitTransport: RabbitMQTransport;
    let localTransport: LocalTransport;
    let fallbackTransport: FallbackTransport;
    let subscriptions: Subscription[];
    let fallbackEvents: TransportFallbackContext[];

    beforeEach(async () => {
      subscriptions = [];
      fallbackEvents = [];

      rabbitTransport = RabbitMQTransport.create({
        url: connectionUrl,
        quorumQueues: false,
      });

      localTransport = new LocalTransport();

      fallbackTransport = new FallbackTransport({
        transports: [rabbitTransport, localTransport],
        onFallback: (ctx) => fallbackEvents.push(ctx),
      });

      await fallbackTransport.connect();
    });

    afterEach(async () => {
      for (const sub of subscriptions) {
        if (sub.isActive) {
          await sub.unsubscribe();
        }
      }
      if (fallbackTransport.isConnected()) {
        await fallbackTransport.disconnect();
      }
    });

    it('should send to RabbitMQ when healthy', async () => {
      const topology = createTestTopology(`healthy-${Date.now()}`);
      await fallbackTransport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const receivedMessages: string[] = [];

      const subscription = await fallbackTransport.subscribe(
        queueName,
        async (env, receipt) => {
          receivedMessages.push(env.id);
          await fallbackTransport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      const envelope = createTestEnvelope();
      await fallbackTransport.send(queueName, envelope);

      await waitFor(() => receivedMessages.length >= 1, 5000);

      expect(receivedMessages).toContain(envelope.id);
      expect(fallbackEvents).toHaveLength(0); // No fallback occurred
    });

    it('should fallback to memory transport when RabbitMQ send fails', async () => {
      const topology = createTestTopology(`fallback-${Date.now()}`);
      await fallbackTransport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const receivedMessages: string[] = [];

      // Subscribe BEFORE disconnecting RabbitMQ
      const subscription = await fallbackTransport.subscribe(
        queueName,
        async (env, receipt) => {
          receivedMessages.push(env.id);
          await fallbackTransport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      // Disconnect RabbitMQ to simulate failure
      await rabbitTransport.disconnect();

      // Send should fallback to memory transport
      const envelope = createTestEnvelope();
      await fallbackTransport.send(queueName, envelope);

      // Message should be processed by subscriber on memory transport
      await waitFor(() => receivedMessages.length >= 1, 5000);

      expect(receivedMessages).toContain(envelope.id);

      // Verify fallback was triggered
      expect(fallbackEvents).toHaveLength(1);
      expect(fallbackEvents[0]!.failedTransport).toBe('rabbitmq');
      expect(fallbackEvents[0]!.successTransport).toBe('local');
      expect(fallbackEvents[0]!.queue).toBe(queueName);
    });

    it('should process multiple messages via fallback', async () => {
      const topology = createTestTopology(`multi-${Date.now()}`);
      await fallbackTransport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const receivedMessages: string[] = [];

      const subscription = await fallbackTransport.subscribe(
        queueName,
        async (env, receipt) => {
          receivedMessages.push(env.id);
          await fallbackTransport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      // Disconnect RabbitMQ
      await rabbitTransport.disconnect();

      // Send multiple messages
      const envelopes = [
        createTestEnvelope({ id: 'msg-1' }),
        createTestEnvelope({ id: 'msg-2' }),
        createTestEnvelope({ id: 'msg-3' }),
      ];

      for (const env of envelopes) {
        await fallbackTransport.send(queueName, env);
      }

      await waitFor(() => receivedMessages.length >= 3, 5000);

      expect(receivedMessages).toContain('msg-1');
      expect(receivedMessages).toContain('msg-2');
      expect(receivedMessages).toContain('msg-3');
      expect(fallbackEvents).toHaveLength(3);
    });

    it('should handle mixed success/fallback sends', async () => {
      const topology = createTestTopology(`mixed-${Date.now()}`);
      await fallbackTransport.applyTopology(topology);
      const queueName = `${topology.namespace}.events`;

      const receivedMessages: string[] = [];

      const subscription = await fallbackTransport.subscribe(
        queueName,
        async (env, receipt) => {
          receivedMessages.push(env.id);
          await fallbackTransport.complete(receipt);
        },
      );
      subscriptions.push(subscription);

      // Send first message to RabbitMQ (should succeed)
      const env1 = createTestEnvelope({ id: 'rabbit-msg' });
      await fallbackTransport.send(queueName, env1);

      await waitFor(() => receivedMessages.includes('rabbit-msg'), 5000);

      // Disconnect RabbitMQ
      await rabbitTransport.disconnect();

      // Send second message (should fallback to memory)
      const env2 = createTestEnvelope({ id: 'memory-msg' });
      await fallbackTransport.send(queueName, env2);

      await waitFor(() => receivedMessages.includes('memory-msg'), 5000);

      expect(receivedMessages).toContain('rabbit-msg');
      expect(receivedMessages).toContain('memory-msg');
      expect(fallbackEvents).toHaveLength(1);
      expect(fallbackEvents[0]!.envelope.id).toBe('memory-msg');
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
