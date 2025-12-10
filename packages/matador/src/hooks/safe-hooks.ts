import type { ConnectionState } from '../transport/index.js';
import type { Envelope, SubscriberDefinition } from '../types/index.js';
import {
  type DecodeErrorContext,
  type EnqueueErrorContext,
  type EnqueueSuccessContext,
  type EnqueueWarningContext,
  type Logger,
  type MatadorHooks,
  type WorkerErrorContext,
  type WorkerExecuteFn,
  type WorkerSuccessContext,
  consoleLogger,
} from './types.js';

/**
 * Wraps hooks with error handling to prevent hook errors from breaking processing.
 * All hooks become safe to call and will catch any errors internally.
 */
export class SafeHooks {
  static create(hooks?: MatadorHooks): SafeHooks {
    return new SafeHooks(hooks);
  }

  private readonly hooks: MatadorHooks;

  /** The logger instance used by Matador. */
  readonly logger: Logger;

  constructor(hooks: MatadorHooks = {}) {
    this.hooks = hooks;
    this.logger = hooks.logger ?? consoleLogger;
  }

  async onEnqueueSuccess(context: EnqueueSuccessContext): Promise<void> {
    await this.safeCall('onEnqueueSuccess', () =>
      this.hooks.onEnqueueSuccess?.(context),
    );
  }

  async onEnqueueWarning(context: EnqueueWarningContext): Promise<void> {
    await this.safeCall('onEnqueueWarning', () =>
      this.hooks.onEnqueueWarning?.(context),
    );
  }

  async onEnqueueError(context: EnqueueErrorContext): Promise<void> {
    await this.safeCall('onEnqueueError', () =>
      this.hooks.onEnqueueError?.(context),
    );
  }

  async onWorkerWrap(
    envelope: Envelope,
    subscriber: SubscriberDefinition,
    execute: WorkerExecuteFn,
  ): Promise<void> {
    if (this.hooks.onWorkerWrap) {
      try {
        await this.hooks.onWorkerWrap(envelope, subscriber, execute);
      } catch (error) {
        this.logger.warn(
          '[Matador] 🟡 Hook onWorkerWrap threw an error',
          error,
        );
        // Still try to execute if wrap failed
        await execute();
      }
    } else {
      await execute();
    }
  }

  async onWorkerBeforeProcess(
    envelope: Envelope,
    subscriber: SubscriberDefinition,
  ): Promise<void> {
    await this.safeCall('onWorkerBeforeProcess', () =>
      this.hooks.onWorkerBeforeProcess?.(envelope, subscriber),
    );
  }

  async onWorkerSuccess(context: WorkerSuccessContext): Promise<void> {
    await this.safeCall('onWorkerSuccess', () =>
      this.hooks.onWorkerSuccess?.(context),
    );
  }

  async onWorkerError(context: WorkerErrorContext): Promise<void> {
    await this.safeCall('onWorkerError', () =>
      this.hooks.onWorkerError?.(context),
    );
  }

  async onDecodeError(context: DecodeErrorContext): Promise<void> {
    await this.safeCall('onDecodeError', () =>
      this.hooks.onDecodeError?.(context),
    );
  }

  async onConnectionStateChange(state: ConnectionState): Promise<void> {
    await this.safeCall('onConnectionStateChange', () =>
      this.hooks.onConnectionStateChange?.(state),
    );
  }

  async loadUniversalMetadata(): Promise<Record<string, unknown>> {
    if (!this.hooks.loadUniversalMetadata) {
      return {};
    }

    try {
      const result = await this.hooks.loadUniversalMetadata();
      return result ?? {};
    } catch (error) {
      this.logger.warn(
        '[Matador] 🟡 Hook loadUniversalMetadata threw an error',
        error,
      );
      return {};
    }
  }

  async getQueueConcurrency(queueName: string): Promise<number | undefined> {
    if (!this.hooks.getQueueConcurrency) {
      return undefined;
    }

    try {
      return await this.hooks.getQueueConcurrency(queueName);
    } catch (error) {
      this.logger.warn(
        '[Matador] 🟡 Hook getQueueConcurrency threw an error',
        error,
      );
      return undefined;
    }
  }

  async getRetryDelay(
    envelope: Envelope,
    attemptNumber: number,
  ): Promise<number | undefined> {
    if (!this.hooks.getRetryDelay) {
      return undefined;
    }

    try {
      return await this.hooks.getRetryDelay(envelope, attemptNumber);
    } catch (error) {
      this.logger.warn('[Matador] 🟡 Hook getRetryDelay threw an error', error);
      return undefined;
    }
  }

  async getAttempts(envelope: Envelope): Promise<number | undefined> {
    if (!this.hooks.getAttempts) {
      return undefined;
    }

    try {
      return await this.hooks.getAttempts(envelope);
    } catch (error) {
      this.logger.warn('[Matador] 🟡 Hook getAttempts threw an error', error);
      return undefined;
    }
  }

  async getMaxDeliveries(envelope: Envelope): Promise<number | undefined> {
    if (!this.hooks.getMaxDeliveries) {
      return undefined;
    }

    try {
      return await this.hooks.getMaxDeliveries(envelope);
    } catch (error) {
      this.logger.warn(
        '[Matador] 🟡 Hook getMaxDeliveries threw an error',
        error,
      );
      return undefined;
    }
  }

  private async safeCall(
    hookName: string,
    fn: () => void | Promise<void> | undefined,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`[Matador] 🟡 Hook ${hookName} threw an error`, error);
    }
  }
}
