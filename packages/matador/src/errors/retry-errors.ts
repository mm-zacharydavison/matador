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
 * Assertion error that should never be retried.
 * Use for programming errors and invariant violations.
 *
 * ACTION: Review the assertion failure message to identify the bug
 * in the event payload or subscriber logic.
 */
export class EventAssertionError extends Error {
  declare readonly name: string;

  readonly description =
    'An event assertion failed, indicating a programming error or invariant violation. ' +
    'ACTION: Review the assertion failure message to identify the bug in the ' +
    'event payload or subscriber logic. These errors are never retried and go ' +
    'directly to the dead-letter queue.';

  constructor(message: string) {
    super(message);
    this.name = 'EventAssertionError';
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
