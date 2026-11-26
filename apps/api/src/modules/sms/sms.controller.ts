import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  PAGE_SIZES,
  SMS_INBOUND_AUTH_RESULTS,
  smsInboundQuerySchema,
  smsWebhookBodySchema,
} from '@garita/shared';
import type { Env } from '../../config/env';
import { CLOCK, type Clock } from '../../common/clock';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { Public, Roles } from '../auth/auth.decorators';
import { verifySmsSignature } from './sms-signature';
import { SmsRateLimit } from './sms-rate-limit';
import { SmsInboundService } from './sms-inbound.service';

@ApiTags('SMS')
@Controller('webhooks/sms')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly limit: SmsRateLimit,
    private readonly sms: SmsInboundService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  @Post()
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recibe un SMS firmado por la pasarela y activa el pánico' })
  @ApiHeader({
    name: 'x-sms-timestamp',
    required: true,
    description: 'Segundos Unix; ventana de 5 minutos',
  })
  @ApiHeader({
    name: 'x-sms-signature',
    required: true,
    description: 'sha256=<HMAC-SHA256(timestamp.cuerpo crudo)>',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id', 'from', 'text', 'receivedAt'],
      properties: {
        id: { type: 'string', maxLength: 100 },
        from: { type: 'string', maxLength: 40 },
        text: { type: 'string', maxLength: 1600 },
        receivedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'SMS registrado; incluye repetidos y desconocidos' })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido' })
  @ApiResponse({ status: 401, description: 'Sin secreto o firma válida y reciente' })
  @ApiResponse({ status: 429, description: 'Más de 60 pedidos por IP y minuto' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-sms-timestamp') timestamp?: string,
    @Headers('x-sms-signature') signature?: string,
  ) {
    const secret = this.config.get('SMS_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      this.logger.error({ event: 'sms.webhook_unconfigured' });
      throw new UnauthorizedException();
    }
    await this.limit.check(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    if (
      !verifySmsSignature({
        rawBody: req.rawBody,
        timestamp,
        signature,
        secret,
        now: this.clock.now(),
      })
    ) {
      this.logger.error({ event: 'sms.invalid_signature' });
      throw new UnauthorizedException();
    }
    await this.sms.receive(parseOrBadRequest(smsWebhookBodySchema, body));
    return { received: true };
  }
}

@ApiTags('SMS')
@ApiBearerAuth()
@Controller('sms-recibidos')
@Roles('admin')
export class SmsInboundController {
  constructor(private readonly sms: SmsInboundService) {}
  @Get()
  @ApiOperation({ summary: 'Lista SMS de la empresa; excluye mensajes sin empresa' })
  @ApiQuery({ name: 'estado', enum: SMS_INBOUND_AUTH_RESULTS, required: false })
  @ApiQuery({ name: 'buscar', type: String, required: false })
  @ApiQuery({ name: 'pagina', type: Number, required: false })
  @ApiQuery({ name: 'porPagina', enum: [...PAGE_SIZES], required: false })
  @ApiResponse({
    status: 200,
    description: 'items, total, page, pageSize y resumen por estado; 20 por página por defecto',
  })
  @ApiResponse({ status: 401, description: 'Sin token' })
  @ApiResponse({ status: 403, description: 'Solo administrador' })
  list(@Query() raw: unknown) {
    return this.sms.list(parseOrBadRequest(smsInboundQuerySchema, raw));
  }
}
