import type { Codec } from '../codec/index.js';
import { CodecDecodeError } from '../codec/index.js';
import {
  SubscriberIsStubError,
  SubscriberNotRegisteredError,
} from '../errors/index.js';
import type { SafeHooks } from '../hooks/index.js';
import type { RetryDecision, RetryPolicy } from '../retry/index.js';
import type { SchemaRegistry } from '../schema/index.js';
import type { MessageReceipt, Transport } from '../transport/index.js';
import type { Envelope, SubscriberDefinition } from '../types/index.js';

/**
 * Configuration for the processing pipeline.
 */
export interface PipelineConfig {
  readonly transport: Transport;
  readonly schema: SchemaRegistry;
  readonly codec: Codec;
  readonly retryPolicy: RetryPolicy;
  readonly hooks: SafeHooks;
}

/**
 * Result of pipeline processing.
 */
export interface ProcessResult {
  readonly success: boolean;
  readonly envelope?: Envelope | undefined;
  readonly subscriber?: SubscriberDefinition | undefined;
  readonly error?: Error | undefined;
  readonly decision?: RetryDecision | undefined;
  readonly durationMs: number;
}

/**
 * Processing pipeline for incoming messages.
 *
 * Handles the complete message lifecycle:
 * 1. Decode envelope from raw bytes
 * 2. Lookup subscriber from schema
 * 3. Execute subscriber callback with hooks
 * 4. Handle success/failure with retry policy
 */
export class ProcessingPipeline {
  private readonly transport: Transport;
  private readonly schema: SchemaRegistry;
  private readonly codec: Codec;
  private readonly retryPolicy: RetryPolicy;
  private readonly hooks: SafeHooks;

  constructor(config: PipelineConfig) {
    this.transport = config.transport;
    this.schema = config.schema;
    this.codec = config.codec;
    this.retryPolicy = config.retryPolicy;
    this.hooks = config.hooks;
  }

  /**
   * Processes a raw message from the transport.
   */
  async process(
    rawMessage: Uint8Array,
    receipt: MessageReceipt,
  ): Promise<ProcessResult> {
    const startTime = performance.now();

    // 1. Decode envelope
    let envelope: Envelope;
    try {
      envelope = this.codec.decode(rawMessage);
    } catch (error) {
      const decodeError =
        error instanceof CodecDecodeError
          ? error
          : new CodecDecodeError('Unknown decode error', error);

      await this.transport.complete(receipt);
      await this.hooks.onDecodeError({
        error: decodeError,
        rawMessage,
        sourceQueue: receipt.sourceQueue,
      });

      return {
        success: false,
        error: decodeError,
        durationMs: performance.now() - startTime,
      };
    }

    // 2. Lookup subscriber from schema
    const subscriberDef = this.schema.getSubscriberDefinition(
      envelope.docket.eventKey,
      envelope.docket.targetSubscriber,
    );

    if (!subscriberDef) {
      const error = new SubscriberNotRegisteredError(
        envelope.docket.targetSubscriber,
        envelope.docket.eventKey,
      );
      await this.sendToDeadLetter(
        receipt,
        envelope,
        'unhandled',
        error.message,
      );

      return {
        success: false,
        envelope,
        error,
        durationMs: performance.now() - startTime,
      };
    }

    // Get executable subscriber
    const subscriber = this.schema.getExecutableSubscriber(
      envelope.docket.eventKey,
      envelope.docket.targetSubscriber,
    );

    if (!subscriber) {
      // Subscriber is a stub (remote implementation)
      const error = new SubscriberIsStubError(envelope.docket.targetSubscriber);
      await this.sendToDeadLetter(
        receipt,
        envelope,
        'unhandled',
        error.message,
      );

      return {
        success: false,
        envelope,
        subscriber: subscriberDef,
        error,
        durationMs: performance.now() - startTime,
      };
    }

    // 3. Execute subscriber callback with hooks
    let result: unknown;
    let error: Error | undefined;

    await this.hooks.onWorkerWrap(envelope, subscriberDef, async () => {
      await this.hooks.onWorkerBeforeProcess(envelope, subscriberDef);

      try {
        result = await subscriber.callback(
          envelope.data,
          envelope.docket,
        );
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      }
    });

    const durationMs = performance.now() - startTime;

    // 4. Handle success
    if (!error) {
      await this.transport.complete(receipt);
      await this.hooks.onWorkerSuccess({
        envelope,
        subscriber: subscriberDef,
        result,
        durationMs,
      });

      return {
        success: true,
        envelope,
        subscriber: subscriberDef,
        durationMs,
      };
    }

    // 5. Handle failure - consult retry policy
    const decision = this.retryPolicy.shouldRetry({
      envelope,
      error,
      subscriber: subscriberDef,
      receipt,
    });

    // Update envelope with error info
    envelope.docket.lastError = error.message;
    envelope.docket.firstError ??= error.message;

    await this.handleRetryDecision(receipt, envelope, decision);

    await this.hooks.onWorkerError({
      envelope,
      subscriber: subscriberDef,
      error,
      durationMs,
      decision,
    });

    return {
      success: false,
      envelope,
      subscriber: subscriberDef,
      error,
      decision,
      durationMs,
    };
  }

  private async handleRetryDecision(
    receipt: MessageReceipt,
    envelope: Envelope,
    decision: RetryDecision,
  ): Promise<void> {
    switch (decision.action) {
      case 'retry': {
        // Increment attempts and schedule retry
        envelope.docket.attempts++;
        envelope.docket.scheduledFor = new Date(
          Date.now() + decision.delay,
        ).toISOString();

        await this.transport.send(receipt.sourceQueue, envelope, {
          delay: decision.delay,
        });
        await this.transport.complete(receipt);
        break;
      }

      case 'dead-letter': {
        await this.sendToDeadLetter(
          receipt,
          envelope,
          decision.queue,
          decision.reason,
        );
        break;
      }

      case 'discard': {
        await this.transport.complete(receipt);
        break;
      }
    }
  }

  private async sendToDeadLetter(
    receipt: MessageReceipt,
    envelope: Envelope,
    dlqName: string,
    reason: string,
  ): Promise<void> {
    envelope.docket.originalQueue ??= receipt.sourceQueue;

    if (this.transport.sendToDeadLetter) {
      await this.transport.sendToDeadLetter(receipt, dlqName, envelope, reason);
    } else {
      // Manual: send to DLQ then complete original
      const fullDlqName = `${receipt.sourceQueue}.${dlqName}`;
      await this.transport.send(fullDlqName, envelope);
      await this.transport.complete(receipt);
    }
  }
}

/**
 * Creates a new processing pipeline.
 */
export function createPipeline(config: PipelineConfig): ProcessingPipeline {
  return new ProcessingPipeline(config);
}
