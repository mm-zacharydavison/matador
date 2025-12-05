/**
 * Static properties required on Event classes for schema registration.
 */
export interface EventStatic<T = unknown> {
  /** Unique routing key for the event */
  readonly key: string;

  /** Human-readable description of the event */
  readonly description: string;

  /** Alternative names/keys for backwards compatibility */
  readonly aliases?: readonly string[];

  /** Create an instance from data (for deserialization) */
  new (data: T, before?: T | undefined): Event<T>;
}

/**
 * Base interface for all events.
 * Events represent something that happened in the system.
 */
export interface Event<T = unknown> {
  /** The event data/payload */
  readonly data: T;

  /** Previous state for change-type events */
  readonly before?: T | undefined;
}

/**
 * Options for dispatching an event.
 */
export interface EventOptions {
  /** Delay processing by this many milliseconds */
  readonly delayMs?: number | undefined;

  /** Correlation ID for request tracing */
  readonly correlationId?: string | undefined;

  /**
   * Event-specific metadata to include in the docket.
   * This metadata will be merged with universal metadata from the
   * loadUniversalMetadata hook, with these values taking precedence
   * when keys conflict.
   */
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Abstract base class for creating event types.
 * Extend this class to define custom events.
 *
 * @example
 * ```typescript
 * class UserCreatedEvent extends BaseEvent<{ userId: string; email: string }> {
 *   static readonly key = 'user.created';
 *   static readonly description = 'Fired when a new user is created';
 * }
 * ```
 */
export abstract class BaseEvent<T> implements Event<T> {
  static readonly key: string;
  static readonly description: string;
  static readonly aliases?: readonly string[];

  readonly before?: T | undefined;

  constructor(
    public readonly data: T,
    before?: T | undefined,
  ) {
    this.before = before;
  }
}

/**
 * Type helper to extract the data type from an event class.
 */
export type EventData<E extends Event<unknown>> = E extends Event<infer T>
  ? T
  : never;

/**
 * Type helper to get the event class type.
 */
export type EventClass<T = unknown> = EventStatic<T> &
  (new (
    data: T,
    before?: T | undefined,
  ) => Event<T>);
