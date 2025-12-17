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
  /** Queue name (will be prefixed with namespace unless exact: true) */
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

  /** Transport-specific queue options */
  readonly transport?: TransportQueueOptions | undefined;
}

/**
 * Transport-specific queue options.
 * Each transport can define its own options under its transport name key.
 */
export interface TransportQueueOptions {
  /** RabbitMQ-specific queue options */
  readonly rabbitmq?: RabbitMQQueueDefinition | undefined;
}

/**
 * RabbitMQ-specific queue definition options.
 */
export interface RabbitMQQueueDefinition {
  /**
   * Exact RabbitMQ queue assertion options.
   * When provided, these options completely replace all auto-computed defaults
   * (durable, x-queue-type, x-dead-letter-exchange, etc.).
   */
  readonly options?: RabbitMQQueueOptions | undefined;
}

/**
 * RabbitMQ queue assertion options.
 * Maps to amqplib's Options.AssertQueue.
 */
export interface RabbitMQQueueOptions {
  /** Queue survives broker restart */
  readonly durable?: boolean | undefined;

  /** Queue is deleted when last consumer unsubscribes */
  readonly autoDelete?: boolean | undefined;

  /** Queue can only be used by the declaring connection */
  readonly exclusive?: boolean | undefined;

  /** Exchange to which dead-lettered messages are sent */
  readonly deadLetterExchange?: string | undefined;

  /** Routing key for dead-lettered messages */
  readonly deadLetterRoutingKey?: string | undefined;

  /** Message TTL in milliseconds */
  readonly messageTtl?: number | undefined;

  /** Queue expires after this many milliseconds of non-use */
  readonly expires?: number | undefined;

  /** Maximum number of messages in the queue */
  readonly maxLength?: number | undefined;

  /** Maximum priority level (0-255) */
  readonly maxPriority?: number | undefined;

  /** Additional x-* arguments for RabbitMQ */
  readonly arguments?: Record<string, unknown> | undefined;
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

/**
 * Resolves the actual queue name for a given queue definition.
 * When exact: true, returns name as-is. Otherwise, returns namespace.name.
 */
export function resolveQueueName(
  namespace: string,
  queueDef: QueueDefinition,
): string {
  if (queueDef.exact) {
    return queueDef.name;
  }
  return `${namespace}.${queueDef.name}`;
}
