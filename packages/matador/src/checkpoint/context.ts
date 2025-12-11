import type { Envelope, SubscriberDefinition } from '../types/index.js';
import { DuplicateIoKeyError } from '../errors/index.js';
import type {
  Checkpoint,
  CheckpointHitContext,
  CheckpointMissContext,
  CheckpointStore,
  JsonSerializable,
  SubscriberContext,
} from './types.js';

/**
 * Hooks for observability during context operations.
 */
export interface ResumableContextHooks {
  onCheckpointHit?(context: CheckpointHitContext): void | Promise<void>;
  onCheckpointMiss?(context: CheckpointMissContext): void | Promise<void>;
}

/**
 * Configuration for creating a ResumableContext.
 */
export interface ResumableContextConfig {
  readonly store: CheckpointStore;
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly existingCheckpoint?: Checkpoint | undefined;
  readonly hooks?: ResumableContextHooks | undefined;
}

/**
 * Implementation of SubscriberContext that provides io() caching.
 *
 * On first execution, io() calls execute their lambdas and cache results.
 * On retry (when existingCheckpoint is provided), cached results are returned
 * without re-executing the lambda.
 */
export class ResumableContext implements SubscriberContext {
  private checkpoint: Checkpoint;
  private readonly usedKeys = new Set<string>();
  private readonly store: CheckpointStore;
  private readonly envelope: Envelope;
  private readonly subscriber: SubscriberDefinition;
  private readonly hooks: ResumableContextHooks | undefined;

  constructor(config: ResumableContextConfig) {
    this.store = config.store;
    this.envelope = config.envelope;
    this.subscriber = config.subscriber;
    this.hooks = config.hooks;

    this.checkpoint = config.existingCheckpoint ?? {
      envelopeId: config.envelope.id,
      subscriberName: config.subscriber.name,
      completedSteps: {},
    };
  }

  get attempt(): number {
    return this.envelope.docket.attempts;
  }

  get isRetry(): boolean {
    return this.attempt > 1;
  }

  async io<T extends JsonSerializable>(
    key: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    // Validate key uniqueness within this execution
    if (this.usedKeys.has(key)) {
      throw new DuplicateIoKeyError(key, this.subscriber.name);
    }
    this.usedKeys.add(key);

    // Check cache first
    if (key in this.checkpoint.completedSteps) {
      await this.hooks?.onCheckpointHit?.({
        envelope: this.envelope,
        subscriber: this.subscriber,
        stepKey: key,
      });
      return this.checkpoint.completedSteps[key] as T;
    }

    // Notify cache miss
    await this.hooks?.onCheckpointMiss?.({
      envelope: this.envelope,
      subscriber: this.subscriber,
      stepKey: key,
    });

    // Execute the function - errors propagate, no caching on failure
    const result = await fn();

    // Cache the result
    this.checkpoint = {
      ...this.checkpoint,
      completedSteps: {
        ...this.checkpoint.completedSteps,
        [key]: result,
      },
    };

    // Persist checkpoint immediately (incremental persistence)
    await this.store.set(this.envelope.id, this.checkpoint);

    return result;
  }

  async all<
    T extends readonly [
      string,
      () => Promise<JsonSerializable> | JsonSerializable,
    ][],
  >(
    ops: T,
  ): Promise<{
    [K in keyof T]: T[K] extends [string, () => Promise<infer R> | infer R]
      ? R
      : never;
  }> {
    // First, check for duplicates within this all() call
    const keysInThisCall = new Set<string>();
    for (const [key] of ops) {
      if (keysInThisCall.has(key)) {
        throw new DuplicateIoKeyError(key, this.subscriber.name);
      }
      keysInThisCall.add(key);
    }

    // Then validate against previously used keys
    for (const [key] of ops) {
      if (this.usedKeys.has(key)) {
        throw new DuplicateIoKeyError(key, this.subscriber.name);
      }
    }

    // Mark all keys as used
    for (const [key] of ops) {
      this.usedKeys.add(key);
    }

    // Execute all operations in parallel
    const results = await Promise.all(
      ops.map(async ([key, fn]) => {
        // Check cache first
        if (key in this.checkpoint.completedSteps) {
          await this.hooks?.onCheckpointHit?.({
            envelope: this.envelope,
            subscriber: this.subscriber,
            stepKey: key,
          });
          return this.checkpoint.completedSteps[key];
        }

        // Notify cache miss
        await this.hooks?.onCheckpointMiss?.({
          envelope: this.envelope,
          subscriber: this.subscriber,
          stepKey: key,
        });

        // Execute - errors propagate
        const result = await fn();

        // Cache individually (in local state, will persist after Promise.all)
        this.checkpoint = {
          ...this.checkpoint,
          completedSteps: {
            ...this.checkpoint.completedSteps,
            [key]: result,
          },
        };

        return result;
      }),
    );

    // Persist after all parallel operations complete
    await this.store.set(this.envelope.id, this.checkpoint);

    return results as {
      [K in keyof T]: T[K] extends [string, () => Promise<infer R> | infer R]
        ? R
        : never;
    };
  }

  /**
   * Clears the checkpoint from storage.
   * Called after successful completion or dead-letter.
   */
  async clear(): Promise<void> {
    await this.store.delete(this.envelope.id);
  }

  /**
   * Gets the current checkpoint state.
   * Useful for debugging and testing.
   */
  getCheckpoint(): Checkpoint {
    return this.checkpoint;
  }

  /**
   * Gets the number of cached steps.
   */
  get cachedStepCount(): number {
    return Object.keys(this.checkpoint.completedSteps).length;
  }
}
