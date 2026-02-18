import type { Envelope, SubscriberDefinition } from '../types/index.js';

/**
 * Type constraint ensuring values can be JSON serialized.
 * Used to enforce type safety for io() return values.
 */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

/**
 * Checkpoint data persisted between retries.
 * Contains cached results from completed io() operations.
 */
export interface Checkpoint {
  /** Unique envelope ID this checkpoint belongs to */
  readonly envelopeId: string;

  /** Subscriber name (for debugging/admin) */
  readonly subscriberName: string;

  /** Map of io() keys to their cached results */
  readonly completedSteps: Record<string, JsonSerializable>;
}

/**
 * Interface for checkpoint persistence.
 * Implementations must handle concurrent access safely.
 */
export interface CheckpointStore {
  /**
   * Retrieve checkpoint for an envelope.
   * @param envelopeId - Unique envelope identifier
   * @returns Checkpoint if exists, undefined otherwise
   */
  get(envelopeId: string): Promise<Checkpoint | undefined>;

  /**
   * Save or update checkpoint.
   * @param envelopeId - Unique envelope identifier
   * @param checkpoint - Checkpoint data to persist
   */
  set(envelopeId: string, checkpoint: Checkpoint): Promise<void>;

  /**
   * Delete checkpoint (on success or dead-letter).
   * @param envelopeId - Unique envelope identifier
   */
  delete(envelopeId: string): Promise<void>;

  /**
   * Optional: TTL-based cleanup for orphaned checkpoints.
   * @param olderThan - Delete checkpoints older than this date
   * @returns Number of checkpoints deleted
   */
  cleanup?(olderThan: Date): Promise<number>;
}

/**
 * Context provided to resumable subscriber callbacks.
 * Contains the io() function for checkpointed operations.
 */
export interface SubscriberContext {
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
   * @throws DuplicateIoKeyError if key was already used in this execution
   */
  io<T extends JsonSerializable>(
    key: string,
    fn: () => Promise<T> | T,
  ): Promise<T>;

  /**
   * Execute multiple io() operations in parallel.
   * Each operation requires its own unique key.
   *
   * @param ops - Array of [key, fn] tuples to execute in parallel
   * @returns Array of results in the same order as input
   */
  all<
    T extends readonly [
      string,
      () => Promise<JsonSerializable> | JsonSerializable,
    ][],
  >(
    ops: T,
  ): Promise<{
    [K in keyof T]: T[K] extends [string, () => Promise<infer R>]
      ? R
      : T[K] extends [string, () => infer R]
        ? R
        : never;
  }>;

  /** Current attempt number (1-based) */
  readonly attempt: number;

  /** Whether this is a retry (attempt > 1) */
  readonly isRetry: boolean;
}

/**
 * Context for checkpoint loaded hook.
 */
export interface CheckpointLoadedContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly checkpoint: Checkpoint;
  readonly cachedSteps: number;
}

/**
 * Context for checkpoint hit hook (cache used).
 */
export interface CheckpointHitContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly stepKey: string;
}

/**
 * Context for checkpoint miss hook (operation executed).
 */
export interface CheckpointMissContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly stepKey: string;
}

/**
 * Context for checkpoint cleared hook.
 */
export interface CheckpointClearedContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly reason: 'success' | 'dead-letter';
}
