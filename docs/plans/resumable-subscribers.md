# Resumable Subscribers Implementation Plan

## Problem Statement

When a subscriber fails partway through execution (e.g., after calling an external API but before completing), retrying the message re-executes all operations from the beginning. This can cause:

- Duplicate side effects (double charges, duplicate emails, etc.)
- Wasted compute on operations that already succeeded
- Complex manual idempotency handling in every subscriber

## Proposed Solution

Provide subscribers with an `io` function that:
1. Wraps side-effectful operations in a cacheable lambda
2. Caches successful results keyed by an explicit developer-provided key
3. On retry, returns cached values instead of re-executing

This pattern is inspired by workflow engines like Temporal/Cadence, adapted for Matador's event-driven model.

## API Design

### Idempotency Integration

A resumable subscriber is inherently idempotent because the `io()` caching mechanism prevents duplicate side effects on retry. We extend the existing `Idempotency` type:

```typescript
// Current
type Idempotency = 'yes' | 'no' | 'unknown';

// Proposed
type Idempotency = 'yes' | 'no' | 'unknown' | 'resumable';
```

**Semantics:**

| Value       | Meaning                                                                 | Retry Behavior                          |
|-------------|-------------------------------------------------------------------------|----------------------------------------|
| `'yes'`     | Subscriber is manually idempotent (safe to retry)                       | Retries allowed                        |
| `'no'`      | Subscriber is NOT idempotent (unsafe to retry)                          | Dead-letter on redelivery              |
| `'unknown'` | Idempotency not determined                                              | Retries allowed (default)              |
| `'resumable'` | Subscriber uses `io()` for checkpointed idempotency                   | Retries allowed, checkpoint loaded     |

**Why `'resumable'` is distinct from `'yes'`:**

- `'yes'` means the subscriber code is inherently idempotent (e.g., upserts, idempotency keys)
- `'resumable'` means idempotency is achieved through the checkpoint system
- This distinction enables:
  - Validation: Matador can warn if `idempotent: 'resumable'` but no `checkpointStore` configured
  - Observability: Differentiate between native idempotency and checkpoint-based idempotency in metrics
  - Future optimization: Skip checkpoint loading for `'yes'` subscribers

### Compile-Time Enforcement via Discriminated Union

We use a discriminated union on the subscriber options to enforce at compile time that:
- `idempotent: 'resumable'` **requires** a callback with `SubscriberContext`
- Other idempotency values **cannot** have a callback with `SubscriberContext`

```typescript
/**
 * Context provided to resumable subscriber callbacks.
 */
interface SubscriberContext {
  /**
   * Wraps a side-effectful operation for caching/replay.
   * On first execution: runs the lambda and caches the result.
   * On retry: returns cached result without re-executing.
   *
   * @param key - Unique identifier for this operation within this subscriber.
   *              Must be stable across retries. Use descriptive names like
   *              'fetch-user', 'send-email', 'charge-payment'.
   * @param fn - The side-effectful operation to execute
   * @returns The result of fn (or cached result on retry)
   */
  io<T extends JsonSerializable>(key: string, fn: () => Promise<T> | T): Promise<T>;

  /**
   * Execute multiple io() operations in parallel.
   * Each operation requires its own unique key.
   *
   * @param ops - Array of [key, fn] tuples to execute in parallel
   * @returns Array of results in the same order as input
   */
  all<T extends readonly [string, () => Promise<JsonSerializable> | JsonSerializable][]>(
    ops: T
  ): Promise<{ [K in keyof T]: T[K] extends [string, () => Promise<infer R> | infer R] ? R : never }>;

  /** Current attempt number (1-based) */
  attempt: number;

  /** Whether this is a retry (attempt > 1) */
  isRetry: boolean;
}

/**
 * Type constraint ensuring values can be JSON serialized.
 */
type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

/**
 * Callback for standard (non-resumable) subscribers.
 */
type StandardCallback<T> = (envelope: Envelope<T>) => Promise<void> | void;

/**
 * Callback for resumable subscribers - receives SubscriberContext with io().
 */
type ResumableCallback<T> = (
  envelope: Envelope<T>,
  context: SubscriberContext
) => Promise<void> | void;

/**
 * Discriminated union ensuring idempotent: 'resumable' pairs with ResumableCallback.
 */
type SubscriberOptions<T extends MatadorEvent> =
  | {
      readonly name: string;
      readonly idempotent?: 'yes' | 'no' | 'unknown';  // Optional, defaults to 'unknown'
      readonly callback: StandardCallback<T['data']>;
      readonly importance?: Importance;
      readonly targetQueue?: string;
      readonly enabled?: () => boolean | Promise<boolean>;
    }
  | {
      readonly name: string;
      readonly idempotent: 'resumable';  // Required, must be 'resumable'
      readonly callback: ResumableCallback<T['data']>;
      readonly importance?: Importance;
      readonly targetQueue?: string;
      readonly enabled?: () => boolean | Promise<boolean>;
    };

/**
 * Single createSubscriber function handles both cases.
 */
function createSubscriber<T extends MatadorEvent>(
  options: SubscriberOptions<T>
): Subscriber<T>;
```

### Compile-Time Examples

```typescript
// ✅ GOOD: Standard subscriber without context
createSubscriber<MyEvent>({
  name: 'standard',
  idempotent: 'yes',
  callback: async (envelope) => {
    // No io() available - correct!
  }
});

// ✅ GOOD: Resumable subscriber with context
createSubscriber<MyEvent>({
  name: 'resumable',
  idempotent: 'resumable',
  callback: async (envelope, { io }) => {
    await io('do-something', () => doSomething());
  }
});

// ❌ COMPILE ERROR: 'resumable' requires context parameter
createSubscriber<MyEvent>({
  name: 'broken',
  idempotent: 'resumable',
  callback: async (envelope) => {  // Error: missing context parameter
    // ...
  }
});

// ❌ COMPILE ERROR: Non-resumable cannot have context parameter
createSubscriber<MyEvent>({
  name: 'broken',
  idempotent: 'yes',
  callback: async (envelope, { io }) => {  // Error: unexpected context parameter
    // ...
  }
});

// ❌ COMPILE ERROR: Cannot use io() without 'resumable'
createSubscriber<MyEvent>({
  name: 'broken',
  // idempotent defaults to 'unknown'
  callback: async (envelope, context) => {  // Error: context not available
    await context.io('key', () => doSomething());
  }
});
```

This ensures that **you cannot use `io()` without `idempotent: 'resumable'`** - the type system enforces it.

### Usage Example

```typescript
const sendWelcomeEmail = createSubscriber<UserCreatedEvent>({
  name: 'send-welcome-email',
  idempotent: 'resumable',  // Idempotency via checkpoint system

  async callback(envelope, { io, all }) {
    const { userId, email } = envelope.data;

    // Fetch user preferences (cached on retry)
    const prefs = await io('fetch-prefs', async () => {
      return await userService.getPreferences(userId);
    });

    // Generate email content (cached on retry)
    const emailContent = await io('generate-email', async () => {
      return await templateService.render('welcome', { prefs });
    });

    // Send email (cached on retry)
    const sendResult = await io('send-email', async () => {
      return await emailService.send(email, emailContent);
    });

    // Record analytics (cached on retry)
    await io('record-analytics', async () => {
      await analytics.track('welcome_email_sent', { userId, messageId: sendResult.id });
    });
  }
});
```

### Parallel Execution Example

```typescript
const enrichUserData = createSubscriber<UserCreatedEvent>({
  name: 'enrich-user-data',
  idempotent: 'resumable',

  async callback(envelope, { io, all }) {
    const { userId } = envelope.data;

    // Fetch multiple data sources in parallel (each with unique key)
    const [profile, preferences, history] = await all([
      ['fetch-profile', async () => await profileService.get(userId)],
      ['fetch-prefs', async () => await prefsService.get(userId)],
      ['fetch-history', async () => await historyService.get(userId)],
    ]);

    // Use enriched data
    await io('process-enrichment', async () => {
      await enrichmentService.process({ profile, preferences, history });
    });
  }
});
```

If the subscriber crashes after 'generate-email' but before 'send-email':
- On retry, 'fetch-prefs' and 'generate-email' return cached values instantly
- 'send-email' executes fresh (no cache entry exists)

## Explicit Keys

Each `io()` call requires an explicit key that uniquely identifies the operation within the subscriber. This design choice provides important safety guarantees.

### Why Explicit Keys?

Explicit keys make resumable subscribers **resilient to code changes**:

```typescript
// Version 1 (first attempt):
await io('fetch-user', () => fetchUser());
await io('send-email', () => sendEmail());
// crash here

// Version 2 deployed (new io inserted), retry:
await io('fetch-user', () => fetchUser());     // cache HIT ✓
await io('log-audit', () => logAudit());       // cache MISS, executes (new key)
await io('send-email', () => sendEmail());     // cache HIT ✓ (same key!)
```

With auto-generated keys (call order), inserting a new `io()` would shift all subsequent keys and cause cache misalignment. Explicit keys avoid this entirely.

### Key Requirements

1. **Unique within subscriber** - No two `io()` calls can have the same key
2. **Stable across retries** - The key for an operation must not change
3. **Descriptive** - Use meaningful names for debugging: `'fetch-user'`, `'send-email'`, `'charge-payment'`

### Runtime Validation

Duplicate keys are detected at runtime and throw an error:

```typescript
await io('fetch-user', () => fetchUser());
await io('fetch-user', () => fetchPrefs());  // Error: Duplicate io key 'fetch-user'
```

### Flexibility with Explicit Keys

Explicit keys allow patterns that auto-generated keys cannot support:

```typescript
// ✅ Conditional io() calls - safe!
if (envelope.data.sendEmail) {
  await io('send-email', () => sendEmail());
}

// ✅ Dynamic loops - safe with unique keys!
for (const item of envelope.data.items) {
  await io(`process-item-${item.id}`, () => processItem(item));
}

// ✅ Reordering code - safe!
// Moving io() calls around doesn't break existing checkpoints
```

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Matador Core                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐      ┌──────────────────────────────────┐  │
│  │ ProcessingPipeline│ ──→ │ ResumableContext                 │  │
│  │                 │      │                                  │  │
│  │ - process()     │      │ - io(key, fn): Promise<T>        │  │
│  │ - executeCallback│      │ - all(ops): Promise<T[]>         │  │
│  │                 │      │ - loadCheckpoint()               │  │
│  └─────────────────┘      │ - saveCheckpoint()               │  │
│           │               │ - clearCheckpoint()              │  │
│           │               └──────────────┬───────────────────┘  │
│           │                              │                      │
│           │                              ▼                      │
│           │               ┌──────────────────────────────────┐  │
│           │               │ CheckpointStore (Interface)      │  │
│           │               │                                  │  │
│           │               │ - get(envelopeId): Checkpoint    │  │
│           │               │ - set(envelopeId, checkpoint)    │  │
│           │               │ - delete(envelopeId)             │  │
│           │               └──────────────────────────────────┘  │
│           │                              │                      │
│           │               ┌──────────────┴──────────────┐       │
│           │               ▼                             ▼       │
│           │         ┌──────────┐                 ┌───────────┐  │
│           │         │ Memory   │                 │ Redis     │  │
│           │         │ Store    │                 │ Store     │  │
│           │         └──────────┘                 └───────────┘  │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Subscriber Callback                                         ││
│  │                                                             ││
│  │  callback(envelope, { io, all, attempt, isRetry })          ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Checkpoint Data Structure

```typescript
interface Checkpoint {
  envelopeId: string;
  subscriberName: string;
  completedSteps: Record<string, JsonSerializable>;  // key -> cached value
}
```

The structure is intentionally minimal:
- `envelopeId` - identifies which message this checkpoint belongs to
- `subscriberName` - identifies which subscriber (for debugging/admin)
- `completedSteps` - map of step keys to their cached results

### CheckpointStore Interface

```typescript
interface CheckpointStore {
  /**
   * Retrieve checkpoint for an envelope
   */
  get(envelopeId: string): Promise<Checkpoint | undefined>;

  /**
   * Save/update checkpoint
   */
  set(envelopeId: string, checkpoint: Checkpoint): Promise<void>;

  /**
   * Delete checkpoint (on success or dead-letter)
   */
  delete(envelopeId: string): Promise<void>;

  /**
   * Optional: TTL-based cleanup for orphaned checkpoints
   */
  cleanup?(olderThan: Date): Promise<number>;
}
```

### Implementations

#### 1. MemoryCheckpointStore (Default, for testing)

```typescript
class MemoryCheckpointStore implements CheckpointStore {
  private checkpoints = new Map<string, Checkpoint>();

  async get(envelopeId: string): Promise<Checkpoint | undefined> {
    return this.checkpoints.get(envelopeId);
  }

  async set(envelopeId: string, checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(envelopeId, checkpoint);
  }

  async delete(envelopeId: string): Promise<void> {
    this.checkpoints.delete(envelopeId);
  }
}
```

#### 2. RedisCheckpointStore (Production)

```typescript
class RedisCheckpointStore implements CheckpointStore {
  constructor(private redis: Redis, private options: {
    prefix?: string;        // Key prefix, default: 'matador:checkpoint:'
    ttlSeconds?: number;    // TTL for cleanup, default: 86400 (24h)
  }) {}

  async get(envelopeId: string): Promise<Checkpoint | undefined> {
    const data = await this.redis.get(this.key(envelopeId));
    return data ? JSON.parse(data) : undefined;
  }

  async set(envelopeId: string, checkpoint: Checkpoint): Promise<void> {
    await this.redis.set(
      this.key(envelopeId),
      JSON.stringify(checkpoint),
      'EX', this.options.ttlSeconds
    );
  }

  async delete(envelopeId: string): Promise<void> {
    await this.redis.del(this.key(envelopeId));
  }

  private key(envelopeId: string): string {
    return `${this.options.prefix}${envelopeId}`;
  }
}
```

## Implementation Details

### ResumableContext Class

```typescript
class ResumableContext implements SubscriberContext {
  private checkpoint: Checkpoint;
  private usedKeys = new Set<string>();

  constructor(
    private store: CheckpointStore,
    private envelope: Envelope,
    private subscriberName: string,
    existingCheckpoint?: Checkpoint
  ) {
    this.checkpoint = existingCheckpoint ?? {
      envelopeId: envelope.id,
      subscriberName,
      completedSteps: {},
    };
  }

  get attempt(): number {
    return this.envelope.docket.attempts;
  }

  get isRetry(): boolean {
    return this.attempt > 1;
  }

  async io<T extends JsonSerializable>(key: string, fn: () => Promise<T> | T): Promise<T> {
    // Validate key uniqueness within this execution
    if (this.usedKeys.has(key)) {
      throw new DuplicateIoKeyError(key, this.subscriberName);
    }
    this.usedKeys.add(key);

    // Check cache first
    if (key in this.checkpoint.completedSteps) {
      return this.checkpoint.completedSteps[key] as T;
    }

    // Execute the function - errors propagate, no caching on failure
    const result = await fn();

    // Cache the result
    this.checkpoint.completedSteps[key] = result;

    // Persist checkpoint immediately (incremental persistence)
    await this.store.set(this.envelope.id, this.checkpoint);

    return result;
  }

  async all<T extends readonly [string, () => Promise<JsonSerializable> | JsonSerializable][]>(
    ops: T
  ): Promise<{ [K in keyof T]: T[K] extends [string, () => Promise<infer R> | infer R] ? R : never }> {
    // Validate all keys are unique
    for (const [key] of ops) {
      if (this.usedKeys.has(key)) {
        throw new DuplicateIoKeyError(key, this.subscriberName);
      }
      this.usedKeys.add(key);
    }

    const results = await Promise.all(
      ops.map(async ([key, fn]) => {
        // Check cache first
        if (key in this.checkpoint.completedSteps) {
          return this.checkpoint.completedSteps[key];
        }

        // Execute - errors propagate
        const result = await fn();

        // Cache individually
        this.checkpoint.completedSteps[key] = result;

        return result;
      })
    );

    // Persist after all parallel operations complete
    await this.store.set(this.envelope.id, this.checkpoint);

    return results as { [K in keyof T]: T[K] extends [string, () => Promise<infer R> | infer R] ? R : never };
  }

  async clear(): Promise<void> {
    await this.store.delete(this.envelope.id);
  }
}
```

### Pipeline Integration

Modify `ProcessingPipeline.executeCallback()` to create and manage the context:

```typescript
// In pipeline.ts - executeCallback method

private async executeCallback(
  envelope: Envelope,
  subscriber: Subscriber,
  receipt: MessageReceipt
): Promise<ProcessResult> {
  const startTime = Date.now();

  try {
    // Load existing checkpoint if available
    const existingCheckpoint = this.checkpointStore
      ? await this.checkpointStore.get(envelope.id)
      : undefined;

    // Create resumable context
    const context = new ResumableContext(
      this.checkpointStore ?? new NoOpCheckpointStore(),
      envelope,
      subscriber.name,
      existingCheckpoint
    );

    // Execute with context
    await subscriber.callback(envelope, context);

    // Success - clean up checkpoint
    await context.clear();

    return {
      success: true,
      envelope,
      subscriber: toSubscriberDefinition(subscriber),
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    // Checkpoint persists for retry
    // (already saved incrementally in io() calls)
    return {
      success: false,
      envelope,
      subscriber: toSubscriberDefinition(subscriber),
      error: error as Error,
      durationMs: Date.now() - startTime,
    };
  }
}
```

### Configuration

```typescript
interface MatadorConfig {
  // ... existing config ...

  /**
   * Checkpoint store for resumable subscribers.
   * If not provided, resumable context will be available but
   * checkpoints won't persist across retries.
   */
  checkpointStore?: CheckpointStore;
}
```

### Retry Policy Integration

The `StandardRetryPolicy` is updated to handle `'resumable'` idempotency:

```typescript
// In standard-policy.ts - shouldRetry method

// 6. Non-idempotent subscriber on redelivery
// 'resumable' is treated as idempotent (like 'yes') for retry purposes
if (receipt.redelivered && subscriber.idempotent === 'no') {
  const idempotentError = new IdempotentMessageCannotRetryError(
    envelope.id,
    subscriber.name,
  );
  return {
    action: 'dead-letter',
    queue: 'undeliverable',
    reason: idempotentError.message,
  };
}

// 7. Default: retry with backoff
// For 'resumable' subscribers, checkpoint will be loaded on retry
return {
  action: 'retry',
  delay: this.getDelay(context),
};
```

**Key behavior:**
- `idempotent: 'resumable'` is treated the same as `'yes'` for retry decisions
- The difference is in the pipeline: `'resumable'` triggers checkpoint loading
- This means `'resumable'` subscribers are always safe to retry

### Schema Validation

The schema registry validates `'resumable'` subscribers:

```typescript
// In registry.ts - validate method

function validateResumableSubscribers(
  schema: SchemaRegistry,
  checkpointStore: CheckpointStore | undefined
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [eventKey, subscribers] of schema.entries()) {
    for (const subscriber of subscribers) {
      if (subscriber.idempotent === 'resumable' && !checkpointStore) {
        errors.push({
          path: `${eventKey}.${subscriber.name}`,
          message: `Subscriber "${subscriber.name}" is marked as 'resumable' but no checkpointStore is configured. ` +
                   `Checkpoints will not persist across retries.`,
        });
      }
    }
  }

  return errors;
}
```

This validation produces a **warning** (not an error) allowing development/testing without Redis.

## Key Design Decisions

### 1. Explicit Keys

**Decision: Developer-provided keys for each `io()` call**

Rationale:
- **Resilient to code changes** - Inserting, removing, or reordering `io()` calls doesn't break existing checkpoints
- **Meaningful debugging** - Keys like `'fetch-user'` are more informative than `'step-0'`
- **Flexible patterns** - Supports conditional `io()`, dynamic loops, and code refactoring
- **No versioning needed** - No need for subscriber version fields or code hashing

Trade-off:
- Developer must provide unique keys (small cognitive overhead)
- Runtime validation needed to detect duplicate keys

### 2. Incremental Checkpoint Persistence

**Decision: Save checkpoint after each `io()` call**

Rationale:
- Ensures no work is lost if crash happens between `io()` calls
- Slightly more I/O but much safer
- For `all()`, save once after all parallel operations complete

### 3. Checkpoint Cleanup Strategy

**Decision: Clean on success, retain on failure with TTL**

- On subscriber success: Delete checkpoint immediately
- On failure/retry: Checkpoint persists for next attempt
- On dead-letter: Delete checkpoint (terminal state)
- TTL on store: Cleanup orphaned checkpoints (24h default)

### 4. Error Handling in io()

**Decision: Errors propagate, no caching of failures**

```typescript
async io<T extends JsonSerializable>(key: string, fn: () => Promise<T> | T): Promise<T> {
  // Check cache
  if (key in this.checkpoint.completedSteps) {
    return this.checkpoint.completedSteps[key] as T;
  }

  // Execute - if this throws, it propagates up
  // The checkpoint is NOT updated on failure
  const result = await fn();

  // Only cache on success
  this.checkpoint.completedSteps[key] = result;
  await this.store.set(...);

  return result;
}
```

### 5. Type-Safe Serialization

**Decision: Enforce JSON-serializable types at compile time**

```typescript
type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

// This will fail type checking:
await io('key', () => new Date());           // Error: Date is not JsonSerializable
await io('key', () => () => {});             // Error: Function is not JsonSerializable
await io('key', () => new Map());            // Error: Map is not JsonSerializable

// This is fine:
await io('key', () => ({ createdAt: new Date().toISOString() }));  // OK
await io('key', () => [1, 2, 3]);                                   // OK
await io('key', () => null);                                        // OK
```

### 6. Backward Compatibility

**Decision: Context parameter is optional, existing subscribers work unchanged**

```typescript
// New signature supports both:
type SubscriberCallback<T> = (
  envelope: Envelope<T>,
  context?: SubscriberContext  // Optional for backward compat
) => Promise<void> | void;

// Old subscribers continue to work
callback: async (envelope) => { ... }

// New subscribers can use context
callback: async (envelope, { io }) => { ... }
```

## Hooks Integration

New hooks for observability:

```typescript
interface MatadorHooks {
  // ... existing hooks ...

  /**
   * Called when a checkpoint is loaded for a retry
   */
  onCheckpointLoaded?(context: {
    envelope: Envelope;
    subscriber: SubscriberDefinition;
    checkpoint: Checkpoint;
    cachedSteps: number;
  }): void | Promise<void>;

  /**
   * Called when an io() operation uses cached value
   */
  onCheckpointHit?(context: {
    envelope: Envelope;
    subscriber: SubscriberDefinition;
    stepKey: string;
  }): void | Promise<void>;

  /**
   * Called when an io() operation executes (cache miss)
   */
  onCheckpointMiss?(context: {
    envelope: Envelope;
    subscriber: SubscriberDefinition;
    stepKey: string;
  }): void | Promise<void>;

  /**
   * Called when checkpoint is cleared (success or dead-letter)
   */
  onCheckpointCleared?(context: {
    envelope: Envelope;
    subscriber: SubscriberDefinition;
    reason: 'success' | 'dead-letter';
  }): void | Promise<void>;
}
```

## File Structure

```
packages/matador/src/
├── checkpoint/
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # Checkpoint, CheckpointStore, JsonSerializable
│   ├── context.ts                  # ResumableContext implementation
│   ├── stores/
│   │   ├── memory.ts               # MemoryCheckpointStore
│   │   └── noop.ts                 # NoOpCheckpointStore (default)
│   └── errors.ts                   # CheckpointError, etc.
├── types/
│   ├── common.ts                   # Add 'resumable' to Idempotency type
│   └── subscriber.ts               # Update SubscriberCallback signature
├── pipeline/
│   └── pipeline.ts                 # Integrate ResumableContext
├── schema/
│   └── registry.ts                 # Add resumable validation warning
└── hooks/
    └── types.ts                    # Add checkpoint hooks
```

## Migration Guide

### For Existing Subscribers (No Changes Required)

Existing subscribers continue to work. The context parameter is optional:

```typescript
// This still works
const mySubscriber = createSubscriber<MyEvent>({
  name: 'my-subscriber',
  callback: async (envelope) => {
    // existing code unchanged
  }
});
```

### For New Resumable Subscribers

1. Set `idempotent: 'resumable'` on the subscriber
2. Add context parameter to callback
3. Wrap side-effectful operations in `io()` with unique keys
4. Use descriptive keys that identify the operation

```typescript
const myResumableSubscriber = createSubscriber<MyEvent>({
  name: 'my-resumable-subscriber',
  idempotent: 'resumable',  // Required for checkpoint-based idempotency
  callback: async (envelope, { io, all }) => {
    // Sequential operations with explicit keys
    const step1 = await io('do-something', () => doSomething());
    const step2 = await io('do-something-else', () => doSomethingElse(step1));

    // Parallel operations with explicit keys
    const [a, b, c] = await all([
      ['fetch-a', () => fetchA()],
      ['fetch-b', () => fetchB()],
      ['fetch-c', () => fetchC()],
    ]);

    await io('finalize', () => finalize(step2, a, b, c));
  }
});
```

### For Production Deployments

Configure a persistent checkpoint store:

```typescript
import { RedisCheckpointStore } from 'matador/checkpoint';
import Redis from 'ioredis';

const matador = new Matador({
  // ... other config ...
  checkpointStore: new RedisCheckpointStore(new Redis(), {
    prefix: 'myapp:checkpoint:',
    ttlSeconds: 86400, // 24 hours
  }),
});
```

## Testing Strategy

### Unit Tests

1. **ResumableContext**
   - `io()` caches results with explicit keys
   - `io()` returns cached value when key exists in checkpoint
   - `io()` throws on duplicate key within same execution
   - `all()` executes in parallel and caches all results
   - Error in `io()` propagates without caching
   - `clear()` removes checkpoint

2. **CheckpointStores**
   - CRUD operations for each implementation
   - TTL/cleanup behavior
   - Concurrent access handling

3. **Pipeline Integration**
   - Context is passed to subscriber
   - Checkpoint loaded on retry
   - Checkpoint cleared on success
   - Checkpoint retained on failure

4. **Type Safety**
   - Non-JsonSerializable types rejected at compile time
   - JsonSerializable types accepted
   - Discriminated union enforces `idempotent: 'resumable'` ↔ `ResumableCallback` pairing
   - Standard callbacks cannot have context parameter
   - Resumable callbacks must have context parameter

### Integration Tests

1. **End-to-end retry with checkpoints**
   - Subscriber fails after 2 io() calls
   - Retry executes, first 2 io() calls return cached
   - Third io() call executes fresh
   - Success clears checkpoint

2. **Parallel operations with all()**
   - Some operations in all() succeed, some fail
   - Retry replays successful ones from cache

3. **Checkpoint store reliability**
   - Redis connection loss handling
   - Checkpoint corruption recovery

### Example Test Case

```typescript
describe('Resumable Subscribers', () => {
  it('should replay cached io() results on retry', async () => {
    const executionLog: string[] = [];
    let shouldFail = true;

    const subscriber = createSubscriber<TestEvent>({
      name: 'test-resumable',
      idempotent: 'resumable',
      callback: async (envelope, { io }) => {
        await io('step-0', () => {
          executionLog.push('step-0');
          return 'result-0';
        });

        await io('step-1', () => {
          executionLog.push('step-1');
          return 'result-1';
        });

        if (shouldFail) {
          shouldFail = false;
          throw new Error('Simulated failure');
        }

        await io('step-2', () => {
          executionLog.push('step-2');
          return 'result-2';
        });
      }
    });

    // First attempt - fails after step-1
    await processMessage(envelope, subscriber);
    expect(executionLog).toEqual(['step-0', 'step-1']);

    // Retry - step-0 and step-1 use cache, step-2 executes
    executionLog.length = 0;
    await processMessage(envelope, subscriber);
    expect(executionLog).toEqual(['step-2']); // Only step-2 executed!
  });

  it('should handle parallel operations with all()', async () => {
    const executionLog: string[] = [];

    const subscriber = createSubscriber<TestEvent>({
      name: 'test-parallel',
      idempotent: 'resumable',
      callback: async (envelope, { io, all }) => {
        const [a, b, c] = await all([
          ['fetch-a', () => { executionLog.push('a'); return 'result-a'; }],
          ['fetch-b', () => { executionLog.push('b'); return 'result-b'; }],
          ['fetch-c', () => { executionLog.push('c'); return 'result-c'; }],
        ]);

        expect(a).toBe('result-a');
        expect(b).toBe('result-b');
        expect(c).toBe('result-c');
      }
    });

    await processMessage(envelope, subscriber);
    expect(executionLog).toContain('a');
    expect(executionLog).toContain('b');
    expect(executionLog).toContain('c');
  });

  it('should throw on duplicate keys', async () => {
    const subscriber = createSubscriber<TestEvent>({
      name: 'test-duplicate-key',
      idempotent: 'resumable',
      callback: async (envelope, { io }) => {
        await io('same-key', () => 'first');
        await io('same-key', () => 'second');  // Should throw!
      }
    });

    await expect(processMessage(envelope, subscriber))
      .rejects.toThrow(DuplicateIoKeyError);
  });
});
```

## Future Enhancements

### 1. Checkpoint inspection API

```typescript
// For debugging/admin tools
const checkpoint = await matador.getCheckpoint(envelopeId);
console.log(checkpoint.completedSteps);
```

### 2. Checkpoint metrics

- Track checkpoint hit/miss ratios
- Monitor checkpoint sizes
- Alert on high checkpoint counts (indicating frequent failures)

## Implementation Order

1. **Phase 1: Core Types and Interfaces**
   - [ ] Add `'resumable'` to `Idempotency` type in `types/common.ts`
   - [ ] Define `Checkpoint`, `CheckpointStore`, `JsonSerializable` types
   - [ ] Define `SubscriberContext` interface with `io()` and `all()`
   - [ ] Define `StandardCallback<T>` and `ResumableCallback<T>` types
   - [ ] Update `SubscriberOptions<T>` to discriminated union
   - [ ] Update `createSubscriber` to accept the discriminated union

2. **Phase 2: Checkpoint Stores**
   - [ ] Implement `NoOpCheckpointStore` (default)
   - [ ] Implement `MemoryCheckpointStore`
   - [ ] Write unit tests for stores

3. **Phase 3: ResumableContext**
   - [ ] Implement `ResumableContext` class
   - [ ] Implement `io(key, fn)` with explicit keys
   - [ ] Implement duplicate key detection
   - [ ] Implement `all(ops)` for parallel operations
   - [ ] Add `DuplicateIoKeyError` to errors
   - [ ] Write unit tests for context

4. **Phase 4: Pipeline Integration**
   - [ ] Add `checkpointStore` to `MatadorConfig`
   - [ ] Modify `ProcessingPipeline` to create/manage context
   - [ ] Only load checkpoints for `idempotent: 'resumable'` subscribers
   - [ ] Pass context to subscriber callbacks
   - [ ] Clear checkpoint on success/dead-letter

5. **Phase 5: Schema Validation**
   - [ ] Add validation warning for `'resumable'` without `checkpointStore`
   - [ ] Update schema validation tests

6. **Phase 6: Hooks**
   - [ ] Add checkpoint-related hooks to `MatadorHooks`
   - [ ] Integrate hooks into context operations

7. **Phase 7: Integration Tests**
   - [ ] End-to-end retry with checkpoints
   - [ ] Parallel operations with all()
   - [ ] Dead-letter checkpoint cleanup
   - [ ] Test `'resumable'` idempotency behavior

8. **Phase 8: Redis Store**
   - [ ] Implement `RedisCheckpointStore`
   - [ ] Write integration tests with Redis

9. **Phase 9: Documentation**
   - [ ] API documentation
   - [ ] Migration guide
   - [ ] Examples
   - [ ] Document explicit key requirements
   - [ ] Document `idempotent: 'resumable'` semantics
