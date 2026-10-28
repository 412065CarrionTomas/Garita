export interface ShiftExecutionEffectsPort {
  /** HU-35: publish the supervisor notice for a guard or administrator early close. */
  notifyEarlyClose(shiftId: string, guardId: string, reason: string | null): Promise<void>;
  /** HU-44: offer the remaining time to another guard after an early close. */
  offerCoverage(shiftId: string, guardId: string): Promise<void>;
  /** HU-45: notify the assigned guard and send the fallback SMS when a site closes. */
  notifyGuardToLeave(transaction: unknown, shiftId: string, guardId: string | null): Promise<void>;
}

export const SHIFT_EXECUTION_EFFECTS_PORT = Symbol('SHIFT_EXECUTION_EFFECTS_PORT');

/** Story-specific modules implement these effects when HU-35, HU-44 and HU-45 are delivered. */
export class NoopShiftExecutionEffects implements ShiftExecutionEffectsPort {
  notifyEarlyClose(): Promise<void> {
    return Promise.resolve();
  }
  offerCoverage(): Promise<void> {
    return Promise.resolve();
  }
  notifyGuardToLeave(): Promise<void> {
    return Promise.resolve();
  }
}
