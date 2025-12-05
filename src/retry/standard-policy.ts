import { isAssertionError, isDoRetry, isDontRetry } from '../errors/index.js';
import type { RetryContext, RetryDecision, RetryPolicy } from './policy.js';

/**
 * Configuration for the standard retry policy.
 */
export interface StandardRetryPolicyConfig {
  /** Maximum number of attempts before dead-lettering */
  readonly maxAttempts: number;

  /** Base delay between retries in milliseconds */
  readonly baseDelay: number;

  /** Maximum delay between retries in milliseconds */
  readonly maxDelay: number;

  /** Multiplier for exponential backoff */
  readonly backoffMultiplier: number;
}

/**
 * Default configuration values.
 */
export const defaultRetryConfig: StandardRetryPolicyConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 300000, // 5 minutes
  backoffMultiplier: 2,
};

/**
 * Standard retry policy implementing Matador v1 behavior.
 *
 * Decision logic:
 * 1. EventAssertionError → dead-letter (never retry)
 * 2. DontRetry → dead-letter (explicit no-retry)
 * 3. DoRetry → retry if under max attempts
 * 4. Max attempts exceeded → dead-letter
 * 5. Non-idempotent subscriber on redelivery → dead-letter
 * 6. Default → retry with exponential backoff
 */
export class StandardRetryPolicy implements RetryPolicy {
  private readonly config: StandardRetryPolicyConfig;

  constructor(config: Partial<StandardRetryPolicyConfig> = {}) {
    this.config = { ...defaultRetryConfig, ...config };
  }

  shouldRetry(context: RetryContext): RetryDecision {
    const { error, subscriber, receipt } = context;
    const errorMessage = error.message;

    // 1. Assertion errors never retry
    if (isAssertionError(error)) {
      return {
        action: 'dead-letter',
        queue: 'undeliverable',
        reason: `assertion error: ${errorMessage}`,
      };
    }

    // 2. Explicit no-retry
    if (isDontRetry(error)) {
      return {
        action: 'dead-letter',
        queue: 'undeliverable',
        reason: errorMessage,
      };
    }

    // 3. Explicit retry request
    if (isDoRetry(error)) {
      if (receipt.attemptNumber >= this.config.maxAttempts) {
        return {
          action: 'dead-letter',
          queue: 'undeliverable',
          reason: `max attempts exceeded (${this.config.maxAttempts}) with forced retry`,
        };
      }
      return {
        action: 'retry',
        delay: this.getDelay(context),
      };
    }

    // 4. Max attempts exceeded
    if (receipt.attemptNumber >= this.config.maxAttempts) {
      return {
        action: 'dead-letter',
        queue: 'undeliverable',
        reason: `max attempts exceeded (${this.config.maxAttempts})`,
      };
    }

    // 5. Non-idempotent subscriber on redelivery
    if (receipt.redelivered && subscriber.idempotent === 'no') {
      return {
        action: 'dead-letter',
        queue: 'undeliverable',
        reason: 'non-idempotent subscriber cannot be retried after redelivery',
      };
    }

    // 6. Default: retry with backoff
    return {
      action: 'retry',
      delay: this.getDelay(context),
    };
  }

  getDelay(context: RetryContext): number {
    const attempt = context.receipt.attemptNumber;
    const delay =
      this.config.baseDelay *
      Math.pow(this.config.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxDelay);
  }
}

/**
 * Creates a new standard retry policy.
 */
export function createRetryPolicy(
  config?: Partial<StandardRetryPolicyConfig>,
): StandardRetryPolicy {
  return new StandardRetryPolicy(config);
}
