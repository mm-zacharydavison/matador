import type { Envelope } from '../types/index.js';

/**
 * Result of encoding an envelope with header support.
 */
export interface EncodedMessage {
  /** Serialized message body */
  readonly body: Uint8Array;

  /** Headers to attach to the message */
  readonly headers: Record<string, unknown>;

  /** MIME content type */
  readonly contentType: string;
}

/**
 * Codec interface for transports that support message headers (e.g., RabbitMQ).
 *
 * Unlike the basic Codec interface, this allows metadata to be stored in
 * headers rather than duplicated in the body, which is more efficient and
 * enables transport-level filtering/routing.
 */
export interface HeaderAwareCodec {
  /**
   * Encodes an envelope into a body buffer and headers.
   * The body should contain only the essential payload data.
   * Routing and observability metadata should go in headers.
   */
  encode(envelope: Envelope): EncodedMessage;

  /**
   * Decodes a body buffer and headers back into an envelope.
   */
  decode(body: Uint8Array, headers: Record<string, unknown>): Envelope;

  /**
   * MIME content type for the body.
   */
  readonly contentType: string;
}
