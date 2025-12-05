import type { RetryDecision } from '../retry/index.js';
import type { ConnectionState } from '../transport/index.js';
import type { Envelope, SubscriberDefinition } from '../types/index.js';

/**
 * Logger interface for Matador internal logging.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Default logger that uses console.
 */
export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(`[matador] ${message}`, ...args),
  info: (message, ...args) => console.info(`[matador] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[matador] ${message}`, ...args),
  error: (message, ...args) => console.error(`[matador] ${message}`, ...args),
};

/**
 * Context for enqueue success hook.
 */
export interface EnqueueSuccessContext {
  readonly envelope: Envelope;
  readonly queue: string;
}

/**
 * Context for enqueue warning hook (fallback used).
 */
export interface EnqueueWarningContext {
  readonly envelope: Envelope;
  readonly originalQueue: string;
  readonly fallbackQueue: string;
  readonly error: Error;
}

/**
 * Context for enqueue error hook.
 */
export interface EnqueueErrorContext {
  readonly envelope: Envelope;
  readonly error: Error;
}

/**
 * Context for decode error hook.
 */
export interface DecodeErrorContext {
  readonly error: Error;
  readonly rawMessage: Uint8Array;
  readonly sourceQueue: string;
}

/**
 * Context for worker success hook.
 */
export interface WorkerSuccessContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly result: unknown;
  readonly durationMs: number;
}

/**
 * Context for worker error hook.
 */
export interface WorkerErrorContext {
  readonly envelope: Envelope;
  readonly subscriber: SubscriberDefinition;
  readonly error: Error;
  readonly durationMs: number;
  readonly decision: RetryDecision;
}

/**
 * Execution function passed to onWorkerWrap for APM wrapping.
 */
export type WorkerExecuteFn = () => Promise<void>;

/**
 * All available hooks for Matador.
 */
export interface MatadorHooks {
  /**
   * Logger for internal Matador logging.
   * Defaults to console logger if not provided.
   */
  logger?: Logger;

  /**
   * Called when an event is successfully enqueued.
   */
  onEnqueueSuccess?(context: EnqueueSuccessContext): void | Promise<void>;

  /**
   * Called when enqueue falls back to a secondary queue.
   */
  onEnqueueWarning?(context: EnqueueWarningContext): void | Promise<void>;

  /**
   * Called when enqueue fails completely.
   */
  onEnqueueError?(context: EnqueueErrorContext): void | Promise<void>;

  /**
   * Wraps entire worker processing (for APM context).
   * Must call execute() to run the actual processing.
   */
  onWorkerWrap?(
    envelope: Envelope,
    subscriber: SubscriberDefinition,
    execute: WorkerExecuteFn,
  ): Promise<void>;

  /**
   * Called before processing begins.
   */
  onWorkerBeforeProcess?(
    envelope: Envelope,
    subscriber: SubscriberDefinition,
  ): void | Promise<void>;

  /**
   * Called after successful processing.
   */
  onWorkerSuccess?(context: WorkerSuccessContext): void | Promise<void>;

  /**
   * Called after processing error.
   */
  onWorkerError?(context: WorkerErrorContext): void | Promise<void>;

  /**
   * Called when message decoding fails.
   */
  onDecodeError?(context: DecodeErrorContext): void | Promise<void>;

  /**
   * Called when transport connection state changes.
   */
  onConnectionStateChange?(state: ConnectionState): void | Promise<void>;

  /**
   * Loads universal metadata to add to all envelopes.
   */
  loadUniversalMetadata?():
    | Record<string, unknown>
    | Promise<Record<string, unknown>>;

  /**
   * Dynamic queue concurrency lookup.
   */
  getQueueConcurrency?(queueName: string): number | undefined;

  /**
   * Dynamic retry delay lookup.
   */
  getRetryDelay?(envelope: Envelope, attemptNumber: number): number | undefined;

  /**
   * Dynamic max attempts lookup.
   */
  getAttempts?(envelope: Envelope): number | undefined;

  /**
   * Dynamic max deliveries (poison threshold) lookup.
   */
  getMaxDeliveries?(envelope: Envelope): number | undefined;
}
