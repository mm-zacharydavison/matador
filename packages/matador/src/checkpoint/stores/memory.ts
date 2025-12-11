import type { Checkpoint, CheckpointStore } from '../types.js';

/**
 * In-memory checkpoint store for testing and development.
 * Checkpoints are lost when the process restarts.
 *
 * For production use, implement a persistent store (e.g., RedisCheckpointStore).
 */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, Checkpoint>();

  async get(envelopeId: string): Promise<Checkpoint | undefined> {
    return this.checkpoints.get(envelopeId);
  }

  async set(envelopeId: string, checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(envelopeId, checkpoint);
  }

  async delete(envelopeId: string): Promise<void> {
    this.checkpoints.delete(envelopeId);
  }

  /**
   * Gets the number of stored checkpoints.
   * Useful for testing.
   */
  get size(): number {
    return this.checkpoints.size;
  }

  /**
   * Clears all stored checkpoints.
   * Useful for testing.
   */
  clear(): void {
    this.checkpoints.clear();
  }

  /**
   * Gets all stored checkpoint IDs.
   * Useful for testing.
   */
  keys(): string[] {
    return [...this.checkpoints.keys()];
  }
}
