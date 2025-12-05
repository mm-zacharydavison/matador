import type { Importance } from './common.js';

/**
 * Message envelope containing the event payload and routing/observability metadata.
 * This is the transport-agnostic message format used throughout Matador.
 */
export interface Envelope<T = unknown> {
  /** Unique message ID (UUID v4) */
  readonly id: string;

  /** The event payload data */
  readonly payload: EnvelopePayload<T>;

  /** Routing and observability metadata */
  readonly docket: Docket;

  /**
   * Attempt counter managed by Matador (1-based).
   * Incremented on each retry. Used when transport doesn't track attempts.
   */
  attempts: number;

  /** When the envelope was first created (ISO 8601 string) */
  readonly createdAt: string;

  /** Scheduled processing time for delayed messages (ISO 8601 string) */
  scheduledFor?: string | undefined;
}

/**
 * Envelope payload structure containing the event data.
 */
export interface EnvelopePayload<T = unknown> {
  /** The event data */
  readonly data: T;
}

/**
 * Metadata associated with an envelope for routing and observability.
 */
export interface Docket {
  /** Event key for routing */
  readonly eventKey: string;

  /** Target subscriber name for 1:1 routing */
  readonly targetSubscriber: string;

  /** Correlation ID for request tracing */
  readonly correlationId?: string | undefined;

  /** Importance level for monitoring */
  readonly importance: Importance;

  /**
   * Custom metadata provided by the application.
   * This is the merged result of universal metadata (from loadUniversalMetadata hook)
   * and event-specific metadata (from dispatch options). Event-specific metadata
   * overrides universal metadata when keys conflict.
   */
  readonly metadata?: Record<string, unknown> | undefined;

  /** Error message from first failure (for debugging) */
  firstError?: string | undefined;

  /** Error message from most recent failure */
  lastError?: string | undefined;

  /** Original queue before any dead-letter routing */
  originalQueue?: string | undefined;
}

/**
 * Fields from Docket that can be specified when creating an envelope.
 */
type DocketCreateFields = Pick<
  Docket,
  'eventKey' | 'targetSubscriber' | 'importance' | 'correlationId'
>;

/**
 * Fields from EnvelopePayload that can be specified when creating an envelope.
 */
type PayloadCreateFields<T> = Pick<EnvelopePayload<T>, 'data'>;

/**
 * Options for creating an envelope.
 */
export interface CreateEnvelopeOptions<T>
  extends DocketCreateFields,
    PayloadCreateFields<T> {
  /** Optional custom ID (defaults to UUID v4) */
  readonly id?: string | undefined;

  /**
   * Event-specific metadata to include in the docket.
   * Will be merged with universal metadata, with these values taking precedence.
   */
  readonly metadata?: Record<string, unknown> | undefined;

  /**
   * Universal metadata loaded from the loadUniversalMetadata hook.
   * This is provided by the fanout engine, not by the caller.
   * @internal
   */
  readonly universalMetadata?: Record<string, unknown> | undefined;

  /** Delay processing by this many milliseconds */
  readonly delayMs?: number | undefined;
}

/**
 * Creates a new envelope with the provided options.
 */
export function createEnvelope<T>(
  options: CreateEnvelopeOptions<T>,
): Envelope<T> {
  const now = new Date().toISOString();

  // Merge universal metadata with event-specific metadata
  // Event-specific metadata takes precedence
  const mergedMetadata =
    options.universalMetadata || options.metadata
      ? { ...options.universalMetadata, ...options.metadata }
      : undefined;

  return {
    id: options.id ?? crypto.randomUUID(),
    payload: {
      data: options.data,
    },
    docket: {
      eventKey: options.eventKey,
      targetSubscriber: options.targetSubscriber,
      importance: options.importance,
      ...(options.correlationId !== undefined && {
        correlationId: options.correlationId,
      }),
      ...(mergedMetadata !== undefined && { metadata: mergedMetadata }),
    },
    attempts: 1,
    createdAt: now,
    ...(options.delayMs !== undefined &&
      options.delayMs > 0 && {
        scheduledFor: new Date(Date.now() + options.delayMs).toISOString(),
      }),
  };
}
