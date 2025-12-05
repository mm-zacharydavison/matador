/**
 * Delivery semantics for message processing.
 * - 'at-least-once': Acknowledge after processing (may redeliver on failure)
 * - 'at-most-once': Acknowledge before processing (no redelivery, may lose messages)
 */
export type DeliveryMode = 'at-least-once' | 'at-most-once';

/**
 * Importance level for subscribers, used for monitoring and alerting prioritization.
 */
export type Importance =
  | 'can-ignore'
  | 'should-investigate'
  | 'must-investigate';

/**
 * Idempotency declaration for subscribers.
 * - 'yes': Safe to retry on failure
 * - 'no': Not safe to retry, may cause duplicate side effects
 * - 'unknown': Idempotency not determined
 */
export type Idempotency = 'yes' | 'no' | 'unknown';

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

/**
 * Individual validation error.
 */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

/**
 * Creates a successful validation result.
 */
export function validResult(): ValidationResult {
  return { valid: true, errors: [] };
}

/**
 * Creates a failed validation result.
 */
export function invalidResult(errors: ValidationError[]): ValidationResult {
  return { valid: false, errors };
}
