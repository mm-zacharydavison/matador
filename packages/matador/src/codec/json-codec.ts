import type { Envelope } from '../types/index.js';
import type { Codec } from './codec.js';
import { CodecDecodeError } from './codec.js';

/**
 * JSON codec for envelope serialization.
 * Uses standard JSON.stringify/parse with Date handling.
 */
export class JsonCodec implements Codec {
  readonly contentType = 'application/json';

  encode(envelope: Envelope): Uint8Array {
    const json = JSON.stringify(envelope);
    return new TextEncoder().encode(json);
  }

  decode(buffer: Uint8Array): Envelope {
    if (buffer.length === 0) {
      throw new CodecDecodeError('Cannot decode empty buffer');
    }

    let json: string;
    try {
      json = new TextDecoder('utf-8').decode(buffer);
    } catch (error) {
      throw new CodecDecodeError('Invalid UTF-8 encoding', error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new CodecDecodeError('Invalid JSON', error);
    }

    if (!this.isValidEnvelope(parsed)) {
      throw new CodecDecodeError('Invalid envelope structure');
    }

    return parsed;
  }

  private isValidEnvelope(value: unknown): value is Envelope {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const envelope = value as Record<string, unknown>;

    // Required top-level fields
    if (typeof envelope['id'] !== 'string') return false;
    if (typeof envelope['payload'] !== 'object' || envelope['payload'] === null)
      return false;
    if (typeof envelope['docket'] !== 'object' || envelope['docket'] === null)
      return false;

    // Validate docket (routing, processing state, observability)
    const docket = envelope['docket'] as Record<string, unknown>;
    // Routing
    if (typeof docket['eventKey'] !== 'string') return false;
    if (typeof docket['targetSubscriber'] !== 'string') return false;
    // Processing state
    if (typeof docket['attempts'] !== 'number') return false;
    if (typeof docket['createdAt'] !== 'string') return false;
    // Observability
    if (typeof docket['importance'] !== 'string') return false;

    // Validate payload
    const payload = envelope['payload'] as Record<string, unknown>;
    if (!('data' in payload)) return false;

    return true;
  }
}

/**
 * Creates a new JSON codec instance.
 */
export function createJsonCodec(): JsonCodec {
  return new JsonCodec();
}
