import type { Idempotency, Importance } from './common.js';
import type { Docket } from './envelope.js';
import type { EventClass } from './event.js';

/**
 * Callback function executed when an event is received.
 */
export type SubscriberCallback<T = unknown> = (
  data: T,
  docket: Docket,
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
export interface Subscriber<T = unknown> extends SubscriberOptions {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** The event class this subscriber handles */
  readonly eventClass: EventClass<T>;

  /** Callback function to execute when event is received */
  readonly callback: SubscriberCallback<T>;
}

/**
 * Subscriber stub for multi-codebase scenarios where subscriber implementation
 * is in a remote service. Declares the subscriber contract without providing
 * the callback.
 */
export interface SubscriberStub<T = unknown> extends SubscriberOptions {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** The event class this subscriber handles */
  readonly eventClass: EventClass<T>;

  /** Indicates this is a stub without implementation */
  readonly isStub: true;
}

/**
 * Union type for any subscriber definition (full or stub).
 */
export type AnySubscriber<T = unknown> = Subscriber<T> | SubscriberStub<T>;

/**
 * Type guard to check if a subscriber is a stub.
 */
export function isSubscriberStub<T>(
  subscriber: AnySubscriber<T>,
): subscriber is SubscriberStub<T> {
  return 'isStub' in subscriber && subscriber.isStub === true;
}

/**
 * Type guard to check if a subscriber has a callback implementation.
 */
export function isSubscriber<T>(
  subscriber: AnySubscriber<T>,
): subscriber is Subscriber<T> {
  return 'callback' in subscriber && typeof subscriber.callback === 'function';
}

/**
 * Creates a subscriber definition.
 */
export function createSubscriber<T>(
  name: string,
  eventClass: EventClass<T>,
  callback: SubscriberCallback<T>,
  options: SubscriberOptions = {},
): Subscriber<T> {
  return {
    name,
    eventClass,
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
export function createSubscriberStub<T>(
  name: string,
  eventClass: EventClass<T>,
  options: SubscriberOptions = {},
): SubscriberStub<T> {
  return {
    name,
    eventClass,
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
