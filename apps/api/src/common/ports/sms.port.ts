import { Injectable, Logger } from '@nestjs/common';

export const SMS_PORT = Symbol('SMS_PORT');

export interface SmsPort {
  sendShiftClosed(input: {
    phone: string;
    shiftId: string;
    guardId: string;
    message: string;
  }): Promise<void>;
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
    // TODO(HU-24): replace this placeholder with the real SMS provider.
    this.logger.log({
      event: 'shift_closed_sms_pending',
      shiftId: input.shiftId,
      guardId: input.guardId,
    });
    return Promise.resolve();
  }
}
