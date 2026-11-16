import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { z } from 'zod';

export interface InvitationMailer {
  sendInvitation(input: { name: string; email: string; link: string }): Promise<{ id: string }>;
}

@Injectable()
export class ResendInvitationMailer implements InvitationMailer {
  private readonly logger = new Logger(ResendInvitationMailer.name);
  constructor(private readonly config: ConfigService<Env, true>) {}

  async sendTrialReminder(input: {
    name: string;
    email: string;
    daysLeft: number;
    companyId: string;
    userId: string;
  }): Promise<{ id: string }> {
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('RESEND_FROM', { infer: true });
    if (!key || !from) throw new Error('Resend no está configurado');
    const link = new URL(
      '/suscripcion',
      this.config.get('WEB_APP_URL', { infer: true }),
    ).toString();
    const reminder =
      input.daysLeft === 1
        ? 'Te queda 1 día de prueba'
        : `Te quedan ${input.daysLeft} días de prueba`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `trial-${input.companyId}-${input.daysLeft}-${input.userId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: `${reminder} en Garita`,
        html: `<main><h1>Garita</h1><p>Hola ${escapeHtml(input.name)}. ${reminder}.</p><p>Suscribite para seguir usando Garita al terminar la prueba.</p><p><a href="${escapeHtml(link)}">Suscribirme</a></p></main>`,
        text: `Hola ${input.name}. ${reminder}. Suscribite para seguir usando Garita al terminar la prueba: ${link}`,
      }),
    });
    const parsed = z.object({ id: z.string() }).safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      this.logger.error({
        event: 'resend_trial_reminder',
        status: response.status,
        result: 'failed',
      });
      throw new Error(`Resend respondió ${response.status}`);
    }
    this.logger.log({
      event: 'resend_trial_reminder',
      providerMessageId: parsed.data.id,
      result: 'sent',
    });
    return parsed.data;
  }

  async sendGraceReminder(input: {
    name: string;
    email: string;
    companyId: string;
    userId: string;
    chargeId: string;
    daysLeft: number;
    endsAt: Date;
    timezone: string;
    amount: string;
  }): Promise<{ id: string }> {
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('RESEND_FROM', { infer: true });
    if (!key || !from) throw new Error('Resend no está configurado');
    const link = new URL(
      '/suscripcion',
      this.config.get('WEB_APP_URL', { infer: true }),
    ).toString();
    const deadline = new Intl.DateTimeFormat('es-AR', {
      timeZone: input.timezone,
      dateStyle: 'short',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(input.endsAt);
    const reminder =
      input.daysLeft === 0
        ? 'Tu cobro mensual fue rechazado'
        : input.daysLeft === 1
          ? 'Hoy termina el período de gracia'
          : `Quedan ${input.daysLeft} días de gracia`;
    const message = `${reminder}. Monto adeudado: ARS ${input.amount}. Fecha límite: ${deadline} (${input.timezone}). El servicio sigue funcionando durante la gracia.`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `grace-${input.chargeId}-${input.daysLeft}-${input.userId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: `${reminder} en Garita`,
        html: `<main><h1>Garita</h1><p>Hola ${escapeHtml(input.name)}.</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(link)}">Regularizar el cobro</a></p></main>`,
        text: `Hola ${input.name}. ${message} Regularizar el cobro: ${link}`,
      }),
    });
    const parsed = z.object({ id: z.string() }).safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      this.logger.error({
        event: 'subscription.grace.email',
        companyId: input.companyId,
        status: response.status,
        result: 'failed',
      });
      throw new Error(`Resend respondió ${response.status}`);
    }
    this.logger.log({
      event: 'subscription.grace.email',
      companyId: input.companyId,
      providerMessageId: parsed.data.id,
      result: 'sent',
    });
    return parsed.data;
  }

  async sendInvitation(input: {
    name: string;
    email: string;
    link: string;
  }): Promise<{ id: string }> {
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('RESEND_FROM', { infer: true });
    if (!key || !from) throw new Error('Resend no está configurado');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: 'Invitación a Garita',
        html: `<main><h1>Garita</h1><p>Hola ${escapeHtml(input.name)}, te invitaron a Garita.</p><p><a href="${escapeHtml(input.link)}">Activar cuenta</a></p><p>${escapeHtml(input.link)}</p></main>`,
        text: `Garita\nHola ${input.name}, te invitaron a Garita.\nActivá tu cuenta: ${input.link}`,
      }),
    });
    const body: unknown = await response.json();
    if (
      !response.ok ||
      typeof body !== 'object' ||
      body === null ||
      !('id' in body) ||
      typeof body.id !== 'string'
    ) {
      this.logger.error({ event: 'resend_invitation', status: response.status, result: 'failed' });
      throw new Error(`Resend respondió ${response.status}`);
    }
    this.logger.log({ event: 'resend_invitation', providerMessageId: body.id, result: 'sent' });
    return { id: body.id };
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
