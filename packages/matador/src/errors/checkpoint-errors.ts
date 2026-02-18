import { MatadorError } from './matador-errors.js';

/**
 * Thrown when a duplicate io() key is used within a single subscriber execution.
 * Each io() call must have a unique key to prevent cache collisions.
 */
export class DuplicateIoKeyError extends MatadorError {
  readonly description =
    'The same io() key was used multiple times in a single subscriber execution. ' +
    'Each io() call must have a unique key to ensure correct checkpoint behavior. ' +
    'ACTION: Ensure all io() keys are unique within the subscriber. ' +
    'For dynamic operations (e.g., loops), include a unique identifier in the key ' +
    '(e.g., `process-item-${item.id}`).';

  constructor(
    public readonly key: string,
    public readonly subscriberName: string,
  ) {
    super(
      `Duplicate io key "${key}" in subscriber "${subscriberName}". Each io() call must have a unique key.`,
    );
  }
}

/**
 * Thrown when checkpoint store operations fail.
 */
export class CheckpointStoreError extends MatadorError {
  readonly description =
    'A checkpoint store operation failed. This may cause issues with resumable subscribers. ' +
    'ACTION: Check the underlying storage system (Redis, etc.) for connectivity issues. ' +
    'The subscriber may re-execute operations that were already completed.';

  constructor(
    public readonly operation: 'get' | 'set' | 'delete',
    public readonly envelopeId: string,
    public readonly cause: Error,
  ) {
    super(
      `Checkpoint store ${operation} failed for envelope "${envelopeId}": ${cause.message}`,
    );
  }
}

/**
 * Type guard for DuplicateIoKeyError.
 */
export function isDuplicateIoKeyError(
  error: unknown,
): error is DuplicateIoKeyError {
  return error instanceof DuplicateIoKeyError;
}

/**
 * Type guard for CheckpointStoreError.
 */
export function isCheckpointStoreError(
  error: unknown,
): error is CheckpointStoreError {
  return error instanceof CheckpointStoreError;
}
