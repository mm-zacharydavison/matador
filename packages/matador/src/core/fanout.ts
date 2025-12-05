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
  readonly fallbackQueues?: readonly string[] | undefined;
}

/**
 * Result of dispatching an event.
 */
export interface DispatchResult {
  readonly eventKey: string;
  readonly subscribersDispatched: number;
  readonly subscribersSkipped: number;
  readonly errors: readonly DispatchError[];
}

/**
 * Error during dispatch.
 */
export interface DispatchError {
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
 * 4. Sending to appropriate queues with fallback
 */
export class FanoutEngine {
  private readonly transport: Transport;
  private readonly schema: SchemaRegistry;
  private readonly hooks: SafeHooks;
  private readonly namespace: string;
  private readonly defaultQueue: string;
  private readonly fallbackQueues: readonly string[];
  private enqueuingCount = 0;

  constructor(config: FanoutConfig) {
    this.transport = config.transport;
    this.schema = config.schema;
    this.hooks = config.hooks;
    this.namespace = config.namespace;
    this.defaultQueue = config.defaultQueue;
    this.fallbackQueues = config.fallbackQueues ?? [];
  }

  /**
   * Current count of events being enqueued.
   */
  get eventsBeingEnqueuedCount(): number {
    return this.enqueuingCount;
  }

  /**
   * Dispatches an event to all registered subscribers.
   */
  async dispatch<T>(
    eventClass: EventClass<T>,
    event: Event<T>,
    options: EventOptions = {},
  ): Promise<DispatchResult> {
    const eventKey = eventClass.key;
    const subscribers = this.schema.getSubscribers(eventKey);

    const errors: DispatchError[] = [];
    let dispatched = 0;
    let skipped = 0;

    // Load universal metadata
    const universalMetadata = await this.hooks.loadUniversalMetadata();

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
        targetSubscriber: subscriber.name,
        data: event.data,
        before: event.before,
        importance: subscriber.importance ?? 'should-investigate',
        correlationId: options.correlationId,
        metadata: options.metadata,
        universalMetadata,
        delayMs: options.delayMs,
      });

      // Send with fallback chain
      this.enqueuingCount++;
      try {
        await this.sendWithFallback(qualifiedQueue, envelope, options.delayMs);
        dispatched++;

        await this.hooks.onEnqueueSuccess({
          envelope,
          queue: qualifiedQueue,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({
          subscriberName: subscriber.name,
          queue: qualifiedQueue,
          error: err,
        });

        await this.hooks.onEnqueueError({
          envelope,
          error: err,
        });
      } finally {
        this.enqueuingCount--;
      }
    }

    return {
      eventKey,
      subscribersDispatched: dispatched,
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

  private async sendWithFallback(
    primaryQueue: string,
    envelope: ReturnType<typeof createEnvelope>,
    delayMs: number | undefined,
  ): Promise<void> {
    const queues = [
      primaryQueue,
      ...this.fallbackQueues.map((q) =>
        getQualifiedQueueName(this.namespace, q),
      ),
    ];

    let lastError: Error | undefined;

    for (let i = 0; i < queues.length; i++) {
      const queue = queues[i];
      if (!queue) continue;

      try {
        await this.transport.send(
          queue,
          envelope,
          delayMs !== undefined ? { delay: delayMs } : undefined,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Notify about fallback
        if (i < queues.length - 1) {
          const nextQueue = queues[i + 1];
          if (nextQueue) {
            await this.hooks.onEnqueueWarning({
              envelope,
              originalQueue: queue,
              fallbackQueue: nextQueue,
              error: lastError,
            });
          }
        }
      }
    }

    // All queues failed
    throw lastError ?? new Error('All queues failed');
  }
}

/**
 * Creates a new fanout engine.
 */
export function createFanoutEngine(config: FanoutConfig): FanoutEngine {
  return new FanoutEngine(config);
}
