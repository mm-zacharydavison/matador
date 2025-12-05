import { describe, expect, it } from 'bun:test';
import type { Importance } from '../types/common.js';
import { RabbitMQCodec } from './rabbitmq-codec.js';

/**
 * V1 message body format for test fixtures.
 */
interface V1MessageBody {
  key: string;
  data: unknown;
  metadata?: unknown;
  universal?: {
    event_id?: string | null;
    user_id?: string | null;
    correlation_id?: string | null;
    [key: string]: unknown;
  };
  before?: unknown;
  options?: { delayMs?: number };
  targetSubscriber: string;
}

/**
 * A v1 message fixture with optional headers.
 */
interface V1MessageFixture {
  name: string;
  body: V1MessageBody;
  headers?: Record<string, unknown>;
  expected: {
    id?: string;
    eventKey: string;
    targetSubscriber: string;
    data: unknown;
    metadata?: Record<string, unknown>;
    correlationId?: string;
    attempts?: number;
    importance?: Importance;
  };
}

/**
 * Add your v1 message examples here.
 * Each fixture describes:
 * - name: A descriptive name for the test case
 * - body: The v1 message body (what goes in the RabbitMQ message content)
 * - headers: Optional RabbitMQ headers that accompany the message
 * - expected: The expected v2 envelope fields after translation
 */
const V1_MESSAGE_FIXTURES: V1MessageFixture[] = [
  // === BASIC EXAMPLES ===
  {
    name: 'minimal v1 message with only required fields',
    body: {
      key: 'user.created',
      data: { userId: '123' },
      targetSubscriber: 'email-service',
    },
    expected: {
      eventKey: 'user.created',
      targetSubscriber: 'email-service',
      data: { userId: '123' },
      attempts: 1,
      importance: 'should-investigate',
    },
  },

  {
    name: 'v1 message with metadata',
    body: {
      key: 'order.placed',
      data: { orderId: 'ORD-456', amount: 99.99 },
      metadata: { source: 'web', region: 'us-east' },
      targetSubscriber: 'fulfillment-service',
    },
    expected: {
      eventKey: 'order.placed',
      targetSubscriber: 'fulfillment-service',
      data: { orderId: 'ORD-456', amount: 99.99 },
      metadata: { source: 'web', region: 'us-east' },
    },
  },

  // === UNIVERSAL METADATA EXAMPLES ===
  {
    name: 'v1 message with universal.event_id',
    body: {
      key: 'payment.processed',
      data: { paymentId: 'PAY-789' },
      universal: {
        event_id: 'evt-abc-123',
      },
      targetSubscriber: 'notification-service',
    },
    expected: {
      id: 'evt-abc-123',
      eventKey: 'payment.processed',
      targetSubscriber: 'notification-service',
      data: { paymentId: 'PAY-789' },
    },
  },

  {
    name: 'v1 message with universal.user_id (merged into metadata)',
    body: {
      key: 'profile.updated',
      data: { field: 'email' },
      universal: {
        user_id: 'user-456',
      },
      targetSubscriber: 'audit-service',
    },
    expected: {
      eventKey: 'profile.updated',
      targetSubscriber: 'audit-service',
      data: { field: 'email' },
      metadata: { user_id: 'user-456' },
    },
  },

  {
    name: 'v1 message with universal.correlation_id',
    body: {
      key: 'request.received',
      data: { requestId: 'req-001' },
      universal: {
        correlation_id: 'corr-xyz-789',
      },
      targetSubscriber: 'logger-service',
    },
    expected: {
      eventKey: 'request.received',
      targetSubscriber: 'logger-service',
      data: { requestId: 'req-001' },
      correlationId: 'corr-xyz-789',
    },
  },

  {
    name: 'v1 message with all universal fields',
    body: {
      key: 'checkout.completed',
      data: { cartId: 'cart-999' },
      universal: {
        event_id: 'evt-full-123',
        user_id: 'user-777',
        correlation_id: 'corr-full-456',
        custom_field: 'custom_value',
      },
      targetSubscriber: 'analytics-service',
    },
    expected: {
      id: 'evt-full-123',
      eventKey: 'checkout.completed',
      targetSubscriber: 'analytics-service',
      data: { cartId: 'cart-999' },
      correlationId: 'corr-full-456',
      metadata: {
        user_id: 'user-777',
        custom_field: 'custom_value',
      },
    },
  },

  // === METADATA MERGING EXAMPLES ===
  {
    name: 'v1 message with both metadata and universal (merged)',
    body: {
      key: 'item.added',
      data: { itemId: 'item-123' },
      metadata: { category: 'electronics', priority: 'high' },
      universal: {
        user_id: 'user-888',
        tenant_id: 'tenant-001',
      },
      targetSubscriber: 'inventory-service',
    },
    expected: {
      eventKey: 'item.added',
      targetSubscriber: 'inventory-service',
      data: { itemId: 'item-123' },
      metadata: {
        category: 'electronics',
        priority: 'high',
        user_id: 'user-888',
        tenant_id: 'tenant-001',
      },
    },
  },

  // === HEADER-BASED EXAMPLES ===
  {
    name: 'v1 message with attempt count from header',
    body: {
      key: 'task.retry',
      data: { taskId: 'task-555' },
      targetSubscriber: 'worker-service',
    },
    headers: {
      'x-matador-attempts': 3,
    },
    expected: {
      eventKey: 'task.retry',
      targetSubscriber: 'worker-service',
      data: { taskId: 'task-555' },
      attempts: 3,
    },
  },

  {
    name: 'v1 message with importance from header',
    body: {
      key: 'alert.triggered',
      data: { alertId: 'alert-111' },
      targetSubscriber: 'pager-service',
    },
    headers: {
      'x-matador-importance': 'must-investigate',
    },
    expected: {
      eventKey: 'alert.triggered',
      targetSubscriber: 'pager-service',
      data: { alertId: 'alert-111' },
      importance: 'must-investigate',
    },
  },

  {
    name: 'v1 message with correlation_id from v1 header',
    body: {
      key: 'trace.event',
      data: { traceId: 'trace-222' },
      targetSubscriber: 'tracing-service',
    },
    headers: {
      'x-correlation-id': 'header-corr-id',
    },
    expected: {
      eventKey: 'trace.event',
      targetSubscriber: 'tracing-service',
      data: { traceId: 'trace-222' },
      correlationId: 'header-corr-id',
    },
  },

  {
    name: 'v1 message with event_id from v1 header',
    body: {
      key: 'legacy.event',
      data: { legacyId: 'leg-333' },
      targetSubscriber: 'legacy-handler',
    },
    headers: {
      'x-event-id': 'header-event-id-456',
    },
    expected: {
      id: 'header-event-id-456',
      eventKey: 'legacy.event',
      targetSubscriber: 'legacy-handler',
      data: { legacyId: 'leg-333' },
    },
  },

  // === EDGE CASES ===
  {
    name: 'v1 message with null universal fields (ignored)',
    body: {
      key: 'null.test',
      data: { test: true },
      universal: {
        event_id: null,
        user_id: null,
        correlation_id: null,
      },
      targetSubscriber: 'null-handler',
    },
    expected: {
      eventKey: 'null.test',
      targetSubscriber: 'null-handler',
      data: { test: true },
    },
  },

  {
    name: 'v1 message with empty metadata object',
    body: {
      key: 'empty.metadata',
      data: { value: 42 },
      metadata: {},
      targetSubscriber: 'empty-handler',
    },
    expected: {
      eventKey: 'empty.metadata',
      targetSubscriber: 'empty-handler',
      data: { value: 42 },
    },
  },

  {
    name: 'v1 message with complex nested data',
    body: {
      key: 'complex.event',
      data: {
        nested: {
          deeply: {
            value: [1, 2, { three: 'four' }],
          },
        },
        array: ['a', 'b', 'c'],
      },
      targetSubscriber: 'complex-handler',
    },
    expected: {
      eventKey: 'complex.event',
      targetSubscriber: 'complex-handler',
      data: {
        nested: {
          deeply: {
            value: [1, 2, { three: 'four' }],
          },
        },
        array: ['a', 'b', 'c'],
      },
    },
  },

  {
    name: 'v1 message with before field (ignored in v2)',
    body: {
      key: 'update.event',
      data: { newValue: 'after' },
      before: { oldValue: 'before' },
      targetSubscriber: 'update-handler',
    },
    expected: {
      eventKey: 'update.event',
      targetSubscriber: 'update-handler',
      data: { newValue: 'after' },
    },
  },

  // === ADD YOUR EXAMPLES BELOW ===
  // Copy this template and fill in your v1 message data:
  //
  // {
  //   name: 'descriptive name for your test case',
  //   body: {
  //     key: 'your.event.key',
  //     data: { /* your event data */ },
  //     metadata: { /* optional metadata */ },
  //     universal: {
  //       event_id: 'optional-event-id',
  //       user_id: 'optional-user-id',
  //       correlation_id: 'optional-correlation-id',
  //       // any other custom fields
  //     },
  //     before: { /* optional, will be ignored */ },
  //     options: { delayMs: 1000 }, // optional
  //     targetSubscriber: 'your-subscriber-name',
  //   },
  //   headers: {
  //     // optional headers
  //     'x-matador-attempts': 1,
  //     'x-matador-importance': 'should-investigate',
  //     'x-event-id': 'header-event-id',
  //     'x-correlation-id': 'header-correlation-id',
  //   },
  //   expected: {
  //     id: 'expected-id', // optional, will be generated if not in body/headers
  //     eventKey: 'your.event.key',
  //     targetSubscriber: 'your-subscriber-name',
  //     data: { /* expected data */ },
  //     metadata: { /* expected merged metadata */ },
  //     correlationId: 'expected-correlation-id',
  //     attempts: 1,
  //     importance: 'should-investigate',
  //   },
  // },
];

describe('RabbitMQCodec', () => {
  const codec = RabbitMQCodec.create();

  describe('v1 to v2 translation', () => {
    for (const fixture of V1_MESSAGE_FIXTURES) {
      it(`should translate: ${fixture.name}`, () => {
        const body = new TextEncoder().encode(JSON.stringify(fixture.body));
        const headers = fixture.headers ?? {};

        const envelope = codec.decode(body, headers);

        // Check required fields
        expect(envelope.docket.eventKey).toBe(fixture.expected.eventKey);
        expect(envelope.docket.targetSubscriber).toBe(
          fixture.expected.targetSubscriber,
        );
        expect(envelope.data).toEqual(fixture.expected.data);

        // Check optional ID (may be generated if not specified)
        if (fixture.expected.id !== undefined) {
          expect(envelope.id).toBe(fixture.expected.id);
        } else {
          expect(envelope.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );
        }

        // Check metadata
        if (fixture.expected.metadata !== undefined) {
          expect(envelope.docket.metadata).toEqual(fixture.expected.metadata);
        } else {
          expect(
            envelope.docket.metadata === undefined ||
              Object.keys(envelope.docket.metadata).length === 0,
          ).toBe(true);
        }

        // Check correlation ID
        if (fixture.expected.correlationId !== undefined) {
          expect(envelope.docket.correlationId).toBe(
            fixture.expected.correlationId,
          );
        }

        // Check attempts (defaults to 1)
        if (fixture.expected.attempts !== undefined) {
          expect(envelope.docket.attempts).toBe(fixture.expected.attempts);
        } else {
          expect(envelope.docket.attempts).toBe(1);
        }

        // Check importance (defaults to 'should-investigate')
        if (fixture.expected.importance !== undefined) {
          expect(envelope.docket.importance).toBe(fixture.expected.importance);
        } else {
          expect(envelope.docket.importance).toBe('should-investigate');
        }

        // Check createdAt is a valid ISO string
        expect(envelope.docket.createdAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
        );
      });
    }
  });

  describe('v1 edge cases', () => {
    it('should handle options.delayMs by setting scheduledFor', () => {
      const body: V1MessageBody = {
        key: 'delayed.event',
        data: { test: true },
        options: { delayMs: 5000 },
        targetSubscriber: 'delay-handler',
      };

      const encoded = new TextEncoder().encode(JSON.stringify(body));
      const before = Date.now();
      const envelope = codec.decode(encoded, {});
      const after = Date.now();

      expect(envelope.docket.scheduledFor).toBeDefined();

      const scheduledTime = new Date(envelope.docket.scheduledFor!).getTime();
      expect(scheduledTime).toBeGreaterThanOrEqual(before + 5000);
      expect(scheduledTime).toBeLessThanOrEqual(after + 5000);
    });

    it('should prefer header event_id over body universal.event_id', () => {
      const body: V1MessageBody = {
        key: 'priority.test',
        data: {},
        universal: { event_id: 'body-event-id' },
        targetSubscriber: 'test-handler',
      };

      const encoded = new TextEncoder().encode(JSON.stringify(body));
      const envelope = codec.decode(encoded, {
        'x-event-id': 'header-event-id',
      });

      expect(envelope.id).toBe('header-event-id');
    });

    it('should prefer v2 correlation header over v1 header', () => {
      const body: V1MessageBody = {
        key: 'corr.priority',
        data: {},
        targetSubscriber: 'test-handler',
      };

      const encoded = new TextEncoder().encode(JSON.stringify(body));
      const envelope = codec.decode(encoded, {
        'x-matador-correlation-id': 'v2-corr-id',
        'x-correlation-id': 'v1-corr-id',
      });

      expect(envelope.docket.correlationId).toBe('v2-corr-id');
    });

    it('should prefer header correlation_id over body universal.correlation_id', () => {
      const body: V1MessageBody = {
        key: 'corr.priority',
        data: {},
        universal: { correlation_id: 'body-corr-id' },
        targetSubscriber: 'test-handler',
      };

      const encoded = new TextEncoder().encode(JSON.stringify(body));
      const envelope = codec.decode(encoded, {
        'x-correlation-id': 'header-corr-id',
      });

      expect(envelope.docket.correlationId).toBe('header-corr-id');
    });
  });
});
