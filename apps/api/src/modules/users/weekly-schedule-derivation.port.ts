export interface WeeklyScheduleDerivationPort {
  deriveForGuard(
    transaction: unknown,
    fromGuardId: string,
    toGuardId: string | null,
  ): Promise<void>;
}

export const WEEKLY_SCHEDULE_DERIVATION_PORT = Symbol('WEEKLY_SCHEDULE_DERIVATION_PORT');

/** ID-121 / HU-32 replaces this placeholder with weekly schedule derivation. */
export class NoopWeeklyScheduleDerivation implements WeeklyScheduleDerivationPort {
  deriveForGuard(
    _transaction: unknown,
    _fromGuardId: string,
    _toGuardId: string | null,
  ): Promise<void> {
    return Promise.resolve();
  }
}
