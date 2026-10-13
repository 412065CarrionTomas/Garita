export interface WeeklyScheduleTerminationPort {
  countForSite(siteIds: string[]): Promise<number>;
  terminateForSites(transaction: unknown, siteIds: string[]): Promise<void>;
}

export interface InProgressShiftClosurePort {
  closeForSites(transaction: unknown, siteIds: string[]): Promise<void>;
}

export const WEEKLY_SCHEDULE_TERMINATION_PORT = Symbol('WEEKLY_SCHEDULE_TERMINATION_PORT');
export const IN_PROGRESS_SHIFT_CLOSURE_PORT = Symbol('IN_PROGRESS_SHIFT_CLOSURE_PORT');

/** HU-32 replaces this placeholder with weekly schedule termination. */
export class NoopWeeklyScheduleTermination implements WeeklyScheduleTerminationPort {
  countForSite(_siteIds: string[]): Promise<number> {
    return Promise.resolve(0);
  }

  terminateForSites(_transaction: unknown, _siteIds: string[]): Promise<void> {
    return Promise.resolve();
  }
}

/** HU-10 replaces this placeholder with closure of shifts already in progress. */
export class NoopInProgressShiftClosure implements InProgressShiftClosurePort {
  closeForSites(_transaction: unknown, _siteIds: string[]): Promise<void> {
    return Promise.resolve();
  }
}
