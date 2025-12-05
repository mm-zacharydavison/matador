/**
 * Transport-agnostic topology definition.
 * Matador owns the topology; transports translate and apply it.
 */
export interface Topology {
  /** Namespace prefix for all queues */
  readonly namespace: string;

  /** Work queues for processing events */
  readonly queues: readonly QueueDefinition[];

  /** Dead-letter queue configuration */
  readonly deadLetter: DeadLetterConfig;

  /** Retry queue configuration */
  readonly retry: RetryConfig;
}

/**
 * Individual queue definition.
 */
export interface QueueDefinition {
  /** Queue name (will be prefixed with namespace) */
  readonly name: string;

  /** Concurrency for this queue */
  readonly concurrency?: number | undefined;

  /** Consumer timeout in milliseconds */
  readonly consumerTimeout?: number | undefined;

  /** Enable priority support if transport allows */
  readonly priorities?: boolean | undefined;

  /**
   * When true, the queue name is used exactly as provided without any
   * modification. The namespace prefix will NOT be added, and no other
   * transformations will be applied. Use this for referencing external
   * queues that are not managed by Matador.
   */
  readonly exact?: boolean | undefined;
}

/**
 * Dead-letter queue configuration.
 */
export interface DeadLetterConfig {
  /** Unhandled events (schema mismatch) queue */
  readonly unhandled: DeadLetterQueueConfig;

  /** Undeliverable events (permanent failures) queue */
  readonly undeliverable: DeadLetterQueueConfig;
}

/**
 * Configuration for a specific dead-letter queue.
 */
export interface DeadLetterQueueConfig {
  /** Whether this DLQ is enabled */
  readonly enabled: boolean;

  /** Maximum number of messages in the DLQ */
  readonly maxLength?: number | undefined;
}

/**
 * Retry queue configuration.
 */
export interface RetryConfig {
  /** Enable retry queue with delay */
  readonly enabled: boolean;

  /** Default retry delay in milliseconds */
  readonly defaultDelayMs: number;

  /** Maximum retry delay in milliseconds */
  readonly maxDelayMs: number;
}

/**
 * Gets the fully qualified queue name with namespace prefix.
 */
export function getQualifiedQueueName(
  namespace: string,
  queueName: string,
): string {
  return `${namespace}.${queueName}`;
}

/**
 * Gets the dead-letter queue name for a given queue.
 */
export function getDeadLetterQueueName(
  namespace: string,
  queueName: string,
  dlqType: 'unhandled' | 'undeliverable',
): string {
  return `${namespace}.${queueName}.${dlqType}`;
}

/**
 * Gets the retry queue name for a given queue.
 */
export function getRetryQueueName(
  namespace: string,
  queueName: string,
): string {
  return `${namespace}.${queueName}.retry`;
}
