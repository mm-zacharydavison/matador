import assert from 'node:assert';
import type { Envelope } from '../types/envelope.js';

/**
 * Base class for retry control errors.
 * These errors control the retry behavior of message processing.
 */
export abstract class RetryControlError extends Error {
  /**
   * Error class name for monitoring tools.
   */
  declare readonly name: string;

  /**
   * Human-readable description of the error and recommended actions.
   */
  abstract readonly description: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Ensure name is preserved when serialized
    Object.defineProperty(this, 'name', {
      value: this.constructor.name,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  /**
   * Returns a serializable representation for logging/monitoring.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      description: this.description,
      stack: this.stack,
    };
  }
}

/**
 * Forces retry regardless of subscriber idempotency setting.
 * Use when you know the operation is safe to retry.
 *
 * ACTION: Check subscriber code to understand why retry was forced.
 * This overrides default retry behavior based on idempotency settings.
 */
export class DoRetry extends RetryControlError {
  readonly description =
    'A subscriber explicitly requested retry by throwing DoRetry. ' +
    'ACTION: Check the subscriber code to understand why retry was forced. ' +
    'This overrides the default retry behavior based on idempotency settings.';

  constructor(message = 'Forced retry requested') {
    super(message);
  }
}

/**
 * Prevents retry regardless of subscriber idempotency setting.
 * Use for permanent failures that should not be retried.
 *
 * ACTION: Check subscriber code to understand why retry was disabled.
 * Typically used for permanent failures like invalid data or business rule violations.
 */
export class DontRetry extends RetryControlError {
  readonly description =
    'A subscriber explicitly prevented retry by throwing DontRetry. ' +
    'ACTION: Check the subscriber code to understand why retry was disabled. ' +
    'Typically used for permanent failures like invalid data or business rule violations. ' +
    'The message will be sent to the dead-letter queue for manual review.';

  constructor(message = 'Retry explicitly disabled') {
    super(message);
  }
}

/**
 * Thrown by `assertEvent` in the event of a failed assertion.
 *
 * This error indicates that an event was in an unexpected state when it reached the subscriber.
 * Throwing this error will indicate to Matador NOT to retry the event - it will be sent
 * directly to the undeliverable dead-letter queue.
 *
 * Use `assertEvent` in your subscribers to assert properties about an event payload.
 * This is useful in scenarios where you would expect an event payload to contain a field
 * based on the types, but something unexpected caused it to not be present.
 *
 * @see assertEvent
 */
export class EventAssertionError extends Error {
  declare readonly name: string;

  readonly description =
    'Thrown to indicate that an event was in an unexpected state when it reached the subscriber. ' +
    'Throwing this error will indicate to Matador NOT to retry the event. ' +
    'Matador does not throw this error directly - it is thrown by assertEvent, which you can ' +
    'use in your subscribers to assert properties about an event. ' +
    'This can be useful in scenarios where you would expect an event payload to contain a field ' +
    'based on the types, but something unexpected caused it to not be present. ' +
    'Using this instead of the NodeJS assert allows Matador to not retry the event subscriber.';

  /** The envelope that failed the assertion */
  readonly envelope: Envelope<unknown>;

  constructor(envelope: Envelope<unknown>, message: string) {
    super(message);
    this.name = 'EventAssertionError';
    this.envelope = envelope;
    Object.defineProperty(this, 'name', {
      value: 'EventAssertionError',
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      description: this.description,
      envelope: this.envelope,
      stack: this.stack,
    };
  }
}

/**
 * Checks if an error forces a retry.
 */
export function isDoRetry(error: unknown): error is DoRetry {
  return error instanceof DoRetry;
}

/**
 * Checks if an error prevents retry.
 */
export function isDontRetry(error: unknown): error is DontRetry {
  return error instanceof DontRetry;
}

/**
 * Checks if an error is an assertion error (never retry).
 */
export function isAssertionError(error: unknown): error is EventAssertionError {
  return error instanceof EventAssertionError;
}

/**
 * Same as Node.js `assert`, but throws an `EventAssertionError` if the assertion fails.
 *
 * `EventAssertionError`s thrown within a subscriber do not cause the subscriber to be retried.
 * The event will be delivered to the undeliverable dead-letter queue instead.
 *
 * @see https://nodejs.org/api/assert.html#assertvalue-message
 * @param envelope - The envelope this assertion relates to.
 * @param value - The value to assert. If falsy, the assertion fails.
 * @param message - The message to include in the error if the assertion fails.
 * @throws {EventAssertionError} If the assertion fails.
 *
 * @example
 * ```typescript
 * const subscriber = createSubscriber<MyEvent>({
 *   name: 'my-subscriber',
 *   description: 'Processes MyEvent',
 *   callback: async (envelope) => {
 *     // Assert that userId exists - if not, event goes to DLQ without retry
 *     assertEvent(envelope, envelope.data.userId, 'userId is required');
 *     // ... rest of processing
 *   },
 * });
 * ```
 */
export function assertEvent(
  envelope: Envelope<unknown>,
  value: unknown,
  message: string,
): asserts value {
  try {
    assert(value, message);
  } catch {
    throw new EventAssertionError(envelope, message);
  }
}
