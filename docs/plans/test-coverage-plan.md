# Matador Test Coverage Analysis & Plan

This document outlines the current test coverage state and identifies gaps that need to be addressed.

## Executive Summary

Matador has **good coverage of outer layers** (transports, codec, topology, schema, retry) but **missing coverage of core orchestration logic** (FanoutEngine, ProcessingPipeline, ShutdownManager).

| Category     | Coverage | Status     |
|--------------|----------|------------|
| Unit Tests   | 7 files  | Partial    |
| Integration  | 1 file   | Good       |
| E2E          | 3 files  | Good       |

---

## Current Test Structure

```
packages/matador/
├── src/
│   ├── core/matador.test.ts
│   ├── codec/rabbitmq-codec.test.ts
│   ├── retry/standard-policy.test.ts
│   ├── schema/registry.test.ts
│   ├── topology/builder.test.ts
│   ├── transport/local/local-transport.test.ts
│   └── transport/multi/multi-transport.test.ts
└── test/
    ├── integration/matador.integration.test.ts
    └── e2e/
        ├── multi-transport.e2e.test.ts
        ├── rabbitmq-transport.e2e.test.ts
        └── transport-compliance.e2e.test.ts
```

---

## Module-by-Module Coverage

### Core Module (`src/core/`)

| File              | Has Tests | Type | Coverage Quality |
|-------------------|-----------|------|------------------|
| matador.ts        | Yes       | Unit | Excellent        |
| fanout.ts         | No        | -    | Missing          |
| shutdown.ts       | No        | -    | Missing          |

#### matador.test.ts - What's Covered

- Configuration & initialization
- Event registration (single & multiple events)
- Start/connect lifecycle (idempotency, error handling)
- Send functionality (single subscriber, multiple subscribers, fanout)
- Shorthand send API (EventClass + data)
- Correlation ID propagation
- Shutdown (graceful, idempotency, rejection during shutdown)
- Idle state tracking
- Queue consumption

#### FanoutEngine - Missing Tests

```typescript
// Required test scenarios:
- send() with single subscriber
- send() with multiple subscribers
- Metadata merging into envelope
- Filtering disabled subscribers via enabled hook
- Error handling when transport.send fails
- eventsBeingEnqueuedCount tracking (increment/decrement)
- Correlation ID propagation through fanout
- Hook invocation (onEnqueueSuccess, onEnqueueError)
```

#### ShutdownManager - Missing Tests

```typescript
// Required test scenarios:
- State transitions: 'running' -> 'graceful-shutdown' -> 'shutdown-complete'
- getHandlersState() returns correct handler state info
- Graceful shutdown waits for in-flight messages
- Force shutdown after timeout
- Multiple shutdown() calls are idempotent
- Event handler deregistration during shutdown
```

---

### Transport Module (`src/transport/`)

| File                     | Has Tests | Type   | Coverage Quality |
|--------------------------|-----------|--------|------------------|
| local/local-transport.ts | Yes       | Unit   | Excellent        |
| multi/multi-transport.ts | Yes       | Unit   | Good             |
| rabbitmq/rabbitmq-transport.ts | Yes | E2E    | Good             |
| connection-manager.ts    | No        | -      | Missing          |

#### LocalTransport - Covered Scenarios

- Connection lifecycle (connect, disconnect, idempotency)
- Capabilities reporting
- Send/receive operations
- Queue size tracking
- Message completion (ack, nack, dead-letter)
- Subscriptions (subscribe, unsubscribe, delivery)
- Pending message delivery on subscribe
- Dead letter queue routing
- Topology application
- Clear/reset functionality
- Delayed message handling with cancellation

#### MultiTransport - Covered Scenarios

- Constructor validation
- Name generation from transport names
- Capabilities delegation to primary
- Connection (all transports)
- Topology application (all transports)
- Primary transport send success
- Fallback mechanism on primary failure
- onEnqueueFallback hook invocation
- All transports fail scenario
- Sequential transport retry
- Fallback enable/disable control
- Subscribe from primary and fallback queues
- Complete operation delegation
- Dead letter delegation

#### RabbitMQTransport - E2E Coverage

E2E tests are sufficient for RabbitMQTransport as they test the real integration with RabbitMQ.

#### ConnectionManager - Missing Tests

```typescript
// Required test scenarios:
- Initial connection establishment
- Automatic reconnection on disconnect
- Connection retry with backoff
- Connection state change callbacks
- Multiple connect() calls are idempotent
- Graceful close() behavior
- Error event handling
```

---

### Pipeline Module (`src/pipeline/`)

| File        | Has Tests | Type | Coverage Quality |
|-------------|-----------|------|------------------|
| pipeline.ts | No        | -    | CRITICAL Missing |

#### ProcessingPipeline - Missing Tests (CRITICAL)

```typescript
// Required test scenarios:
- Decode operation via codec
- Subscriber lookup from registry
- Successful callback execution
- Callback error handling
- Retry decision flow (shouldRetry)
- Dead letter routing (shouldDeadLetter)
- Requeue operation (shouldRequeue)
- Hook invocation:
  - onWorkerBeforeProcess
  - onWorkerSuccess
  - onWorkerError
  - onDeadLetter
  - onDecodeError
- Message completion (ack after success)
- Invalid message handling
- Missing subscriber handling
- Envelope validation
```

---

### Codec Module (`src/codec/`)

| File                    | Has Tests | Type | Coverage Quality |
|-------------------------|-----------|------|------------------|
| rabbitmq-codec.ts       | Yes       | Unit | Excellent        |
| json-codec.ts           | No        | -    | Missing          |
| header-aware-codec.ts   | No        | -    | Missing          |

#### RabbitMQCodec - Covered Scenarios

- V1 to V2 message translation (25+ fixture variations)
- Universal metadata extraction (event_id, user_id, correlation_id)
- Metadata merging (body + universal)
- Header-based fields (attempt count, importance, correlation/event IDs)
- Null field handling
- Empty metadata
- Nested complex data
- Delayed message (options.delayMs)
- Priority ordering in field resolution
- ID generation when missing

#### JsonCodec - Missing Tests

```typescript
// Required test scenarios:
- encode() produces valid JSON Buffer
- decode() parses JSON Buffer correctly
- Round-trip encoding/decoding preserves data
- Error handling for invalid JSON
- UTF-8 encoding correctness
- Special character handling
```

#### HeaderAwareCodec - Missing Tests

```typescript
// Required test scenarios:
- Header extraction from message
- Header injection into message
- Default header handling
- Custom header mapping
```

---

### Schema Module (`src/schema/`)

| File        | Has Tests | Type | Coverage Quality |
|-------------|-----------|------|------------------|
| registry.ts | Yes       | Unit | Excellent        |

#### SchemaRegistry - Covered Scenarios

- Event registration
- Duplicate event detection
- Override functionality
- Event aliases (registration & retrieval)
- Duplicate alias conflict detection
- Event class retrieval (by key & alias)
- Subscriber retrieval (all, by name)
- Subscriber definition extraction
- Executable subscriber lookup
- Event keys listing
- Schema validation (duplicate subscriber names)
- Clear/reset

---

### Retry Module (`src/retry/`)

| File               | Has Tests | Type | Coverage Quality |
|--------------------|-----------|------|------------------|
| standard-policy.ts | Yes       | Unit | Excellent        |

#### StandardRetryPolicy - Covered Scenarios

- Dead letter on EventAssertionError
- Dead letter on DontRetry
- Retry on DoRetry with max attempts check
- Dead letter when max attempts exceeded
- Non-idempotent subscriber redelivery handling
- Idempotent subscriber redelivery
- Generic error retry with backoff
- Exponential backoff calculation
- Max delay capping
- Default configuration
- Custom configuration
- Partial configuration merging

---

### Topology Module (`src/topology/`)

| File       | Has Tests | Type | Coverage Quality |
|------------|-----------|------|------------------|
| builder.ts | Yes       | Unit | Excellent        |

#### TopologyBuilder - Covered Scenarios

- Namespace configuration
- Namespace validation (non-empty, no leading digits, hyphens/underscores allowed)
- Queue addition (defaults, options, multiple)
- Duplicate queue detection
- Queue name validation (non-empty, no leading digits)
- Concurrency validation
- Consumer timeout validation
- Dead letter configuration & merging
- Retry configuration & validation
- Disable retry
- Disable dead letter
- Validation without throwing
- Immutability
- External/exact queue marking

---

### Types Module (`src/types/`)

| File      | Has Tests | Type | Coverage Quality |
|-----------|-----------|------|------------------|
| event.ts  | No        | -    | Missing          |

#### Event Serialization - Missing Tests

```typescript
// Required test scenarios:
- Event static fields (key, description) are included when serialized to JSON
- JSON.stringify(event) includes static key field
- JSON.stringify(event) includes static description field
- Serialization in hook contexts (e.g., onEnqueueError logging)
```

This is important because events are often logged in hooks like `onEnqueueError`, and the static `key` and `description` fields must be present in the serialized output for debugging/observability.

---

## Integration Tests

### matador.integration.test.ts - Covered Scenarios

- Full event dispatch flow (dispatch -> fanout -> process -> callback)
- Multi-event scenarios
- Retry behavior validation
- Graceful shutdown testing
- State tracking validation

### Missing Integration Scenarios

```typescript
// Required test scenarios:
- Multiple concurrent dispatches
- Dispatch during shutdown (rejection)
- Error propagation through full stack
- Dead letter routing end-to-end
- Delayed message processing end-to-end
- Priority queue ordering
- Multi-subscriber fanout with partial failures
```

---

## E2E Tests

### rabbitmq-transport.e2e.test.ts - Covered Scenarios

- Capabilities reporting
- Message priority handling
- Attempt number tracking
- Prefetch/concurrency per queue
- Reconnection behavior
- Channel per queue isolation
- Delayed messages error handling

### transport-compliance.e2e.test.ts - Covered Scenarios

- Common transport interface compliance
- Send/receive basic operations
- Subscription management
- Dead letter handling

### multi-transport.e2e.test.ts - Covered Scenarios

- Primary transport usage
- Fallback on primary failure
- Multiple fallback transports
- Recovery back to primary

### Missing E2E Scenarios

```typescript
// Required test scenarios:
- RabbitMQ restart recovery
```

---

## Priority Implementation Plan

### Phase 1: Critical (Core Logic)

| Priority | Module             | Estimated Tests |
|----------|--------------------|-----------------|
| P0       | ProcessingPipeline | 15-20           |
| P0       | FanoutEngine       | 10-12           |
| P0       | ShutdownManager    | 8-10            |
| P0       | Event Serialization| 4-6             |

### Phase 2: Important (Infrastructure)

| Priority | Module            | Estimated Tests |
|----------|-------------------|-----------------|
| P1       | ConnectionManager | 8-10            |

### Phase 3: Nice-to-Have (Completeness)

| Priority | Module            | Estimated Tests |
|----------|-------------------|-----------------|
| P2       | JsonCodec         | 6-8             |
| P2       | HeaderAwareCodec  | 4-6             |
| P2       | Integration gaps  | 8-10            |
| P2       | E2E: RabbitMQ restart recovery | 1-2  |

---

## Test Patterns to Follow

### Unit Test Pattern

```typescript
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';

describe('ModuleName', () => {
  let instance: ModuleClass;

  beforeEach(() => {
    instance = new ModuleClass(/* dependencies */);
  });

  afterEach(() => {
    // cleanup
  });

  describe('methodName', () => {
    it('should do expected behavior', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = instance.methodName(input);

      // Assert
      expect(result).toEqual(expectedOutput);
    });

    it('should handle error case', () => {
      // Arrange
      const badInput = createBadInput();

      // Act & Assert
      expect(() => instance.methodName(badInput)).toThrow(ExpectedError);
    });
  });
});
```

### Integration Test Pattern

```typescript
describe('Feature Integration', () => {
  let matador: Matador;
  let transport: LocalTransport;

  beforeEach(async () => {
    transport = new LocalTransport();
    matador = Matador.create({ transport });
    // register events and subscribers
    await matador.start();
  });

  afterEach(async () => {
    await matador.shutdown();
  });

  it('should process event through full pipeline', async () => {
    const received: Event[] = [];

    // Subscribe to capture events
    matador.register(TestEvent, [
      Subscriber.create({
        name: 'test-subscriber',
        callback: async (envelope) => {
          received.push(envelope.data);
        },
      }),
    ]);

    // Dispatch
    await matador.dispatch(new TestEvent({ value: 'test' }));

    // Wait and verify
    await waitFor(() => received.length === 1);
    expect(received[0].value).toBe('test');
  });
});
```

### E2E Test Pattern

```typescript
import { GenericContainer, StartedTestContainer } from 'testcontainers';

describe('RabbitMQ E2E', () => {
  let container: StartedTestContainer;
  let transport: RabbitMQTransport;

  beforeAll(async () => {
    container = await new GenericContainer('rabbitmq:3-management')
      .withExposedPorts(5672)
      .start();
  }, 60000);

  afterAll(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    transport = new RabbitMQTransport({
      url: `amqp://localhost:${container.getMappedPort(5672)}`,
    });
    await transport.connect();
  });

  afterEach(async () => {
    await transport.disconnect();
  });

  it('should handle real message flow', async () => {
    // Test with real RabbitMQ
  });
});
```

---

## Test Utilities to Create

### Recommended Helpers

```typescript
// test/helpers/fixtures.ts
export function createTestEnvelope(overrides?: Partial<Envelope>): Envelope;
export function createTestEvent(overrides?: Partial<EventData>): Event;
export function createTestSubscriber(overrides?: Partial<SubscriberConfig>): Subscriber;
export function createTestTopology(queues?: QueueConfig[]): Topology;
export function createTestContext(overrides?: Partial<RetryContext>): RetryContext;

// test/helpers/assertions.ts
export function expectEnvelopeMatch(actual: Envelope, expected: Partial<Envelope>): void;
export function expectErrorType(error: unknown, ErrorClass: typeof Error): void;

// test/helpers/mocks.ts
export function createMockTransport(): Transport & { calls: Record<string, unknown[]> };
export function createMockCodec(): Codec & { calls: Record<string, unknown[]> };
export function createMockHooks(): Hooks & { invocations: string[] };

// test/helpers/wait.ts
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout?: number,
  interval?: number
): Promise<void>;
```

---

## Coverage Metrics Target

| Category   | Current | Target |
|------------|---------|--------|
| Statements | ~60%    | 90%    |
| Branches   | ~50%    | 85%    |
| Functions  | ~55%    | 90%    |
| Lines      | ~60%    | 90%    |

---

## Summary

### What We Have

- Excellent coverage of: TopologyBuilder, SchemaRegistry, StandardRetryPolicy, LocalTransport, RabbitMQCodec
- Good integration tests for core Matador flow
- Good E2E tests for RabbitMQ transport

### What We Need

1. **Critical**: ProcessingPipeline, FanoutEngine, ShutdownManager unit tests, Event serialization tests
2. **Important**: ConnectionManager unit tests
3. **Nice-to-have**: JsonCodec, HeaderAwareCodec, additional edge cases

### Next Steps

1. Start with ProcessingPipeline tests (most critical gap)
2. Add FanoutEngine tests
3. Add ShutdownManager tests
4. Add Event serialization tests (static fields in JSON output)
5. Fill remaining gaps
