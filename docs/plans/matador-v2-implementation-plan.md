# Matador v2 Implementation Plan

This document outlines the implementation plan for building Matador v2 from scratch in a new directory.

## Overview

**Location:** `@meetsmore/matador-v2` (new package, separate from existing `@meetsmore/matador`)

**Approach:** Ground-up implementation following the v2 proposal architecture. No code will be copied from v1; all components will be written fresh based on the design specifications.

**Goal:** Create a transport-agnostic event processing library with clean abstractions, comprehensive testing, and pluggable components.

---

## Phase 0: Project Setup

### 0.1 Initialize Package

- [ ] Create `@meetsmore/matador-v2` directory
- [ ] Initialize `package.json` with appropriate metadata
- [ ] Configure TypeScript (`tsconfig.json`) with strict mode
- [ ] Configure Biome for formatting/linting
- [ ] Configure Jest for testing
- [ ] Set up directory structure:

```
matador-v2/
├── src/
│   ├── core/           # Core Matador orchestration
│   ├── transport/      # Transport interface and implementations
│   ├── pipeline/       # Processing pipeline
│   ├── topology/       # Topology definitions
│   ├── schema/         # Schema management
│   ├── codec/          # Serialization codecs
│   ├── retry/          # Retry policies
│   ├── hooks/          # Hook system
│   ├── errors/         # Error classes
│   ├── types/          # Shared type definitions
│   └── index.ts        # Public API exports
├── test/
│   ├── unit/           # Pure unit tests
│   ├── integration/    # Tests with MemoryTransport
│   └── e2e/            # Tests with real transports (Testcontainers)
└── package.json
```

### 0.2 Define Core Types

- [ ] Create `src/types/envelope.ts` - Envelope and EnvelopeMetadata interfaces
- [ ] Create `src/types/event.ts` - Event base class and related types
- [ ] Create `src/types/subscriber.ts` - Subscriber and SubscriberStub types
- [ ] Create `src/types/common.ts` - DeliveryMode, Importance, Idempotency types

**Acceptance Criteria:**
- All core types compile with strict TypeScript
- Types are exported from package index
- JSDoc documentation on all public types

---

## Phase 1: Transport Layer

Build the transport abstraction layer first, as all other components depend on it.

### 1.1 Transport Interface

**File:** `src/transport/transport.ts`

Define the Transport interface:
- `name: string`
- `capabilities: TransportCapabilities`
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `isConnected(): boolean`
- `applyTopology(topology: Topology): Promise<void>`
- `send(queue: string, envelope: Envelope, options?: SendOptions): Promise<void>`
- `subscribe(queue: string, handler: MessageHandler, options?: SubscribeOptions): Promise<Subscription>`
- `complete(receipt: MessageReceipt): Promise<void>`

**File:** `src/transport/capabilities.ts`

Define TransportCapabilities:
- `deliveryModes: DeliveryMode[]`
- `delayedMessages: boolean`
- `deadLetterRouting: 'native' | 'manual' | 'none'`
- `attemptTracking: boolean`
- `concurrencyModel: 'prefetch' | 'worker' | 'partition' | 'none'`
- `ordering: 'none' | 'queue' | 'partition'`
- `priorities: boolean`

**Acceptance Criteria:**
- Interface compiles and is exported
- All methods have JSDoc documentation
- Supporting types (SendOptions, SubscribeOptions, MessageReceipt, Subscription) defined

### 1.2 Connection Manager

**File:** `src/transport/connection-manager.ts`

Implement ConnectionManager class:
- State machine: disconnected → connecting → connected → reconnecting → failed
- Exponential backoff for reconnection
- Configurable retry limits and delays
- State change callbacks
- Heartbeat monitoring (optional, transport-specific)

**Acceptance Criteria:**
- Unit tests for state transitions
- Unit tests for backoff calculation
- Tests for max retry behavior

### 1.3 Memory Transport

**File:** `src/transport/memory/memory-transport.ts`

Implement MemoryTransport for testing:
- In-memory queue storage (Map<string, Envelope[]>)
- Synchronous message delivery
- Basic subscription management
- No persistence
- Supports both delivery modes
- Simple topology application (just stores config)

**Capabilities:**
```typescript
{
  deliveryModes: ['at-least-once', 'at-most-once'],
  delayedMessages: false,  // Could implement with setTimeout
  deadLetterRouting: 'manual',
  attemptTracking: false,
  concurrencyModel: 'none',
  ordering: 'queue',
  priorities: false
}
```

**Acceptance Criteria:**
- Can send and receive messages
- Can complete messages
- Subscriptions can be cancelled
- Messages are isolated between queues
- Full test coverage

---

## Phase 2: Topology

### 2.1 Topology Types

**File:** `src/topology/types.ts`

Define topology interfaces:
- `Topology` - namespace, queues, deadLetter, retry config
- `QueueDefinition` - name, concurrency, timeout, priorities
- `DeadLetterConfig` - unhandled, undeliverable settings
- `RetryConfig` - enabled, delays

### 2.2 Topology Builder

**File:** `src/topology/builder.ts`

Implement TopologyBuilder for fluent topology construction:
- `withNamespace(name: string)`
- `addQueue(name: string, options?: QueueOptions)`
- `withDeadLetter(config: DeadLetterConfig)`
- `withRetry(config: RetryConfig)`
- `build(): Topology`

Implement validation:
- Namespace required
- At least one queue
- Valid queue names (no special characters)

**Acceptance Criteria:**
- Builder produces valid Topology objects
- Validation errors are descriptive
- Immutable topology output

---

## Phase 3: Codec Layer

### 3.1 Codec Interface

**File:** `src/codec/codec.ts`

Define Codec interface:
- `encode(envelope: Envelope): Buffer`
- `decode(buffer: Buffer): Envelope`
- `contentType: string`

### 3.2 JSON Codec

**File:** `src/codec/json-codec.ts`

Implement JsonCodec:
- JSON.stringify for encoding
- JSON.parse for decoding
- Date serialization handling
- Content-Type: `application/json`

**Acceptance Criteria:**
- Round-trip encoding/decoding preserves data
- Handles Date objects correctly
- Throws descriptive errors on invalid input
- Handles empty buffer gracefully

---

## Phase 4: Schema Layer

### 4.1 Schema Types

**File:** `src/schema/types.ts`

Define schema types:
- `MatadorSchema` - map of event key to [EventClass, Subscriber[]]
- Event class requirements (static key, description, data type)
- Subscriber requirements (name, callback, options)

### 4.2 Schema Registry

**File:** `src/schema/registry.ts`

Implement SchemaRegistry:
- `register(eventClass, subscribers[])`
- `getEventClass(key: string): EventClass | undefined`
- `getSubscribers(key: string): Subscriber[]`
- `getSubscriber(eventKey: string, subscriberName: string): Subscriber | undefined`
- `getEventByAlias(alias: string): EventClass | undefined`
- `validate(): ValidationResult` - check for issues

**Acceptance Criteria:**
- Can register and retrieve events
- Can retrieve subscribers by event
- Alias lookup works
- Validation catches duplicate keys

---

## Phase 5: Retry Policy

### 5.1 Retry Policy Interface

**File:** `src/retry/policy.ts`

Define RetryPolicy interface:
- `shouldRetry(context: RetryContext): RetryDecision`
- `getDelay(context: RetryContext): number`

Define RetryContext and RetryDecision types.

### 5.2 Standard Retry Policy

**File:** `src/retry/standard-policy.ts`

Implement StandardRetryPolicy:
- Check for DoRetry/DontRetry error types
- Check max attempts
- Check idempotency on redelivery
- Exponential backoff calculation
- Configurable: maxAttempts, baseDelay, maxDelay, backoffMultiplier

**Acceptance Criteria:**
- Pure functions, no side effects
- 100% unit test coverage
- All decision paths tested
- Backoff calculation correct

### 5.3 Error Classes

**File:** `src/errors/retry-errors.ts`

Implement error classes:
- `DoRetry` - force retry
- `DontRetry` - never retry
- `EventAssertionError` - assertion failure, never retry

---

## Phase 6: Hook System

### 6.1 Hook Types

**File:** `src/hooks/types.ts`

Define hook interfaces:
- `onEnqueueSuccess(envelope, queue)`
- `onEnqueueWarning(envelope, queue, fallbackQueue)`
- `onEnqueueError(envelope, error)`
- `onWorkerWrap(envelope, subscriber, execute)` - wrapper for APM
- `onWorkerBeforeProcess(envelope, subscriber)`
- `onWorkerSuccess(envelope, subscriber, result, durationMs)`
- `onWorkerError(envelope, subscriber, error, durationMs, decision)`
- `onDecodeError(error, receipt)`
- `onConnectionStateChange(state)`

### 6.2 Safe Hooks Wrapper

**File:** `src/hooks/safe-hooks.ts`

Implement SafeHooks:
- Wraps all hooks in try-catch
- Provides sensible defaults for missing hooks
- Logs errors from hooks without breaking processing

**Acceptance Criteria:**
- Hook errors don't propagate
- Missing hooks use no-op defaults
- All hooks are optional

---

## Phase 7: Processing Pipeline

### 7.1 Pipeline Implementation

**File:** `src/pipeline/pipeline.ts`

Implement ProcessingPipeline:

```
Input: (rawMessage: Buffer, receipt: MessageReceipt)

1. Decode envelope using Codec
   - On failure: complete message, call onDecodeError, return

2. Lookup subscriber from Schema
   - On failure: send to unhandled DLQ, return

3. Validate payload (if validator configured)
   - On failure: send to undeliverable DLQ, return

4. Execute subscriber callback
   - Wrap in onWorkerWrap hook
   - Call onWorkerBeforeProcess
   - Measure duration
   - Catch errors

5. Handle result
   - Success: complete message, call onWorkerSuccess
   - Failure: consult RetryPolicy
     - Retry: increment attempts, send with delay, complete original
     - Dead-letter: send to DLQ, complete original
     - Discard: complete original

6. Call onWorkerError if failed
```

**Acceptance Criteria:**
- All paths have test coverage
- Hooks called at correct points
- Duration measurement accurate
- Error information preserved in envelope

### 7.2 Payload Validator

**File:** `src/pipeline/validator.ts`

Implement PayloadValidator interface:
- `validate(payload: unknown, eventClass: EventClass): ValidationResult`

Implement ZodValidator (optional, peer dependency):
- Uses Zod schema from event class if present

**Acceptance Criteria:**
- Invalid payloads rejected with clear errors
- Validation is optional (graceful when no schema)

---

## Phase 8: Fanout Engine

### 8.1 Fanout Implementation

**File:** `src/core/fanout.ts`

Implement FanoutEngine:

```
Input: Event instance

1. Get event key from event class
2. Get subscribers from schema
3. Filter by enabled() hook
4. For each enabled subscriber:
   - Create envelope with:
     - Unique ID
     - Event data as payload
     - Metadata (eventKey, targetSubscriber, correlationId, etc.)
     - before state if present
   - Determine target queue
   - Send via transport

5. Handle failures:
   - Try fallback queue chain if configured
   - Call appropriate hooks
```

**Acceptance Criteria:**
- Creates correct number of envelopes
- Each envelope has unique ID
- Subscriber filtering works
- Fallback chain executed on failure

---

## Phase 9: Shutdown Manager

### 9.1 Shutdown Implementation

**File:** `src/core/shutdown.ts`

Implement ShutdownManager:

```
Graceful shutdown sequence:
1. Stop receiving new messages (unsubscribe all)
2. Wait for in-flight processing to complete
   - Poll eventsBeingProcessed counter
   - Respect gracefulShutdownTimeout
3. Stop accepting new enqueue requests
4. Disconnect transport
```

State tracking:
- `eventsBeingEnqueuedCount: number`
- `eventsBeingProcessed: Map<string, number>` (by subscriber)

**Acceptance Criteria:**
- Graceful shutdown completes in-flight work
- Timeout forces shutdown
- State counters accurate

---

## Phase 10: Core Matador Class

### 10.1 Matador Implementation

**File:** `src/core/matador.ts`

Implement Matador class - the main orchestrator:

```typescript
class Matador {
  constructor(config: MatadorConfig)

  // Lifecycle
  start(): Promise<void>
  shutdown(): Promise<void>

  // Publishing
  dispatch(event: Event): Promise<void>

  // State
  getHandlersState(): HandlersState
  isIdle(): boolean
}
```

Wiring:
- Create transport from config
- Create topology and apply to transport
- Create pipeline with codec, retry policy, hooks
- Create fanout engine
- Create shutdown manager
- Subscribe to queues specified in `consumeFrom`

**Acceptance Criteria:**
- Full lifecycle works (start → dispatch → shutdown)
- All components properly wired
- Configuration validated on construction

---

## Phase 11: RabbitMQ Transport

### 11.1 RabbitMQ Implementation

**File:** `src/transport/rabbitmq/rabbitmq-transport.ts`

Implement RabbitMQTransport:

**Capabilities:**
```typescript
{
  deliveryModes: ['at-least-once', 'at-most-once'],
  delayedMessages: true,  // With plugin detection
  deadLetterRouting: 'native',
  attemptTracking: true,
  concurrencyModel: 'prefetch',
  ordering: 'none',
  priorities: true
}
```

**applyTopology:**
- Create main exchange (direct)
- Create queues with bindings
- Create DLX and DLQ topology
- Create delayed message exchange (if plugin available)
- Configure quorum queues

**Connection:**
- Use amqplib
- Integrate ConnectionManager for reconnection
- Per-queue channels for concurrency control

**Acceptance Criteria:**
- Integration tests with Testcontainers
- Topology created correctly
- Messages flow end-to-end
- Reconnection works
- Delayed messages work (with plugin)

---

## Phase 12: Integration Testing

### 12.1 Transport Compliance Suite

**File:** `test/transport-compliance.ts`

Create shared test suite that all transports must pass:
- `can connect and disconnect`
- `can send and receive messages`
- `can complete messages`
- `respects subscription cancellation`
- `applies topology without error`
- `reports capabilities correctly`

### 12.2 End-to-End Tests

**File:** `test/e2e/matador.e2e.test.ts`

Full integration tests:
- Dispatch event → subscriber receives → completes
- Failed subscriber → retry → succeeds
- Failed subscriber → max attempts → DLQ
- Graceful shutdown with in-flight work
- Multiple queues with routing

---

## Phase 13: Documentation

### 13.1 API Documentation

- JSDoc on all public APIs
- Generate API docs with TypeDoc

### 13.2 Usage Guide

- Getting started
- Configuration reference
- Transport selection guide
- Migration from v1

---

## Implementation Order & Dependencies

```
Phase 0: Setup
    │
    ▼
Phase 1: Transport ──────────────────┐
    │                                 │
    ▼                                 │
Phase 2: Topology                     │
    │                                 │
    ▼                                 │
Phase 3: Codec                        │
    │                                 │
    ▼                                 │
Phase 4: Schema                       │
    │                                 │
    ▼                                 │
Phase 5: Retry ◄─────────────────────┤
    │                                 │
    ▼                                 │
Phase 6: Hooks                        │
    │                                 │
    ▼                                 │
Phase 7: Pipeline ◄───────────────────┤ (depends on all above)
    │                                 │
    ▼                                 │
Phase 8: Fanout ◄─────────────────────┤
    │                                 │
    ▼                                 │
Phase 9: Shutdown                     │
    │                                 │
    ▼                                 │
Phase 10: Matador Core ◄──────────────┘ (wires everything)
    │
    ▼
Phase 11: RabbitMQ Transport
    │
    ▼
Phase 12: Integration Testing
    │
    ▼
Phase 13: Documentation
```

---

## Testing Strategy

### Unit Tests (Phase 1-10)

Each component should have unit tests that:
- Test all public methods
- Test edge cases
- Test error conditions
- Use no external dependencies (mocks or MemoryTransport only)

### Integration Tests (Phase 11-12)

- Use Testcontainers for real RabbitMQ
- Test full message flow
- Test failure scenarios
- Test reconnection

### Test Isolation

- Each test file creates fresh instances
- No shared state between tests
- MemoryTransport clears between tests
- Testcontainers use unique vhosts/prefixes

---

## Definition of Done

A phase is complete when:

1. **Code complete** - All specified functionality implemented
2. **Types complete** - Full TypeScript types with strict mode passing
3. **Tests passing** - All unit tests pass with >90% coverage
4. **Documented** - JSDoc on public APIs
5. **Reviewed** - Code review completed
6. **Integrated** - Works with components from previous phases

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Transport abstraction too leaky | Build MemoryTransport first, validate interface before RabbitMQ |
| Performance regression from v1 | Benchmark critical paths, compare with v1 |
| Breaking changes for consumers | Create v1 compatibility layer in Phase 13 if needed |
| Complex topology translation | Start simple, iterate based on real transport needs |

---

## Success Criteria

Matador v2 is successful when:

1. **Functional parity** - All v1 features (per audit) work in v2
2. **Transport agnostic** - RabbitMQ transport works without RabbitMQ-specific code in core
3. **Testable** - Core components testable without mocks using MemoryTransport
4. **Documented** - Complete API docs and migration guide
5. **Performant** - No significant regression from v1 in message throughput
