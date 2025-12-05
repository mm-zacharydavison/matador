import type { HasDescription } from '../errors/index.js';
import type {
  DeadLetterConfig,
  QueueDefinition,
  RetryConfig,
  Topology,
} from './types.js';

/**
 * Options for adding a queue.
 * Excludes 'name' as that is provided as the first argument to addQueue.
 */
export type QueueOptions = Omit<QueueDefinition, 'name'>;

/**
 * Error thrown when topology validation fails.
 */
export class TopologyValidationError extends Error implements HasDescription {
  readonly description =
    'The topology configuration is invalid. Check the issues array for ' +
    'specific validation failures such as missing namespace, invalid queue ' +
    'names, or conflicting settings. This error occurs during Matador ' +
    'initialization and must be fixed in the configuration.';

  constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'TopologyValidationError';
  }
}

/**
 * Fluent builder for creating Topology configurations.
 */
export class TopologyBuilder {
  /**
   * Creates a new TopologyBuilder instance.
   */
  static create(): TopologyBuilder {
    return new TopologyBuilder();
  }

  private namespace = '';
  private queues: QueueDefinition[] = [];
  private deadLetter: DeadLetterConfig = {
    unhandled: { enabled: true },
    undeliverable: { enabled: true },
  };
  private retry: RetryConfig = {
    enabled: true,
    defaultDelayMs: 1000,
    maxDelayMs: 300000, // 5 minutes
  };

  /**
   * Sets the namespace prefix for all queues.
   */
  withNamespace(namespace: string): this {
    this.namespace = namespace;
    return this;
  }


  /**
   * Adds a queue to the topology.
   */
  addQueue(name: string, options: QueueOptions = {}): this {
    this.queues.push({ name, ...options });
    return this;
  }

  /**
   * Alias for addQueue().
   */
  queue(name: string, options: QueueOptions = {}): this {
    return this.addQueue(name, options);
  }

  /**
   * Configures dead-letter queue settings.
   */
  withDeadLetter(config: Partial<DeadLetterConfig>): this {
    this.deadLetter = {
      unhandled: config.unhandled ?? this.deadLetter.unhandled,
      undeliverable: config.undeliverable ?? this.deadLetter.undeliverable,
    };
    return this;
  }

  /**
   * Configures retry settings.
   */
  withRetry(config: Partial<RetryConfig>): this {
    this.retry = {
      enabled: config.enabled ?? this.retry.enabled,
      defaultDelayMs: config.defaultDelayMs ?? this.retry.defaultDelayMs,
      maxDelayMs: config.maxDelayMs ?? this.retry.maxDelayMs,
    };
    return this;
  }

  /**
   * Disables retry functionality.
   */
  withoutRetry(): this {
    this.retry = { ...this.retry, enabled: false };
    return this;
  }

  /**
   * Disables dead-letter queues.
   */
  withoutDeadLetter(): this {
    this.deadLetter = {
      unhandled: { enabled: false },
      undeliverable: { enabled: false },
    };
    return this;
  }

  /**
   * Validates the topology configuration.
   */
  validate(): readonly string[] {
    const issues: string[] = [];

    if (!this.namespace || this.namespace.trim() === '') {
      issues.push('Namespace is required');
    } else if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(this.namespace)) {
      issues.push(
        'Namespace must start with a letter and contain only alphanumeric characters, underscores, and hyphens',
      );
    }

    if (this.queues.length === 0) {
      issues.push('At least one queue is required');
    }

    const queueNames = new Set<string>();
    for (const queue of this.queues) {
      if (!queue.name || queue.name.trim() === '') {
        issues.push('Queue name cannot be empty');
      } else if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(queue.name)) {
        issues.push(
          `Queue name "${queue.name}" must start with a letter and contain only alphanumeric characters, underscores, and hyphens`,
        );
      } else if (queueNames.has(queue.name)) {
        issues.push(`Duplicate queue name: "${queue.name}"`);
      } else {
        queueNames.add(queue.name);
      }

      if (queue.concurrency !== undefined && queue.concurrency < 1) {
        issues.push(`Queue "${queue.name}" concurrency must be at least 1`);
      }

      if (queue.consumerTimeout !== undefined && queue.consumerTimeout < 0) {
        issues.push(
          `Queue "${queue.name}" consumer timeout must be non-negative`,
        );
      }
    }

    if (this.retry.enabled) {
      if (this.retry.defaultDelayMs < 0) {
        issues.push('Default retry delay must be non-negative');
      }
      if (this.retry.maxDelayMs < this.retry.defaultDelayMs) {
        issues.push(
          'Max retry delay must be greater than or equal to default delay',
        );
      }
    }

    return issues;
  }

  /**
   * Builds the topology configuration.
   * @throws TopologyValidationError if validation fails
   */
  build(): Topology {
    const issues = this.validate();
    if (issues.length > 0) {
      throw new TopologyValidationError(
        `Invalid topology: ${issues.join('; ')}`,
        issues,
      );
    }

    return {
      namespace: this.namespace,
      queues: [...this.queues],
      deadLetter: this.deadLetter,
      retry: this.retry,
    };
  }
}

