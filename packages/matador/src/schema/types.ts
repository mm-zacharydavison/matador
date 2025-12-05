import type { AnySubscriber, EventClass } from '../types/index.js';

/**
 * Schema entry for a single event type.
 */
export interface SchemaEntry<T = unknown> {
  /** The event class */
  readonly eventClass: EventClass<T>;

  /** Subscribers for this event */
  readonly subscribers: readonly AnySubscriber<T>[];
}

/**
 * Matador schema mapping event keys to their definitions.
 * This is the type-safe way to define event-subscriber relationships.
 */
export type MatadorSchema = {
  readonly [eventKey: string]: SchemaEntry;
};

/**
 * Options for schema registration.
 */
export interface RegisterOptions {
  /** Override existing registration if present */
  readonly override?: boolean;
}

/**
 * Result of schema validation.
 */
export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SchemaIssue[];
}

/**
 * Individual schema issue.
 */
export interface SchemaIssue {
  readonly severity: 'error' | 'warning';
  readonly eventKey: string;
  readonly message: string;
}
