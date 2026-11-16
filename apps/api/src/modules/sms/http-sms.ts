import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { NoopSms, type SmsPort } from '../../common/ports/sms.port';

@Injectable()
export class HttpSms implements SmsPort {
  private readonly logger = new Logger(HttpSms.name);
  constructor(private readonly config: ConfigService<Env, true>) {}

  async sendShiftClosed(input: Parameters<SmsPort['sendShiftClosed']>[0]): Promise<void> {
    await this.send(input.phone, input.message);
  }

  sendPanicAlert(input: Parameters<SmsPort['sendPanicAlert']>[0]): Promise<{ sent: boolean }> {
    return this.send(input.phone, input.message);
  }

  private async send(to: string, message: string): Promise<{ sent: boolean }> {
    try {
      const url = this.config.get('SMS_GATEWAY_URL', { infer: true });
      const token = this.config.get('SMS_GATEWAY_TOKEN', { infer: true });
      if (!url || !token) throw new Error('Proveedor incompleto');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, message }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('Proveedor rechazó el envío');
      // shortcut: estimate from HU-36, replace with the contracted tariff when a provider is activated.
      this.logger.log({ event: 'sms.accepted', estimatedCostUsd: 0.08 });
      return { sent: true };
    } catch {
      this.logger.error({ event: 'sms.delivery_failed' });
      return { sent: false };
    }
  }
}

export function smsProvider(config: ConfigService<Env, true>): SmsPort {
  return config.get('SMS_PROVIDER', { infer: true }) === 'http'
    ? new HttpSms(config)
    : new NoopSms();
}
