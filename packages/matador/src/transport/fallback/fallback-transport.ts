import type { TransportFallbackContext } from '../../hooks/index.js';
import type { Topology } from '../../topology/types.js';
import type { Envelope } from '../../types/index.js';
import type { TransportCapabilities } from '../capabilities.js';
import type {
  MessageHandler,
  MessageReceipt,
  SendOptions,
  SubscribeOptions,
  Subscription,
  Transport,
} from '../transport.js';

/**
 * Symbol key used to store the source transport on wrapped receipts.
 */
const SOURCE_TRANSPORT = Symbol('sourceTransport');

/**
 * Extracts the source transport from a tagged receipt.
 */
function getSourceTransport(receipt: MessageReceipt): Transport | undefined {
  return (receipt as unknown as Record<symbol, Transport | undefined>)[
    SOURCE_TRANSPORT
  ];
}

/**
 * Configuration for FallbackTransport.
 */
export interface FallbackTransportConfig {
  /**
   * Ordered list of transports to try.
   * First transport is primary, rest are fallbacks tried in order.
   */
  readonly transports: readonly Transport[];

  /**
   * Called when a fallback transport is used successfully.
   */
  readonly onFallback?: (context: TransportFallbackContext) => void;
}

/**
 * Computes merged capabilities from multiple transports.
 * Uses the most restrictive/conservative interpretation.
 */
function mergeCapabilities(
  transports: readonly Transport[],
): TransportCapabilities {
  const primary = transports[0];
  if (!primary) {
    throw new Error('At least one transport is required');
  }

  // For fallback scenarios, we use primary's capabilities since that's
  // what we'll use for subscriptions and most operations
  return primary.capabilities;
}

/**
 * A transport wrapper that tries multiple transports in order for send operations.
 *
 * - All transports are connected upfront
 * - Every send() tries the primary transport first, then fallbacks in order
 * - Subscriptions and other operations use the primary transport only
 *
 * @example
 * ```typescript
 * const transport = new FallbackTransport({
 *   transports: [rabbitMQTransport, memoryTransport],
 *   onFallback: (ctx) => console.warn(`Fallback to ${ctx.successTransport}`),
 * });
 * ```
 */
export class FallbackTransport implements Transport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  readonly primary: Transport;

  private readonly transports: readonly Transport[];
  private readonly onFallback:
    | ((context: TransportFallbackContext) => void)
    | undefined;
  private connected = false;

  constructor(config: FallbackTransportConfig) {
    const primary = config.transports[0];
    if (!primary) {
      throw new Error('At least one transport is required');
    }

    this.primary = primary;
    this.transports = config.transports;
    this.onFallback = config.onFallback;
    this.name = `fallback(${this.transports.map((t) => t.name).join(',')})`;
    this.capabilities = mergeCapabilities(this.transports);
  }

  async connect(): Promise<void> {
    // Connect all transports in parallel
    await Promise.all(this.transports.map((t) => t.connect()));
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    // Disconnect all transports in parallel
    await Promise.all(this.transports.map((t) => t.disconnect()));
    this.connected = false;
  }

  isConnected(): boolean {
    // Consider connected if primary is connected
    return this.connected && this.primary.isConnected();
  }

  async applyTopology(topology: Topology): Promise<void> {
    // Apply topology to all transports so fallbacks are ready
    await Promise.all(this.transports.map((t) => t.applyTopology(topology)));
  }

  async send(
    queue: string,
    envelope: Envelope,
    options?: SendOptions,
  ): Promise<void> {
    let lastError: Error | undefined;
    let lastFailedTransportName: string | undefined;

    for (const transport of this.transports) {
      try {
        await transport.send(queue, envelope, options);

        // If we had a previous failure, notify about fallback
        if (lastError && lastFailedTransportName && this.onFallback) {
          this.onFallback({
            envelope,
            queue,
            failedTransport: lastFailedTransportName,
            successTransport: transport.name,
            error: lastError,
          });
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        lastFailedTransportName = transport.name;
        // Continue to next transport
      }
    }

    // All transports failed
    throw lastError ?? new Error('All transports failed to send message');
  }

  async subscribe(
    queue: string,
    handler: MessageHandler,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    // Subscribe on ALL transports so messages are processed regardless of
    // which transport they were enqueued to (primary or fallback)
    const subscriptions = await Promise.all(
      this.transports.map((transport) => {
        // Wrap handler to tag receipts with source transport
        const wrappedHandler: MessageHandler = (envelope, receipt) => {
          const taggedReceipt = Object.assign(receipt, {
            [SOURCE_TRANSPORT]: transport,
          });
          return handler(envelope, taggedReceipt);
        };
        return transport.subscribe(queue, wrappedHandler, options);
      }),
    );

    return {
      unsubscribe: async () => {
        await Promise.all(subscriptions.map((s) => s.unsubscribe()));
      },
      get isActive() {
        return subscriptions.some((s) => s.isActive);
      },
    };
  }

  async complete(receipt: MessageReceipt): Promise<void> {
    const transport = getSourceTransport(receipt) ?? this.primary;
    return transport.complete(receipt);
  }

  async sendToDeadLetter(
    receipt: MessageReceipt,
    dlqName: string,
    envelope: Envelope,
    reason: string,
  ): Promise<void> {
    const transport = getSourceTransport(receipt) ?? this.primary;
    if (transport.sendToDeadLetter) {
      return transport.sendToDeadLetter(receipt, dlqName, envelope, reason);
    }
    throw new Error('Transport does not support dead letter routing');
  }
}
