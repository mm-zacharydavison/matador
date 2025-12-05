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
 * Schema entry as a tuple: [EventClass, Subscribers[]]
 * This is the compact format for defining event-subscriber relationships.
 *
 * @example
 * ```typescript
 * const schema: MatadorSchema = {
 *   [UserCreatedEvent.key]: [UserCreatedEvent, [emailSubscriber, analyticsSubscriber]],
 *   [OrderPlacedEvent.key]: [OrderPlacedEvent, [invoiceSubscriber]],
 * };
 * ```
 */
export type SchemaEntryTuple<T = unknown> = readonly [
  eventClass: EventClass<T>,
  subscribers: readonly AnySubscriber<T>[],
];

/**
 * Matador schema mapping event keys to their definitions.
 * Supports both object format (SchemaEntry) and tuple format (SchemaEntryTuple).
 */
export type MatadorSchema = {
  readonly [eventKey: string]: SchemaEntry | SchemaEntryTuple;
};

/**
 * Type guard to check if a schema entry is in tuple format.
 */
export function isSchemaEntryTuple(
  entry: SchemaEntry | SchemaEntryTuple,
): entry is SchemaEntryTuple {
  return Array.isArray(entry);
}

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
