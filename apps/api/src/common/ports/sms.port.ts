import { Injectable, Logger } from '@nestjs/common';

export const SMS_PORT = Symbol('SMS_PORT');

export interface SmsPort {
  sendShiftClosed(input: {
    phone: string;
    shiftId: string;
    guardId: string;
    message: string;
  }): Promise<void>;
  /** Panic SMS to one recipient (HU-24). Returns whether it was handed to a provider. */
  sendPanicAlert(input: {
    phone: string;
    companyId: string;
    alertId: string;
    message: string;
  }): Promise<{ sent: boolean }>;
}

@Injectable()
export class NoopSms implements SmsPort {
  private readonly logger = new Logger(NoopSms.name);

  sendShiftClosed(input: {
    phone: string;
    shiftId: string;
    guardId: string;
    message: string;
  }): Promise<void> {
    // TODO(HU-24-proveedor): replace this placeholder with the real SMS provider.
    this.logger.log({
      event: 'shift_closed_sms_pending',
      shiftId: input.shiftId,
      guardId: input.guardId,
    });
    return Promise.resolve();
  }

  sendPanicAlert(input: { companyId: string; alertId: string }): Promise<{ sent: boolean }> {
    // shortcut: log only (user decision 28/10), wire a real provider in Sprint 5.
    this.logger.log({
      event: 'panic_sms_skipped',
      companyId: input.companyId,
      alertId: input.alertId,
    });
    return Promise.resolve({ sent: false });
  }
}
