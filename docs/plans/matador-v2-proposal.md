# Matador v2 Proposal

This document proposes a ground-up rewrite of the Matador events library to address architectural concerns and prepare for open-sourcing.

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Problems with v1](#problems-with-v1)
3. [Current Feature Inventory](#current-feature-inventory)
4. [Proposed v2 Architecture](#proposed-v2-architecture)
5. [Transport Implementations](#transport-implementations)
   - [RabbitMQ Transport](#rabbitmq-transport)
   - [BullMQ Transport](#bullmq-transport)
   - [Kafka Transport](#kafka-transport)
6. [Migration Strategy](#migration-strategy)

---

## Current State Analysis

Matador v1 is a mature event-driven messaging library with:
- **742 lines** in the main RabbitMQ backend
- **531 lines** in the Matador orchestrator
- **405 lines** in the hooks system
- Two backend implementations (RabbitMQ, Local)

The library has served well but has accumulated technical debt that makes it difficult to:
- Add new backend implementations
- Test components in isolation
- Understand where responsibilities lie

---

## Problems with v1

### 1. RabbitMQ Details Leaking Through Abstractions

RabbitMQ-specific concepts appear throughout the codebase:

| Leakage             | Location                                                  | Issue                                 |
|---------------------|-----------------------------------------------------------|---------------------------------------|
| AMQP Headers        | `x-event-id`, `x-delivery-count`, `x-first-death-message` | Header names are RabbitMQ conventions |
| Topology Concepts   | Exchanges, bindings, DLX/DLQ                              | Not all message systems have exchanges|
| Delivery Semantics  | `message.fields.redelivered`, `x-delivery-count`          | RabbitMQ redelivery model assumed     |
| Channel Model       | Per-queue channels, prefetch/QoS                          | RabbitMQ-specific concurrency model   |
| Plugin Dependencies | `rabbitmq_delayed_message_exchange`                       | Vendor-specific feature               |

**Impact:** Any new backend must understand RabbitMQ's model to implement the `Backend` interface correctly.

### 2. Generic Logic Trapped in RabbitMQ Backend

The following logic is in `rabbitmq.ts` but is backend-agnostic:

| Logic                    | Lines            | Should Be                  |
|--------------------------|------------------|----------------------------|
| Retry decision making    | 585-647          | Generic retry strategy     |
| Poison message detection | 414-416          | Generic dead-letter policy |
| Event fanout (1:N → 1:1) | (in matador.ts)  | Already generic, good      |
| Duration tracking        | 469-472          | Generic processing metrics |
| Error augmentation       | 505-520          | Generic error enrichment   |
| Idempotency enforcement  | 461-464          | Generic retry filter       |

**Impact:** Each new backend must reimplement this logic, leading to inconsistent behavior.

### 3. Brittle Tests with Isolation Problems

Current test issues:

- **Shared RabbitMQ mocks** - Tests share `mock-amqplib` state
- **Global fixture state** - Fixtures sometimes retain state between tests
- **Timing dependencies** - Tests use `waitFor` with arbitrary timeouts
- **Integration test coupling** - Testcontainers tests share topology
- **Hook state bleeding** - Mock hooks called across test boundaries

**Impact:** Tests fail intermittently, require careful ordering, and are hard to debug.

---

## Current Feature Inventory

The following features exist in Matador v1. Status: YES (keep), NO (remove), CHANGE (modify).

### A. Event System

| Feature           | Description                                                  | Status |
|-------------------|--------------------------------------------------------------|--------|
| Event base class  | Abstract class with `key`, `description`, `data`, `metadata` | YES    |
| RichEvent wrapper | Adds `universalMetadata` and `before` state to events        | YES    |
| Before/after state| Optional `before` for change-type events (same type as data) | YES    |
| TargetedRichEvent | RichEvent + `targetSubscriber` for 1:1 routing               | YES    |
| Event options     | `delayMs` for delayed processing                             | YES    |
| Event key         | Static string identifier for routing                         | YES    |

**Notes:**
- `before` state enables change-type events showing previous vs current state

### B. Subscriber System

| Feature              | Description                                       | Status |
|----------------------|---------------------------------------------------|--------|
| Subscriber class     | Full implementation with callback function        | YES    |
| SubscriberStub       | Declaration for subscribers implemented elsewhere | YES    |
| `name` property      | Human-readable subscriber name                    | YES    |
| `targetQueue`        | Route subscriber's events to specific queue       | CHANGE |
| `enabled()` hook     | Feature-flag subscriber dispatch                  | YES    |
| `idempotent` property| Declares idempotency ('yes', 'no', 'unknown')     | YES    |
| `importance` property| Severity level for monitoring                     | YES    |

**Changes:**
- `preferredQueue` renamed to `targetQueue`
- `preferredBackend` removed (no longer selecting backends per-subscriber)
- `fallbackDisabled` removed (fallback model changed)

**Notes:**
- SubscriberStub is for multi-codebase scenarios where subscriber implementation is remote

### C. Queue Management

| Feature              | Description                                   | Status |
|----------------------|-----------------------------------------------|--------|
| Multiple queues      | `queues` config array for work distribution   | YES    |
| Queue naming         | Auto-prefixed with namespace                  | YES    |
| Exact queue bindings | Reference external/pre-existing queues        | YES    |
| `consumeFrom`        | Specify which queues this instance consumes   | CHANGE |
| Per-queue concurrency| Independent concurrency per queue             | YES    |
| Quorum queues        | RabbitMQ durable queue type                   | YES    |
| Consumer timeout     | Timeout configuration per queue               | YES    |

**Changes:**
- `shouldWorkQueues` renamed to `consumeFrom` for clarity

**Notes:**
- Exact queue bindings allow integration with pre-existing queues not managed by Matador

### D. Message Publishing

| Feature                 | Description                                      | Status |
|-------------------------|--------------------------------------------------|--------|
| Event fanout            | One event → multiple targeted events             | YES    |
| Selective dispatch      | `enabled()` filters subscribers at dispatch      | YES    |
| Target queue routing    | Route to subscriber's target queue               | YES    |
| Fallback queue chain    | Fallback to next queue in chain on failure       | CHANGE |
| Enqueue state tracking  | `eventsBeingEnqueuedCount`                       | YES    |
| `onEnqueueSuccess` hook | Called on successful enqueue                     | YES    |
| `onEnqueueWarning` hook | Called on fallback                               | YES    |
| `onEnqueueError` hook   | Called on final failure                          | YES    |

**Changes:**
- `Preferred backend routing` removed (backends no longer selectable per-subscriber)
- `Fallback support` changed: fallback can be to any queue in a configurable chain, not just local

### E. Message Consumption

| Feature                      | Description                                           | Status |
|------------------------------|-------------------------------------------------------|--------|
| Consumer per queue           | Dedicated consumer per queue (transport-specific)     | YES    |
| Payload deserialization      | Parse event from message body                         | YES    |
| Schema validation            | Lookup subscriber from schema                         | YES    |
| Payload validation           | Validate payload against schema (Zod or similar)      | NEW    |
| Async callback execution     | Await subscriber callback                             | YES    |
| Duration tracking            | Measure processing time                               | YES    |
| Processing state tracking    | `eventsBeingProcessed` counter                        | YES    |
| `onWorkerWrap` hook          | Wrap entire processing (APM context)                  | YES    |
| `onWorkerBeforeProcess` hook | Pre-processing hook                                   | YES    |
| `onWorkerSuccess` hook       | Success callback with metrics                         | YES    |
| `onWorkerError` hook         | Error callback with details                           | YES    |

**Changes:**
- Added payload validation against event class schema (Zod preferred)
- Consumer-per-queue is transport-specific implementation detail

### F. Error Handling

| Feature                  | Description                                     | Status |
|--------------------------|-------------------------------------------------|--------|
| Poison message detection | Detect messages exceeding delivery threshold    | YES    |
| Idempotency-based retry  | Only retry idempotent subscribers               | YES    |
| `DoRetry` error class    | Force retry regardless of idempotency           | YES    |
| `DontRetry` error class  | Never retry regardless of idempotency           | YES    |
| `EventAssertionError`    | Never retry (assertion failures)                | YES    |
| Max attempts tracking    | Track attempt count in envelope                 | YES    |
| Retry DLQ                | Temporary hold with TTL for retry               | YES    |
| Unhandled DLQ            | Schema mismatch (deployment issues)             | YES    |
| Undeliverable DLQ        | Permanent failures                              | YES    |
| Error augmentation       | Track first and last error messages             | YES    |
| DLQ max length           | Bound undeliverable queue size                  | YES    |

### G. Acknowledgment & Delivery Semantics

| Feature                    | Description                                         | Status |
|----------------------------|-----------------------------------------------------|--------|
| At-least-once delivery     | Ack after subscriber completes successfully         | YES    |
| At-most-once delivery      | Ack before processing (where transport supports)    | NEW    |
| Delivery semantics config  | Configure per-subscriber or global delivery mode    | NEW    |
| Transport capability check | Indicate what semantics each transport supports     | NEW    |
| Ack on success             | Acknowledge after callback completes                | YES    |
| Nack on undeliverable      | Reject without requeue                              | YES    |
| DLQ routing                | Route to dead-letter after ack/nack                 | YES    |

**Changes:**
- Explicit support for both at-least-once and at-most-once delivery semantics
- Transport declares which delivery semantics it supports

### H. Connection Management

| Feature                   | Description                          | Status |
|---------------------------|--------------------------------------|--------|
| Auto-reconnect            | Reconnect on connection loss         | YES    |
| Exponential backoff       | Increasing intervals between retries | YES    |
| Heartbeat monitoring      | Detect stale connections             | YES    |
| Connection state tracking | `isConnected()` method               | YES    |
| Graceful shutdown         | Close consumers then connection      | YES    |

### I. Serialization

| Feature               | Description                                    | Status |
|-----------------------|------------------------------------------------|--------|
| JSON format           | Events serialized as JSON strings              | YES    |
| Buffer encoding       | UTF-8 encoded buffers                          | YES    |
| Empty body validation | Reject empty messages                          | YES    |
| Parse error handling  | Handle malformed payloads                      | YES    |
| Pluggable codecs      | Extensible serialization (JSON, MessagePack)   | NEW    |

**Changes:**
- Added pluggable codec system for future serialization formats

### J. Delayed Messages

| Feature                 | Description                                | Status |
|-------------------------|--------------------------------------------|--------|
| Delay option            | `delayMs` on event options                 | YES    |
| Transport-native delays | Use transport's native delay if available  | YES    |
| Fallback delay handling | Handle delays when transport lacks support | YES    |
| Auto-detection          | Detect delay capability                    | YES    |
| Graceful degradation    | Process immediately if unavailable         | YES    |
| Long delay warning      | Log warning for delays > 1 hour            | YES    |

**Changes:**
- Generalized from RabbitMQ-specific to transport-agnostic

### K. Shutdown

| Feature               | Description                  | Status |
|-----------------------|------------------------------|--------|
| Stop receiving        | `stopReceivingEvents()`      | YES    |
| Wait for idle         | `waitHandlersToBeIdle()`     | YES    |
| Stop enqueueing       | `stopEnqueuingEvents()`      | YES    |
| Shutdown connections  | `shutdown()`                 | YES    |
| Timeout configuration | `gracefulShutdownTimeout`    | YES    |
| Forced shutdown       | Force after timeout          | YES    |
| Idle polling          | Check every 1 second         | YES    |

### L. Monitoring & Observability

| Feature                         | Description                            | Status |
|---------------------------------|----------------------------------------|--------|
| `getHandlersState()`            | Query idle state and counts            | YES    |
| `getAllTransportsHandlersState` | Aggregate from all transports          | YES    |
| Envelope-based tracing          | Event ID, correlation ID in envelope   | YES    |
| Logger integration              | Logger passed via hooks                | YES    |
| Connection status logs          | Log connect/disconnect                 | YES    |
| Queue binding logs              | Log consumer creation                  | YES    |

**Changes:**
- Renamed from backend to transport terminology

### M. Runtime Configuration

| Feature                        | Description                  | Status |
|--------------------------------|------------------------------|--------|
| `getQueueConcurrency()` hook   | Dynamic concurrency          | YES    |
| `getRetryDelay()` hook         | Dynamic retry delay          | YES    |
| `getAttempts()` hook           | Dynamic max attempts         | YES    |
| `getMaxDeliveries()` hook      | Dynamic poison threshold     | YES    |
| `loadUniversalMetadata()` hook | Add correlation context      | YES    |

**Changes:**
- `getDesiredBackend()` removed (backend selection per-event no longer supported)

### N. Schema System

| Feature            | Description                             | Status |
|--------------------|-----------------------------------------|--------|
| MatadorSchema type | `{ [EventKey]: [Event, Subscriber[]] }` | YES    |
| `getEventClass()`  | Lookup event from schema                | YES    |
| `getSubscribers()` | Lookup subscribers for event            | YES    |
| `getSubscriber()`  | Lookup specific subscriber              | YES    |
| Event aliases      | Multiple names/keys for same event      | CHANGE |

**Changes:**
- `legacyName()` renamed to `aliases` - provides multiple routing keys for backwards compatibility and migrations

### O. Testing Utilities

| Feature              | Description                           | Status |
|----------------------|---------------------------------------|--------|
| Event fixtures       | Test event implementations            | YES    |
| Subscriber fixtures  | Test subscriber implementations       | YES    |
| Schema fixtures      | Test schema configurations            | YES    |
| `waitFor()` helper   | Async condition waiting               | YES    |
| MemoryTransport      | In-memory transport for unit tests    | NEW    |
| Transport test suite | Shared tests for transport compliance | NEW    |

**Changes:**
- `mock-amqplib` integration removed (transport-specific mocking not needed)
- Added MemoryTransport for testing
- Added shared transport compliance test suite

---

## Proposed v2 Architecture

### Design Principles

1. **Backend Agnostic Core** - All business logic lives outside backends
2. **Explicit Contracts** - Backends implement minimal transport interface
3. **Pluggable Components** - Serialization, retry, dead-letter are injectable
4. **Testable by Design** - Components testable in isolation without mocks
5. **No Leaky Abstractions** - Generic interfaces with no vendor terminology
6. **Capability-Based Adaptation** - Transports declare capabilities, Matador adapts behavior

### Proposed Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Application                              │
│                 (Events, Subscribers, Schema)                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Matador Core                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │    Fanout     │  │     Retry     │  │   Shutdown    │        │
│  │    Engine     │  │    Policy     │  │   Manager     │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │    Message    │  │     Codec     │  │     Hooks     │        │
│  │   Envelope    │  │  (serialize)  │  │    System     │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
│  ┌───────────────┐  ┌───────────────────────────────────┐       │
│  │   Topology    │  │        Processing Pipeline         │       │
│  │  (queues/DLQ) │  │ (decode → validate → execute → ack)│       │
│  └───────────────┘  └───────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Transport Interface                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  capabilities: TransportCapabilities                     │    │
│  │  applyTopology(topology): Promise<void>                  │    │
│  │  send(queue, envelope, options?): Promise<void>          │    │
│  │  subscribe(queue, handler, options?): Promise<Sub>       │    │
│  │  complete(receipt): Promise<void>                        │    │
│  │  connect(): Promise<void>                                │    │
│  │  disconnect(): Promise<void>                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Connection Manager                     │    │
│  │  (reconnect, backoff, heartbeat, state tracking)         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  RabbitMQ   │         │   BullMQ    │         │    Kafka    │
│  Transport  │         │  Transport  │         │  Transport  │
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │                       │
       ▼                       ▼                       ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   AMQP      │         │    Redis    │         │    Kafka    │
│   Broker    │         │   Server    │         │   Cluster   │
└─────────────┘         └─────────────┘         └─────────────┘
```

### Key Changes from v1

#### 1. Transport Capabilities (New)

Transports declare their native capabilities so Matador can adapt:

```typescript
type DeliveryMode = 'at-least-once' | 'at-most-once';

interface TransportCapabilities {
  /**
   * Delivery semantics the transport supports.
   * - 'at-least-once': Ack after processing (may redeliver on failure)
   * - 'at-most-once': Ack before processing (no redelivery, may lose messages)
   * Most transports support at-least-once; at-most-once is opt-in for specific use cases.
   */
  deliveryModes: DeliveryMode[];

  /**
   * Transport can delay message delivery natively.
   * - true: Use transport's native delay (BullMQ, RabbitMQ with plugin)
   * - false: Matador handles via retry queue with TTL or external scheduler
   */
  delayedMessages: boolean;

  /**
   * Transport can route failed messages to dead-letter queue natively.
   * - 'native': Transport handles DL routing (RabbitMQ DLX)
   * - 'manual': Matador must send() to DLQ then complete() original
   * - 'none': No DL support, Matador logs and discards
   */
  deadLetterRouting: 'native' | 'manual' | 'none';

  /**
   * Transport tracks delivery/attempt count natively.
   * - true: Receipt includes accurate attemptNumber from transport
   * - false: Matador tracks attempts in envelope.attempts field
   */
  attemptTracking: boolean;

  /**
   * How transport handles concurrency.
   * - 'prefetch': Channel-based prefetch (RabbitMQ)
   * - 'worker': Worker concurrency setting (BullMQ)
   * - 'partition': Partition-based parallelism (Kafka)
   * - 'none': No concurrency control (Memory)
   */
  concurrencyModel: 'prefetch' | 'worker' | 'partition' | 'none';

  /**
   * Message ordering guarantees.
   * - 'none': No ordering guarantee (most transports with multiple consumers)
   * - 'queue': Ordered within queue (single consumer scenarios)
   * - 'partition': Ordered within partition/key (Kafka)
   */
  ordering: 'none' | 'queue' | 'partition';

  /**
   * Transport supports message priority.
   * - true: Higher priority messages processed first (BullMQ, RabbitMQ)
   * - false: FIFO only
   */
  priorities: boolean;
}
```

#### 2. Transport Interface (Replaces Backend)

The transport is **pure I/O** with minimal responsibilities:

```typescript
interface Transport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Topology - translate generic topology to transport-specific structure
  applyTopology(topology: Topology): Promise<void>;

  // Core operations
  send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void>;
  subscribe(
    queue: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): Promise<Subscription>;

  // Message completion - always called after processing
  complete(receipt: MessageReceipt): Promise<void>;
}

interface SendOptions {
  delay?: number;        // Milliseconds - transport uses native or ignores
  priority?: number;     // Priority level - transport uses native or ignores
  partitionKey?: string; // For Kafka - determines partition
}

interface SubscribeOptions {
  concurrency?: number;    // Hint for transport - implementation varies
  fromBeginning?: boolean; // For Kafka - start from earliest offset
  deliveryMode?: DeliveryMode; // Override default delivery semantics
}

interface MessageReceipt {
  /** Opaque handle for the transport to identify the message */
  handle: unknown;
  /** True if this is a redelivery (transport-reported if capable) */
  redelivered: boolean;
  /** 1-based attempt number (transport-reported if capable, else from envelope) */
  attemptNumber: number;
  /** Original queue/topic the message came from */
  sourceQueue: string;
}

interface Subscription {
  unsubscribe(): Promise<void>;
  readonly isActive: boolean;
}
```

#### 3. Topology (New First-Class Construct)

Topology defines the queue architecture in a transport-agnostic way. Matador owns the topology definition; transports translate and apply it.

```typescript
interface Topology {
  /** Namespace prefix for all queues */
  namespace: string;

  /** Work queues for processing events */
  queues: QueueDefinition[];

  /** Dead-letter queue configuration */
  deadLetter: DeadLetterConfig;

  /** Retry queue configuration */
  retry: RetryConfig;
}

interface QueueDefinition {
  /** Queue name (will be prefixed with namespace) */
  name: string;
  /** Concurrency for this queue */
  concurrency?: number;
  /** Consumer timeout in milliseconds */
  consumerTimeout?: number;
  /** Enable priority support if transport allows */
  priorities?: boolean;
}

interface DeadLetterConfig {
  /** Unhandled events (schema mismatch) */
  unhandled: {
    enabled: boolean;
    maxLength?: number;
  };
  /** Undeliverable events (permanent failures) */
  undeliverable: {
    enabled: boolean;
    maxLength?: number;
  };
}

interface RetryConfig {
  /** Enable retry queue with delay */
  enabled: boolean;
  /** Default retry delay in milliseconds */
  defaultDelayMs: number;
  /** Maximum retry delay */
  maxDelayMs: number;
}
```

**Transport Translation Examples:**

| Topology Concept | RabbitMQ | BullMQ | Kafka |
|------------------|----------|--------|-------|
| Queue            | Exchange + Queue + Binding | Queue | Topic |
| Dead-letter      | DLX + DLQ | Separate queue | DLQ topic |
| Retry with delay | DLX + TTL queue | Delayed job | Retry topic + scheduler |
| Namespace        | Exchange/queue prefix | Queue prefix | Topic prefix |
| Concurrency      | Prefetch per channel | Worker concurrency | Partition count |

```typescript
// Transport implements translation
class RabbitMQTransport implements Transport {
  async applyTopology(topology: Topology): Promise<void> {
    // Create main exchange
    await this.channel.assertExchange(`${topology.namespace}.main`, 'direct');

    // Create each queue with bindings
    for (const queue of topology.queues) {
      const queueName = `${topology.namespace}.${queue.name}`;
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-dead-letter-exchange': `${topology.namespace}.dlx`,
        }
      });
      await this.channel.bindQueue(queueName, `${topology.namespace}.main`, queue.name);
    }

    // Create DLX and DLQs
    if (topology.deadLetter.undeliverable.enabled) {
      await this.createDeadLetterTopology(topology);
    }

    // Create retry infrastructure
    if (topology.retry.enabled) {
      await this.createRetryTopology(topology);
    }
  }
}

class BullMQTransport implements Transport {
  async applyTopology(topology: Topology): Promise<void> {
    // BullMQ auto-creates queues, but we store config for later use
    this.topologyConfig = topology;

    // Pre-create queue references for DLQs if needed
    if (topology.deadLetter.undeliverable.enabled) {
      for (const queue of topology.queues) {
        this.getOrCreateQueue(`${topology.namespace}:${queue.name}:undeliverable`);
      }
    }
  }
}

class KafkaTransport implements Transport {
  async applyTopology(topology: Topology): Promise<void> {
    const topics: NewTopic[] = [];

    // Create main topics
    for (const queue of topology.queues) {
      topics.push({
        topic: `${topology.namespace}.${queue.name}`,
        numPartitions: queue.concurrency ?? 1,
      });
    }

    // Create DLQ topics
    if (topology.deadLetter.undeliverable.enabled) {
      for (const queue of topology.queues) {
        topics.push({
          topic: `${topology.namespace}.${queue.name}.undeliverable`,
          numPartitions: 1,
        });
      }
    }

    await this.admin.createTopics({ topics });
  }
}
```

#### 4. Connection Manager

Each transport includes a Connection Manager responsible for:

```typescript
interface ConnectionManager {
  /** Current connection state */
  readonly state: ConnectionState;

  /** Connect with automatic retry on failure */
  connect(): Promise<void>;

  /** Gracefully disconnect */
  disconnect(): Promise<void>;

  /** Check if currently connected */
  isConnected(): boolean;

  /** Register callback for connection state changes */
  onStateChange(callback: (state: ConnectionState) => void): void;
}

type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; attempt: number }
  | { status: 'connected' }
  | { status: 'reconnecting'; attempt: number; lastError: Error }
  | { status: 'failed'; error: Error };

interface ConnectionManagerConfig {
  /** Maximum reconnection attempts before giving up (0 = infinite) */
  maxReconnectAttempts: number;
  /** Initial delay between reconnection attempts (ms) */
  initialReconnectDelay: number;
  /** Maximum delay between reconnection attempts (ms) */
  maxReconnectDelay: number;
  /** Backoff multiplier for reconnection delay */
  backoffMultiplier: number;
  /** Heartbeat interval for connection health (ms) */
  heartbeatInterval?: number;
}
```

**Responsibilities:**
- Establish initial connection
- Detect connection loss (heartbeat, error events)
- Reconnect with exponential backoff
- Track connection state for observability
- Notify listeners of state changes

#### 5. Message Envelope (Replaces RichEvent + Headers)

Generic envelope without vendor-specific concepts:

```typescript
interface Envelope {
  /** Unique message ID (UUID v4) */
  id: string;
  /** The event payload */
  payload: unknown;
  /** Routing and observability metadata */
  metadata: EnvelopeMetadata;
  /**
   * Attempt counter managed by Matador (1-based).
   * Incremented on each retry. Used when transport doesn't track attempts.
   */
  attempts: number;
  /** When the envelope was first created */
  createdAt: Date;
  /** Scheduled processing time (for delayed messages) */
  scheduledFor?: Date;
}

interface EnvelopeMetadata {
  eventKey: string;
  targetSubscriber: string;
  correlationId?: string;
  userId?: string;
  importance: Importance;
  /** Error message from first failure (for debugging) */
  firstError?: string;
  /** Error message from most recent failure */
  lastError?: string;
  /** Original queue before any dead-letter routing */
  originalQueue?: string;
}
```

#### 6. Pluggable Codec (Replaces Hardcoded JSON)

```typescript
interface Codec {
  encode(envelope: Envelope): Buffer;
  decode(buffer: Buffer): Envelope;
  contentType: string;
}

// Built-in implementations
class JsonCodec implements Codec {
  contentType = 'application/json';
  encode(envelope: Envelope): Buffer {
    return Buffer.from(JSON.stringify(envelope), 'utf-8');
  }
  decode(buffer: Buffer): Envelope {
    return JSON.parse(buffer.toString('utf-8'));
  }
}

class MsgPackCodec implements Codec {
  contentType = 'application/msgpack';
  // More efficient binary serialization
}
```

#### 7. Retry Policy (Extracted from RabbitMQ Backend)

```typescript
interface RetryPolicy {
  shouldRetry(context: RetryContext): RetryDecision;
  getDelay(context: RetryContext): number;
}

interface RetryContext {
  envelope: Envelope;
  error: Error;
  subscriber: SubscriberDefinition;
  receipt: MessageReceipt;
}

type RetryDecision =
  | { action: 'retry'; delay: number }
  | { action: 'dead-letter'; queue: string; reason: string }
  | { action: 'discard'; reason: string };

// Built-in policy implementing current Matador v1 behavior
class StandardRetryPolicy implements RetryPolicy {
  constructor(private options: {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  }) {}

  shouldRetry(context: RetryContext): RetryDecision {
    const { envelope, error, subscriber, receipt } = context;

    // 1. Check for explicit retry control errors
    if (error instanceof DontRetry) {
      return { action: 'dead-letter', queue: 'undeliverable', reason: error.message };
    }
    if (error instanceof DoRetry && receipt.attemptNumber < this.options.maxAttempts) {
      return { action: 'retry', delay: this.getDelay(context) };
    }

    // 2. Check max attempts
    if (receipt.attemptNumber >= this.options.maxAttempts) {
      return { action: 'dead-letter', queue: 'undeliverable', reason: 'max attempts exceeded' };
    }

    // 3. Check idempotency for redelivered messages
    if (receipt.redelivered && subscriber.idempotent === 'no') {
      return { action: 'dead-letter', queue: 'undeliverable', reason: 'non-idempotent redelivery' };
    }

    // 4. Default: retry with backoff
    return { action: 'retry', delay: this.getDelay(context) };
  }

  getDelay(context: RetryContext): number {
    const attempt = context.receipt.attemptNumber;
    const delay = this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.options.maxDelay);
  }
}
```

#### 8. Processing Pipeline (Extracted from RabbitMQ Consumer)

```typescript
class ProcessingPipeline {
  constructor(
    private schema: Schema,
    private codec: Codec,
    private retryPolicy: RetryPolicy,
    private hooks: SafeHooks,
    private transport: Transport
  ) {}

  async process(rawMessage: Buffer, receipt: MessageReceipt): Promise<void> {
    const startTime = performance.now();

    // 1. Decode envelope
    let envelope: Envelope;
    try {
      envelope = this.codec.decode(rawMessage);
    } catch (error) {
      // Malformed message - cannot retry, discard
      await this.transport.complete(receipt);
      this.hooks.onDecodeError({ error, receipt });
      return;
    }

    // 2. Lookup subscriber from schema
    const subscriber = this.schema.getSubscriber(
      envelope.metadata.eventKey,
      envelope.metadata.targetSubscriber
    );
    if (!subscriber) {
      // Schema mismatch - send to unhandled DLQ
      await this.sendToDeadLetter(receipt, envelope, 'unhandled', 'subscriber not in schema');
      return;
    }

    // 3. Execute subscriber callback with hooks
    let result: unknown;
    let error: Error | undefined;

    await this.hooks.onWorkerWrap(envelope, subscriber, async () => {
      await this.hooks.onWorkerBeforeProcess(envelope, subscriber);

      try {
        result = await subscriber.callback(envelope.payload, envelope.metadata);
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      }
    });

    const durationMs = performance.now() - startTime;

    // 4. Handle success
    if (!error) {
      await this.transport.complete(receipt);
      this.hooks.onWorkerSuccess({ envelope, subscriber, result, durationMs });
      return;
    }

    // 5. Handle failure - consult retry policy
    const decision = this.retryPolicy.shouldRetry({
      envelope,
      error,
      subscriber,
      receipt
    });

    // Update envelope with error info
    envelope.metadata.lastError = error.message;
    envelope.metadata.firstError ??= error.message;

    switch (decision.action) {
      case 'retry':
        envelope.attempts++;
        envelope.scheduledFor = new Date(Date.now() + decision.delay);
        await this.transport.send(receipt.sourceQueue, envelope, { delay: decision.delay });
        await this.transport.complete(receipt);
        break;

      case 'dead-letter':
        await this.sendToDeadLetter(receipt, envelope, decision.queue, decision.reason);
        break;

      case 'discard':
        await this.transport.complete(receipt);
        break;
    }

    this.hooks.onWorkerError({ envelope, subscriber, error, durationMs, decision });
  }

  private async sendToDeadLetter(
    receipt: MessageReceipt,
    envelope: Envelope,
    dlqName: string,
    reason: string
  ): Promise<void> {
    envelope.metadata.originalQueue ??= receipt.sourceQueue;

    if (this.transport.sendToDeadLetter) {
      // Use native dead-letter routing
      await this.transport.sendToDeadLetter(receipt, dlqName, envelope, reason);
    } else {
      // Manual: send to DLQ then complete original
      const fullDlqName = `${receipt.sourceQueue}.${dlqName}`;
      await this.transport.send(fullDlqName, envelope);
      await this.transport.complete(receipt);
    }
  }
}
```

### Test Architecture for v2

#### 1. Pure Unit Tests (No Mocks Needed)

```typescript
// Retry policy is pure function - no mocks
describe('StandardRetryPolicy', () => {
  const policy = new StandardRetryPolicy({
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  });

  it('should retry idempotent subscriber on first failure', () => {
    const decision = policy.shouldRetry({
      envelope: createEnvelope({ attempts: 1 }),
      error: new Error('transient'),
      subscriber: { idempotent: 'yes' },
      receipt: { attemptNumber: 1, redelivered: false }
    });
    expect(decision).toEqual({ action: 'retry', delay: 1000 });
  });

  it('should dead-letter after max attempts', () => {
    const decision = policy.shouldRetry({
      envelope: createEnvelope({ attempts: 3 }),
      error: new Error('still failing'),
      subscriber: { idempotent: 'yes' },
      receipt: { attemptNumber: 3, redelivered: true }
    });
    expect(decision.action).toBe('dead-letter');
  });

  it('should dead-letter non-idempotent subscriber on redelivery', () => {
    const decision = policy.shouldRetry({
      envelope: createEnvelope({ attempts: 1 }),
      error: new Error('failed'),
      subscriber: { idempotent: 'no' },
      receipt: { attemptNumber: 1, redelivered: true }
    });
    expect(decision.action).toBe('dead-letter');
    expect(decision.reason).toContain('non-idempotent');
  });
});
```

#### 2. Transport Tests with Test Doubles

```typescript
// Memory transport for fast integration tests
describe('ProcessingPipeline', () => {
  let transport: MemoryTransport;
  let pipeline: ProcessingPipeline;
  let hooks: MockHooks;

  beforeEach(() => {
    transport = new MemoryTransport();
    hooks = createMockHooks();
    pipeline = new ProcessingPipeline(
      createTestSchema(),
      new JsonCodec(),
      new StandardRetryPolicy(),
      hooks,
      transport
    );
  });

  it('should process message and complete on success', async () => {
    const envelope = createEnvelope();
    await transport.send('test-queue', envelope);

    const message = await transport.receiveOne('test-queue');
    await pipeline.process(message.body, message.receipt);

    expect(transport.getCompleted()).toHaveLength(1);
    expect(hooks.onWorkerSuccess).toHaveBeenCalled();
  });

  it('should retry failed message with delay', async () => {
    const envelope = createEnvelope();
    await transport.send('test-queue', envelope);

    // Subscriber that always fails
    setSubscriberToFail('test-subscriber');

    const message = await transport.receiveOne('test-queue');
    await pipeline.process(message.body, message.receipt);

    // Original completed, retry enqueued
    expect(transport.getCompleted()).toHaveLength(1);
    expect(transport.getQueueSize('test-queue')).toBe(1);
  });
});
```

#### 3. Integration Tests with Real Backends

```typescript
// Testcontainers for true integration - each transport
describe.each([
  ['RabbitMQ', () => new RabbitMQContainer()],
  ['Redis/BullMQ', () => new RedisContainer()],
  ['Kafka', () => new KafkaContainer()]
])('%s Integration', (name, createContainer) => {
  let container: StartedTestContainer;
  let transport: Transport;

  beforeAll(async () => {
    container = await createContainer().start();
  });

  afterAll(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    // Each transport has its own isolation mechanism
    transport = await createTransportWithIsolation(name, container);
  });

  it('should send and receive messages', async () => {
    const envelope = createEnvelope();
    const received: Envelope[] = [];

    await transport.subscribe('test-queue', async (msg, receipt) => {
      received.push(msg);
      await transport.complete(receipt);
    });

    await transport.send('test-queue', envelope);
    await waitFor(() => received.length === 1);

    expect(received[0].id).toBe(envelope.id);
  });
});
```

---

## Transport Implementations

This section details how each transport maps to the Transport interface.

### RabbitMQ Transport

RabbitMQ is a message broker with exchanges, queues, and bindings.

#### Capabilities

```typescript
const rabbitMQCapabilities: TransportCapabilities = {
  deliveryModes: ['at-least-once', 'at-most-once'], // Both supported via noAck option
  delayedMessages: true,        // With rabbitmq_delayed_message_exchange plugin
  deadLetterRouting: 'native',  // Via DLX (dead-letter exchange)
  attemptTracking: true,        // Via x-delivery-count header (RabbitMQ 3.10+)
  concurrencyModel: 'prefetch', // Channel QoS prefetch count
  ordering: 'none',             // Multiple consumers = no ordering
  priorities: true              // Via x-max-priority queue argument
};
```

#### Mapping to Interface

| Interface Method     | RabbitMQ Implementation                         |
|----------------------|-------------------------------------------------|
| `connect()`          | `amqplib.connect(uri)` + channel creation       |
| `disconnect()`       | Close channels then connection                  |
| `ensureQueue()`      | Assert exchange, queue, and binding             |
| `send()`             | `channel.publish()` with confirms               |
| `subscribe()`        | `channel.consume()` with prefetch               |
| `complete()`         | `channel.ack(message)`                          |
| `sendToDeadLetter()` | `channel.reject(message, false)` (routes to DLX)|

#### Implementation Notes

```typescript
class RabbitMQTransport implements Transport {
  readonly capabilities = rabbitMQCapabilities;

  async send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void> {
    const content = this.codec.encode(envelope);
    const publishOptions: amqplib.Options.Publish = {
      persistent: true,
      messageId: envelope.id,
      contentType: this.codec.contentType,
      headers: {
        'x-matador-attempts': envelope.attempts
      }
    };

    // Handle delayed messages
    if (options?.delay && this.delayedExchangeAvailable) {
      publishOptions.headers['x-delay'] = options.delay;
      await this.publishToDelayedExchange(queue, content, publishOptions);
    } else {
      await this.publishToMainExchange(queue, content, publishOptions);
    }
  }

  async sendToDeadLetter(
    receipt: MessageReceipt,
    dlqName: string,
    envelope: Envelope,
    reason: string
  ): Promise<void> {
    // RabbitMQ routes to DLX automatically on reject
    // We just need to ensure the DLX routing key maps to the right DLQ
    const message = receipt.handle as amqplib.Message;
    this.channel.reject(message, false); // requeue=false triggers DLX
  }
}
```

#### Topology

```
Main Exchange (direct)                    Delayed Exchange (x-delayed-message)
      │                                            │
      ├── routing_key: queue1 ──► Queue 1         │
      ├── routing_key: queue2 ──► Queue 2         ├── routing_key: * ──► Main Exchange
      └── routing_key: queue3 ──► Queue 3         │
                │                                  │
                │ (on reject)                      │
                ▼                                  │
        DLX (topic)                                │
              │                                    │
              ├── #.retry ──► Retry Queue (TTL) ──┘
              ├── #.unhandled ──► Unhandled DLQ
              └── #.undeliverable ──► Undeliverable DLQ
```

---

### BullMQ Transport

BullMQ is a Redis-based job queue with native delay, retry, and job lifecycle tracking.

#### Capabilities

```typescript
const bullMQCapabilities: TransportCapabilities = {
  deliveryModes: ['at-least-once'],  // Job completes after processor returns
  delayedMessages: true,       // Native delay support
  deadLetterRouting: 'manual', // Jobs go to 'failed' state, we move to DLQ
  attemptTracking: true,       // job.attemptsMade property
  concurrencyModel: 'worker',  // Worker concurrency setting
  ordering: 'none',            // FIFO per queue, but multiple workers = no global order
  priorities: true             // Native priority support
};
```

#### Mapping to Interface

| Interface Method     | BullMQ Implementation                            |
|----------------------|--------------------------------------------------|
| `connect()`          | Create Redis connection, initialize Queue/Worker |
| `disconnect()`       | `worker.close()` + `queue.close()`               |
| `ensureQueue()`      | No-op (queues auto-create)                       |
| `send()`             | `queue.add(name, data, opts)`                    |
| `subscribe()`        | `new Worker(queue, processor, opts)`             |
| `complete()`         | Implicit via processor completion                |
| `sendToDeadLetter()` | `job.moveToFailed()` then `dlqQueue.add()`       |

#### Implementation Notes

```typescript
class BullMQTransport implements Transport {
  readonly capabilities = bullMQCapabilities;
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  async send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void> {
    const q = this.getOrCreateQueue(queue);

    await q.add(
      envelope.metadata.eventKey,  // Job name for filtering
      envelope,                    // Job data is the full envelope
      {
        jobId: envelope.id,        // Deduplication by envelope ID
        delay: options?.delay,     // Native delay support
        priority: options?.priority,
        attempts: 1,               // BullMQ manages retries, but we handle at Matador level
        removeOnComplete: true,
        removeOnFail: false        // Keep failed for inspection
      }
    );
  }

  async subscribe(
    queue: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    const worker = new Worker(
      queue,
      async (job: Job<Envelope>) => {
        const receipt: MessageReceipt = {
          handle: job,
          redelivered: job.attemptsMade > 0,
          attemptNumber: job.attemptsMade + 1, // BullMQ is 0-based
          sourceQueue: queue
        };

        // Handler is responsible for calling complete()
        await handler(job.data, receipt);
      },
      {
        connection: this.redis,
        concurrency: options?.concurrency ?? 1
      }
    );

    this.workers.set(queue, worker);

    return {
      unsubscribe: async () => {
        await worker.close();
        this.workers.delete(queue);
      },
      get isActive() { return worker.isRunning(); }
    };
  }

  async complete(receipt: MessageReceipt): Promise<void> {
    // BullMQ auto-completes when the processor function returns
    // This is a no-op - the job is already marked complete
    // If we needed explicit control, we'd use job.moveToCompleted()
  }

  async sendToDeadLetter(
    receipt: MessageReceipt,
    dlqName: string,
    envelope: Envelope,
    reason: string
  ): Promise<void> {
    const job = receipt.handle as Job<Envelope>;

    // Move to failed state with reason
    await job.moveToFailed(new Error(reason), job.token ?? '', false);

    // Send copy to DLQ queue for inspection/replay
    const dlq = this.getOrCreateQueue(`${receipt.sourceQueue}:${dlqName}`);
    await dlq.add('dead-letter', envelope, {
      jobId: `${envelope.id}:dl`,
      removeOnComplete: false,
      removeOnFail: false
    });
  }
}
```

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Redis                                │
│                                                              │
│  Queue: events                    Queue: events:undeliverable│
│  ┌─────────────────────────┐      ┌─────────────────────────┐│
│  │ waiting: [job1, job2]   │      │ waiting: [dlJob1]       ││
│  │ active: [job3]          │      │ active: []              ││
│  │ delayed: [job4 @+5000ms]│      │ failed: []              ││
│  │ completed: []           │      └─────────────────────────┘│
│  │ failed: [job5]          │                                 │
│  └─────────────────────────┘                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
           │                                    ▲
           ▼                                    │
┌─────────────────────────────────────────────────────────────┐
│                    BullMQ Transport                          │
│  ┌─────────────┐                                             │
│  │   Worker    │ ◄── concurrency: 5                          │
│  │  (events)   │                                             │
│  └─────────────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  Processing Pipeline                                         │
│         │                                                    │
│         ├── Success ──► job auto-completes                   │
│         └── Failure ──► sendToDeadLetter() ─────────────────►│
└─────────────────────────────────────────────────────────────┘
```

#### BullMQ-Specific Advantages

1. **Native Delays** - No plugin required, delays stored in Redis sorted set
2. **Job Progress** - Can report progress during long-running jobs
3. **Rate Limiting** - Built-in rate limiter per queue
4. **Job Dependencies** - Jobs can wait for other jobs to complete
5. **Repeatable Jobs** - Cron-like scheduling built-in
6. **Dashboard** - Bull Board provides UI for monitoring

#### BullMQ-Specific Considerations

1. **Redis Dependency** - Requires Redis 5.0+ with Streams support
2. **No Exchanges** - Direct queue addressing only (no fanout at transport level)
3. **Job Size** - Large payloads stored in Redis, watch memory usage
4. **Stalled Jobs** - Workers must heartbeat or jobs become stalled

---

### Kafka Transport

Apache Kafka is a distributed commit log for high-throughput event streaming.

#### Capabilities

```typescript
const kafkaCapabilities: TransportCapabilities = {
  deliveryModes: ['at-least-once', 'at-most-once'], // Via commit timing (after/before processing)
  delayedMessages: false,       // No native support
  deadLetterRouting: 'manual',  // Produce to DLQ topic manually
  attemptTracking: false,       // No native redelivery tracking
  concurrencyModel: 'partition', // Parallelism = partition count
  ordering: 'partition',        // Ordered within partition only
  priorities: false             // No priority support
};
```

#### Mapping to Interface

| Interface Method     | Kafka Implementation                               |
|----------------------|----------------------------------------------------|
| `connect()`          | Create Producer + Consumer, connect to brokers     |
| `disconnect()`       | `consumer.disconnect()` + `producer.disconnect()`  |
| `ensureQueue()`      | `admin.createTopics()` if not exists               |
| `send()`             | `producer.send({ topic, messages })`               |
| `subscribe()`        | `consumer.subscribe()` + `consumer.run()`          |
| `complete()`         | `consumer.commitOffsets()` or auto-commit          |
| `sendToDeadLetter()` | Produce to DLQ topic, then commit original         |

#### Implementation Notes

```typescript
class KafkaTransport implements Transport {
  readonly capabilities = kafkaCapabilities;
  private producer: Producer;
  private consumer: Consumer;
  private admin: Admin;

  async send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void> {
    // Note: 'queue' maps to 'topic' in Kafka
    await this.producer.send({
      topic: queue,
      messages: [{
        key: options?.partitionKey ?? envelope.metadata.correlationId ?? envelope.id,
        value: this.codec.encode(envelope),
        headers: {
          'matador-id': envelope.id,
          'matador-event-key': envelope.metadata.eventKey,
          'matador-attempts': String(envelope.attempts)
        }
      }]
    });

    // Delayed messages: Kafka doesn't support natively
    // Options:
    // 1. Ignore delay (process immediately) - simplest
    // 2. External scheduler republishes at scheduled time
    // 3. Consumer filters by scheduledFor timestamp
    if (options?.delay) {
      console.warn(`Kafka transport ignoring delay of ${options.delay}ms - not supported`);
    }
  }

  async subscribe(
    queue: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    await this.consumer.subscribe({
      topic: queue,
      fromBeginning: options?.fromBeginning ?? false
    });

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const envelope = this.codec.decode(message.value!);

        const receipt: MessageReceipt = {
          handle: { topic, partition, offset: message.offset },
          redelivered: false, // Kafka doesn't track this natively
          attemptNumber: envelope.attempts, // Trust envelope's counter
          sourceQueue: topic
        };

        await handler(envelope, receipt);
      }
    });

    return {
      unsubscribe: async () => {
        await this.consumer.stop();
      },
      get isActive() { return this.consumer.isRunning?.() ?? false; }
    };
  }

  async complete(receipt: MessageReceipt): Promise<void> {
    const { topic, partition, offset } = receipt.handle as KafkaOffset;

    // Commit this offset to mark message as processed
    await this.consumer.commitOffsets([
      { topic, partition, offset: (BigInt(offset) + 1n).toString() }
    ]);
  }

  async sendToDeadLetter(
    receipt: MessageReceipt,
    dlqName: string,
    envelope: Envelope,
    reason: string
  ): Promise<void> {
    const dlqTopic = `${receipt.sourceQueue}.${dlqName}`;

    // Ensure DLQ topic exists
    await this.ensureQueue(dlqTopic);

    // Produce to DLQ
    envelope.metadata.originalQueue = receipt.sourceQueue;
    envelope.metadata.lastError = reason;

    await this.producer.send({
      topic: dlqTopic,
      messages: [{
        key: envelope.id,
        value: this.codec.encode(envelope),
        headers: {
          'matador-dead-letter-reason': reason,
          'matador-original-topic': receipt.sourceQueue
        }
      }]
    });

    // Commit original offset (message is "done" even though it failed)
    await this.complete(receipt);
  }
}
```

#### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Kafka Cluster                                  │
│                                                                          │
│  Topic: events (3 partitions)           Topic: events.undeliverable      │
│  ┌──────────────────────────────────┐   ┌────────────────────────────┐  │
│  │ P0: [m1, m2, m3] offset: 3       │   │ P0: [dl1, dl2]             │  │
│  │ P1: [m4, m5] offset: 2           │   └────────────────────────────┘  │
│  │ P2: [m6, m7, m8, m9] offset: 4   │                                   │
│  └──────────────────────────────────┘                                   │
│           │                                         ▲                    │
│           │                                         │                    │
│  Consumer Group: matador-workers                    │                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Worker 1 ◄── P0              Worker 2 ◄── P1, P2               │    │
│  │      │                             │                             │    │
│  │      ▼                             ▼                             │    │
│  │  Pipeline                      Pipeline                          │    │
│  │      │                             │                             │    │
│  │      ├── commit offset             ├── commit offset             │    │
│  │      └── produce to DLQ ──────────────────────────────────────────►  │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Kafka-Specific Considerations

1. **No Native Delays** - Options for handling `scheduledFor`:
   - **Ignore**: Process immediately (simplest, may be acceptable)
   - **Timestamp Filter**: Consumer checks scheduledFor, re-produces if future
   - **External Scheduler**: Separate service republishes at scheduled time
   - **Retry Topic with TTL**: Use compacted topic with timestamp-based key

2. **No Native Retry** - Matador handles retries:
   - On failure, produce to retry topic
   - Retry topic consumed by same or separate consumer group
   - Must track attempts in envelope (Kafka doesn't track redeliveries)

3. **Partition Strategy**:
   - Use `partitionKey` option to ensure related messages go to same partition
   - Enables ordering within a subscriber's events
   - Default: use envelope ID (random distribution)

4. **Consumer Groups**:
   - Each Matador instance joins same consumer group
   - Kafka auto-balances partitions across instances
   - Max parallelism = number of partitions

5. **Offset Management**:
   - Must commit offsets to mark progress
   - Don't commit = message redelivered on restart/rebalance
   - Auto-commit is risky (may lose messages on crash)

6. **Exactly-Once Considerations**:
   - Kafka supports transactions for produce+commit atomicity
   - Enable with `transactionalId` in producer config
   - Prevents duplicate DLQ writes on retry

#### Delayed Messages Workaround for Kafka

Since Kafka doesn't support delayed messages natively, here's a recommended pattern:

```typescript
class KafkaDelayedMessageHandler {
  constructor(
    private transport: KafkaTransport,
    private scheduler: ExternalScheduler // e.g., BullMQ, pg-boss, or custom
  ) {}

  async send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void> {
    if (options?.delay && options.delay > 0) {
      // Schedule for later republishing
      await this.scheduler.schedule({
        id: envelope.id,
        runAt: new Date(Date.now() + options.delay),
        payload: { queue, envelope }
      });
    } else {
      // Send immediately
      await this.transport.send(queue, envelope);
    }
  }

  // Called by scheduler when delay expires
  async onScheduledTime(job: { queue: string; envelope: Envelope }): Promise<void> {
    await this.transport.send(job.queue, job.envelope);
  }
}
```

---

### Transport Comparison Summary

| Feature                  | RabbitMQ              | BullMQ               | Kafka                     |
|--------------------------|-----------------------|----------------------|---------------------------|
| **Delivery Modes**       | Both                  | At-least-once only   | Both                      |
| **Delayed Messages**     | Plugin required       | Native               | Not supported             |
| **Dead-Letter Routing**  | Native (DLX)          | Manual               | Manual                    |
| **Attempt Tracking**     | Native (3.10+)        | Native               | Manual (envelope)         |
| **Concurrency Model**    | Prefetch              | Worker setting       | Partitions                |
| **Ordering**             | None (multi-consumer) | None (multi-worker)  | Within partition          |
| **Priorities**           | Yes                   | Yes                  | No                        |
| **Persistence**          | Durable queues        | Redis persistence    | Commit log                |
| **Horizontal Scaling**   | Add consumers         | Add workers          | Add partitions            |
| **Best For**             | Traditional queuing   | Redis-first stacks   | High-throughput streaming |

### When to Choose Each Transport

**RabbitMQ** - Choose when:
- You need sophisticated routing (exchanges, bindings)
- Message priorities are important
- You want native dead-letter handling
- You need plugin ecosystem (delayed messages, shovel, federation)

**BullMQ** - Choose when:
- You already have Redis in your stack
- You want native delays without plugins
- Job progress tracking is useful
- You prefer simpler queue semantics (no exchanges)
- Dashboard/UI is important (Bull Board)

**Kafka** - Choose when:
- You need very high throughput (millions/sec)
- Message replay/reprocessing is required
- Ordering within a key/partition matters
- You're building event sourcing or streaming pipelines
- You need long-term message retention

---

## Migration Strategy

### Phase 1: Extract Generic Logic

1. Extract retry policy from RabbitMQ backend
2. Extract dead-letter strategy
3. Extract processing pipeline
4. Create Codec interface and JsonCodec

### Phase 2: Define Transport Interface

1. Define minimal Transport interface
2. Implement MemoryTransport for testing
3. Implement RabbitMQTransport wrapping existing connection logic

### Phase 3: Rebuild Core

1. New Matador class using Transport + Pipeline
2. Migrate hook system with cleaner contracts
3. New test suite using layered approach

### Phase 4: Compatibility Layer

1. Create v1-compatible API wrapper
2. Deprecation warnings for v1 patterns
3. Migration guide documentation

---

## Design Decisions

Answers to key design questions for v2:

### 1. Before/After State in Events

**Decision:** Keep support for `before` state in events.

**Rationale:** Necessary for change-type events where you want to dispatch an event showing what changed. The `before` property contains the previous state (same type as `data`). This is optional per-event.

```typescript
interface Envelope {
  payload: {
    data: T;           // Current/after state
    before?: T;        // Previous state (optional, same type as data)
  };
  // ...
}
```

### 2. SubscriberStub Pattern

**Decision:** Keep SubscriberStub.

**Rationale:** Matador is designed for monorepos with shared MatadorSchema code. However, SubscriberStub supports scenarios with separate codebases where you need to declare a subscriber whose implementation lives in a remote service. The stub describes the subscriber contract without providing the callback.

### 3. External Queue References

**Decision:** Keep exact queue bindings.

**Rationale:** Allows Matador to work with pre-existing queues not created by Matador. Useful when integrating with existing infrastructure or queues managed by other systems.

### 4. Event Aliases (legacyName)

**Decision:** Keep, rename to `aliases`.

**Rationale:** Provides multiple names for the same event, useful for:
- Backwards compatibility during event renames
- Supporting multiple routing keys for the same event
- Migration scenarios

### 5. Importance Levels

**Decision:** Keep all three levels (`can-ignore`, `should-investigate`, `must-investigate`).

**Rationale:** All levels are actively used for alerting and monitoring prioritization.

### 6. Per-Subscriber Backend Selection

**Decision:** Remove `preferredBackend`.

**Rationale:** Not used in practice. Transport selection should be a deployment concern, not a per-subscriber concern.

### 7. Fallback Disabled Flag

**Decision:** Remove `fallbackDisabled`.

**Rationale:** The fallback model has changed to support queue chains. Per-subscriber fallback disabling is no longer needed.

---

## Next Steps

1. **Finalize Transport Interface** - Agree on minimal transport contract
2. **Prototype MemoryTransport** - Build reference implementation for testing
3. **Define Topology Schema** - Finalize the generic topology structure
4. **Write Test Architecture** - Establish testing patterns before implementation
5. **Begin Extraction** - Start with retry policy as first extracted module
6. **Implement RabbitMQ Transport** - Port existing RabbitMQ backend to new interface
