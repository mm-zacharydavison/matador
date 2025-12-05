/**
 * Shutdown state.
 */
export type ShutdownState =
  | 'running'
  | 'stopping-receive'
  | 'waiting-handlers'
  | 'stopping-enqueue'
  | 'disconnecting'
  | 'stopped';

/**
 * Configuration for shutdown manager.
 */
export interface ShutdownConfig {
  /** Timeout for graceful shutdown in milliseconds */
  readonly gracefulShutdownTimeout: number;

  /** Polling interval when waiting for handlers to idle */
  readonly idlePollingInterval: number;
}

/**
 * Default shutdown configuration.
 */
export const defaultShutdownConfig: ShutdownConfig = {
  gracefulShutdownTimeout: 30000,
  idlePollingInterval: 1000,
};

/**
 * Handler state tracking.
 */
export interface HandlersState {
  readonly eventsBeingProcessed: number;
  readonly eventsBeingEnqueued: number;
  readonly isIdle: boolean;
}

/**
 * Manages graceful shutdown of Matador.
 *
 * Shutdown sequence:
 * 1. Stop receiving new messages
 * 2. Wait for in-flight processing to complete
 * 3. Stop accepting new enqueue requests
 * 4. Disconnect transport
 */
export class ShutdownManager {
  private _state: ShutdownState = 'running';
  private readonly config: ShutdownConfig;
  private eventsBeingProcessed = 0;
  private acceptingEnqueue = true;

  constructor(
    private readonly getEnqueueCount: () => number,
    private readonly stopReceiving: () => Promise<void>,
    private readonly disconnectTransport: () => Promise<void>,
    config: Partial<ShutdownConfig> = {},
  ) {
    this.config = { ...defaultShutdownConfig, ...config };
  }

  /**
   * Current shutdown state.
   */
  get state(): ShutdownState {
    return this._state;
  }

  /**
   * Whether enqueue is currently allowed.
   */
  get isEnqueueAllowed(): boolean {
    return this.acceptingEnqueue;
  }

  /**
   * Gets current handler state.
   */
  getHandlersState(): HandlersState {
    const eventsBeingEnqueued = this.getEnqueueCount();
    return {
      eventsBeingProcessed: this.eventsBeingProcessed,
      eventsBeingEnqueued,
      isIdle: this.eventsBeingProcessed === 0 && eventsBeingEnqueued === 0,
    };
  }

  /**
   * Increment processing counter.
   */
  incrementProcessing(): void {
    this.eventsBeingProcessed++;
  }

  /**
   * Decrement processing counter.
   */
  decrementProcessing(): void {
    this.eventsBeingProcessed--;
  }

  /**
   * Performs graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this._state !== 'running') {
      return;
    }

    // 1. Stop receiving new messages
    this._state = 'stopping-receive';
    await this.stopReceiving();

    // 2. Wait for handlers to idle
    this._state = 'waiting-handlers';
    await this.waitForIdle();

    // 3. Stop accepting new enqueue requests
    this._state = 'stopping-enqueue';
    this.acceptingEnqueue = false;

    // 4. Disconnect transport
    this._state = 'disconnecting';
    await this.disconnectTransport();

    this._state = 'stopped';
  }

  /**
   * Forcefully stops without waiting.
   */
  async forceStop(): Promise<void> {
    this.acceptingEnqueue = false;
    await this.stopReceiving();
    await this.disconnectTransport();
    this._state = 'stopped';
  }

  private async waitForIdle(): Promise<void> {
    const deadline = Date.now() + this.config.gracefulShutdownTimeout;

    while (!this.getHandlersState().isIdle) {
      if (Date.now() > deadline) {
        console.warn(
          `Shutdown timeout reached with ${this.eventsBeingProcessed} events still processing`,
        );
        break;
      }

      await this.sleep(this.config.idlePollingInterval);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Creates a new shutdown manager.
 */
export function createShutdownManager(
  getEnqueueCount: () => number,
  stopReceiving: () => Promise<void>,
  disconnectTransport: () => Promise<void>,
  config?: Partial<ShutdownConfig>,
): ShutdownManager {
  return new ShutdownManager(
    getEnqueueCount,
    stopReceiving,
    disconnectTransport,
    config,
  );
}
