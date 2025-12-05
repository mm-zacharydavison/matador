import type { Idempotency, Importance } from './common.js';
import type { Envelope } from './envelope.js';
import type { MatadorEvent } from './event.js';

/**
 * Callback function executed when an event is received.
 * Receives the full envelope containing id, data, and docket.
 */
export type SubscriberCallback<T = unknown> = (
  envelope: Envelope<T>,
) => Promise<void> | void;

/**
 * Configuration options for a subscriber.
 */
export interface SubscriberOptions {
  /** Route this subscriber's events to a specific queue */
  readonly targetQueue?: string | undefined;

  /** Idempotency declaration for retry handling */
  readonly idempotent?: Idempotency | undefined;

  /** Importance level for monitoring and alerting */
  readonly importance?: Importance | undefined;

  /** Feature flag function to conditionally enable/disable the subscriber */
  readonly enabled?: (() => boolean | Promise<boolean>) | undefined;
}

/**
 * Full subscriber definition with callback.
 */
export interface Subscriber<T extends MatadorEvent> extends SubscriberOptions {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** Callback function to execute when event is received */
  readonly callback: SubscriberCallback<T['data']>;
}

/**
 * Subscriber stub for multi-codebase scenarios where subscriber implementation
 * is in a remote service. Declares the subscriber contract without providing
 * the callback.
 */
export interface SubscriberStub extends SubscriberOptions {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** Indicates this is a stub without implementation */
  readonly isStub: true;
}

/**
 * Union type for any subscriber definition (full or stub).
 * This is the type-erased version for use in collections and schema.
 */
export type AnySubscriber = Subscriber<MatadorEvent<unknown>> | SubscriberStub;

/**
 * Type guard to check if a subscriber is a stub.
 */
export function isSubscriberStub(
  subscriber: AnySubscriber,
): subscriber is SubscriberStub {
  return 'isStub' in subscriber && subscriber.isStub === true;
}

/**
 * Type guard to check if a subscriber has a callback implementation.
 */
export function isSubscriber(
  subscriber: AnySubscriber,
): subscriber is Subscriber<MatadorEvent<unknown>> {
  return 'callback' in subscriber && typeof subscriber.callback === 'function';
}

/**
 * Creates a subscriber definition.
 */
export function createSubscriber<T extends MatadorEvent>(
  name: string,
  callback: SubscriberCallback<T['data']>,
  options: SubscriberOptions = {},
): Subscriber<T> {
  return {
    name,
    callback,
    idempotent: options.idempotent ?? 'unknown',
    importance: options.importance ?? 'should-investigate',
    ...(options.targetQueue !== undefined && {
      targetQueue: options.targetQueue,
    }),
    ...(options.enabled !== undefined && { enabled: options.enabled }),
  };
}

/**
 * Creates a subscriber stub for remote implementations.
 */
export function createSubscriberStub(
  name: string,
  options: SubscriberOptions = {},
): SubscriberStub {
  return {
    name,
    isStub: true,
    idempotent: options.idempotent ?? 'unknown',
    importance: options.importance ?? 'should-investigate',
    ...(options.targetQueue !== undefined && {
      targetQueue: options.targetQueue,
    }),
    ...(options.enabled !== undefined && { enabled: options.enabled }),
  };
}

/**
 * Definition interface used by the pipeline (excludes event class reference).
 */
export interface SubscriberDefinition {
  readonly name: string;
  readonly idempotent: Idempotency;
  readonly importance: Importance;
  readonly targetQueue?: string | undefined;
}
