import type { Checkpoint, CheckpointStore } from '../types.js';

/**
 * No-operation checkpoint store that doesn't persist anything.
 * Used when no checkpoint store is configured.
 *
 * With this store, resumable subscribers will work but checkpoints
 * won't persist across retries - all io() operations will re-execute.
 */
export class NoOpCheckpointStore implements CheckpointStore {
  async get(_envelopeId: string): Promise<Checkpoint | undefined> {
    return undefined;
  }

  async set(_envelopeId: string, _checkpoint: Checkpoint): Promise<void> {
    // No-op
  }

  async delete(_envelopeId: string): Promise<void> {
    // No-op
  }
}
