import type { ConnectionState } from '../transport/index.js';
import type { Envelope, SubscriberDefinition } from '../types/index.js';
import type {
  DecodeErrorContext,
  EnqueueErrorContext,
  EnqueueSuccessContext,
  EnqueueWarningContext,
  MatadorHooks,
  WorkerErrorContext,
  WorkerExecuteFn,
  WorkerSuccessContext,
} from './types.js';

/**
 * Logger interface for hook errors.
 */
export interface HookLogger {
  warn(message: string, error?: unknown): void;
}

/**
 * Default no-op logger.
 */
const noopLogger: HookLogger = {
  warn: () => {},
};

/**
 * Wraps hooks with error handling to prevent hook errors from breaking processing.
 * All hooks become safe to call and will catch any errors internally.
 */
export class SafeHooks {
  private readonly hooks: MatadorHooks;
  private readonly logger: HookLogger;

  constructor(hooks: MatadorHooks = {}, logger: HookLogger = noopLogger) {
    this.hooks = hooks;
    this.logger = logger;
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
        this.logger.warn('Hook onWorkerWrap threw an error', error);
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
      this.logger.warn('Hook loadUniversalMetadata threw an error', error);
      return {};
    }
  }

  getQueueConcurrency(queueName: string): number | undefined {
    if (!this.hooks.getQueueConcurrency) {
      return undefined;
    }

    try {
      return this.hooks.getQueueConcurrency(queueName);
    } catch (error) {
      this.logger.warn('Hook getQueueConcurrency threw an error', error);
      return undefined;
    }
  }

  getRetryDelay(envelope: Envelope, attemptNumber: number): number | undefined {
    if (!this.hooks.getRetryDelay) {
      return undefined;
    }

    try {
      return this.hooks.getRetryDelay(envelope, attemptNumber);
    } catch (error) {
      this.logger.warn('Hook getRetryDelay threw an error', error);
      return undefined;
    }
  }

  getAttempts(envelope: Envelope): number | undefined {
    if (!this.hooks.getAttempts) {
      return undefined;
    }

    try {
      return this.hooks.getAttempts(envelope);
    } catch (error) {
      this.logger.warn('Hook getAttempts threw an error', error);
      return undefined;
    }
  }

  getMaxDeliveries(envelope: Envelope): number | undefined {
    if (!this.hooks.getMaxDeliveries) {
      return undefined;
    }

    try {
      return this.hooks.getMaxDeliveries(envelope);
    } catch (error) {
      this.logger.warn('Hook getMaxDeliveries threw an error', error);
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
      this.logger.warn(`Hook ${hookName} threw an error`, error);
    }
  }
}

/**
 * Creates a SafeHooks wrapper.
 */
export function createSafeHooks(
  hooks?: MatadorHooks,
  logger?: HookLogger,
): SafeHooks {
  return new SafeHooks(hooks, logger);
}
