import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import type { Env } from '../../config/env';
import { Public } from '../auth/auth.decorators';
import { verifyMercadoPagoSignature } from './mercadopago-signature';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';

const notificationSchema = z.object({
  id: z
    .union([z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), z.number().int().nonnegative()])
    .transform(String),
  type: z.string().min(1).max(100),
  action: z.string().max(100).optional(),
  data: z.object({ id: z.union([z.string().min(1).max(100), z.number()]).transform(String) }),
});

@ApiTags('Webhooks')
@Controller({ path: 'webhooks/mercadopago', version: '1' })
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly webhook: MercadoPagoWebhookService,
  ) {}

  /** Public: authenticity comes from the `x-signature` HMAC, not from the caller. */
  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recibe avisos firmados de Mercado Pago' })
  @ApiHeader({ name: 'x-signature', required: true, description: 'Firma HMAC de Mercado Pago' })
  @ApiHeader({ name: 'x-request-id', required: true, description: 'Identificador de la solicitud' })
  @ApiResponse({ status: 200, description: 'Aviso validado y encolado' })
  @ApiResponse({ status: 401, description: 'Firma inválida' })
  async receive(
    @Body() raw: unknown,
    @Query('data.id') queryDataId: string | undefined,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ) {
    const secret = this.config.get('MERCADOPAGO_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      this.logger.warn('Falta MERCADOPAGO_WEBHOOK_SECRET: se rechazan los avisos');
      throw new ServiceUnavailableException();
    }
    const notification = parseOrBadRequest(notificationSchema, raw);
    const dataId = queryDataId ?? notification.data.id;
    const { valid, ts } = verifyMercadoPagoSignature({ signature, requestId, dataId, secret });
    if (!valid) {
      this.logger.error({
        event: 'subscription.notification',
        correlationId: notification.id,
        result: 'invalid_signature',
        requestId,
      });
      throw new UnauthorizedException();
    }
    this.logger.log(
      `Aviso válido: ${notification.type}/${notification.action ?? '-'} id=${dataId} ts=${ts}`,
    );
    // Answer fast and fetch afterwards; Mercado Pago retries if the response is slow.
    await this.webhook.receive({
      id: notification.id,
      type: notification.type,
      action: notification.action,
      resourceId: dataId,
    });
    return { received: true };
  }
}
