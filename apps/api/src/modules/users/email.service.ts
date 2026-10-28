import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface InvitationMailer {
  sendInvitation(input: { name: string; email: string; link: string }): Promise<{ id: string }>;
}

@Injectable()
export class ResendInvitationMailer implements InvitationMailer {
  private readonly logger = new Logger(ResendInvitationMailer.name);
  constructor(private readonly config: ConfigService<Env, true>) {}

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
