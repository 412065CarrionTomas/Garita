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
    this.logger.log({
      event: 'shift_closed_sms_pending',
      shiftId: input.shiftId,
      guardId: input.guardId,
    });
    return Promise.resolve();
  }

  sendPanicAlert(input: { companyId: string; alertId: string }): Promise<{ sent: boolean }> {
    // Default log provider: no credentials and no external delivery.
    this.logger.log({
      event: 'panic_sms_skipped',
      companyId: input.companyId,
      alertId: input.alertId,
    });
    return Promise.resolve({ sent: false });
  }
}
