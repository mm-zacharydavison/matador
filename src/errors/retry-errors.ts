import type { HasDescription } from './has-description.js';

/**
 * Base class for retry control errors.
 */
export abstract class RetryControlError extends Error implements HasDescription {
  abstract readonly description: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Forces retry regardless of subscriber idempotency setting.
 * Use when you know the operation is safe to retry.
 */
export class DoRetry extends RetryControlError {
  readonly description =
    'A subscriber explicitly requested retry by throwing DoRetry. ' +
    'This overrides the default retry behavior. Check the subscriber code ' +
    'to understand why retry was forced.';

  constructor(message = 'Forced retry requested') {
    super(message);
  }
}

/**
 * Prevents retry regardless of subscriber idempotency setting.
 * Use for permanent failures that should not be retried.
 */
export class DontRetry extends RetryControlError {
  readonly description =
    'A subscriber explicitly prevented retry by throwing DontRetry. ' +
    'The message will be sent to the dead-letter queue. Check the subscriber ' +
    'code to understand why retry was disabled - typically used for permanent ' +
    'failures like invalid data or business rule violations.';

  constructor(message = 'Retry explicitly disabled') {
    super(message);
  }
}

/**
 * Assertion error that should never be retried.
 * Use for programming errors and invariant violations.
 */
export class EventAssertionError extends Error implements HasDescription {
  readonly description =
    'An event assertion failed, indicating a programming error or invariant ' +
    'violation. These errors are never retried and go directly to the dead-letter ' +
    'queue. Review the assertion failure message to identify the bug in the ' +
    'event payload or subscriber logic.';

  constructor(message: string) {
    super(message);
    this.name = 'EventAssertionError';
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
