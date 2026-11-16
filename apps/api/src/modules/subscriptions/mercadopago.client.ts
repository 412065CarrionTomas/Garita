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
  auto_recurring: z
    .object({
      transaction_amount: z
        .union([z.string().regex(/^\d+(?:\.\d{1,2})?$/), z.number().nonnegative()])
        .nullish(),
    })
    .nullish(),
});
export type MercadoPagoPreapproval = z.infer<typeof preapprovalSchema>;

export const authorizedPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.string(),
  status: z.string().optional(),
  transaction_amount: z.union([z.string().regex(/^\d+(?:\.\d{1,2})?$/), z.number().nonnegative()]),
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

const authorizedPaymentSearchSchema = z.object({
  results: z.array(authorizedPaymentSchema),
  paging: z
    .object({
      total: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
    })
    .optional(),
});
const paymentSchema = z.object({
  currency_id: z.string().optional(),
  date_of_expiration: z.iso.datetime({ offset: true }).nullish(),
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  status_detail: z.string().nullish(),
  external_reference: z.string().nullish(),
  transaction_amount: z.union([z.string().regex(/^\d+(?:\.\d{1,2})?$/), z.number().nonnegative()]),
});
export type MercadoPagoPayment = z.infer<typeof paymentSchema>;

export class MercadoPagoRetryableError extends Error {
  constructor(
    readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
  }
}

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

  /** `cancelled` is final in Mercado Pago; `paused` stops debits and can go back to `authorized`. */
  setPreapprovalStatus(
    id: string,
    status: 'paused' | 'authorized' | 'cancelled',
  ): Promise<MercadoPagoPreapproval> {
    return this.request('PUT', `/preapproval/${encodeURIComponent(id)}`, preapprovalSchema, {
      status,
    });
  }

  cancelPreapproval(id: string): Promise<MercadoPagoPreapproval> {
    return this.setPreapprovalStatus(id, 'cancelled');
  }

  getAuthorizedPayment(id: string): Promise<MercadoPagoAuthorizedPayment> {
    return this.request(
      'GET',
      `/authorized_payments/${encodeURIComponent(id)}`,
      authorizedPaymentSchema,
    );
  }

  async searchAuthorizedPayments(preapprovalId: string): Promise<MercadoPagoAuthorizedPayment[]> {
    const payments: MercadoPagoAuthorizedPayment[] = [];
    for (let offset = 0; ;) {
      const query = new URLSearchParams({
        preapproval_id: preapprovalId,
        offset: String(offset),
        limit: '20',
      });
      const page = await this.request(
        'GET',
        `/authorized_payments/search?${query.toString()}`,
        authorizedPaymentSearchSchema,
      );
      payments.push(...page.results);
      offset += page.results.length;
      if (!page.paging || offset >= page.paging.total || page.results.length === 0) return payments;
    }
  }

  getPayment(id: string): Promise<MercadoPagoPayment> {
    return this.request('GET', `/v1/payments/${encodeURIComponent(id)}`, paymentSchema);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    serialized = false,
  ): Promise<T> {
    const token = this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true });
    if (!token) throw new ServiceUnavailableException('Mercado Pago no está configurado');
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Validated decimal strings become JSON numbers without a floating point conversion.
      body:
        body === undefined
          ? undefined
          : serialized && typeof body === 'string'
            ? body
            : JSON.stringify(body).replace(
                /"(unit_price|transaction_amount)":"(\d+(?:\.\d{1,2})?)"/g,
                '"$1":$2',
              ),
      signal: AbortSignal.timeout(10_000),
    });
    const data: unknown = await res.json().catch(() => null);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = res.headers.get('Retry-After');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1000
        : Math.max(0, Date.parse(retryAfter ?? '') - Date.now());
      throw new MercadoPagoRetryableError(
        Number.isFinite(retryAfterMs) ? retryAfterMs : 5000,
        `Mercado Pago HTTP ${res.status}`,
      );
    }
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

  updatePreapprovalAmount(id: string, amount: string): Promise<MercadoPagoPreapproval> {
    z.string()
      .regex(/^\d+\.\d{2}$/)
      .parse(amount);
    return this.request('PUT', `/preapproval/${encodeURIComponent(id)}`, preapprovalSchema, {
      auto_recurring: { transaction_amount: amount, currency_id: 'ARS' },
    });
  }

  // https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/search-payments/get
  async searchGracePayments(externalReference: string): Promise<MercadoPagoPayment[]> {
    const payments: MercadoPagoPayment[] = [];
    const schema = z.object({
      results: z.array(paymentSchema),
      paging: z.object({ total: z.number().int().nonnegative() }),
    });
    for (let offset = 0; ;) {
      const query = new URLSearchParams({
        external_reference: externalReference,
        sort: 'date_created',
        criteria: 'desc',
        offset: String(offset),
        limit: '50',
      });
      const page = await this.request('GET', `/v1/payments/search?${query.toString()}`, schema);
      payments.push(...page.results);
      offset += page.results.length;
      if (offset >= page.paging.total || page.results.length === 0) return payments;
    }
  }

  // https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/term-of-preference
  async expirePreference(id: string, expiresAt: Date): Promise<void> {
    await this.request(
      'PUT',
      `/checkout/preferences/${encodeURIComponent(id)}`,
      z.object({ id: z.string() }),
      {
        expires: true,
        expiration_date_to: expiresAt.toISOString(),
      },
    );
  }

  // https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post
  async createPreference(input: {
    externalReference: string;
    title: string;
    amount: string;
    backUrl: string;
    excludeOffline?: boolean;
  }): Promise<{ id: string; initPoint: string }> {
    const amount = z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .parse(input.amount);
    // MP expects a JSON number: emit the validated decimal token without floating point conversion.
    const body = JSON.stringify({
      external_reference: input.externalReference,
      items: [
        { title: input.title, quantity: 1, currency_id: 'ARS', unit_price: '__DECIMAL_AMOUNT__' },
      ],
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      expires: true,
      expiration_date_to: new Date(Date.now() + 86_400_000).toISOString(),
      // Avoid vouchers that can settle long after the upgrade quote expires.
      ...(input.excludeOffline && {
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      }),
    }).replace('"unit_price":"__DECIMAL_AMOUNT__"', '"unit_price":' + amount);
    const preference = await this.request(
      'POST',
      '/checkout/preferences',
      z.object({ id: z.string(), init_point: z.url() }),
      body,
      true,
    );
    return { id: preference.id, initPoint: preference.init_point };
  }
}
