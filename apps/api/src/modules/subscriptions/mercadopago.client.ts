import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env';

const BASE_URL = 'https://api.mercadopago.com';

export const preapprovalSchema = z.object({
  id: z.string(),
  status: z.string(),
  init_point: z.string().optional(),
  external_reference: z.string().nullish(),
  next_payment_date: z.string().nullish(),
});
export type MercadoPagoPreapproval = z.infer<typeof preapprovalSchema>;

export const authorizedPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.string(),
  transaction_amount: z.number(),
  date_created: z.string().nullish(),
  retry_attempt: z.number().nullish(),
  payment: z
    .object({
      id: z.union([z.string(), z.number()]).transform(String).nullish(),
      status: z.string().nullish(),
      status_detail: z.string().nullish(),
    })
    .nullish(),
});
export type MercadoPagoAuthorizedPayment = z.infer<typeof authorizedPaymentSchema>;

const authorizedPaymentSearchSchema = z.object({ results: z.array(authorizedPaymentSchema) });

export interface CreatePreapprovalInput {
  reason: string;
  externalReference: string;
  payerEmail: string;
  backUrl: string;
  amount: number;
  /** Omitted to charge right away. */
  startDate?: Date;
}

/** Thin wrapper over Mercado Pago's REST API; responses are validated before use. */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  createPreapproval(input: CreatePreapprovalInput): Promise<MercadoPagoPreapproval> {
    return this.request('POST', '/preapproval', preapprovalSchema, {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: input.amount,
        currency_id: 'ARS',
        ...(input.startDate ? { start_date: input.startDate.toISOString() } : {}),
      },
    });
  }

  getPreapproval(id: string): Promise<MercadoPagoPreapproval> {
    return this.request('GET', `/preapproval/${encodeURIComponent(id)}`, preapprovalSchema);
  }

  cancelPreapproval(id: string): Promise<MercadoPagoPreapproval> {
    return this.request('PUT', `/preapproval/${encodeURIComponent(id)}`, preapprovalSchema, {
      status: 'cancelled',
    });
  }

  getAuthorizedPayment(id: string): Promise<MercadoPagoAuthorizedPayment> {
    return this.request(
      'GET',
      `/authorized_payments/${encodeURIComponent(id)}`,
      authorizedPaymentSchema,
    );
  }

  async searchAuthorizedPayments(preapprovalId: string): Promise<MercadoPagoAuthorizedPayment[]> {
    const query = new URLSearchParams({ preapproval_id: preapprovalId });
    const page = await this.request(
      'GET',
      `/authorized_payments/search?${query.toString()}`,
      authorizedPaymentSearchSchema,
    );
    return page.results;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const token = this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true });
    if (!token) throw new ServiceUnavailableException('Mercado Pago no está configurado');
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.warn(
        `Mercado Pago respondió ${res.status} a ${method} ${path}: ${JSON.stringify(data)}`,
      );
      throw new BadGatewayException('Mercado Pago rechazó la operación');
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      this.logger.error(`Respuesta inesperada de Mercado Pago en ${method} ${path}`);
      throw new BadGatewayException('Respuesta inesperada de Mercado Pago');
    }
    return parsed.data;
  }
}
