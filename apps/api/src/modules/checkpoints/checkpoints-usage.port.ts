export interface CheckpointUsagePort {
  findActiveRoundsUsing(checkpointId: string): Promise<{ id: string; name: string }[]>;
}

export const CHECKPOINT_USAGE_PORT = Symbol('CHECKPOINT_USAGE_PORT');

/** HU-08 replaces this empty Sprint 1 adapter with the active-round lookup. */
export class EmptyCheckpointUsageAdapter implements CheckpointUsagePort {
  findActiveRoundsUsing(_checkpointId: string): Promise<{ id: string; name: string }[]> {
    return Promise.resolve([]);
  }
}
