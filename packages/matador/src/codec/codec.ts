import type { HasDescription } from '../errors/index.js';
import type { Envelope } from '../types/index.js';

/**
 * Codec interface for serializing/deserializing envelopes.
 */
export interface Codec {
  /**
   * Encodes an envelope to a buffer for transport.
   */
  encode(envelope: Envelope): Uint8Array;

  /**
   * Decodes a buffer back to an envelope.
   * @throws Error if the buffer is invalid or cannot be decoded
   */
  decode(buffer: Uint8Array): Envelope;

  /**
   * MIME content type for this codec.
   */
  readonly contentType: string;
}

/**
 * Error thrown when decoding fails.
 */
export class CodecDecodeError extends Error implements HasDescription {
  readonly description =
    'Failed to decode a message from the transport. This typically indicates ' +
    'corrupted data, incompatible codec versions, or messages from a different ' +
    'system. Check the cause property for the underlying parsing error. ' +
    'The message will be sent to the dead-letter queue for investigation.';

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CodecDecodeError';
  }
}
