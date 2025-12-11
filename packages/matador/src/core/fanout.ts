import { TransportSendError } from '../errors/index.js';
import type { SafeHooks } from '../hooks/index.js';
import type { SchemaRegistry } from '../schema/index.js';
import { getQualifiedQueueName } from '../topology/index.js';
import type { Transport } from '../transport/index.js';
import type {
  AnySubscriber,
  Event,
  EventClass,
  EventOptions,
} from '../types/index.js';
import { createEnvelope } from '../types/index.js';

/**
 * Configuration for the fanout engine.
 */
export interface FanoutConfig {
  readonly transport: Transport;
  readonly schema: SchemaRegistry;
  readonly hooks: SafeHooks;
  readonly namespace: string;
  readonly defaultQueue: string;
}

/**
 * Result of sending an event.
 */
export interface SendResult {
  readonly eventKey: string;
  readonly subscribersSent: number;
  readonly subscribersSkipped: number;
  readonly errors: readonly SendError[];
}

/**
 * Error during send.
 */
export interface SendError {
  readonly subscriberName: string;
  readonly queue: string;
  readonly error: Error;
}

/**
 * Engine for fanning out events to subscribers.
 *
 * Handles:
 * 1. Getting subscribers from schema
 * 2. Filtering by enabled() hook
 * 3. Creating envelopes for each subscriber
 * 4. Sending to appropriate queues via transport
 */
export class FanoutEngine {
  private readonly transport: Transport;
  private readonly schema: SchemaRegistry;
  private readonly hooks: SafeHooks;
  private readonly namespace: string;
  private readonly defaultQueue: string;
  private enqueuingCount = 0;

  constructor(config: FanoutConfig) {
    this.transport = config.transport;
    this.schema = config.schema;
    this.hooks = config.hooks;
    this.namespace = config.namespace;
    this.defaultQueue = config.defaultQueue;
  }

  /**
   * Current count of events being enqueued.
   */
  get eventsBeingEnqueuedCount(): number {
    return this.enqueuingCount;
  }

  /**
   * Sends an event to all registered subscribers.
   */
  async send<T>(
    eventClass: EventClass<T>,
    event: Event<T>,
    options: EventOptions = {},
  ): Promise<SendResult> {
    const eventKey = eventClass.key;
    const subscribers = this.schema.getSubscribers(eventKey);

    const errors: SendError[] = [];
    let sent = 0;
    let skipped = 0;

    // Load universal metadata
    const universalMetadata = await this.hooks.loadUniversalMetadata();

    // Merge event.metadata with options.metadata (options takes precedence)
    const mergedMetadata =
      event.metadata || options.metadata
        ? { ...event.metadata, ...options.metadata }
        : undefined;

    for (const subscriber of subscribers) {
      // Check if subscriber is enabled
      const enabled = await this.isSubscriberEnabled(subscriber);
      if (!enabled) {
        skipped++;
        continue;
      }

      // Determine target queue
      const targetQueue = subscriber.targetQueue ?? this.defaultQueue;
      const qualifiedQueue = getQualifiedQueueName(this.namespace, targetQueue);

      // Create envelope
      const envelope = createEnvelope({
        eventKey,
        eventDescription: eventClass.description,
        targetSubscriber: subscriber.name,
        data: event.data,
        importance: subscriber.importance ?? 'should-investigate',
        correlationId: options.correlationId,
        metadata: mergedMetadata,
        universalMetadata,
        delayMs: options.delayMs,
      });

      // Send to transport
      this.enqueuingCount++;
      try {
        const usedTransport = await this.transport.send(
          qualifiedQueue,
          envelope,
          options.delayMs !== undefined
            ? { delay: options.delayMs }
            : undefined,
        );
        sent++;

        await this.hooks.onEnqueueSuccess({
          envelope,
          queue: qualifiedQueue,
          transport: usedTransport,
        });
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        const err = new TransportSendError(qualifiedQueue, cause);
        errors.push({
          subscriberName: subscriber.name,
          queue: qualifiedQueue,
          error: err,
        });

        await this.hooks.onEnqueueError({
          envelope,
          error: err,
          transport: this.transport.name,
        });
      } finally {
        this.enqueuingCount--;
      }
    }

    return {
      eventKey,
      subscribersSent: sent,
      subscribersSkipped: skipped,
      errors,
    };
  }

  private async isSubscriberEnabled(
    subscriber: AnySubscriber,
  ): Promise<boolean> {
    if (!subscriber.enabled) {
      return true;
    }

    try {
      const result = await subscriber.enabled();
      return result;
    } catch {
      // If enabled check fails, consider it enabled
      return true;
    }
  }
}
