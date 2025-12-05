import type { MessageReceipt } from '../transport/index.js';
import type { Envelope, SubscriberDefinition } from '../types/index.js';

/**
 * Context provided to retry policy for decision making.
 */
export interface RetryContext {
  /** The message envelope */
  readonly envelope: Envelope;

  /** The error that caused the failure */
  readonly error: Error;

  /** The subscriber definition */
  readonly subscriber: SubscriberDefinition;

  /** Message receipt with delivery information */
  readonly receipt: MessageReceipt;
}

/**
 * Decision returned by retry policy.
 */
export type RetryDecision =
  | { readonly action: 'retry'; readonly delay: number }
  | {
      readonly action: 'dead-letter';
      readonly queue: string;
      readonly reason: string;
    }
  | { readonly action: 'discard'; readonly reason: string };

/**
 * Interface for retry policies.
 */
export interface RetryPolicy {
  /**
   * Determines what to do with a failed message.
   */
  shouldRetry(context: RetryContext): RetryDecision;

  /**
   * Calculates the delay for a retry attempt.
   */
  getDelay(context: RetryContext): number;
}
