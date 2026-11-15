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
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import type { Env } from '../../config/env';
import { Public } from '../auth/auth.decorators';
import { verifyMercadoPagoSignature } from './mercadopago-signature';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';

const notificationSchema = z.object({
  type: z.string().min(1).max(100),
  action: z.string().max(100).optional(),
  data: z.object({ id: z.union([z.string().min(1).max(100), z.number()]).transform(String) }),
});

@ApiExcludeController()
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
  receive(
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
      this.logger.warn(`Aviso de Mercado Pago con firma inválida (request-id ${requestId ?? '-'})`);
      throw new UnauthorizedException();
    }
    this.logger.log(
      `Aviso válido: ${notification.type}/${notification.action ?? '-'} id=${dataId} ts=${ts}`,
    );
    // Answer fast and fetch afterwards; Mercado Pago retries if the response is slow.
    void this.webhook.handle(notification.type, dataId);
    return { received: true };
  }
}
