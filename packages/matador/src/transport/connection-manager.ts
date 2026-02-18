/**
 * Connection state machine states.
 */
export type ConnectionState =
  | { readonly status: 'disconnected' }
  | { readonly status: 'connecting'; readonly attempt: number }
  | { readonly status: 'connected' }
  | {
      readonly status: 'reconnecting';
      readonly attempt: number;
      readonly lastError: Error;
    }
  | { readonly status: 'failed'; readonly error: Error };

/**
 * Configuration for the connection manager.
 */
export interface ConnectionManagerConfig {
  /** Maximum reconnection attempts before giving up (0 = infinite) */
  readonly maxReconnectAttempts: number;

  /** Initial delay between reconnection attempts (ms) */
  readonly initialReconnectDelay: number;

  /** Maximum delay between reconnection attempts (ms) */
  readonly maxReconnectDelay: number;

  /** Backoff multiplier for reconnection delay */
  readonly backoffMultiplier: number;

  /** Heartbeat interval for connection health (ms), optional */
  readonly heartbeatInterval?: number;
}

/**
 * Default configuration values.
 */
export const defaultConnectionConfig: ConnectionManagerConfig = {
  maxReconnectAttempts: 0, // Infinite
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * Callback for state change notifications.
 */
export type StateChangeCallback = (state: ConnectionState) => void;

/**
 * Function that performs the actual connection.
 */
export type ConnectFn = () => Promise<void>;

/**
 * Function that performs disconnection.
 */
export type DisconnectFn = () => Promise<void>;

/**
 * Manages connection lifecycle with automatic reconnection.
 */
export class ConnectionManager {
  private _state: ConnectionState = { status: 'disconnected' };
  private readonly listeners: Set<StateChangeCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: ConnectionManagerConfig;

  constructor(
    private readonly connectFn: ConnectFn,
    private readonly disconnectFn: DisconnectFn,
    config: Partial<ConnectionManagerConfig> = {},
  ) {
    this.config = { ...defaultConnectionConfig, ...config };
  }

  /**
   * Current connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Whether currently connected.
   */
  isConnected(): boolean {
    return this._state.status === 'connected';
  }

  /**
   * Register a callback for connection state changes.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Attempt to establish connection.
   */
  async connect(): Promise<void> {
    if (this._state.status === 'connected') {
      return;
    }

    this.setState({ status: 'connecting', attempt: 1 });

    try {
      await this.connectFn();
      this.setState({ status: 'connected' });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.handleConnectionFailure(err, 1);
    }
  }

  /**
   * Gracefully disconnect.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();

    if (this._state.status === 'disconnected') {
      return;
    }

    try {
      await this.disconnectFn();
    } finally {
      this.setState({ status: 'disconnected' });
    }
  }

  /**
   * Called by transport when connection is lost unexpectedly.
   */
  async handleConnectionLost(error: Error): Promise<void> {
    if (this._state.status === 'disconnected') {
      return;
    }

    this.setState({ status: 'reconnecting', attempt: 1, lastError: error });
    await this.attemptReconnect(1);
  }

  /**
   * Calculate delay for a given attempt using exponential backoff.
   */
  calculateDelay(attempt: number): number {
    const delay =
      this.config.initialReconnectDelay *
      this.config.backoffMultiplier ** (attempt - 1);
    return Math.min(delay, this.config.maxReconnectDelay);
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private async handleConnectionFailure(
    error: Error,
    attempt: number,
  ): Promise<void> {
    if (this.shouldGiveUp(attempt)) {
      this.setState({ status: 'failed', error });
      throw error;
    }

    this.setState({
      status: 'reconnecting',
      attempt: attempt + 1,
      lastError: error,
    });
    await this.attemptReconnect(attempt + 1);
  }

  private shouldGiveUp(attempt: number): boolean {
    return (
      this.config.maxReconnectAttempts > 0 &&
      attempt >= this.config.maxReconnectAttempts
    );
  }

  private async attemptReconnect(attempt: number): Promise<void> {
    const delay = this.calculateDelay(attempt);

    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(resolve, delay);
    });

    if (this._state.status === 'disconnected') {
      return;
    }

    try {
      await this.connectFn();
      this.setState({ status: 'connected' });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.handleConnectionFailure(err, attempt);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
