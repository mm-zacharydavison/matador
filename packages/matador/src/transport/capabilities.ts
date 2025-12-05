import type { DeliveryMode } from '../types/index.js';

/**
 * Describes the native capabilities of a transport.
 * Matador adapts its behavior based on these capabilities.
 */
export interface TransportCapabilities {
  /**
   * Delivery semantics the transport supports.
   * - 'at-least-once': Ack after processing (may redeliver on failure)
   * - 'at-most-once': Ack before processing (no redelivery, may lose messages)
   */
  readonly deliveryModes: readonly DeliveryMode[];

  /**
   * Transport can delay message delivery natively.
   * - true: Use transport's native delay (BullMQ, RabbitMQ with plugin)
   * - false: Matador handles via retry queue with TTL or external scheduler
   */
  readonly delayedMessages: boolean;

  /**
   * Transport can route failed messages to dead-letter queue natively.
   * - 'native': Transport handles DL routing (RabbitMQ DLX)
   * - 'manual': Matador must send() to DLQ then complete() original
   * - 'none': No DL support, Matador logs and discards
   */
  readonly deadLetterRouting: 'native' | 'manual' | 'none';

  /**
   * Transport tracks delivery/attempt count natively.
   * - true: Receipt includes accurate attemptNumber from transport
   * - false: Matador tracks attempts in envelope.docket.attempts field
   */
  readonly attemptTracking: boolean;

  /**
   * How transport handles concurrency.
   * - 'prefetch': Channel-based prefetch (RabbitMQ)
   * - 'worker': Worker concurrency setting (BullMQ)
   * - 'partition': Partition-based parallelism (Kafka)
   * - 'none': No concurrency control (Memory)
   */
  readonly concurrencyModel: 'prefetch' | 'worker' | 'partition' | 'none';

  /**
   * Message ordering guarantees.
   * - 'none': No ordering guarantee (most transports with multiple consumers)
   * - 'queue': Ordered within queue (single consumer scenarios)
   * - 'partition': Ordered within partition/key (Kafka)
   */
  readonly ordering: 'none' | 'queue' | 'partition';

  /**
   * Transport supports message priority.
   * - true: Higher priority messages processed first
   * - false: FIFO only
   */
  readonly priorities: boolean;
}

/**
 * Checks if the transport supports a specific delivery mode.
 */
export function supportsDeliveryMode(
  capabilities: TransportCapabilities,
  mode: DeliveryMode,
): boolean {
  return capabilities.deliveryModes.includes(mode);
}

/**
 * Checks if the transport supports native delayed messages.
 */
export function supportsDelayedMessages(
  capabilities: TransportCapabilities,
): boolean {
  return capabilities.delayedMessages;
}

/**
 * Checks if the transport has native dead-letter routing.
 */
export function hasNativeDeadLetter(
  capabilities: TransportCapabilities,
): boolean {
  return capabilities.deadLetterRouting === 'native';
}
