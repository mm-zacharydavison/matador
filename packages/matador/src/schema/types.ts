import type {
  AnySubscriber,
  EventClass,
  MatadorEvent,
  Subscriber,
  SubscriberStub,
} from '../types/index.js';

/**
 * Type-safe schema entry for a single event type (object format).
 * The type parameter enforces that subscribers match the event type.
 */
export interface SchemaEntry<T extends MatadorEvent = MatadorEvent> {
  /** The event class */
  readonly eventClass: EventClass<T['data']>;

  /** Subscribers for this event */
  readonly subscribers: readonly (Subscriber<T> | SubscriberStub)[];
}

/**
 * Type-safe schema entry as a tuple: [EventClass, Subscribers[]]
 * The type parameter enforces that subscribers match the event type.
 *
 * @example
 * ```typescript
 * const entry: SchemaEntryTuple<UserCreatedEvent> = [
 *   UserCreatedEvent,
 *   [createSubscriber<UserCreatedEvent>('handler', async (env) => {})]
 * ];
 * ```
 */
export type SchemaEntryTuple<T extends MatadorEvent = MatadorEvent> = readonly [
  eventClass: EventClass<T['data']>,
  subscribers: readonly (Subscriber<T> | SubscriberStub)[],
];

/**
 * Creates a type-safe schema entry tuple.
 * Ensures that subscribers are compatible with the event class at compile time.
 *
 * @example
 * ```typescript
 * const schema = {
 *   [UserCreatedEvent.key]: bind(UserCreatedEvent, [
 *     createSubscriber<UserCreatedEvent>('send-email', async (env) => {
 *       console.log(env.data.email); // Type-safe access
 *     }),
 *   ]),
 * } satisfies MatadorSchema;
 * ```
 */
export function bind<T extends MatadorEvent>(
  eventClass: EventClass<T['data']>,
  subscribers: readonly (Subscriber<T> | SubscriberStub)[],
): SchemaEntryTuple<T> {
  return [eventClass, subscribers] as const;
}

/**
 * Minimal type for event class in schema storage.
 * Only requires the static `key` property for routing.
 * Constructor constraint is omitted to allow heterogeneous event types.
 */
// biome-ignore lint/suspicious/noExplicitAny: Constructor accepts any data type for variance compatibility
export type AnyEventClass = {
  readonly key: string;
  new (data: any): MatadorEvent;
};

/**
 * Runtime schema entry stored in MatadorSchema (object format).
 * Uses AnySubscriber and AnyEventClass to allow heterogeneous event types.
 * Type safety is enforced at definition time via `schemaEntry()` helper.
 */
export interface RuntimeSchemaEntry {
  readonly eventClass: AnyEventClass;
  readonly subscribers: readonly AnySubscriber[];
}

/**
 * Runtime schema tuple stored in MatadorSchema.
 * Uses AnySubscriber and AnyEventClass to allow heterogeneous event types.
 * Type safety is enforced at definition time via `schemaEntry()` helper.
 */
export type RuntimeSchemaEntryTuple = readonly [
  eventClass: AnyEventClass,
  subscribers: readonly AnySubscriber[],
];

/**
 * Matador schema mapping event keys to their definitions.
 * Supports both object format (SchemaEntry) and tuple format (SchemaEntryTuple).
 *
 * For type-safe schema definitions, use the `bind` helper function
 * which ensures subscribers are compatible with their event class.
 *
 * @example
 * ```typescript
 * // Type-safe with bind helper:
 * const schema = {
 *   [UserCreatedEvent.key]: bind(UserCreatedEvent, [emailSubscriber]),
 * } satisfies MatadorSchema;
 *
 * // Or inline (less type-safe):
 * const schema: MatadorSchema = {
 *   [UserCreatedEvent.key]: [UserCreatedEvent, [emailSubscriber]],
 * };
 * ```
 */
export type MatadorSchema = {
  readonly [eventKey: string]: RuntimeSchemaEntry | RuntimeSchemaEntryTuple;
};

/**
 * Type guard to check if a schema entry is in tuple format.
 */
export function isSchemaEntryTuple(
  entry: RuntimeSchemaEntry | RuntimeSchemaEntryTuple,
): entry is RuntimeSchemaEntryTuple {
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
