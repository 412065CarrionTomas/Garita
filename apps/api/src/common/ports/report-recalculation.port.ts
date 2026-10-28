import { Injectable } from '@nestjs/common';

export interface ReportRecalculationPort {
  recalculate(input: { companyId: string; shiftId: string }): Promise<void>;
}

export const REPORT_RECALCULATION_PORT = Symbol('REPORT_RECALCULATION_PORT');

@Injectable()
export class NoopReportRecalculation implements ReportRecalculationPort {
  // TODO(E6): replace with the report recalculation worker.
  recalculate(): Promise<void> {
    return Promise.resolve();
  }
}
